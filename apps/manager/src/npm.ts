/**
 * Robust npm CLI resolution (macOS / Windows / Linux).
 *
 * The packaged app is launched from Finder/Explorer with a minimal PATH: `npm`
 * is not on PATH, and even when its binary is found, it is a shebang wrapper
 * (`#!/usr/bin/env node` / npm.cmd) that also fails without `node` reachable.
 * So instead of invoking `npm`, we always run a node binary directly against
 * the real `npm-cli.js` — no PATH dependency at all.
 *
 * Search order for the node binary:
 *   1. the running node (process.execPath, unless it is the Electron binary)
 *   2. `node` on PATH (which/where)
 *   3. ~/.nvm/versions/node/<v>/bin/node (unix), $NVM_SYMLINK/node.exe (Windows)
 *   4. /opt/homebrew/bin/node, /usr/local/bin/node (unix),
 *      %ProgramFiles%\nodejs\node.exe (Windows)
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

const IS_WIN = process.platform === 'win32'

function isExecutableFile(p: string): boolean {
  try {
    if (existsSync(p)) {
      // Windows has no reliable executable bit; existence is enough there.
      if (IS_WIN) return true
      return (statSync(p).mode & 0o111) !== 0
    }
    return false
  } catch {
    return false
  }
}

async function which(name: string): Promise<string | null> {
  try {
    // Windows: `where` (cmd builtin, but also a real where.exe); unix: which
    const { stdout } = await execFileAsync(IS_WIN ? 'where' : '/usr/bin/which', [name])
    const p = stdout.trim().split(/\r?\n/)[0] ?? ''
    return p ? p : null
  } catch {
    return null
  }
}

function highestNvm(binName: string): string | null {
  if (IS_WIN) {
    // nvm-windows exposes the current node install via NVM_SYMLINK
    const symlink = process.env.NVM_SYMLINK
    if (symlink) {
      const candidate = join(symlink, binName)
      if (isExecutableFile(candidate)) return candidate
    }
    return null
  }
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

/** npm-cli.js next to a node binary, across platform layouts. */
function cliJsBeside(nodePath: string): string | null {
  const nodeDir = dirname(nodePath)
  const candidates = [
    // unix nvm: bin/node -> ../lib/node_modules/npm/bin/npm-cli.js
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    // windows: C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
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
    const realDir = dirname(real)
    const candidates = [
      join(realDir, 'npm-cli.js'),
      // windows: npm.cmd sits in nodejs dir next to node_modules/npm
      join(realDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(realDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(realDir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
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

  // 3. an npm binary found on PATH / nvm / standard locations → its npm-cli.js
  const npmOnPath = await which('npm')
  const nvmNpm = highestNvm(IS_WIN ? 'npm.cmd' : 'npm')
  const standardNpm = IS_WIN
    ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'npm.cmd'),
       join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs', 'npm.cmd')]
    : ['/opt/homebrew/bin/npm', '/usr/local/bin/npm']
  for (const npmPath of [npmOnPath, nvmNpm, ...standardNpm]) {
    if (!npmPath || !isExecutableFile(npmPath)) continue
    const cli = cliJsFromNpmBinary(npmPath)
    if (cli) {
      const nodeForNpm = highestNvm(IS_WIN ? 'node.exe' : 'node')
        ?? nodeOnPath
        ?? (IS_WIN ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe') : process.execPath)
      cached = { cmd: nodeForNpm, prefix: [cli] }
      return cached
    }
  }

  // 4. Windows: nodejs dir's own npm-cli.js with its node.exe
  if (IS_WIN) {
    const nodejsDir = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs')
    const cli = cliJsBeside(join(nodejsDir, 'node.exe'))
    const nodeExe = join(nodejsDir, 'node.exe')
    if (cli && isExecutableFile(nodeExe)) {
      cached = { cmd: nodeExe, prefix: [cli] }
      return cached
    }
  }

  throw new Error(
    'npm CLI not found: launch the app from a terminal, or install Node.js (https://nodejs.org)',
  )
}
