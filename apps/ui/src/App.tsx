import { useCallback, useEffect, useState } from 'react'
import type { EntityInfo, HealthInfo, JobInfo, SnapshotInfo, VersionInfo } from '@dshm/shared'
import {
  BASE,
  createEntity,
  createSnapshot,
  deleteEntity,
  exportAllEntities,
  exportEntityTo,
  getEntities,
  getHealth,
  getJobs,
  getLogs,
  getVersions,
  importEntity,
  installVersion,
  listSnapshots,
  patchEntity,
  pickDirectory,
  registerLocal,
  restoreSnapshot,
  startEntity,
  stopEntity,
} from './api.ts'
import { useLang } from './i18n.ts'

const POLL_MS = 3000

export function App() {
  const { lang, t, toggle } = useLang()
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

  const exportEntityWithDir = useCallback(async (id: string): Promise<string | null> => {
    const dir = await pickDirectory()
    if (!dir) {
      setError(t('noDirChosen'))
      return null
    }
    const result = await exportEntityTo(id, dir)
    setError(null)
    return result.path
  }, [t])

  const exportAllWithDir = useCallback(async (): Promise<string | null> => {
    const dir = await pickDirectory()
    if (!dir) {
      setError(t('noDirChosen'))
      return null
    }
    const result = await exportAllEntities(dir)
    setError(null)
    return result.exported.length > 0 ? result.exported[0]!.path : null
  }, [t])

  return (
    <div className="app">
      <header className="app-header">
        <h1>DSH Entity Manager</h1>
        <span className="health">
          {health
            ? t('managerUp', { version: health.version, entities: health.entities, uptime: health.uptimeSeconds })
            : t('connecting')}
        </span>
        <button className="lang-toggle" onClick={toggle} title={lang === 'zh' ? 'Switch to English' : '切换到中文'}>
          {t('langToggle')}
        </button>
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
            t={t}
          />
        : (
          <>
            <section className="panel">
              <div className="panel-head">
                <h2>{t('entities')}</h2>
                {entities.length > 0 && (
                  <span className="actions">
                    <button onClick={() => void act(t('exportAllBusy'), exportAllWithDir)}>{t('exportAll')}</button>
                  </span>
                )}
              </div>
              {entities.length === 0
                ? <p className="muted">{t('noEntities')}</p>
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
                            ? <button onClick={() => void act(t('stoppingBusy'), () => stopEntity(entity.spec.id))}>{t('stop')}</button>
                            : <button onClick={() => void act(t('startingBusy'), () => startEntity(entity.spec.id))}>{t('start')}</button>}
                          {entity.status.port !== null && (
                            <a href={`http://127.0.0.1:${String(entity.status.port)}/`} target="_blank" rel="noreferrer">{t('open')}</a>
                          )}
                          <button onClick={() => setDetail(entity)}>{t('detail')}</button>
                          <button onClick={() => void act(t('exportingBusy'), async () => {
                            const path = await exportEntityWithDir(entity.spec.id)
                            if (path) setError(`${t('exportedTo')} ${path}`)
                          })}>{t('export')}</button>
                          <button className="danger" onClick={() => void act(t('deletingBusy'), () => deleteEntity(entity.spec.id))}>{t('delete')}</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </section>

            <CreateWizard versions={versions} onCreated={() => void refresh()} act={act} t={t} />

            <ImportPanel act={act} onImported={() => void refresh()} t={t} />

            <VersionsPanel versions={versions} jobs={jobs} act={act} onRefresh={refresh} t={t} />
          </>
        )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

type T = ReturnType<typeof useLang>['t']

function CreateWizard(props: {
  versions: VersionInfo[]
  onCreated: () => void
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  t: T
}) {
  const { versions, onCreated, act, t } = props
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
    void act(t('creatingBusy'), async () => {
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
        <button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {t('newEntity')}</button>
      </h2>
      {open && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <label>{t('name')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sandbox" required />
          </label>
          <label>{t('version')}
            <select value={ref} onChange={(e) => setRef(e.target.value)} required>
              <option value="" disabled>{t('pickVersion')}</option>
              {versionOptions.map((v) => (
                <option key={`${v.source}:${v.ref}`} value={v.ref}>
                  {v.ref}{v.installed ? '' : t('needsInstall')}{v.source === 'local' ? t('localTag') : ''}
                </option>
              ))}
            </select>
          </label>
          <label>{t('profile')}
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="web">{t('webProfile')}</option>
              <option value="headless">{t('headlessProfile')}</option>
            </select>
          </label>
          <label>{t('isolation')}
            <select value={isolation} onChange={(e) => setIsolation(e.target.value)}>
              <option value="process">{t('processIso')}</option>
              <option value="sandbox">{t('sandboxIso')}</option>
              <option value="container">{t('containerIso')}</option>
            </select>
          </label>
          <label>{t('apiKey')} <span className="muted">{t('optional')}</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
          </label>
          <label>{t('baseUrl')} <span className="muted">{t('optional')}</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" />
          </label>
          <div className="form-row">
            <button type="submit">{t('createEntity')}</button>
            <span className="muted">{t('portAuto')}</span>
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
  t: T
}) {
  const { entity, versions, onBack, onChanged, act, t } = props
  const [logs, setLogs] = useState('')
  const [switchRef, setSwitchRef] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [exportPath, setExportPath] = useState<string | null>(null)
  const iframeKey = `${entity.spec.id}-${entity.status.port ?? 'off'}`

  useEffect(() => {
    const timer = setInterval(() => {
      void getLogs(entity.spec.id, 400).then(({ logs }) => setLogs(logs)).catch(() => {})
    }, 2000)
    void listSnapshots(entity.spec.id).then(setSnapshots).catch(() => {})
    return () => clearInterval(timer)
  }, [entity.spec.id])

  const switchVersion = () => {
    if (!switchRef || switchRef === entity.spec.version.ref) return
    void act(t('switchingBusy'), async () => {
      await patchEntity(entity.spec.id, { version: { source: 'npm', ref: switchRef }, restart: true })
      setSwitchRef('')
      onChanged()
    })
  }

  const doExport = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    const result = await exportEntityTo(entity.spec.id, dir)
    setExportPath(result.path)
  }

  const running = entity.status.phase === 'running'
  const port = entity.status.port
  const openInAppWindow = window.dshm?.openEntityWindow

  return (
    <section className="panel detail">
      <div className="detail-head">
        <button className="link" onClick={onBack}>{t('back')}</button>
        <h2>{entity.spec.name}</h2>
        <span className="badge">{entity.spec.version.ref}</span>
        <span className={`phase ${entity.status.phase}`}>{entity.status.phase}</span>
        <span className="actions">
          {running
            ? <button onClick={() => void act(t('stoppingBusy'), () => stopEntity(entity.spec.id))}>{t('stop')}</button>
            : <button onClick={() => void act(t('startingBusy'), () => startEntity(entity.spec.id))}>{t('start')}</button>}
          <button className="danger" onClick={() => void act(t('deletingBusy'), async () => { await deleteEntity(entity.spec.id); onBack(); })}>{t('delete')}</button>
        </span>
      </div>

      <dl className="meta">
        <dt>{t('home')}</dt><dd><code>{entity.spec.homeDir}</code></dd>
        <dt>{t('port')}</dt><dd><code>{port ?? '—'}</code></dd>
        <dt>{t('pid')}</dt><dd><code>{entity.status.pid ?? '—'}</code></dd>
        <dt>{t('profileLabel')}</dt><dd><code>{entity.spec.profile}</code></dd>
      </dl>

      <div className="version-switch">
        <span className="muted">{t('switchVersion')}</span>
        <select value={switchRef} onChange={(e) => setSwitchRef(e.target.value)}>
          <option value="" disabled>{t('pickVersion')}</option>
          {versions.filter((v) => v.installed).map((v) => (
            <option key={`${v.source}:${v.ref}`} value={v.ref}>
              {v.ref}{v.source === 'local' ? t('localTag') : ''}
            </option>
          ))}
        </select>
        <button onClick={switchVersion} disabled={!switchRef || switchRef === entity.spec.version.ref}>
          {t('switchRestart')}
        </button>
        <span className="muted">{t('dataKept')}</span>
      </div>

      <div className="snapshots">
        <div className="subhead">{t('snapshots')}</div>
        <div className="snap-row">
          <button onClick={() => void act(t('snapshottingBusy'), async () => {
            await createSnapshot(entity.spec.id)
            setSnapshots(await listSnapshots(entity.spec.id))
          })}>{t('takeSnapshot')}</button>
          <button onClick={() => void act(t('exportingBusy'), doExport)}>{t('exportBundle')}</button>
          <a href={`${BASE}/exports/${exportPath?.split('/').pop() ?? ''}`} className={exportPath ? '' : 'hidden'} download>{t('downloadBundle')}</a>
          {port !== null && openInAppWindow && (
            <button onClick={() => void openInAppWindow(`http://127.0.0.1:${port}/`)}>
              {t('openInWindow')}
            </button>
          )}
        </div>
        {snapshots.length > 0 && (
          <ul className="snap-list">
            {snapshots.map((snap) => (
              <li key={snap.id}>
                <span className="badge">{new Date(snap.createdAt).toLocaleString()}</span>
                <span className="muted">{snap.hasHome ? `${snap.sizeBytes} B home` : t('specOnly')}</span>
                <button className="danger" onClick={() => void act(t('restoringBusy'), () => restoreSnapshot(entity.spec.id, snap.id))}>
                  {t('restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="gui-and-logs">
        <div className="gui">
          <div className="subhead">{t('gui')}{port === null ? t('notRunning') : ` — http://127.0.0.1:${port}/`}</div>
          {port !== null
            ? <iframe key={iframeKey} title="entity GUI" src={`http://127.0.0.1:${port}/`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
            : <div className="placeholder">{t('startToEmbed')}</div>}
        </div>
        <div className="logs-pane">
          <div className="subhead">{t('logs')}</div>
          <pre className="logs">{logs || t('waitingLogs')}</pre>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function ImportPanel(props: {
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  onImported: () => void
  t: T
}) {
  const { act, onImported, t } = props
  const [path, setPath] = useState('')
  return (
    <section className="panel">
      <h2>{t('importBundle')}</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!path.trim()) return
          void act(t('importingBusy'), async () => {
            await importEntity(path.trim())
            setPath('')
            onImported()
          })
        }}
      >
        <label>{t('bundlePath')}
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/entity-….tar.gz" required />
        </label>
        <div className="form-row">
          <button type="submit">{t('import')}</button>
          <span className="muted">{t('createsFresh')}</span>
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
  t: T
}) {
  const { versions, jobs, act, onRefresh, t } = props
  const [showAddLocal, setShowAddLocal] = useState(false)
  const [localLabel, setLocalLabel] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const installJobs = jobs.filter((j) => j.kind === 'version-install')
  const activeInstall = installJobs.find((j) => j.status === 'pending' || j.status === 'running')
  const jobFor = (ref: string): JobInfo | undefined =>
    installJobs.find((j) => j.target === ref)

  const chooseLocalDir = async () => {
    const dir = await pickDirectory()
    if (dir) setLocalPath(dir)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('versions')}</h2>
        <span className="actions">
          <button onClick={() => void act(t('refreshingBusy'), onRefresh)}>⟳ {t('refresh')}</button>
          <button onClick={() => setShowAddLocal(!showAddLocal)}>+ {t('addLocal')}</button>
        </span>
      </div>
      {showAddLocal && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!localLabel.trim() || !localPath.trim()) return
            void act(t('addingLocalBusy'), async () => {
              await registerLocal(localLabel.trim(), localPath.trim())
              setLocalLabel('')
              setLocalPath('')
              setShowAddLocal(false)
              onRefresh()
            })
          }}
        >
          <label>{t('label')}
            <input value={localLabel} onChange={(e) => setLocalLabel(e.target.value)} placeholder="e.g. dev" required />
          </label>
          <label>{t('localDir')}
            <div className="dir-pick">
              <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/path/to/deepseek-harness" required />
              <button type="button" onClick={() => void chooseLocalDir()}>{t('chooseDir')}</button>
            </div>
          </label>
          <div className="form-row">
            <button type="submit">{t('registerLocal')}</button>
          </div>
        </form>
      )}
      {versions.length === 0 && <p className="muted">{t('noVersions')}</p>}
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
                ? <span className="badge ok">{t('installed')}</span>
                : (
                  <span className="actions">
                    <span className="badge">{t('available')}</span>
                    <button
                      disabled={activeInstall !== undefined && !isInstalling}
                      onClick={() => void act(t('installingBusy'), () => installVersion('npm', version.ref))}
                    >
                      {isInstalling ? t('installing') : t('install')}
                    </button>
                  </span>
                )}
              <button
                className="chevron"
                onClick={() => setExpanded(open ? null : version.ref)}
                title={open ? t('collapse') : t('showDetails')}
              >
                {open ? '▴' : '▾'}
              </button>
              {open && (
                <div className="version-detail">
                  {job && (job.status === 'pending' || job.status === 'running') && (
                    <>
                      <div className="progress"><div className="progress-bar running" /></div>
                      <span className="muted">{t('installingOne')}</span>
                    </>
                  )}
                  {job && job.status === 'done' && <span className="badge ok">{t('installDone')}</span>}
                  {job && job.status === 'failed' && (
                    <span className="err-text">{t('installFailed')}: {job.error ?? 'unknown error'}</span>
                  )}
                  {version.installed && version.installDir && (
                    <div className="muted">{t('installedAt')}: <code>{version.installDir}</code></div>
                  )}
                  {job && job.startedAt && (
                    <div className="muted">
                      {t('started')} {new Date(job.startedAt).toLocaleTimeString()}
                      {job.finishedAt ? ` · ${t('finished')} ${new Date(job.finishedAt).toLocaleTimeString()}` : ''}
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
