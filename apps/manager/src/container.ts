/**
 * L3 isolation: Docker container backend.
 *
 * Each installed version is baked into an image (`dsh-entity-manager:<ref>`)
 * that embeds the dsh install; entities with isolation 'container' run as
 * `docker run` with the entity home mounted as $DSH_HOME and the port mapped.
 *
 * Requires a running Docker daemon; every failure here surfaces as a clear
 * error on the entity status.
 */
import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

export const IMAGE_PREFIX = 'dsh-entity-manager'

export interface ContainerRunOptions {
  ref: string
  versionDir: string
  entityId: string
  port: number
  homeDir: string
  profile: string
  extraArgs: string[]
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function imageName(ref: string): string {
  // refs can contain slashes/colons (npm versions do not, git refs might)
  const safe = ref.replace(/[^a-zA-Z0-9._-]/g, '-')
  return `${IMAGE_PREFIX}:${safe}`
}

/** Build (once) the image embedding the installed version. */
export async function ensureImage(ref: string, versionDir: string): Promise<string> {
  const image = imageName(ref)
  try {
    await execFileAsync('docker', ['image', 'inspect', image])
    return image
  } catch {
    // not built yet — fall through to build
  }
  if (!existsSync(join(versionDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    throw new Error(`version ${ref} has no node_modules/@deepseek-ai/dsh/lib/bin.js; install it first`)
  }
  // Transparent TCP proxy baked into the image: DSH's web app refuses to bind
  // 0.0.0.0 (RCE guard), but published ports only reach a container-side
  // 0.0.0.0 listener (and Docker Desktop host-networking is VM-level loopback).
  // The proxy listens on 0.0.0.0:<port> and relays to 127.0.0.1:<port>, so
  // `-p <port>:<port>` works on macOS AND Linux.
  const proxyPath = join(versionDir, '.dshm-proxy.cjs')
  writeFileSync(
    proxyPath,
    [
      "const { spawn } = require('node:child_process')",
      "const net = require('node:net')",
      "const args = process.argv.slice(2)",
      "const port = Number(args[args.indexOf('--port') + 1]) || 3000",
      "const dsh = spawn('node', ['--expose-internals', '/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js', ...args], { stdio: 'inherit', env: process.env })",
      'const server = net.createServer((client) => {',
      "  const upstream = net.connect(port, '127.0.0.1')",
      '  client.pipe(upstream); upstream.pipe(client)',
      "  client.on('error', () => upstream.destroy())",
      "  upstream.on('error', () => client.destroy())",
      '})',
      "server.listen(port + 1, '0.0.0.0')",
      "dsh.on('exit', (code) => process.exit(code ?? 1))",
      '',
    ].join('\n'),
    'utf8',
  )
  const dockerfile = join(tmpdir(), `dshm-dockerfile-${randomUUID()}`)
  writeFileSync(
    dockerfile,
    [
      'FROM node:22-slim',
      // Several DSH runtime deps need native modules that ship no Linux
      // prebuilds in their tarballs (node-pty, koffi, ...) and were skipped by
      // --ignore-scripts during the host install. Compile/restore them all in
      // the image; apt layers are cached, so this runs once per version image.
      'RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ cmake && rm -rf /var/lib/apt/lists/*',
      'COPY . /dsh',
      'WORKDIR /dsh',
      'RUN npm rebuild',
      'ENTRYPOINT ["node", "/dsh/.dshm-proxy.cjs"]',
      '',
    ].join('\n'),
    'utf8',
  )
  try {
    await execFileAsync('docker', ['build', '-t', image, '-f', dockerfile, versionDir], {
      maxBuffer: 32 * 1024 * 1024,
    })
  } finally {
    // best effort cleanup of the temp dockerfile
    await execFileAsync('rm', ['-f', dockerfile]).catch(() => {})
  }
  return image
}

/** Start the entity container; returns the container id. */
export async function containerRun(options: ContainerRunOptions): Promise<string> {
  if (!(await dockerAvailable())) {
    throw new Error('isolation "container" requires a running Docker daemon')
  }
  const { ref, versionDir, entityId, port, homeDir, profile, extraArgs } = options
  const image = await ensureImage(ref, versionDir)
  const name = `dshm-${entityId}`
  const args = [
    'run', '-d', '--name', name,
    // published port reaches the image's 0.0.0.0 proxy -> loopback dsh server
    '-p', `${port}:${port + 1}`,
    '-v', `${homeDir}:/dsh-home`,
    '-e', 'DSH_HOME=/dsh-home',
    '--restart', 'no',
    image,
    '--profile', profile,
    '--port', String(port),
    ...extraArgs,
  ]
  const { stdout } = await execFileAsync('docker', args, { maxBuffer: 16 * 1024 * 1024 })
  const containerId = stdout.trim()
  if (!containerId) throw new Error('docker run returned no container id')
  return containerId
}

export async function containerStop(entityId: string): Promise<void> {
  const name = `dshm-${entityId}`
  await execFileAsync('docker', ['stop', name]).catch(() => {})
  await execFileAsync('docker', ['rm', name]).catch(() => {})
}

export async function containerLogs(entityId: string, lines: number): Promise<string> {
  const name = `dshm-${entityId}`
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker', ['logs', '--tail', String(lines), name],
      { maxBuffer: 16 * 1024 * 1024 },
    )
    return (stdout + stderr).trim()
  } catch {
    return ''
  }
}

export async function containerIsRunning(entityId: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', `dshm-${entityId}`],
    )
    return stdout.trim() === 'true'
  } catch {
    return false
  }
}

/** After a manager restart, reconcile stale "running" container entities. */
export async function reconcileContainers(entityIds: string[]): Promise<Set<string>> {
  const alive = new Set<string>()
  for (const id of entityIds) {
    if (await containerIsRunning(id)) alive.add(id)
  }
  return alive
}
