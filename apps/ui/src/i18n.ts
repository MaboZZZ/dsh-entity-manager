/**
 * Minimal UI i18n: zh / en monolingual display with a toggle.
 * The chosen language is persisted in localStorage.
 */
import { useCallback, useState } from 'react'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'dshm-lang'

const zh: Record<string, string> = {
  entities: '实体',
  noEntities: '还没有实体 — 在下方创建',
  start: '启动',
  stop: '停止',
  open: '打开',
  detail: '详情',
  delete: '删除',
  export: '导出',
  exportAll: '导出全部',
  exportingBusy: '导出中',
  exportAllBusy: '导出全部',
  exportedTo: '已导出到',
  newEntity: '新建实体',
  name: '名称',
  version: '版本',
  pickVersion: '选择一个版本…',
  needsInstall: '（需要安装）',
  localTag: '[本地]',
  profile: '配置',
  webProfile: 'web（浏览器界面）',
  headlessProfile: 'headless',
  isolation: '隔离',
  processIso: 'process（默认）',
  sandboxIso: 'sandbox（landlock，仅 Linux）',
  containerIso: 'container（Docker）',
  apiKey: 'DeepSeek API 密钥',
  optional: '（可选）',
  baseUrl: '基础地址',
  createEntity: '创建实体',
  creatingBusy: '创建中',
  portAuto: '端口自动分配并保持稳定',
  importBundle: '导入实体包',
  bundlePath: '本机 bundle 路径',
  import: '导入',
  importingBusy: '导入中',
  createsFresh: '创建全新实体（新 id 和数据目录）',
  versions: '版本',
  refresh: '刷新',
  refreshingBusy: '刷新中',
  addLocal: '添加本地版本',
  label: '标签',
  localDir: '本地 DSH 项目代码目录',
  chooseDir: '选择目录',
  registerLocal: '注册本地版本',
  addingLocalBusy: '添加本地版本',
  noVersions: '未找到版本 — 点刷新，或添加本地 checkout',
  installed: '已安装',
  available: '可安装',
  install: '安装',
  installing: '安装中…',
  installingBusy: '安装中',
  installDone: '安装完成',
  installFailed: '安装失败',
  installedAt: '安装位置',
  started: '开始',
  finished: '结束',
  installingOne: '安装中（一次只装一个版本）',
  collapse: '收起',
  showDetails: '显示详情',
  back: '← 返回',
  home: '主目录',
  port: '端口',
  pid: '进程',
  profileLabel: '配置',
  switchVersion: '切换版本',
  switchRestart: '切换并重启',
  switchingBusy: '切换版本中',
  dataKept: '实体数据保持不变',
  snapshots: '快照与迁移',
  takeSnapshot: '创建快照',
  snapshottingBusy: '快照中',
  exportBundle: '导出实体包',
  downloadBundle: '下载实体包',
  openInWindow: '在应用窗口中打开',
  restoringBusy: '恢复中',
  restore: '恢复',
  specOnly: '仅配置',
  gui: '界面',
  notRunning: '（未运行）',
  logs: '日志',
  startToEmbed: '启动实体后在此嵌入其 GUI',
  waitingLogs: '（等待输出…）',
  connecting: '连接中…',
  stoppingBusy: '停止中',
  startingBusy: '启动中',
  deletingBusy: '删除中',
  managerUp: 'manager v{version} · {entities} 个实体 · 运行 {uptime}s',
  chooseExportDir: '选择导出目录',
  noDirChosen: '已取消（未选择目录）',
  langToggle: 'EN',
}

const en: Record<string, string> = {
  entities: 'Entities',
  noEntities: 'No entities yet — create one below',
  start: 'start',
  stop: 'stop',
  open: 'open',
  detail: 'detail',
  delete: 'delete',
  export: 'export',
  exportAll: 'Export All',
  exportingBusy: 'exporting',
  exportAllBusy: 'exporting all',
  exportedTo: 'exported to',
  newEntity: 'New entity',
  name: 'Name',
  version: 'Version',
  pickVersion: 'pick a version…',
  needsInstall: ' (needs install)',
  localTag: ' [local]',
  profile: 'Profile',
  webProfile: 'web (browser GUI)',
  headlessProfile: 'headless',
  isolation: 'Isolation',
  processIso: 'process (default)',
  sandboxIso: 'sandbox (landlock, Linux only)',
  containerIso: 'container (Docker)',
  apiKey: 'DeepSeek API key',
  optional: ' (optional)',
  baseUrl: 'Base URL',
  createEntity: 'Create entity',
  creatingBusy: 'creating',
  portAuto: 'port is auto-assigned and kept stable',
  importBundle: 'Import entity bundle',
  bundlePath: 'Bundle path on this machine',
  import: 'Import',
  importingBusy: 'importing',
  createsFresh: 'creates a fresh entity with a new id and home',
  versions: 'Versions',
  refresh: 'refresh',
  refreshingBusy: 'refreshing versions',
  addLocal: 'add local version',
  label: 'Label',
  localDir: 'Local DSH project directory',
  chooseDir: 'Choose directory',
  registerLocal: 'Register local version',
  addingLocalBusy: 'adding local version',
  noVersions: 'No versions found — try refresh, or add a local checkout',
  installed: 'installed',
  available: 'available',
  install: 'install',
  installing: 'installing…',
  installingBusy: 'installing',
  installDone: 'install done',
  installFailed: 'install failed',
  installedAt: 'installed at',
  started: 'started',
  finished: 'finished',
  installingOne: 'installing (one version at a time)',
  collapse: 'collapse',
  showDetails: 'show install details',
  back: '← back',
  home: 'home',
  port: 'port',
  pid: 'pid',
  profileLabel: 'profile',
  switchVersion: 'Switch version:',
  switchRestart: 'switch & restart',
  switchingBusy: 'switching version',
  dataKept: 'data in the entity home stays untouched',
  snapshots: 'Snapshots & transfer',
  takeSnapshot: 'take snapshot',
  snapshottingBusy: 'snapshotting',
  exportBundle: 'export bundle',
  downloadBundle: 'download bundle',
  openInWindow: 'open in app window',
  restoringBusy: 'restoring',
  restore: 'restore',
  specOnly: 'spec only',
  gui: 'GUI',
  notRunning: ' (not running)',
  logs: 'logs',
  startToEmbed: 'start the entity to embed its GUI here',
  waitingLogs: '(waiting for output…)',
  connecting: 'connecting…',
  stoppingBusy: 'stopping',
  startingBusy: 'starting',
  deletingBusy: 'deleting',
  managerUp: 'manager v{version} · {entities} entities · up {uptime}s',
  chooseExportDir: 'Choose export directory',
  noDirChosen: 'cancelled (no directory chosen)',
  langToggle: '中',
}

const dicts: Record<Lang, Record<string, string>> = { zh, en }

export function useLang(): {
  lang: Lang
  t: (key: string, vars?: Record<string, string | number>) => string
  toggle: () => void
} {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let s = dicts[lang][key] ?? dicts.en[key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
      }
      return s
    },
    [lang],
  )
  const toggle = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === 'zh' ? 'en' : 'zh'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore storage errors
      }
      return next
    })
  }, [])
  return { lang, t, toggle }
}
