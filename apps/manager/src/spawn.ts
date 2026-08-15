/**
 * Entity process lifecycle.
 *
 * M0 will implement the real spawn: run
 *   node <versionsDir>/<ref>/node_modules/@deepseek-ai/dsh/lib/bin.js --profile <profile>
 * with env DSH_HOME=<homesDir>/<id>, a port patch, and the entity's env, then
 * health-probe the web server and reconcile status in the store.
 *
 * This skeleton only sketches the interface and keeps the status contract.
 */
import { join } from 'node:path'
import type { EntityInfo, EntityStatus } from '@dshm/shared'
import { NotImplemented } from './versions.ts'

export class EntityProcessManager {
  constructor(readonly homesDir: string) {
    // M1: reconcile stale "running" statuses against live pids on boot.
  }

  start(entity: EntityInfo): EntityStatus {
    // M0: spawn child process; pick/verify port; probe /api/health until ready.
    throw new NotImplemented('entity spawn (M0)')
  }

  stop(entity: EntityInfo): EntityStatus {
    // M0: graceful SIGTERM, escalate to SIGKILL after a grace period.
    throw new NotImplemented('entity stop (M0)')
  }

  /** Absolute path of the entity's $DSH_HOME. */
  homeDirOf(entity: EntityInfo): string {
    return entity.spec.homeDir || join(this.homesDir, entity.spec.id)
  }
}
