import { useCallback, useEffect, useState } from 'react'
import type { EntityInfo, HealthInfo, VersionInfo } from '@dshm/shared'
import {
  deleteEntity,
  getEntities,
  getHealth,
  getLogs,
  getVersions,
  installVersion,
  startEntity,
  stopEntity,
} from './api.ts'

/**
 * M0 dashboard: entity cards with start/stop/open/delete, version list with
 * install, and a log viewer. Create wizard lands in M1.
 */
export function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [entities, setEntities] = useState<EntityInfo[]>([])
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [logs, setLogs] = useState('')

  const refresh = useCallback(async () => {
    const [h, e, v] = await Promise.all([getHealth(), getEntities(), getVersions()])
    setHealth(h)
    setEntities(e)
    setVersions(v)
  }, [])

  useEffect(() => {
    void refresh().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)))
  }, [refresh])

  const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const showLogs = useCallback(async (id: string) => {
    setLogsFor(id)
    try {
      const { logs } = await getLogs(id, 300)
      setLogs(logs)
    } catch (reason) {
      setLogs(reason instanceof Error ? reason.message : String(reason))
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

      {error && <div className="banner error">{error}</div>}
      {busy && <div className="banner">{busy}…</div>}

      <section className="panel">
        <h2>Entities</h2>
        {entities.length === 0 ? (
          <p className="muted">No entities yet. Create one with the API (create wizard lands in M1).</p>
        ) : (
          <ul className="cards">
            {entities.map((entity) => (
              <li key={entity.spec.id} className="card">
                <strong>{entity.spec.name}</strong>
                <span className="badge">{entity.spec.version.ref}</span>
                <span className={`phase ${entity.status.phase}`}>{entity.status.phase}</span>
                {entity.status.port !== null && <code className="muted">:{entity.status.port}</code>}
                <span className="actions">
                  {entity.status.phase === 'running' ? (
                    <button onClick={() => void act('stopping', () => stopEntity(entity.spec.id))}>stop</button>
                  ) : (
                    <button onClick={() => void act('starting', () => startEntity(entity.spec.id))}>start</button>
                  )}
                  {entity.status.port !== null && (
                    <a href={`http://127.0.0.1:${String(entity.status.port)}/`} target="_blank" rel="noreferrer">open</a>
                  )}
                  <button onClick={() => void showLogs(entity.spec.id)}>logs</button>
                  <button className="danger" onClick={() => void act('deleting', () => deleteEntity(entity.spec.id))}>delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {logsFor && (
          <details open>
            <summary>logs: {logsFor}</summary>
            <pre className="logs">{logs || '(empty)'}</pre>
          </details>
        )}
      </section>

      <section className="panel">
        <h2>Versions</h2>
        <ul className="cards">
          {versions.map((version) => (
            <li key={`${version.source}:${version.ref}`} className="card">
              <strong>{version.ref}</strong>
              <span className="badge">{version.source}</span>
              {version.installed
                ? <span className="badge ok">installed</span>
                : (
                  <span className="actions">
                    <span className="badge">available</span>
                    <button onClick={() => void act('installing', () => installVersion('npm', version.ref))}>
                      install
                    </button>
                  </span>
                )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
