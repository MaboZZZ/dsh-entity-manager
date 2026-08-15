import { useEffect, useState } from 'react'
import type { EntityInfo, HealthInfo, VersionInfo } from '@dshm/shared'
import { getEntities, getHealth, getVersions } from './api.ts'

/**
 * Skeleton dashboard: proves the manager API round-trip and shows the shape
 * of the three core panels (entities / versions / health). Real panels land
 * in M1+.
 */
export function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [entities, setEntities] = useState<EntityInfo[]>([])
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getHealth(), getEntities(), getVersions()])
      .then(([h, e, v]) => {
        if (cancelled) return
        setHealth(h)
        setEntities(e)
        setVersions(v)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>DSH Entity Manager</h1>
        <span className="health">
          {health ? `manager v${health.version} · ${health.entities} entities · up ${health.uptimeSeconds}s` : 'connecting…'}
        </span>
      </header>

      {error && <div className="banner error">manager unreachable: {error} — start it with <code>pnpm dev:manager</code></div>}

      <section className="panel">
        <h2>Entities <span className="muted">(M1: create / start / stop / open)</span></h2>
        {entities.length === 0 ? (
          <p className="muted">No entities yet. The create wizard lands in M1.</p>
        ) : (
          <ul className="cards">
            {entities.map((entity) => (
              <li key={entity.spec.id} className="card">
                <strong>{entity.spec.name}</strong>
                <span className="badge">{entity.spec.version.ref}</span>
                <span className={`phase ${entity.status.phase}`}>{entity.status.phase}</span>
                <code className="muted">{entity.spec.homeDir}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Versions <span className="muted">(M0/M1: install &amp; pin)</span></h2>
        <ul className="cards">
          {versions.map((version) => (
            <li key={`${version.source}:${version.ref}`} className="card">
              <strong>{version.ref}</strong>
              <span className="badge">{version.source}</span>
              {version.installed ? <span className="badge ok">installed</span> : <span className="badge">available</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
