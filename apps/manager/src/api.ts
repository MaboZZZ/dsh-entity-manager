/**
 * Manager JSON API (loopback-only HTTP).
 *
 * Skeleton routes: health, entity CRUD (persist only; spawn comes in M0),
 * version listing (live npm view + installed scan; install comes in M0/M1).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type {
  ApiError,
  CreateEntityRequest,
  EntitySpec,
  HealthInfo,
  InstallVersionRequest,
} from '@dshm/shared'
import { EntityStore } from './store.ts'
import { EntityProcessManager } from './spawn.ts'
import { NotImplemented, VersionRegistry } from './versions.ts'

export interface ManagerServerOptions {
  port: number
  rootDir: string
  version: string
}

type Handler = (req: IncomingMessage, res: ServerResponse, rest: string) => Promise<void> | void

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

export function createManagerServer(options: ManagerServerOptions) {
  const store = new EntityStore(options.rootDir)
  const versions = new VersionRegistry(join(options.rootDir, 'versions'))
  const processes = new EntityProcessManager(join(options.rootDir, 'homes'))
  const startedAt = Date.now()

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

  routes.set('DELETE /api/entities/{id}', (_req, res, id) => {
    if (!store.remove(id)) return sendError(res, 404, `entity ${id} not found`)
    res.writeHead(204).end()
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
    try {
      const info = await versions.install(raw.source, raw.ref)
      sendJson(res, 201, info)
    } catch (error) {
      if (error instanceof NotImplemented) return sendError(res, 501, error.message)
      return sendError(res, 500, error instanceof Error ? error.message : String(error))
    }
  })

  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    // exact match first, then /{id} suffix match
    const exact = routes.get(`${method} ${path}`)
    if (exact) return void exact(req, res, '')

    for (const [key, handler] of routes) {
      const match = /^(GET|POST|DELETE) (\/api\/[^/]+)\/\{id\}$/.exec(key)
      if (!match || match[1] !== method || !path.startsWith(match[2] ?? '/')) continue
      const rest = path.slice((match[2] ?? '').length)
      if (rest.startsWith('/') && !rest.slice(1).includes('/')) {
        return void handler(req, res, decodeURIComponent(rest.slice(1)))
      }
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
