import { useCallback, useEffect, useRef, useState } from 'react'
import type { EntityInfo, HealthInfo, JobInfo, SnapshotInfo, VersionInfo } from '@dshm/shared'
import {
  BASE,
  createEntity,
  createSnapshot,
  deleteEntity,
  exportEntity,
  getEntities,
  getHealth,
  getJobs,
  getLogs,
  getVersions,
  importEntity,
  installVersion,
  listSnapshots,
  patchEntity,
  registerLocal,
  restoreSnapshot,
  startEntity,
  stopEntity,
} from './api.ts'

const POLL_MS = 3000

export function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [entities, setEntities] = useState<EntityInfo[]>([])
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [detail, setDetail] = useState<EntityInfo | null>(null)

  const refresh = useCallback(async () => {
    const [h, e, v, j] = await Promise.all([getHealth(), getEntities(), getVersions(), getJobs()])
    setHealth(h)
    setEntities(e)
    setVersions(v)
    setJobs(j)
    setDetail((current) => {
      if (!current) return current
      const fresh = e.find((x) => x.spec.id === current.spec.id)
      return fresh ?? current
    })
  }, [])

  useEffect(() => {
    void refresh().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)))
    const timer = setInterval(() => {
      void refresh().catch(() => { /* transient poll errors are non-fatal */ })
    }, POLL_MS)
    return () => clearInterval(timer)
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

      {detail
        ? <DetailView
            entity={detail}
            versions={versions}
            onBack={() => setDetail(null)}
            onChanged={() => void refresh()}
            act={act}
          />
        : (
          <>
            <section className="panel">
              <h2>Entities</h2>
              {entities.length === 0
                ? <p className="muted">No entities yet — create one below.</p>
                : (
                  <ul className="cards">
                    {entities.map((entity) => (
                      <li key={entity.spec.id} className="card">
                        <button className="link" onClick={() => setDetail(entity)}>
                          <strong>{entity.spec.name}</strong>
                        </button>
                        <span className="badge">{entity.spec.version.ref}</span>
                        <span className={`phase ${entity.status.phase}`}>{entity.status.phase}</span>
                        {entity.status.port !== null && <code className="muted">:{entity.status.port}</code>}
                        <span className="actions">
                          {entity.status.phase === 'running'
                            ? <button onClick={() => void act('stopping', () => stopEntity(entity.spec.id))}>stop</button>
                            : <button onClick={() => void act('starting', () => startEntity(entity.spec.id))}>start</button>}
                          {entity.status.port !== null && (
                            <a href={`http://127.0.0.1:${String(entity.status.port)}/`} target="_blank" rel="noreferrer">open</a>
                          )}
                          <button onClick={() => setDetail(entity)}>detail</button>
                          <button className="danger" onClick={() => void act('deleting', () => deleteEntity(entity.spec.id))}>delete</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </section>

            <CreateWizard versions={versions} onCreated={() => void refresh()} act={act} />

            <ImportPanel act={act} onImported={() => void refresh()} />

            <VersionsPanel versions={versions} jobs={jobs} act={act} onRefresh={refresh} />
          </>
        )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CreateWizard(props: {
  versions: VersionInfo[]
  onCreated: () => void
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  const { versions, onCreated, act } = props
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ref, setRef] = useState('')
  const [profile, setProfile] = useState('web')
  const [isolation, setIsolation] = useState('process')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  const installed = versions.filter((v) => v.installed)
  const versionOptions = installed.length > 0 ? installed : versions.slice(0, 8)

  const submit = () => {
    if (!name.trim() || !ref) return
    void act('creating', async () => {
      await createEntity({
        name: name.trim(),
        version: { source: 'npm', ref },
        profile,
        port: 0,
        isolation: isolation as 'process' | 'sandbox' | 'container',
        env: {
          ...(apiKey.trim() ? { DEEPSEEK_API_KEY: apiKey.trim() } : {}),
          ...(baseUrl.trim() ? { DEEPSEEK_BASE_URL: baseUrl.trim() } : {}),
        },
      })
      setName('')
      setApiKey('')
      setBaseUrl('')
      setOpen(false)
      onCreated()
    })
  }

  return (
    <section className="panel">
      <h2>
        <button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} New entity</button>
      </h2>
      {open && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sandbox" required />
          </label>
          <label>Version
            <select value={ref} onChange={(e) => setRef(e.target.value)} required>
              <option value="" disabled>pick a version…</option>
              {versionOptions.map((v) => (
                <option key={`${v.source}:${v.ref}`} value={v.ref}>
                  {v.ref}{v.installed ? '' : ' (needs install)'}{v.source === 'local' ? ' [local]' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>Profile
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="web">web (browser GUI)</option>              <option value="headless">headless</option>
            </select>
          </label>
          <label>Isolation
            <select value={isolation} onChange={(e) => setIsolation(e.target.value)}>
              <option value="process">process (default)</option>
              <option value="sandbox">sandbox (landlock, Linux only)</option>
              <option value="container">container (Docker)</option>
            </select>
          </label>
          <label>DeepSeek API key <span className="muted">(optional — also configurable inside the entity)</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
          </label>
          <label>Base URL <span className="muted">(optional)</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" />
          </label>
          <div className="form-row">
            <button type="submit">Create entity</button>
            <span className="muted">port is auto-assigned and kept stable</span>
          </div>
        </form>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function DetailView(props: {
  entity: EntityInfo
  versions: VersionInfo[]
  onBack: () => void
  onChanged: () => void
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  const { entity, versions, onBack, onChanged, act } = props
  const [logs, setLogs] = useState('')
  const [switchRef, setSwitchRef] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [exportPath, setExportPath] = useState<string | null>(null)
  const iframeKey = `${entity.spec.id}-${entity.status.port ?? 'off'}`

  // live logs + snapshots while the detail is open
  useEffect(() => {
    const timer = setInterval(() => {
      void getLogs(entity.spec.id, 400).then(({ logs }) => setLogs(logs)).catch(() => {})
    }, 2000)
    void listSnapshots(entity.spec.id).then(setSnapshots).catch(() => {})
    return () => clearInterval(timer)
  }, [entity.spec.id])

  const switchVersion = () => {
    if (!switchRef || switchRef === entity.spec.version.ref) return
    void act('switching version', async () => {
      await patchEntity(entity.spec.id, { version: { source: 'npm', ref: switchRef }, restart: true })
      setSwitchRef('')
      onChanged()
    })
  }

  const running = entity.status.phase === 'running'
  const port = entity.status.port
  const openInAppWindow = window.dshm?.openEntityWindow

  return (
    <section className="panel detail">
      <div className="detail-head">
        <button className="link" onClick={onBack}>← back</button>
        <h2>{entity.spec.name}</h2>
        <span className="badge">{entity.spec.version.ref}</span>
        <span className={`phase ${entity.status.phase}`}>{entity.status.phase}</span>
        <span className="actions">
          {running
            ? <button onClick={() => void act('stopping', () => stopEntity(entity.spec.id))}>stop</button>
            : <button onClick={() => void act('starting', () => startEntity(entity.spec.id))}>start</button>}
          <button className="danger" onClick={() => void act('deleting', async () => { await deleteEntity(entity.spec.id); onBack(); })}>delete</button>
        </span>
      </div>

      <dl className="meta">
        <dt>home</dt><dd><code>{entity.spec.homeDir}</code></dd>
        <dt>port</dt><dd><code>{port ?? '—'}</code></dd>
        <dt>pid</dt><dd><code>{entity.status.pid ?? '—'}</code></dd>
        <dt>profile</dt><dd><code>{entity.spec.profile}</code></dd>
      </dl>

      <div className="version-switch">
        <span className="muted">Switch version:</span>
        <select value={switchRef} onChange={(e) => setSwitchRef(e.target.value)}>
          <option value="" disabled>pick a version…</option>
          {versions.filter((v) => v.installed).map((v) => (
            <option key={`${v.source}:${v.ref}`} value={v.ref}>
              {v.ref}{v.source === 'local' ? ' [local]' : ''}
            </option>
          ))}
        </select>
        <button onClick={switchVersion} disabled={!switchRef || switchRef === entity.spec.version.ref}>
          switch & restart
        </button>
        <span className="muted">data in the entity home stays untouched</span>
      </div>

      <div className="snapshots">
        <div className="subhead">Snapshots &amp; transfer</div>
        <div className="snap-row">
          <button onClick={() => void act('snapshotting', async () => {
            await createSnapshot(entity.spec.id)
            setSnapshots(await listSnapshots(entity.spec.id))
          })}>take snapshot</button>
          <button onClick={() => void act('exporting', async () => {
            const result = await exportEntity(entity.spec.id)
            setExportPath(result.path)
          })}>export bundle</button>
          <a href={`${BASE}/exports/${exportPath?.split('/').pop() ?? ''}`} className={exportPath ? '' : 'hidden'} download>download bundle</a>
          {port !== null && openInAppWindow && (
            <button onClick={() => void openInAppWindow(`http://127.0.0.1:${port}/`)}>
              open in app window
            </button>
          )}
        </div>
        {snapshots.length > 0 && (
          <ul className="snap-list">
            {snapshots.map((snap) => (
              <li key={snap.id}>
                <span className="badge">{new Date(snap.createdAt).toLocaleString()}</span>
                <span className="muted">{snap.hasHome ? `${snap.sizeBytes} B home` : 'spec only'}</span>
                <button className="danger" onClick={() => void act('restoring', () => restoreSnapshot(entity.spec.id, snap.id))}>
                  restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="gui-and-logs">
        <div className="gui">
          <div className="subhead">GUI{port === null ? ' (not running)' : ` — http://127.0.0.1:${port}/`}</div>
          {port !== null
            ? <iframe key={iframeKey} title="entity GUI" src={`http://127.0.0.1:${port}/`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
            : <div className="placeholder">start the entity to embed its GUI here</div>}
        </div>
        <div className="logs-pane">
          <div className="subhead">logs</div>
          <pre className="logs">{logs || '(waiting for output…)'}</pre>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function ImportPanel(props: {
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  onImported: () => void
}) {
  const { act, onImported } = props
  const [path, setPath] = useState('')
  return (
    <section className="panel">
      <h2>Import entity bundle</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!path.trim()) return
          void act('importing', async () => {
            await importEntity(path.trim())
            setPath('')
            onImported()
          })
        }}
      >
        <label>Bundle path on this machine
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/entity-….tar.gz" required />
        </label>
        <div className="form-row">
          <button type="submit">Import</button>
          <span className="muted">creates a fresh entity with a new id and home</span>
        </div>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function VersionsPanel(props: {
  versions: VersionInfo[]
  jobs: JobInfo[]
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  onRefresh: () => Promise<unknown>
}) {
  const { versions, jobs, act, onRefresh } = props
  const [showAddLocal, setShowAddLocal] = useState(false)
  const [localLabel, setLocalLabel] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // install jobs by target ref (one install at a time)
  const installJobs = jobs.filter((j) => j.kind === 'version-install')
  const activeInstall = installJobs.find((j) => j.status === 'pending' || j.status === 'running')
  const jobFor = (ref: string): JobInfo | undefined =>
    installJobs.find((j) => j.target === ref)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Versions</h2>
        <span className="actions">
          <button onClick={() => void act('refreshing versions', onRefresh)}>⟳ refresh</button>
          <button onClick={() => setShowAddLocal(!showAddLocal)}>+ add local version</button>
        </span>
      </div>
      {showAddLocal && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!localLabel.trim() || !localPath.trim()) return
            void act('adding local version', async () => {
              await registerLocal(localLabel.trim(), localPath.trim())
              setLocalLabel('')
              setLocalPath('')
              setShowAddLocal(false)
              onRefresh()
            })
          }}
        >
          <label>Label
            <input value={localLabel} onChange={(e) => setLocalLabel(e.target.value)} placeholder="e.g. dev" required />
          </label>
          <label>本地 DSH 项目代码目录（checkout）
            <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/path/to/deepseek-harness" required />
          </label>
          <div className="form-row">
            <button type="submit">Register local version</button>
          </div>
        </form>
      )}
      {versions.length === 0 && <p className="muted">No versions found — try the refresh button, or add a local checkout.</p>}
      <ul className="cards">
        {versions.map((version) => {
          const job = jobFor(version.ref)
          const isInstalling = job !== undefined && (job.status === 'pending' || job.status === 'running')
          const open = expanded === version.ref
          return (
            <li key={`${version.source}:${version.ref}`} className="card version-row">
              <strong>{version.ref}</strong>
              <span className="badge">{version.source}</span>
              {version.installed
                ? <span className="badge ok">installed</span>
                : (
                  <span className="actions">
                    <span className="badge">available</span>
                    <button
                      disabled={activeInstall !== undefined && !isInstalling}
                      onClick={() => void act('installing', () => installVersion('npm', version.ref))}
                    >
                      {isInstalling ? 'installing…' : 'install'}
                    </button>
                  </span>
                )}
              {/* rightmost: chevron to expand install details */}
              <button
                className="chevron"
                onClick={() => setExpanded(open ? null : version.ref)}
                title={open ? 'collapse' : 'show install details'}
              >
                {open ? '▴' : '▾'}
              </button>
              {open && (
                <div className="version-detail">
                  {job && (job.status === 'pending' || job.status === 'running') && (
                    <>
                      <div className="progress"><div className="progress-bar running" /></div>
                      <span className="muted">{job.status}… 安装中（一次只装一个版本）</span>
                    </>
                  )}
                  {job && job.status === 'done' && <span className="badge ok">install done</span>}
                  {job && job.status === 'failed' && (
                    <span className="err-text">install failed: {job.error ?? 'unknown error'}</span>
                  )}
                  {version.installed && version.installDir && (
                    <div className="muted">installed at: <code>{version.installDir}</code></div>
                  )}
                  {job && job.startedAt && (
                    <div className="muted">
                      started {new Date(job.startedAt).toLocaleTimeString()}
                      {job.finishedAt ? ` · finished ${new Date(job.finishedAt).toLocaleTimeString()}` : ''}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */

