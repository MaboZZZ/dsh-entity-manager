/**
 * Shared contracts between the manager daemon, the UI, and the Electron shell.
 *
 * These types are the wire format of the manager's JSON API and the persisted
 * entity store. Keep them serialization-friendly: plain JSON, no class
 * instances, no function fields.
 */

/** Isolation level for a DSH entity. */
export type IsolationLevel = 'process' | 'sandbox' | 'container'

/** Where a version pin came from. */
export type VersionSourceKind = 'npm' | 'git-tag' | 'local'

/** A pinned DSH version inside an entity. */
export interface VersionPin {
  source: VersionSourceKind
  /** npm version string, git tag name, or local checkout label */
  ref: string
}

export type EntityPhase =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

/** The declarative, persisted part of an entity. */
export interface EntitySpec {
  id: string
  name: string
  version: VersionPin
  /** profile name passed to `dsh --profile <name>` */
  profile: string
  /** listen port; 0 means OS-assigned */
  port: number
  isolation: IsolationLevel
  /** absolute path used as the entity's $DSH_HOME */
  homeDir: string
  /** extra args passed to the booted app, after launcher flags */
  args: string[]
  /** environment overrides (model provider keys etc.) */
  env: Record<string, string>
  createdAt: string
}

/** The live, volatile part of an entity. */
export interface EntityStatus {
  phase: EntityPhase
  pid: number | null
  port: number | null
  startedAt: string | null
  error: string | null
  /** the pin the process was last started with */
  version: VersionPin | null
}

export interface EntityInfo {
  spec: EntitySpec
  status: EntityStatus
}

/** One installable / installed DSH version in the registry. */
export interface VersionInfo {
  source: VersionSourceKind
  ref: string
  /** semantic version when source is npm */
  semver?: string
  installed: boolean
  installDir?: string
  installedAt?: string
  summary?: string
}

export interface InstallVersionRequest {
  source: VersionSourceKind
  ref: string
}

export interface CreateEntityRequest {
  /** optional; generated when absent */
  id?: string
  name: string
  version: VersionPin
  profile?: string
  port?: number
  isolation?: IsolationLevel
  homeDir?: string
  args?: string[]
  env?: Record<string, string>
}

export interface ApiError {
  error: string
}

export interface HealthInfo {
  ok: true
  version: string
  uptimeSeconds: number
  entities: number
}
