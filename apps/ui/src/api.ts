import type {
  CreateEntityRequest,
  EntityInfo,
  ExportResult,
  HealthInfo,
  JobInfo,
  SnapshotInfo,
  UpdateEntityRequest,
  VersionInfo,
} from '@dshm/shared'

declare global {
  interface Window {
    /** injected by the Electron preload bridge (M4); absent in a plain browser */
    dshm?: {
      managerUrl?: string
      openEntityWindow?: (url: string) => Promise<unknown>
      openManager?: () => Promise<unknown>
      pickDirectory?: (title?: string) => Promise<string | null>
      pickFile?: (title?: string) => Promise<string | null>
    }
  }
}

// In Electron the manager URL comes from the preload bridge; in a plain
// browser dev session it is the vite dev proxy (/api -> manager).
const BASE = window.dshm?.managerUrl ? `${window.dshm.managerUrl}/api` : '/api'

export { BASE }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // non-JSON error body
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function getHealth(): Promise<HealthInfo> {
  return request<HealthInfo>('/health')
}

export function getEntities(): Promise<EntityInfo[]> {
  return request<EntityInfo[]>('/entities')
}

export function getVersions(): Promise<VersionInfo[]> {
  return request<VersionInfo[]>('/versions')
}

export function getJobs(): Promise<JobInfo[]> {
  return request<JobInfo[]>('/jobs')
}

export function createEntity(input: CreateEntityRequest): Promise<EntityInfo> {
  return request<EntityInfo>('/entities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function patchEntity(id: string, patch: UpdateEntityRequest): Promise<EntityInfo> {
  return request<EntityInfo>(`/entities/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function getEntity(id: string): Promise<EntityInfo> {
  return request<EntityInfo>(`/entities/${id}`)
}

export function startEntity(id: string): Promise<EntityInfo> {
  return request<EntityInfo>(`/entities/${id}/start`, { method: 'POST' })
}

export function stopEntity(id: string): Promise<EntityInfo> {
  return request<EntityInfo>(`/entities/${id}/stop`, { method: 'POST' })
}

export function deleteEntity(id: string): Promise<void> {
  return request<void>(`/entities/${id}`, { method: 'DELETE' })
}

export function getLogs(id: string, lines = 200): Promise<{ id: string; logs: string }> {
  return request<{ id: string; logs: string }>(`/entities/${id}/logs?lines=${String(lines)}`)
}

export function installVersion(source: 'npm' | 'git-tag', ref: string): Promise<VersionInfo> {
  return request<VersionInfo>('/versions/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, ref }),
  })
}

export function registerLocal(label: string, checkoutDir: string): Promise<VersionInfo> {
  return request<VersionInfo>('/versions/register-local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, checkoutDir }),
  })
}

export function createSnapshot(id: string): Promise<SnapshotInfo> {
  return request<SnapshotInfo>(`/entities/${id}/snapshot`, { method: 'POST' })
}

export function listSnapshots(id: string): Promise<SnapshotInfo[]> {
  return request<SnapshotInfo[]>(`/entities/${id}/snapshots`)
}

export function restoreSnapshot(id: string, snapshot: string): Promise<EntityInfo> {
  return request<EntityInfo>(`/entities/${id}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  })
}

export function exportEntity(id: string): Promise<ExportResult> {
  return request<ExportResult>(`/entities/${id}/export`)
}

export function exportEntityTo(id: string, dir: string): Promise<ExportResult> {
  return request<ExportResult>(`/entities/${id}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir }),
  })
}

export function exportAllEntities(dir: string): Promise<{ exported: Array<{ id: string; path: string; sizeBytes: number }> }> {
  return request<{ exported: Array<{ id: string; path: string; sizeBytes: number }> }>('/entities/export-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir }),
  })
}

/** Native directory picker (Electron); prompt fallback in a plain browser. */
export async function pickDirectory(title?: string): Promise<string | null> {
  if (window.dshm?.pickDirectory) return window.dshm.pickDirectory(title)
  const picked = window.prompt('Directory path (browser mode):')
  return picked && picked.trim() ? picked.trim() : null
}

/** Native file picker (Electron); prompt fallback in a plain browser. */
export async function pickFile(title?: string): Promise<string | null> {
  if (window.dshm?.pickFile) return window.dshm.pickFile(title)
  const picked = window.prompt('File path (browser mode):')
  return picked && picked.trim() ? picked.trim() : null
}

export function importEntity(path: string): Promise<EntityInfo> {
  return request<EntityInfo>('/entities/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export interface SettingsInfo { versionsDir: string; entitiesDir: string }

export interface UpdateSettingsInput { versionsDir?: string; entitiesDir?: string }
export interface UpdateSettingsResult { versionsDir?: string; entitiesDir?: string; moved?: string[]; errors?: string[] }

export function getSettings(): Promise<SettingsInfo> {
  return request<SettingsInfo>('/settings')
}

export function updateSettings(input: UpdateSettingsInput): Promise<UpdateSettingsResult> {
  return request<UpdateSettingsResult>('/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteVersion(source: string, ref: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>('/versions/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, ref }),
  })
}
