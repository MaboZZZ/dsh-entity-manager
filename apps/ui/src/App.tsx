import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { EntityInfo, HealthInfo, JobInfo, SnapshotInfo, VersionInfo } from '@dshm/shared'
import {
  BASE,
  createEntity,
  createSnapshot,
  deleteEntity,
  deleteVersion,
  exportAllEntities,
  exportEntityTo,
  getEntities,
  getHealth,
  getJobs,
  getLogs,
  getSettings,
  getVersions,
  importEntity,
  installVersion,
  listSnapshots,
  patchEntity,
  pickDirectory,
  pickFile,
  registerLocal,
  restoreSnapshot,
  startEntity,
  stopEntity,
  updateSettings,
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
  const [showCreate, setShowCreate] = useState(false)

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

  const changeEntitiesDir = useCallback(async (): Promise<void> => {
    const dir = await pickDirectory(t('pickDirTitle'))
    if (!dir) {
      setError(t('noDirChosen'))
      return
    }
    const result = await updateSettings({ entitiesDir: dir })
    const moved = result.moved ?? []
    const errors = result.errors ?? []
    const parts: string[] = [`${t('entitiesDirChanged')}: ${result.entitiesDir ?? dir}`]
    if (moved.length > 0) parts.push(`${t('movedVersions')}: ${moved.join(', ')}`)
    if (errors.length > 0) parts.push(`${t('moveErrors')}: ${errors.join('; ')}`)
    setError(parts.join(' · '))
    await refresh()
  }, [t, refresh])

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
                <span className="actions">
                  <button className="btn-secondary" onClick={() => setShowCreate(true)}>+ {t('newEntity')}</button>
                  <button className="btn-secondary" onClick={() => void act(t('entitiesDirBusy'), changeEntitiesDir)}>{t('entitiesDir')}</button>
                  {entities.length > 0 && (
                    <button className="btn-secondary" onClick={() => void act(t('exportAllBusy'), exportAllWithDir)}>{t('exportAll')}</button>
                  )}
                </span>
              </div>
              {entities.length === 0
                ? <p className="muted">{t('noEntities')}</p>
                : (
                  <ul className="cards">
                    {entities.map((entity) => (
                      <li key={entity.spec.id} className="card entity-row">
                        <div className="entity-main">
                          <button className="link" onClick={() => setDetail(entity)}>
                            <strong>{entity.spec.name}</strong>
                          </button>
                          <span className="badge">{entity.spec.version.ref}</span>
                          <span className={`phase ${entity.status.phase}`}>{entity.status.phase}</span>
                          {entity.status.port !== null && <code className="muted">:{entity.status.port}</code>}
                        </div>
                        <div className="entity-actions">
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
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </section>

            {showCreate && (
              <Modal title={t('newEntity')} onClose={() => setShowCreate(false)}>
                <CreateWizard versions={versions} onCreated={() => void refresh()} onClose={() => setShowCreate(false)} act={act} t={t} />
              </Modal>
            )}

            <ImportPanel act={act} onImported={() => void refresh()} t={t} />

            <VersionsPanel versions={versions} jobs={jobs} act={act} onRefresh={refresh} onNotice={setError} t={t} />
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
  onClose: () => void
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  t: T
}) {
  const { versions, onCreated, onClose, act, t } = props
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
    // use the selected version's real source (npm / local / git-tag)
    const selected = versions.find((v) => v.ref === ref && (v.installed || v.source === 'npm'))
    void act(t('creatingBusy'), async () => {
      await createEntity({
        name: name.trim(),
        version: { source: selected?.source ?? 'npm', ref },
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
      onClose()
      onCreated()
    })
  }

  return (
    <>
      <label>{t('name')}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sandbox" autoFocus />
      </label>
      <label>{t('version')}
        <select value={ref} onChange={(e) => setRef(e.target.value)}>
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
      <span className="muted">{t('portAuto')}</span>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
        <button className="btn-primary" disabled={!name.trim() || !ref} onClick={submit}>{t('createEntity')}</button>
      </div>
    </>
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
    const selected = versions.filter((v) => v.installed).find((v) => v.ref === switchRef)
    void act(t('switchingBusy'), async () => {
      await patchEntity(entity.spec.id, { version: { source: selected?.source ?? 'npm', ref: switchRef }, restart: true })
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

function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="chevron" onClick={props.onClose}>✕</button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ImportPanel(props: {
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  onImported: () => void
  t: T
}) {
  const { act, onImported, t } = props

  const doImport = async () => {
    const file = await pickFile(t('pickFileTitle'))
    if (!file) return
    await act(t('importingBusy'), async () => {
      await importEntity(file)
      onImported()
    })
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('importBundle')}</h2>
        <span className="actions">
          <button onClick={() => void doImport()}>{t('import')}</button>
        </span>
      </div>
      <p className="muted">{t('createsFresh')} — {t('chooseBundleFile')}</p>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function VersionsPanel(props: {
  versions: VersionInfo[]
  jobs: JobInfo[]
  act: (label: string, fn: () => Promise<unknown>) => Promise<void>
  onRefresh: () => Promise<unknown>
  onNotice: (message: string) => void
  t: T
}) {
  const { versions, jobs, act, onRefresh, onNotice, t } = props
  const [modal, setModal] = useState<'local' | 'dir' | null>(null)
  const [localLabel, setLocalLabel] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [settingsDir, setSettingsDir] = useState<string | null>(null)
  const [pendingDir, setPendingDir] = useState<string | null>(null)

  useEffect(() => {
    void getSettings().then((s) => setSettingsDir(s.versionsDir)).catch(() => {})
  }, [])

  const installJobs = jobs.filter((j) => j.kind === 'version-install')
  const activeInstall = installJobs.find((j) => j.status === 'pending' || j.status === 'running')
  const jobFor = (ref: string): JobInfo | undefined =>
    installJobs.find((j) => j.target === ref)

  const openLocalModal = () => {
    setLocalLabel('')
    setLocalPath('')
    setModal('local')
  }

  const openDirModal = () => {
    setPendingDir(null)
    setModal('dir')
  }

  const registerLocalVersion = () => {
    if (!localLabel.trim() || !localPath.trim()) return
    void act(t('addingLocalBusy'), async () => {
      await registerLocal(localLabel.trim(), localPath.trim())
      setModal(null)
      onRefresh()
    })
  }

  const applyDataDir = () => {
    if (!pendingDir || pendingDir === settingsDir) return
    void act(t('applyingBusy'), async () => {
      const result = await updateSettings({ versionsDir: pendingDir })
      setSettingsDir(result.versionsDir ?? pendingDir)
      setModal(null)
      const moved = result.moved ?? []
      const errors = result.errors ?? []
      const parts: string[] = [`${t('changedDir')}: ${result.versionsDir ?? pendingDir}`]
      if (moved.length > 0) parts.push(`${t('movedVersions')}: ${moved.join(', ')}`)
      if (errors.length > 0) parts.push(`${t('moveErrors')}: ${errors.join('; ')}`)
      onNotice(parts.join(' · '))
      onRefresh()
    })
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('versions')}</h2>
        <span className="actions">
          <button onClick={() => void act(t('refreshingBusy'), onRefresh)}>⟳ {t('refresh')}</button>
          <button onClick={openLocalModal}>+ {t('addLocal')}</button>
          <button onClick={openDirModal}>+ {t('versionDataDir')}</button>
        </span>
      </div>

      {modal === 'local' && (
        <Modal title={t('addLocalTitle')} onClose={() => setModal(null)}>
          <div className="modal-row">
            <span className="modal-row-label">{t('label')}</span>
            <div className="modal-row-control">
              <input value={localLabel} onChange={(e) => setLocalLabel(e.target.value)} placeholder="e.g. dev" autoFocus />
            </div>
          </div>
          <div className="modal-row">
            <span className="modal-row-label">{t('localDir')}</span>
            <div className="modal-row-control">
              <div className="dir-pick">
                <code className="pick-value">{localPath || '…'}</code>
                <button type="button" onClick={() => void pickDirectory(t('pickDirTitle')).then((d) => { if (d) setLocalPath(d) })}>
                  {t('chooseDir')}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setModal(null)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={!localLabel.trim() || !localPath.trim()} onClick={registerLocalVersion}>{t('register')}</button>
          </div>
        </Modal>
      )}

      {modal === 'dir' && (
        <Modal title={t('dataDirTitle')} onClose={() => setModal(null)}>
          <div className="modal-row">
            <span className="modal-row-label">{t('versionDataDir')}</span>
            <div className="modal-row-control">
              <div className="dir-pick">
                <code className="pick-value">{pendingDir ?? settingsDir ?? '…'}</code>
                <button type="button" onClick={() => void pickDirectory(t('pickDirTitle')).then((d) => { if (d) setPendingDir(d) })}>
                  {t('chooseDir')}
                </button>
              </div>
            </div>
          </div>
          <span className="muted">{t('applyDirHint')}</span>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setModal(null)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={!pendingDir || pendingDir === settingsDir} onClick={applyDataDir}>{t('apply')}</button>
          </div>
        </Modal>
      )}

      {versions.length === 0 && <p className="muted">{t('noVersions')}</p>}
      <ul className="cards">
        {versions.map((version) => {
          const job = jobFor(version.ref)
          const isInstalling = job !== undefined && (job.status === 'pending' || job.status === 'running')
          const pct = job?.progress?.percent ?? 0
          const doDelete = () => {
            if (!version.installed || isInstalling) return
            const ok = window.confirm(`${t('deleteVersion')}: ${version.ref}?`)
            if (!ok) return
            void act(t('deletingBusy'), async () => {
              try {
                await deleteVersion(version.source, version.ref)
                await onRefresh()
              } catch (reason) {
                onNotice(reason instanceof Error ? reason.message : String(reason))
              }
            })
          }
          return (
            <li key={`${version.source}:${version.ref}`} className="card version-row">
              <strong className="v-name">{version.ref}</strong>
              <span className="badge">{version.source}</span>
              <div className="version-middle">
                {isInstalling && job?.progress && (
                  <>
                    <div className="progress">
                      <div className="progress-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted">{pct}% · {job.progress.label}</span>
                  </>
                )}
                {job?.status === 'failed' && (
                  <span className="err-text">{t('installFailed')}: {job.error ?? 'unknown error'}</span>
                )}
                {!isInstalling && version.installed && version.installDir && (
                  <code className="muted ellipsis" title={version.installDir}>{version.installDir}</code>
                )}
              </div>
              <span className="version-status">
                {version.installed
                  ? <span className="badge ok">{t('installed')}</span>
                  : <span className="badge">{t('available')}</span>}
                {!version.installed && !isInstalling && (
                  <button
                    disabled={activeInstall !== undefined}
                    onClick={() => void act(t('installingBusy'), () => installVersion('npm', version.ref))}
                  >
                    {t('install')}
                  </button>
                )}
                {version.installed && !isInstalling && (
                  <button className="danger" onClick={doDelete}>{t('delete')}</button>
                )}
                {isInstalling && <span className="muted">{pct}%</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
