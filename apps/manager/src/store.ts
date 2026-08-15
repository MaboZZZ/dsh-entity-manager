/**
 * Persisted entity store.
 *
 * Single JSON document under the manager home (`entities.json`), written
 * atomically. Volatile status is persisted too so the UI can render last-known
 * state after a manager restart (a stale `running` is reconciled by the
 * process manager on boot).
 *
 * Multi-instance safety: before every read/mutation the store re-reads the
 * file when its mtime changed on disk, so a second manager (or a second app
 * instance sharing the same home) cannot silently clobber entities away.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EntityInfo, EntitySpec, EntityStatus } from '@dshm/shared'

export const ENTITIES_FILE = 'entities.json'

export interface ManagerStoreData {
  entities: EntityInfo[]
}

function freshStatus(): EntityStatus {
  return {
    phase: 'stopped',
    pid: null,
    port: null,
    startedAt: null,
    error: null,
    version: null,
    containerId: null,
  }
}

function load(file: string): ManagerStoreData {
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ManagerStoreData>
    return { entities: Array.isArray(parsed.entities) ? parsed.entities : [] }
  } catch {
    return { entities: [] }
  }
}

export class EntityStore {
  readonly rootDir: string
  private readonly file: string
  private data: ManagerStoreData
  private lastMtime = 0

  constructor(rootDir: string) {
    this.rootDir = rootDir
    this.file = join(rootDir, ENTITIES_FILE)
    mkdirSync(rootDir, { recursive: true })
    this.data = load(this.file)
    this.lastMtime = this.fileMtime()
  }

  list(): EntityInfo[] {
    this.sync()
    return this.data.entities
  }

  get(id: string): EntityInfo | undefined {
    this.sync()
    return this.data.entities.find((entity) => entity.spec.id === id)
  }

  /** Insert or replace the spec of an entity; existing status is kept. */
  upsert(spec: EntitySpec): EntityInfo {
    this.sync()
    const existing = this.get(spec.id)
    const info: EntityInfo = {
      spec,
      status: existing?.status ?? freshStatus(),
    }
    this.data.entities = [...this.data.entities.filter((e) => e.spec.id !== spec.id), info]
    this.save()
    return info
  }

  remove(id: string): boolean {
    this.sync()
    const before = this.data.entities.length
    this.data.entities = this.data.entities.filter((e) => e.spec.id !== id)
    if (this.data.entities.length === before) return false
    this.save()
    return true
  }

  /** Update just the status; the store never invents statuses on its own. */
  patchStatus(id: string, patch: Partial<EntityStatus>): EntityInfo | undefined {
    this.sync()
    const info = this.get(id)
    if (!info) return undefined
    info.status = { ...info.status, ...patch }
    this.save()
    return info
  }

  private fileMtime(): number {
    try {
      return statSync(this.file).mtimeMs
    } catch {
      return 0
    }
  }

  /** Re-read the file when another process changed it on disk. */
  private sync(): void {
    const mtime = this.fileMtime()
    if (mtime !== 0 && mtime !== this.lastMtime) {
      this.data = load(this.file)
      this.lastMtime = mtime
    }
  }

  private save(): void {
    const dir = dirname(this.file)
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `${ENTITIES_FILE}.tmp`)
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
    this.lastMtime = this.fileMtime()
  }
}
