/**
 * Manager JSON API (loopback-only HTTP).
 *
 * Routes (M0):
 *   GET    /api/health
 *   GET    /api/entities
 *   POST   /api/entities
 *   GET    /api/entities/{id}
 *   DELETE /api/entities/{id}
 *   POST   /api/entities/{id}/start
 *   POST   /api/entities/{id}/stop
 *   GET    /api/entities/{id}/logs?lines=200
 *   GET    /api/versions
 *   POST   /api/versions/install        { source, ref }
 *   POST   /api/versions/register-local { label, checkoutDir }
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type {
  ApiError,
  CreateEntityRequest,
  EntitySpec,
  HealthInfo,
  InstallVersionRequest,
  RegisterLocalRequest,
  UpdateEntityRequest,
  VersionInfo,
} from '@dshm/shared'
import { JobRunner } from './jobs.ts'
import { EntityStore } from './store.ts'
import { EntityProcessManager } from './spawn.ts'
import { NotImplemented, VersionRegistry } from './versions.ts'

export interface ManagerServerOptions {
  port: number
  rootDir: string
  version: string
}

interface RouteMatch {
  method: string
  pattern: RegExp
  names: string[]
}

type RouteParams = Record<string, string>
type Handler = (req: IncomingMessage, res: ServerResponse, params: RouteParams) => Promise<void> | void

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendError(res: ServerResponse, status: number, error: string): void {
  const body: ApiError = { error }
  sendJson(res, status, body)
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'entity'
}

function compileRoute(key: string): RouteMatch {
  const [method, path] = key.split(' ')
  const names: string[] = []
  const segments = (path ?? '').split('/').map((segment) => {
    if (segment === '{id}') {
      names.push('id')
      return '([^/]+)'
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return { method: method ?? 'GET', pattern: new RegExp(`^${segments.join('/')}$`), names }
}

/** Look up an entity by route id, sending a 404 response on failure. */
function entityOr404(
  res: ServerResponse,
  store: EntityStore,
  id: string | undefined,
): ReturnType<EntityStore['get']> {
  if (!id) {
    sendError(res, 404, 'missing entity id')
    return undefined
  }
  const info = store.get(id)
  if (!info) sendError(res, 404, `entity ${id} not found`)
  return info
}

