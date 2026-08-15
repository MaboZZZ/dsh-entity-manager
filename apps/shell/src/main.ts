/**
 * Electron main process (M4).
 *
 * - Runs the manager daemon in-process (createManagerServer) on 127.0.0.1.
 * - Main window hosts the manager UI (built ui/ in production, dev URL in dev).
 * - Native menu + tray: toggle auto-launch, quit.
 * - IPC: the renderer can ask to open an entity GUI in its own app window,
 *   and report the manager URL so fetches do not depend on a proxy.
 * - On quit, running entities are stopped so no orphan DSH processes remain.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createManagerServer } from '@dshm/manager'

const DEV_UI_URL = process.env.DSHM_DEV_UI_URL ?? 'http://127.0.0.1:5173'
const isDev = Boolean(process.env.DSHM_DEV) || !app.isPackaged

let manager: ReturnType<typeof createManagerServer> | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let managerUrl = ''

/** Start the in-process manager; prefer 4180, fall back to OS-assigned. */
async function startManager(): Promise<string> {
  const rootDir = process.env.DSHM_HOME ?? join(homedir(), '.dsh-entities')
  const preferredPort = Number(process.env.DSHM_PORT ?? 4180)
  let server = createManagerServer({ port: preferredPort, rootDir, version: app.getVersion() })
  try {
    const info = await server.start()
    manager = server
    console.log(`[shell] manager at ${info.url} (home: ${rootDir})`)
    return info.url
  } catch {
    // port busy (e.g. a standalone manager is already running)
    await server.stop().catch(() => {})
    server = createManagerServer({ port: 0, rootDir, version: app.getVersion() })
    const info = await server.start()
    manager = server
    console.log(`[shell] manager at ${info.url} (home: ${rootDir})`)
    return info.url
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    title: 'DSH Entity Manager',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:')) openEntityWindow(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  if (isDev) {
    void mainWindow.loadURL(DEV_UI_URL)
  } else {
    // packaged: UI ships via extraResources (process.resourcesPath/ui-dist)
    void mainWindow.loadFile(join(process.resourcesPath, 'ui-dist', 'index.html'))
  }
}

/** Open an entity GUI (or any loopback URL) in its own app window. */
function openEntityWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: `DSH — ${url}`,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://127.0.0.1:')) openEntityWindow(target)
    return { action: 'deny' }
  })
  void win.loadURL(url)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Entity',
      submenu: [
        { label: 'Open manager', accelerator: 'CmdOrCtrl+1', click: () => mainWindow?.show() },
        { label: 'Reload UI', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { type: 'separator' },
        { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked })
        } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(import.meta.dirname, '../assets/tray.png'))
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('DSH Entity Manager')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show manager', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: 'Open entity GUI in window', click: () => openEntityWindow(managerUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit() } },
  ]))
  tray.on('click', () => { mainWindow?.show() })
}

async function stopEntities(): Promise<void> {
  if (!manager) return
  await manager.processes.stopAll()
}

// Single-instance lock: two app instances sharing one DSH home would clobber
// each other's entities.json ("entity disappeared from the store").
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

void app.whenReady().then(async () => {
  managerUrl = await startManager()
  ipcMain.on('dshm:manager-url-sync', (event) => {
    event.returnValue = managerUrl
  })
  ipcMain.handle('dshm:open-entity-window', (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('http://127.0.0.1:')) openEntityWindow(url)
  })
  ipcMain.handle('dshm:open-manager', () => { mainWindow?.show(); mainWindow?.focus() })
  ipcMain.handle('dshm:pick-directory', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: title ?? 'Choose directory',
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('dshm:pick-file', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: title ?? 'Choose file',
      filters: [{ name: 'Entity bundle', extensions: ['gz', 'zip'] }],
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] ?? null
  })

  createWindow()
  buildMenu()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  // Close every entity instance (running, starting, or merely alive) so no
  // DSH process/container survives the app closing. Timeout guards the quit.
  event.preventDefault()
  const quit = () => app.exit(0)
  const timer = setTimeout(quit, 30_000)
  void stopEntities().finally(() => {
    clearTimeout(timer)
    quit()
  })
})

// Closing the last window fully quits the app on every platform, which then
// stops all entity instances (before-quit above).
app.on('window-all-closed', () => {
  app.quit()
})
