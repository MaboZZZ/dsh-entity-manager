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
  /** container id when isolation is 'container' (L3) */
  containerId: string | null
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
  /** how to launch this version's `dsh` bin */
  launch?: VersionLaunch
}

/** How the manager spawns a pinned version. */
export interface VersionLaunch {
  /** extra node arguments before the script (e.g. --import tsx/esm) */
  nodeArgs: string[]
  /** absolute path of the dsh bin script */
  script: string
  /** working directory for the child process */
  cwd: string
}

export interface InstallVersionRequest {
  source: VersionSourceKind
  ref: string
}

export interface RegisterLocalRequest {
  /** label shown in the version list, e.g. "dev" */
  label: string
  /** absolute path of a DSH checkout (source tree) */
  checkoutDir: string
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

/** Partial update of an entity's spec (PATCH). */
export interface UpdateEntityRequest {
  name?: string
  version?: VersionPin
  profile?: string
  port?: number
  args?: string[]
  env?: Record<string, string>
  /** auto-restart after the change if it was running (default true) */
  restart?: boolean
}

export interface ApiError {
  error: string
}

/** One snapshot of an entity (spec + optional home tarball). */
export interface SnapshotInfo {
  id: string
  entityId: string
  createdAt: string
  hasHome: boolean
  spec: EntitySpec
  sizeBytes: number
}

export interface RestoreRequest {
  /** snapshot id (timestamp dir name) */
  snapshot: string
}

export interface ExportResult {
  path: string
  sizeBytes: number
}

export interface ImportRequest {
  /** absolute path of an exported bundle on the manager machine */
  path: string
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

/** One async manager job (version installs etc.), as seen by the UI. */
export interface JobInfo {
  id: string
  kind: string
  status: JobStatus
  label: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface HealthInfo {
  ok: true
  version: string
  uptimeSeconds: number
  entities: number
  /** whether the Docker daemon is reachable (L3 container isolation) */
  docker: boolean
}
