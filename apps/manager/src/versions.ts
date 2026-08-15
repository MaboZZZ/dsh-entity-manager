/**
 * Version registry: the three sources of DSH versions and the version store
 * under `<manager home>/versions/<ref>/`.
 *
 * M0 status:
 *  - npm source: real install (`npm install` into an isolated dir) + live
 *    `npm view` listing, with an isolated npm cache that never touches the
 *    system cache.
 *  - local source: registration of a DSH source-tree checkout (validated).
 *  - git-tag source: planned for M3.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { VersionInfo, VersionLaunch, VersionSourceKind } from '@dshm/shared'

const execFileAsync = promisify(execFile)

export const DSH_PACKAGE = '@deepseek-ai/dsh'
export const DSH_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'
export const MANIFEST_FILE = 'manifest.json'

/** Thrown by operations the current milestone has not implemented yet. */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented yet: ${what}`)
    this.name = 'NotImplemented'
  }
}

/** Thrown when a pin refers to a version that is not installed. */
export class VersionNotInstalled extends Error {
  constructor(ref: string) {
    super(`version ${ref} is not installed in the version store`)
    this.name = 'VersionNotInstalled'
  }
}

/** One installed version manifest inside the version store. */
interface InstalledManifest {
  ref: string
  source: VersionSourceKind
  installedAt: string
  semver?: string
  summary?: string
  launch: VersionLaunch
}

export class VersionRegistry {
  constructor(readonly versionsDir: string) {
    mkdirSync(versionsDir, { recursive: true })
  }

  async list(): Promise<VersionInfo[]> {
    const installed = this.scanInstalled()
    const byRef = new Map(installed.map((v) => [v.ref, v]))

    // npm source: live registry view with an isolated cache.
    let npmVersions: string[] = []
    try {
      const { stdout } = await execFileAsync(
        'npm',
        ['view', DSH_PACKAGE, 'versions', '--json'],
        { env: this.npmEnv() },
      )
      const parsed = JSON.parse(stdout) as unknown
      if (Array.isArray(parsed)) npmVersions = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      // registry unreachable: fall back to installed-only
    }

    const out: VersionInfo[] = []
    for (const ref of npmVersions) {
      const local = byRef.get(ref)
      out.push(this.toInfo(local, { source: 'npm', ref, semver: ref }))
    }
    for (const local of installed) {
      if (!npmVersions.includes(local.ref)) out.push(this.toInfo(local, local))
    }
    out.sort((a, b) => b.ref.localeCompare(a.ref, undefined, { numeric: true }))
    return out
  }

  async install(source: VersionSourceKind, ref: string): Promise<VersionInfo> {
    switch (source) {
      case 'npm':
        return this.installNpm(ref)
      case 'git-tag':
        return this.installGitTag(ref)
      case 'local':
        throw new NotImplemented('use registerLocal for local checkouts')
    }
  }

  /** Register a DSH source-tree checkout (e.g. the development repo) as a version. */
  async registerLocal(label: string, checkoutDir: string): Promise<VersionInfo> {
    const script = join(checkoutDir, 'apps', 'cli', 'src', 'bin.ts')
    const tsx = join(checkoutDir, 'node_modules', 'tsx', 'package.json')
    if (!existsSync(script)) {
      throw new Error(`not a DSH checkout: missing ${script}`)
    }
    if (!existsSync(tsx)) {
      throw new Error(`checkout has no tsx dependency at ${tsx}; run pnpm install in the checkout first`)
    }
    const dir = join(this.versionsDir, label)
    mkdirSync(dir, { recursive: true })
    const manifest: InstalledManifest = {
      ref: label,
      source: 'local',
      installedAt: new Date().toISOString(),
      summary: `local checkout at ${checkoutDir}`,
      launch: {
        nodeArgs: ['--import', 'tsx/esm'],
        script,
        cwd: checkoutDir,
      },
    }
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    return this.toInfo(manifest, manifest)
  }

  /**
   * Resolve a pin to launch info, or throw VersionNotInstalled.
   * Read from disk each time so a version installed after the manager boot
   * is immediately usable.
   */
  resolve(pin: { source: VersionSourceKind; ref: string }): VersionLaunch {
    const manifest = this.readManifest(pin.ref)
    if (!manifest || manifest.source !== pin.source) throw new VersionNotInstalled(pin.ref)
    return manifest.launch
  }

  private async installNpm(version: string): Promise<VersionInfo> {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`invalid npm version string: ${JSON.stringify(version)}`)
    }
    const dir = join(this.versionsDir, version)
    if (existsSync(join(dir, MANIFEST_FILE))) {
      const existing = this.readManifest(version)
      if (existing) return this.toInfo(existing, existing)
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: `dshm-version-${version.replace(/[^a-z0-9.-]/gi, '-')}`,
        private: true,
        version: '0.0.0',
        dependencies: { [DSH_PACKAGE]: version },
      }, null, 2) + '\n',
      'utf8',
    )
    // --ignore-scripts: never run install scripts from the registry.
    await execFileAsync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--ignore-scripts'], {
      cwd: dir,
      env: this.npmEnv(),
    })
    const script = join(dir, 'node_modules', DSH_PACKAGE, 'lib', 'bin.js')
    if (!existsSync(script)) {
      throw new Error(`npm install finished but ${script} is missing`)
    }
    const manifest: InstalledManifest = {
      ref: version,
      source: 'npm',
      installedAt: new Date().toISOString(),
      semver: version,
      summary: `npm ${DSH_PACKAGE}@${version}`,
      launch: { nodeArgs: [], script, cwd: dir },
    }
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    return this.toInfo(manifest, manifest)
  }

  /**
   * Install from a git ref (tag, branch, or commit) of the DSH repository:
   * shallow clone, checkout the ref, install dependencies with pnpm, then
   * register like a local checkout. Heavy: run this as an async job.
   */
  private async installGitTag(ref: string): Promise<VersionInfo> {
    const dir = join(this.versionsDir, ref)
    if (this.readManifest(ref)) {
      const existing = this.readManifest(ref)
      if (existing) return this.toInfo(existing, existing)
    }
    mkdirSync(this.versionsDir, { recursive: true })
    try {
      await execFileAsync('git', ['clone', '--depth', '1', '--branch', ref, '--single-branch', DSH_REPOSITORY, dir], { env: process.env })
    } catch {
      // ref is probably a commit sha or a branch that cannot be single-branch-cloned
      await execFileAsync('git', ['clone', '--depth', '1', DSH_REPOSITORY, dir], { env: process.env })
      await execFileAsync('git', ['-C', dir, 'checkout', ref], { env: process.env })
    }
    const script = join(dir, 'apps', 'cli', 'src', 'bin.ts')
    if (!existsSync(script)) throw new Error(`git ref ${ref} has no apps/cli/src/bin.ts (not a DSH checkout?)`)
    await execFileAsync('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, env: process.env })
    const manifest: InstalledManifest = {
      ref,
      source: 'git-tag',
      installedAt: new Date().toISOString(),
      summary: `git ${DSH_REPOSITORY} @ ${ref}`,
      launch: { nodeArgs: ['--import', 'tsx/esm'], script, cwd: dir },
    }
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    return this.toInfo(manifest, manifest)
  }

  private npmEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      // Isolated cache: the system ~/.npm cache can be broken or root-owned.
      npm_config_cache: join(this.versionsDir, '.npm-cache'),
    }
  }

  private readManifest(ref: string): InstalledManifest | undefined {
    try {
      const raw = readFileSync(join(this.versionsDir, ref, MANIFEST_FILE), 'utf8')
      return JSON.parse(raw) as InstalledManifest
    } catch {
      return undefined
    }
  }

  private toInfo(installed: InstalledManifest | undefined, fallback: Omit<VersionInfo, 'installed'>): VersionInfo {
    if (!installed) return { ...fallback, installed: false }
    return {
      source: installed.source,
      ref: installed.ref,
      semver: installed.semver,
      installed: true,
      installDir: join(this.versionsDir, installed.ref),
      installedAt: installed.installedAt,
      summary: installed.summary,
      launch: installed.launch,
    }
  }

  private scanInstalled(): InstalledManifest[] {
    if (!existsSync(this.versionsDir)) return []
    const out: InstalledManifest[] = []
    for (const entry of readdirSync(this.versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.npm-cache') continue
      const manifest = this.readManifest(entry.name)
      if (manifest) out.push(manifest)
    }
    return out
  }
}
