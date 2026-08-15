/**
 * Entity process lifecycle (M0).
 *
 * start: resolve the pinned version's launch info, pick a free port when the
 * spec asks for one, mkdir the entity's $DSH_HOME, spawn
 *   node [nodeArgs] <dsh bin> --profile <profile> --port <port>
 * with DSH_HOME=<entity home> and the entity's env, capture stdout/stderr to
 * a per-entity log file, then health-probe the web server until ready.
 *
 * stop: SIGTERM, escalate to SIGKILL after a grace period.
 *
 * reconcile: after a manager restart, mark stale "running" entities stopped.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createWriteStream, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EntityInfo, EntityStatus } from '@dshm/shared'
import { EntityStore } from './store.ts'
import { VersionRegistry } from './versions.ts'

const READY_TIMEOUT_MS = 60_000
const PROBE_INTERVAL_MS = 500
const STOP_GRACE_MS = 10_000
const LOG_RING_LINES = 1000

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Ask the OS for a free TCP port on loopback. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForHttp(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      try {
        const res = await fetch(`http://127.0.0.1:${String(port)}/`, { signal: controller.signal })
        if (res.ok) return true
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS))
  }
  return false
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => resolve(), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export class EntityProcessManager {
  private readonly children = new Map<string, ChildProcess>()
  private readonly logStreams = new Map<string, ReturnType<typeof createWriteStream>>()

  constructor(
    readonly homesDir: string,
    readonly logsDir: string,
    private readonly versions: VersionRegistry,
    private readonly store: EntityStore,
  ) {}

  /** After a manager restart, drop stale "running" statuses. */
  reconcile(): void {
    for (const entity of this.store.list()) {
      const { status } = entity
      if (status.phase === 'running' && status.pid !== null && !isAlive(status.pid)) {
        this.store.patchStatus(entity.spec.id, {
          phase: 'stopped',
          pid: null,
          port: null,
          startedAt: null,
          error: 'process no longer alive after manager restart',
        })
      }
    }
  }

  async start(entity: EntityInfo): Promise<EntityInfo> {
    const { spec } = entity
    if (this.children.has(spec.id)) throw new Error(`entity ${spec.id} is already running`)

    const launch = this.versions.resolve(spec.version)
    // Absolutize against the manager's cwd: pnpm --filter runs the manager
    // with cwd = the package dir, so relative launch paths would not resolve.
    const launchCwd = resolve(launch.cwd)
    const launchScript = resolve(launch.script)
    const port = spec.port !== 0 ? spec.port : await freePort()
    // Persist an OS-assigned port so restarts keep the same URL.
    if (spec.port !== port) {
      this.store.upsert({ ...spec, port })
      spec.port = port
    }
    const homeDir = spec.homeDir
    mkdirSync(homeDir, { recursive: true })
    mkdirSync(this.logsDir, { recursive: true })

    this.store.patchStatus(spec.id, { phase: 'starting', port, version: spec.version, error: null })

    const args = [
      ...launch.nodeArgs,
      launchScript,
      '--profile',
      spec.profile,
      '--port',
      String(port),
      ...spec.args,
    ]
    const child = spawn(process.execPath, args, {
      cwd: launchCwd,
      env: {
        ...process.env,
        DSH_HOME: homeDir,
        // Under Electron (M4) process.execPath is the Electron binary; this
        // flag makes it run as plain Node, which is what the dsh bin expects.
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        ...spec.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.children.set(spec.id, child)

    const logPath = join(this.logsDir, `${spec.id}.log`)
    const stream = createWriteStream(logPath, { flags: 'a' })
    this.logStreams.set(spec.id, stream)
    const append = (chunk: Buffer): void => {
      stream.write(chunk)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    // Never let a failed spawn crash the manager.
    child.on('error', (error) => {
      this.children.delete(spec.id)
      this.logStreams.get(spec.id)?.end()
      this.logStreams.delete(spec.id)
      const message = error instanceof Error ? error.message : String(error)
      this.store.patchStatus(spec.id, {
        phase: 'error',
        pid: null,
        startedAt: null,
        error: `failed to spawn process: ${message}`,
      })
    })

    child.on('exit', (code, signal) => {
      this.children.delete(spec.id)
      this.logStreams.get(spec.id)?.end()
      this.logStreams.delete(spec.id)
      const current = this.store.get(spec.id)
      const phase = current?.status.phase
      if (phase === 'starting' || phase === 'running') {
        this.store.patchStatus(spec.id, {
          phase: 'error',
          pid: null,
          startedAt: null,
          error: `process exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
        })
      }
    })

    const ready = await waitForHttp(port, READY_TIMEOUT_MS)
    if (!ready) {
      // move out of starting so the exit handler does not overwrite our message
      this.store.patchStatus(spec.id, { phase: 'stopping' })
      child.kill('SIGKILL')
      await waitForExit(child, 5000)
      this.store.patchStatus(spec.id, { phase: 'error', error: 'web server did not become ready in time' })
      return this.require(spec.id)
    }
    this.store.patchStatus(spec.id, {
      phase: 'running',
      pid: child.pid ?? null,
      port,
      startedAt: new Date().toISOString(),
      version: spec.version,
      error: null,
    })
    return this.require(spec.id)
  }

  async stop(entity: EntityInfo): Promise<EntityInfo> {
    const { spec } = entity
    const child = this.children.get(spec.id)
    if (!child) {
      this.store.patchStatus(spec.id, { phase: 'stopped', pid: null, port: null, startedAt: null, error: null })
      return this.require(spec.id)
    }
    this.store.patchStatus(spec.id, { phase: 'stopping', error: null })
    child.kill('SIGTERM')
    await waitForExit(child, STOP_GRACE_MS)
    if (isAlive(child.pid ?? -1)) {
      child.kill('SIGKILL')
      await waitForExit(child, 5000)
    }
    this.store.patchStatus(spec.id, { phase: 'stopped', pid: null, port: null, startedAt: null, error: null })
    return this.require(spec.id)
  }

  /** Last `lines` of the entity's log file. */
  getLogs(entityId: string, lines = 200): string {
    const logPath = join(this.logsDir, `${entityId}.log`)
    if (!existsSync(logPath)) return ''
    const text = readFileSync(logPath, 'utf8')
    const parts = text.split('\n')
    return parts.slice(-Math.max(1, lines)).join('\n')
  }

  private require(id: string): EntityInfo {
    const info = this.store.get(id)
    if (!info) throw new Error(`entity ${id} disappeared from the store`)
    return info
  }
}

export type { EntityStatus }
