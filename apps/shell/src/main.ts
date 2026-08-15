/**
 * Electron main process skeleton.
 *
 * Current shape: one BrowserWindow that loads the manager UI.
 *
 * M4 milestones tracked here:
 *  - spawn the manager daemon (or run it in-process) when the app starts
 *  - per-entity tabs rendered as webviews pointing at each entity's
 *    loopback URL, driven by the manager API
 *  - tray / auto-launch / packaging
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

const DEV_UI_URL = process.env.DSHM_DEV_UI_URL ?? 'http://127.0.0.1:5173'
const isDev = Boolean(process.env.DSHM_DEV)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'DSH Entity Manager',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Open external links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(DEV_UI_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../../ui/dist/index.html'))
  }
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
