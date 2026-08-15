import type { EntityInfo, HealthInfo, VersionInfo } from '@dshm/shared'

const BASE = '/api'

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
