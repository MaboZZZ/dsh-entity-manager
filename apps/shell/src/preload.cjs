/**
 * Preload bridge (CJS: sandboxed preloads cannot use ESM).
 * Exposes the manager URL and window helpers to the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshm', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron || '',
    node: process.versions.node,
  },
  // synchronous: the renderer reads this once at startup to build its API base
  managerUrl: ipcRenderer.sendSync('dshm:manager-url-sync'),
  /** open an entity GUI in its own app window */
  openEntityWindow: (url) => ipcRenderer.invoke('dshm:open-entity-window', url),
  openManager: () => ipcRenderer.invoke('dshm:open-manager'),
})
