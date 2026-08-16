/**
 * Manager settings, persisted as <manager home>/settings.json.
 *
 * The user chooses where installed versions AND entity data (homes) live
 * (native folder pickers in the UI). Changing a directory migrates existing
 * content to the new location so nothing is lost.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManagerSettingsData {
  versionsDir?: string
  entitiesDir?: string
}

export interface SetDirResult {
  moved: string[]
  errors: string[]
}

export interface SetVersionsDirResult extends SetDirResult {
  versionsDir: string
}

export interface SetEntitiesDirResult extends SetDirResult {
  entitiesDir: string
}

function load(file: string): ManagerSettingsData {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ManagerSettingsData>
    return {
      ...(typeof raw.versionsDir === 'string' && raw.versionsDir !== '' ? { versionsDir: raw.versionsDir } : {}),
      ...(typeof raw.entitiesDir === 'string' && raw.entitiesDir !== '' ? { entitiesDir: raw.entitiesDir } : {}),
    }
  } catch {
    return {}
  }
}

export class SettingsStore {
  private readonly rootDir: string
  private readonly file: string
  private data: ManagerSettingsData

  constructor(rootDir: string) {
    this.rootDir = rootDir
    this.file = join(rootDir, 'settings.json')
    mkdirSync(rootDir, { recursive: true })
    this.data = load(this.file)
  }

  /** Resolved version data directory (user-chosen or the default). */
  get versionsDir(): string {
    return this.data.versionsDir ?? join(this.rootDir, 'versions')
  }

  /** Resolved entity data (homes) directory (user-chosen or the default). */
  get entitiesDir(): string {
    return this.data.entitiesDir ?? join(this.rootDir, 'homes')
  }

  /**
   * Set the version data directory. Creates it if missing and migrates
   * existing installed versions from the previous directory.
   */
  setVersionsDir(dir: string): SetVersionsDirResult {
    const target = this.prepareDir(dir, 'versions')
    const moved = this.moveEntries(this.versionsDir, target)
    this.data.versionsDir = target
    this.save()
    return { versionsDir: target, ...moved }
  }

  /**
   * Set the entity data (homes) directory. Creates it if missing and migrates
   * existing entity homes from the previous directory.
   */
  setEntitiesDir(dir: string): SetEntitiesDirResult {
    const target = this.prepareDir(dir, 'entities')
    const moved = this.moveEntries(this.entitiesDir, target)
    this.data.entitiesDir = target
    this.save()
    return { entitiesDir: target, ...moved }
  }

  private prepareDir(dir: string, what: string): string {
    const target = dir.trim()
    if (!target) throw new Error(`${what} directory cannot be empty`)
    try {
      mkdirSync(target, { recursive: true })
    } catch (error) {
      throw new Error(
        `cannot create directory ${target}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return target
  }

  /** Move every entry from `old` into `target`; collisions keep the target copy. */
  private moveEntries(old: string, target: string): SetDirResult {
    const moved: string[] = []
    const errors: string[] = []
    if (old !== target && existsSync(old)) {
      for (const entry of readdirSync(old, { withFileTypes: true })) {
        const from = join(old, entry.name)
        const to = join(target, entry.name)
        try {
          if (existsSync(to)) {
            moved.push(entry.name)
            continue
          }
          execFileSync('mv', [from, to])
          moved.push(entry.name)
        } catch (error) {
          errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return { moved, errors }
  }

  private save(): void {
    mkdirSync(this.rootDir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
  }
}
