/**
 * Manager settings, persisted as <manager home>/settings.json.
 *
 * The user chooses the version data directory themselves (native folder
 * picker in the UI). Changing it moves existing installed versions to the new
 * location so nothing is lost.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManagerSettingsData {
  versionsDir?: string
}

export interface SetVersionsDirResult {
  versionsDir: string
  moved: string[]
  errors: string[]
}

function load(file: string): ManagerSettingsData {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ManagerSettingsData>
    return { ...(typeof raw.versionsDir === 'string' && raw.versionsDir !== '' ? { versionsDir: raw.versionsDir } : {}) }
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

  /**
   * Set the version data directory. Creates it if missing and migrates
   * existing installed versions from the previous directory.
   */
  setVersionsDir(dir: string): SetVersionsDirResult {
    const target = dir.trim()
    if (!target) throw new Error('versions directory cannot be empty')
    const old = this.versionsDir
    try {
      mkdirSync(target, { recursive: true })
    } catch (error) {
      throw new Error(
        `cannot create directory ${target}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const moved: string[] = []
    const errors: string[] = []
    if (old !== target && existsSync(old)) {
      for (const entry of readdirSync(old, { withFileTypes: true })) {
        const from = join(old, entry.name)
        const to = join(target, entry.name)
        try {
          if (existsSync(to)) {
            moved.push(entry.name) // collision: keep the target's copy
            continue
          }
          execFileSync('mv', [from, to])
          moved.push(entry.name)
        } catch (error) {
          errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    this.data.versionsDir = target
    this.save()
    return { versionsDir: target, moved, errors }
  }

  private save(): void {
    mkdirSync(this.rootDir, { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
  }
}
