/**
 * Version registry: the three sources of DSH versions and the version store
 * under `<manager home>/versions/<ref>/`.
 *
 * Skeleton state:
 *  - `list()` is live: installed versions come from scanning the store,
 *    npm versions come from `npm view @deepseek-ai/dsh versions`.
 *  - `install*()` are stubs that throw NotImplemented; M0 wires the real
 *    install (npm pack into an isolated dir, git clone/tag checkout, local
 *    checkout registration) and the manifest sidecar.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { VersionInfo, VersionSourceKind } from '@dshm/shared'

const execFileAsync = promisify(execFile)

export const DSH_PACKAGE = '@deepseek-ai/dsh'
export const DSH_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'

/** Thrown by operations the current milestone has not implemented yet. */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented yet: ${what}`)
    this.name = 'NotImplemented'
  }
}

/** One installed version manifest inside the version store. */
interface InstalledManifest {
  ref: string
  source: VersionSourceKind
  installedAt: string
  semver?: string
  summary?: string
}

export class VersionRegistry {
  constructor(readonly versionsDir: string) {
    mkdirSync(versionsDir, { recursive: true })
  }

  async list(): Promise<VersionInfo[]> {
    const installed = this.scanInstalled()
    const byRef = new Map(installed.map((v) => [v.ref, v]))

    // npm source: live registry view with an isolated cache (the default
    // ~/.npm cache can be broken or root-owned; never touch it).
    let npmVersions: string[] = []
    try {
      const { stdout } = await execFileAsync(
        'npm',
        ['view', DSH_PACKAGE, 'versions', '--json'],
        { env: { ...process.env, npm_config_cache: join(this.versionsDir, '.npm-cache') } },
      )
      const parsed = JSON.parse(stdout) as unknown
      if (Array.isArray(parsed)) npmVersions = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      // registry unreachable: fall back to installed-only
    }

    const out: VersionInfo[] = []
    for (const ref of npmVersions) {
      const local = byRef.get(ref)
      out.push({
        source: 'npm',
        ref,
        semver: ref,
        installed: local !== undefined,
        installDir: local?.installDir,
        installedAt: local?.installedAt,
        summary: local?.summary,
      })
    }
    for (const local of installed) {
      if (!npmVersions.includes(local.ref)) out.push(local)
    }
    out.sort((a, b) => b.ref.localeCompare(a.ref, undefined, { numeric: true }))
    return out
  }

  async install(source: VersionSourceKind, ref: string): Promise<VersionInfo> {
    switch (source) {
      case 'npm':
        return this.installNpm(ref)
      case 'git-tag':
        throw new NotImplemented('git-tag version install (M3)')
      case 'local':
        throw new NotImplemented('local checkout registration (M1)')
    }
  }

  private async installNpm(version: string): Promise<VersionInfo> {
    // M0: `npm pack @deepseek-ai/dsh@<version>` + unpack into
    // `<versionsDir>/<version>/` + write the manifest sidecar.
    throw new NotImplemented('npm version install (M0)')
  }

  private scanInstalled(): VersionInfo[] {
    if (!existsSync(this.versionsDir)) return []
    const out: VersionInfo[] = []
    for (const entry of readdirSync(this.versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.npm-cache') continue
      const dir = join(this.versionsDir, entry.name)
      const manifestPath = join(dir, 'manifest.json')
      let manifest: InstalledManifest | undefined
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as InstalledManifest
      } catch {
        // no manifest: treat the directory name as an npm version
      }
      const source = manifest?.source ?? 'npm'
      out.push({
        source,
        ref: manifest?.ref ?? entry.name,
        semver: source === 'npm' ? manifest?.ref ?? entry.name : undefined,
        installed: true,
        installDir: dir,
        installedAt: manifest?.installedAt,
        summary: manifest?.summary,
      })
    }
    return out
  }
}
