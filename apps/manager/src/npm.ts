/**
 * Robust npm CLI resolution.
 *
 * The packaged app is launched from Finder with a minimal PATH: `npm` is not
 * on PATH, and even when its binary is found, it is a shebang wrapper
 * (`#!/usr/bin/env node`) that also fails without `node` on PATH. So instead
 * of invoking `npm`, we always run a node binary directly against the real
 * `npm-cli.js` — no PATH dependency at all.
 *
 * Search order for the node binary:
 *   1. the running node (process.execPath, unless it is the Electron binary)
 *   2. `node` on PATH
 *   3. highest ~/.nvm/versions/node/<v>/bin/node
 *   4. /opt/homebrew/bin/node, /usr/local/bin/node
 * Then npm-cli.js is resolved from that node's sibling layout or from an npm
 * binary found on PATH / nvm / Homebrew.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface NpmInvocation {
  /** absolute node binary */
  cmd: string
  /** absolute npm-cli.js path */
  prefix: string[]
}

function isExecutableFile(p: string): boolean {
  try {
    return existsSync(p) && (statSync(p).mode & 0o111) !== 0
  } catch {
    return false
  }
}

async function which(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [name])
    const p = stdout.trim()
    return p ? p : null
  } catch {
    return null
  }
}

function highestNvm(binName: string): string | null {
  const nvm = join(homedir(), '.nvm', 'versions', 'node')
  if (!existsSync(nvm)) return null
  const versions = readdirSync(nvm)
    .filter((v) => /^\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const v of versions) {
    const candidate = join(nvm, v, 'bin', binName)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** npm-cli.js next to a node binary (nvm layout: bin/node -> ../lib/node_modules/npm/bin/npm-cli.js). */
function cliJsBeside(nodePath: string): string | null {
  const candidates = [
    join(dirname(nodePath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(nodePath), '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Resolve npm-cli.js from an npm binary's real location. */
function cliJsFromNpmBinary(npmPath: string): string | null {
  try {
    const real = realpathSync(npmPath)
    if (real.endsWith('npm-cli.js')) return real
    const candidates = [
      join(dirname(real), 'npm-cli.js'),
      join(dirname(real), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(dirname(real), '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  } catch {
    // fall through
  }
  return null
}

let cached: NpmInvocation | null = null

/** Resolve { node, npm-cli.js } once and cache it. */
export async function resolveNpm(): Promise<NpmInvocation> {
  if (cached) return cached

  // 1. running node (skip when it is the Electron binary: it has no npm)
  if (!process.versions.electron) {
    const cli = cliJsBeside(process.execPath)
    if (isExecutableFile(process.execPath) && cli) {
      cached = { cmd: process.execPath, prefix: [cli] }
      return cached
    }
  }

  // 2. node on PATH, with its sibling npm-cli.js
  const nodeOnPath = await which('node')
  if (nodeOnPath) {
    const cli = cliJsBeside(nodeOnPath)
    if (cli) {
      cached = { cmd: nodeOnPath, prefix: [cli] }
      return cached
    }
  }

  // 3. an npm binary found on PATH / nvm / Homebrew → its npm-cli.js
  const npmOnPath = await which('npm')
  const nvmNpm = highestNvm('npm')
  for (const npmPath of [npmOnPath, nvmNpm, '/opt/homebrew/bin/npm', '/usr/local/bin/npm']) {
    if (!npmPath || !isExecutableFile(npmPath)) continue
    const cli = cliJsFromNpmBinary(npmPath)
    if (cli) {
      // use a node from the same tree when possible (nvm), else any node
      const nodeForNpm = highestNvm('node') ?? nodeOnPath ?? process.execPath
      cached = { cmd: nodeForNpm, prefix: [cli] }
      return cached
    }
  }

  throw new Error(
    'npm CLI not found: launch the app from a terminal, or install Node.js (https://nodejs.org)',
  )
}
