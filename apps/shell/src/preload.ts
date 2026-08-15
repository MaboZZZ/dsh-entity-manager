/**
 * Preload skeleton. M4: expose a minimal, typed bridge to the renderer
 * (e.g. manager URL, entity webview control) without nodeIntegration.
 */
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('dshm', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node,
  },
})
