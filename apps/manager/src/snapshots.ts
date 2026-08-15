/**
 * Snapshots and entity bundles (export/import).
 *
 * Snapshot = spec.json + optional home.tar.gz under
 * `<manager home>/snapshots/<entityId>/<timestamp>/`.
 *
 * Export bundle = single tar.gz with manifest.json (carries the spec) and
 * home.tar.gz, under `<manager home>/exports/`.
 *
 * Tar is delegated to the system `tar` (macOS/Linux); Windows support is a
 * follow-up (M4 packaging).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { EntityInfo, EntitySpec, SnapshotInfo } from '@dshm/shared'

function nowStamp(): string {
  // keep the '.' separator so the stamp stays a valid ISO instant (parseable by new Date)
  return new Date().toISOString().replace(/:/g, '-')
}

function tar(args: string[]): void {
  const result = spawnSync('tar', args, { stdio: 'pipe' })
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? ''
    throw new Error(`tar ${args.join(' ')} failed: ${stderr.slice(0, 500)}`)
  }
}

export class SnapshotManager {
  constructor(readonly rootDir: string) {}

  get snapshotsDir(): string {
    return join(this.rootDir, 'snapshots')
  }

  get exportsDir(): string {
    return join(this.rootDir, 'exports')
  }

  async create(entity: EntityInfo): Promise<SnapshotInfo> {
    const id = nowStamp()
    const dir = join(this.snapshotsDir, entity.spec.id, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(entity.spec, null, 2) + '\n', 'utf8')
    let hasHome = false
    if (existsSync(entity.spec.homeDir)) {
      tar(['-czf', join(dir, 'home.tar.gz'), '-C', dirname(entity.spec.homeDir), basename(entity.spec.homeDir)])
      hasHome = true
    }
    return this.info(entity.spec.id, id)
  }

  list(entityId: string): SnapshotInfo[] {
    const dir = join(this.snapshotsDir, entityId)
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.info(entityId, entry.name))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  restore(entity: EntityInfo, snapshotId: string): EntitySpec {
    const dir = join(this.snapshotsDir, entity.spec.id, snapshotId)
    const specPath = join(dir, 'spec.json')
    if (!existsSync(specPath)) throw new Error(`snapshot ${snapshotId} has no spec.json`)
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as EntitySpec
    const homeTarball = join(dir, 'home.tar.gz')
    if (existsSync(homeTarball)) {
      rmSync(spec.homeDir, { recursive: true, force: true })
      mkdirSync(dirname(spec.homeDir), { recursive: true })
      tar(['-xzf', homeTarball, '-C', dirname(spec.homeDir)])
    }
    return spec
  }

  /** Build an export bundle and return its path. */
  async exportBundle(entity: EntityInfo): Promise<{ path: string; sizeBytes: number }> {
    mkdirSync(this.exportsDir, { recursive: true })
    const work = join(tmpdir(), `dshm-export-${randomUUID()}`)
    const bundle = join(work, 'bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(
      join(bundle, 'manifest.json'),
      JSON.stringify({ exportedAt: new Date().toISOString(), spec: entity.spec }, null, 2) + '\n',
      'utf8',
    )
    if (existsSync(entity.spec.homeDir)) {
      tar(['-czf', join(bundle, 'home.tar.gz'), '-C', dirname(entity.spec.homeDir), basename(entity.spec.homeDir)])
    }
    const outPath = join(this.exportsDir, `${entity.spec.id}-${nowStamp()}.tar.gz`)
    tar(['-czf', outPath, '-C', work, 'bundle'])
    rmSync(work, { recursive: true, force: true })
    return { path: outPath, sizeBytes: statSync(outPath).size }
  }

  /**
   * Import an export bundle into a fresh entity. The bundle's id is ignored;
   * a new id is generated so imports never collide with a live entity.
   */
  async importBundle(bundlePath: string): Promise<EntitySpec> {
    if (!existsSync(bundlePath)) throw new Error(`bundle not found: ${bundlePath}`)
    const work = join(tmpdir(), `dshm-import-${randomUUID()}`)
    mkdirSync(work, { recursive: true })
    tar(['-xzf', bundlePath, '-C', work])
    const manifest = JSON.parse(readFileSync(join(work, 'bundle', 'manifest.json'), 'utf8')) as {
      spec: EntitySpec
    }
    if (!manifest.spec || typeof manifest.spec.name !== 'string') {
      throw new Error('bundle manifest has no valid spec')
    }
    const oldId = manifest.spec.id
    const newId = `${manifest.spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'entity'}-${Date.now().toString(36)}`
    const newHome = join(this.rootDir, 'homes', newId)
    const homeTarball = join(work, 'bundle', 'home.tar.gz')
    if (existsSync(homeTarball)) {
      mkdirSync(dirname(newHome), { recursive: true })
      tar(['-xzf', homeTarball, '-C', dirname(newHome)])
      // the tarball contains the old home dir name; rename it to the new id
      const extracted = join(dirname(newHome), basename(manifest.spec.homeDir))
      if (extracted !== newHome && existsSync(extracted)) {
        rmSync(newHome, { recursive: true, force: true })
        // renameSync fails across filesystems rarely; use mv via tar trick below
        spawnSync('mv', [extracted, newHome], { stdio: 'pipe' })
      }
    }
    const spec: EntitySpec = {
      ...manifest.spec,
      id: newId,
      homeDir: newHome,
      port: 0,
      createdAt: new Date().toISOString(),
    }
    rmSync(work, { recursive: true, force: true })
    return spec
  }

  private info(entityId: string, id: string): SnapshotInfo {
    const dir = join(this.snapshotsDir, entityId, id)
    const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')) as EntitySpec
    const homeTarball = join(dir, 'home.tar.gz')
    const sizeBytes = existsSync(homeTarball) ? statSync(homeTarball).size : 0
    // id is a timestamp-stamped dir name; fall back to dir mtime when a legacy
    // stamp is not a parseable instant.
    const parsed = new Date(id)
    const createdAt = Number.isNaN(parsed.getTime()) ? statSync(dir).mtime.toISOString() : parsed.toISOString()
    return {
      id,
      entityId,
      createdAt,
      hasHome: existsSync(homeTarball),
      spec,
      sizeBytes,
    }
  }
}
