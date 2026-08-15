/**
 * dshm — DSH entity manager daemon entry.
 *
 * Environment:
 *   DSHM_PORT  listen port (default 4180)
 *   DSHM_HOME  manager home (default ~/.dsh-entities)
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createManagerServer } from './api.ts'

const PORT = Number(process.env.DSHM_PORT ?? 4180)
const ROOT_DIR = process.env.DSHM_HOME ?? join(homedir(), '.dsh-entities')
const VERSION = '0.0.0-dev'

const manager = createManagerServer({ port: PORT, rootDir: ROOT_DIR, version: VERSION })

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[dshm] ${signal}: shutting down`)
  await manager.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  const { url } = await manager.start()
  console.log(`[dshm] manager listening at ${url} (home: ${ROOT_DIR})`)
} catch (error) {
  console.error('[dshm] failed to start:', error)
  process.exit(1)
}
