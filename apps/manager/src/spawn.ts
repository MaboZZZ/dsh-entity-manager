/**
 * Entity lifecycle with isolation levels (M0 process + L2 sandbox + L3 container).
 *
 * - 'process': direct child process (default).
 * - 'sandbox' (L2): the process is wrapped in DSH's Landlock launcher on Linux
 *   (read-only /, writable only the entity home + logs).
 * - 'container' (L3): the installed version is baked into a Docker image and
 *   the entity runs as a container with the home mounted as $DSH_HOME and the
 *   port mapped.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createWriteStream, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EntityInfo, EntityStatus } from '@dshm/shared'
import {
  containerIsRunning,
  containerLogs,
  containerRun,
  containerStop,
  dockerAvailable,
  reconcileContainers,
  type ContainerRunOptions,
} from './container.ts'
import { sandboxWrap } from './sandbox.ts'
import { EntityStore } from './store.ts'
import { VersionRegistry } from './versions.ts'

const READY_TIMEOUT_MS = 60_000
const PROBE_INTERVAL_MS = 500
const STOP_GRACE_MS = 10_000

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
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePromise(port))
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, PROBE_INTERVAL_MS))
  }
  return false
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolvePromise()
    const timer = setTimeout(() => resolvePromise(), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
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

  /** After a manager restart, drop stale "running" statuses (process + container). */
  async reconcile(): Promise<void> {
    const processIds: string[] = []
    const containerIds: string[] = []
    for (const entity of this.store.list()) {
      if (entity.status.phase !== 'running') continue
      if (entity.spec.isolation === 'container') {
        containerIds.push(entity.spec.id)
      } else if (entity.status.pid !== null && !isAlive(entity.status.pid)) {
        processIds.push(entity.spec.id)
      }
    }
    for (const id of processIds) {
      this.store.patchStatus(id, {
        phase: 'stopped', pid: null, port: null, startedAt: null,
        error: 'process no longer alive after manager restart', containerId: null,
      })
    }
    const aliveContainers = await reconcileContainers(containerIds)
    for (const id of containerIds) {
      if (!aliveContainers.has(id)) {
        this.store.patchStatus(id, {
          phase: 'stopped', pid: null, port: null, startedAt: null,
          error: 'container no longer running after manager restart', containerId: null,
        })
      }
    }
  }

  async start(entity: EntityInfo): Promise<EntityInfo> {
    const { spec } = entity
    if (this.children.has(spec.id)) throw new Error(`entity ${spec.id} is already running`)

    const launch = this.versions.resolve(spec.version)
    const port = spec.port !== 0 ? spec.port : await freePort()
    // Persist an OS-assigned port so restarts keep the same URL.
    if (spec.port !== port) {
      this.store.upsert({ ...spec, port })
      spec.port = port
    }
    const homeDir = spec.homeDir
    mkdirSync(homeDir, { recursive: true })
    mkdirSync(this.logsDir, { recursive: true })

    if (spec.isolation === 'container') {
      return this.startContainer(entity, launch, port)
    }
    return this.startProcess(entity, launch, port)
  }

  private async startProcess(
    entity: EntityInfo,
    launch: { nodeArgs: string[]; script: string; cwd: string },
    port: number,
  ): Promise<EntityInfo> {
    const { spec } = entity
    const launchCwd = resolve(launch.cwd)
    const launchScript = resolve(launch.script)

    this.store.patchStatus(spec.id, { phase: 'starting', port, version: spec.version, error: null, containerId: null })

    // L2: wrap in the Landlock launcher; plain process otherwise.
    let command: string
    let args: string[]
    let env: NodeJS.ProcessEnv
    if (spec.isolation === 'sandbox') {
      const wrapped = sandboxWrap(launch, { homeDir: spec.homeDir, logsDir: this.logsDir })
      command = wrapped.command
      args = [...wrapped.args, '--profile', spec.profile, '--port', String(port), ...spec.args]
      env = { ...wrapped.env, DSH_HOME: spec.homeDir, ...spec.env }
    } else {
      command = process.execPath
      args = [...launch.nodeArgs, launchScript, '--profile', spec.profile, '--port', String(port), ...spec.args]
      env = {
        ...process.env,
        DSH_HOME: spec.homeDir,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        ...spec.env,
      }
    }

    const child = spawn(command, args, { cwd: launchCwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.children.set(spec.id, child)

    const logPath = join(this.logsDir, `${spec.id}.log`)
    const stream = createWriteStream(logPath, { flags: 'a' })
    this.logStreams.set(spec.id, stream)
    const append = (chunk: Buffer): void => { stream.write(chunk) }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    child.on('error', (error) => {
      this.children.delete(spec.id)
      this.logStreams.get(spec.id)?.end()
      this.logStreams.delete(spec.id)
      console.error(`[dshm] spawn error for ${spec.id}:`, error instanceof Error ? error.message : String(error))
      this.store.patchStatus(spec.id, {
        phase: 'error', pid: null, startedAt: null,
        error: `failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
        containerId: null,
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
          phase: 'error', pid: null, startedAt: null,
          error: `process exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
          containerId: null,
        })
      }
    })

    // If the child failed to spawn (error event), surface the real error now
    // instead of wasting the whole probe window.
    await new Promise((resolvePromise) => setImmediate(resolvePromise))
    const afterSpawn = this.store.get(spec.id)
    if (afterSpawn?.status.phase === 'error') return this.require(spec.id)

    const ready = await waitForHttp(port, READY_TIMEOUT_MS)
    if (!ready) {
      this.store.patchStatus(spec.id, { phase: 'stopping' })
      child.kill('SIGKILL')
      await waitForExit(child, 5000)
      this.store.patchStatus(spec.id, { phase: 'error', error: 'web server did not become ready in time', containerId: null })
      return this.require(spec.id)
    }
    this.store.patchStatus(spec.id, {
      phase: 'running', pid: child.pid ?? null, port,
      startedAt: new Date().toISOString(), version: spec.version, error: null, containerId: null,
    })
    return this.require(spec.id)
  }

  private async startContainer(
    entity: EntityInfo,
    launch: { script: string; cwd: string },
    port: number,
  ): Promise<EntityInfo> {
    const { spec } = entity
    this.store.patchStatus(spec.id, { phase: 'starting', port, version: spec.version, error: null, containerId: null })
    const options: ContainerRunOptions = {
      ref: spec.version.ref,
      versionDir: resolve(launch.cwd),
      entityId: spec.id,
      port,
      homeDir: spec.homeDir,
      profile: spec.profile,
      extraArgs: spec.args,
    }
    let containerId: string
    try {
      containerId = await containerRun(options)
    } catch (error) {
      this.store.patchStatus(spec.id, {
        phase: 'error', error: `container start failed: ${error instanceof Error ? error.message : String(error)}`,
        containerId: null,
      })
      return this.require(spec.id)
    }
    const ready = await waitForHttp(port, READY_TIMEOUT_MS)
    if (!ready) {
      await containerStop(spec.id)
      this.store.patchStatus(spec.id, { phase: 'error', error: 'web server did not become ready in time', containerId: null })
      return this.require(spec.id)
    }
    this.store.patchStatus(spec.id, {
      phase: 'running', pid: null, port,
      startedAt: new Date().toISOString(), version: spec.version, error: null, containerId,
    })
    return this.require(spec.id)
  }

  async stop(entity: EntityInfo): Promise<EntityInfo> {
    const { spec } = entity
    if (spec.isolation === 'container') {
      this.store.patchStatus(spec.id, { phase: 'stopping', error: null })
      await containerStop(spec.id)
      this.store.patchStatus(spec.id, {
        phase: 'stopped', pid: null, port: null, startedAt: null, error: null, containerId: null,
      })
      return this.require(spec.id)
    }
    const child = this.children.get(spec.id)
    if (!child) {
      this.store.patchStatus(spec.id, {
        phase: 'stopped', pid: null, port: null, startedAt: null, error: null, containerId: null,
      })
      return this.require(spec.id)
    }
    this.store.patchStatus(spec.id, { phase: 'stopping', error: null })
    child.kill('SIGTERM')
    await waitForExit(child, STOP_GRACE_MS)
    if (isAlive(child.pid ?? -1)) {
      child.kill('SIGKILL')
      await waitForExit(child, 5000)
    }
    this.store.patchStatus(spec.id, {
      phase: 'stopped', pid: null, port: null, startedAt: null, error: null, containerId: null,
    })
    return this.require(spec.id)
  }

  /** Last `lines` of the entity's log (process log file or docker logs). */
  async getLogs(entityId: string, lines = 200): Promise<string> {
    const entity = this.store.get(entityId)
    if (entity?.spec.isolation === 'container') {
      return containerLogs(entityId, lines)
    }
    const logPath = join(this.logsDir, `${entityId}.log`)
    if (!existsSync(logPath)) return ''
    const text = readFileSync(logPath, 'utf8')
    const parts = text.split('\n')
    return parts.slice(-Math.max(1, lines)).join('\n')
  }

  /** True when the Docker daemon is reachable (L3 prerequisite). */
  async checkDocker(): Promise<boolean> {
    return dockerAvailable()
  }

  private require(id: string): EntityInfo {
    const info = this.store.get(id)
    if (!info) throw new Error(`entity ${id} disappeared from the store`)
    return info
  }
}

export type { EntityStatus }