export function createManagerServer(options: ManagerServerOptions) {
  const store = new EntityStore(options.rootDir)
  const versions = new VersionRegistry(join(options.rootDir, 'versions'))
  const jobs = new JobRunner()
  const processes = new EntityProcessManager(
    join(options.rootDir, 'homes'),
    join(options.rootDir, 'logs'),
    versions,
    store,
  )
  const startedAt = Date.now()

  processes.reconcile()

  const routes = new Map<string, Handler>()

  routes.set('GET /api/health', (_req, res) => {
    const body: HealthInfo = {
      ok: true,
      version: options.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      entities: store.list().length,
    }
    sendJson(res, 200, body)
  })

  routes.set('GET /api/entities', (_req, res) => {
    sendJson(res, 200, store.list())
  })

  routes.set('POST /api/entities', async (req, res) => {
    const raw = (await readJson(req)) as Partial<CreateEntityRequest> | undefined
    if (!raw || typeof raw.name !== 'string' || raw.name === '') {
      return sendError(res, 400, 'name is required')
    }
    if (!raw.version || typeof raw.version.source !== 'string' || typeof raw.version.ref !== 'string') {
      return sendError(res, 400, 'version { source, ref } is required')
    }
    const id = raw.id && raw.id !== '' ? raw.id : `${slugify(raw.name)}-${Date.now().toString(36)}`
    const spec: EntitySpec = {
      id,
      name: raw.name,
      version: { source: raw.version.source, ref: raw.version.ref },
      profile: raw.profile ?? 'web',
      port: typeof raw.port === 'number' ? raw.port : 0,
      isolation: raw.isolation ?? 'process',
      homeDir: raw.homeDir ?? join(options.rootDir, 'homes', id),
      args: raw.args ?? [],
      env: raw.env ?? {},
      createdAt: new Date().toISOString(),
    }
    const info = store.upsert(spec)
    sendJson(res, 201, info)
  })

  routes.set('GET /api/entities/{id}', (_req, res, params) => {
    const info = entityOr404(res, store, params.id)
    if (!info) return
    sendJson(res, 200, info)
  })

  routes.set('DELETE /api/entities/{id}', async (_req, res, params) => {
    const info = entityOr404(res, store, params.id)
    if (!info) return
    if (info.status.phase === 'running' || info.status.phase === 'starting') {
      await processes.stop(info)
    }
    store.remove(info.spec.id)
    res.writeHead(204).end()
  })

  routes.set('POST /api/entities/{id}/start', async (_req, res, params) => {
    const info = entityOr404(res, store, params.id)
    if (!info) return
    try {
      const updated = await processes.start(info)
      sendJson(res, 200, updated)
    } catch (error) {
      if (error instanceof Error && error.name === 'VersionNotInstalled') {
        return sendError(res, 409, error.message)
      }
      return sendError(res, 500, error instanceof Error ? error.message : String(error))
    }
  })

  routes.set('POST /api/entities/{id}/stop', async (_req, res, params) => {
    const info = entityOr404(res, store, params.id)
    if (!info) return
    const updated = await processes.stop(info)
    sendJson(res, 200, updated)
  })

  routes.set('PATCH /api/entities/{id}', async (req, res, params) => {
    const info = entityOr404(res, store, params.id)
    if (!info) return
    const raw = (await readJson(req)) as Partial<UpdateEntityRequest> | undefined
    if (!raw || typeof raw !== 'object') return sendError(res, 400, 'body must be a JSON object')
    if (raw.version !== undefined) {
      if (typeof raw.version.source !== 'string' || typeof raw.version.ref !== 'string') {
        return sendError(res, 400, 'version { source, ref } is required')
      }
    }
    const wasRunning = info.status.phase === 'running' || info.status.phase === 'starting'
    if (wasRunning) await processes.stop(info)

    const spec: EntitySpec = {
      ...info.spec,
      ...(raw.name !== undefined && typeof raw.name === 'string' && raw.name !== '' ? { name: raw.name } : {}),
      ...(raw.version !== undefined ? { version: { source: raw.version.source, ref: raw.version.ref } } : {}),
      ...(raw.profile !== undefined && typeof raw.profile === 'string' ? { profile: raw.profile } : {}),
      ...(raw.port !== undefined && typeof raw.port === 'number' ? { port: raw.port } : {}),
      ...(raw.args !== undefined && Array.isArray(raw.args) ? { args: raw.args } : {}),
      ...(raw.env !== undefined && raw.env !== null && typeof raw.env === 'object'
        ? { env: { ...info.spec.env, ...raw.env } }
        : {}),
    }
    const updated = store.upsert(spec)
    if (wasRunning && raw.restart !== false) {
      try {
        const restarted = await processes.start(updated)
        return sendJson(res, 200, restarted)
      } catch (error) {
        return sendJson(res, 200, {
          ...updated,
          status: { ...updated.status, phase: 'error', error: error instanceof Error ? error.message : String(error) },
        })
      }
    }
    sendJson(res, 200, updated)
  })

  routes.set('GET /api/entities/{id}/logs', (_req, res, params) => {
    const info = entityOr404(res, store, params.id)
    if (!info) return
    const url = new URL(_req.url ?? '/', 'http://localhost')
    const lines = Math.max(1, Math.min(5000, Number(url.searchParams.get('lines') ?? 200) || 200))
    sendJson(res, 200, { id: info.spec.id, logs: processes.getLogs(info.spec.id, lines) })
  })

  routes.set('GET /api/versions', async (_req, res) => {
    const list = await versions.list()
    sendJson(res, 200, list)
  })

  routes.set('POST /api/versions/install', async (req, res) => {
    const raw = (await readJson(req)) as Partial<InstallVersionRequest> | undefined
    if (!raw || raw.source === undefined || typeof raw.ref !== 'string') {
      return sendError(res, 400, 'source and ref are required')
    }
    const source = raw.source
    const ref = raw.ref
    try {
      const job = jobs.submit<VersionInfo>(
        'version-install',
        `install ${source} ${ref}`,
        () => versions.install(source!, ref),
      )
      sendJson(res, 202, job)
    } catch (error) {
      return sendError(res, 500, error instanceof Error ? error.message : String(error))
    }
  })

  routes.set('GET /api/jobs', (_req, res) => {
    sendJson(res, 200, jobs.list())
  })

  routes.set('GET /api/jobs/{id}', (_req, res, params) => {
    const job = params.id ? jobs.get(params.id) : undefined
    if (!job) return sendError(res, 404, `job ${params.id ?? ''} not found`)
    sendJson(res, 200, job)
  })

  routes.set('POST /api/versions/register-local', async (req, res) => {
    const raw = (await readJson(req)) as Partial<RegisterLocalRequest> | undefined
    if (!raw || typeof raw.label !== 'string' || raw.label === '' || typeof raw.checkoutDir !== 'string') {
      return sendError(res, 400, 'label and checkoutDir are required')
    }
    try {
      const info = await versions.registerLocal(raw.label, raw.checkoutDir)
      sendJson(res, 201, info)
    } catch (error) {
      return sendError(res, 400, error instanceof Error ? error.message : String(error))
    }
  })

  const compiled = [...routes.entries()].map(([key, handler]) => ({
    match: compileRoute(key),
    handler,
  }))

  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    for (const { match, handler } of compiled) {
      if (match.method !== method) continue
      const result = match.pattern.exec(path)
      if (!result) continue
      const params: RouteParams = {}
      match.names.forEach((name, index) => {
        params[name] = decodeURIComponent(result[index + 1] ?? '')
      })
      return void handler(req, res, params)
    }
    sendError(res, 404, `no route ${method} ${path}`)
  })

  return {
    start(): Promise<{ url: string; port: number }> {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port, '127.0.0.1', () => {
          const address = server.address()
          const port = typeof address === 'object' && address ? address.port : options.port
          resolve({ url: `http://127.0.0.1:${String(port)}`, port })
        })
      })
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
    get store() {
      return store
    },
    get processes() {
      return processes
    },
  }
}

export type ManagerServer = ReturnType<typeof createManagerServer>
