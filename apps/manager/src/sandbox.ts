/**
 * L2 isolation: Landlock sandbox (Linux only).
 *
 * Wraps the entity process in DSH's own `landlock-run` launcher
 * (`@deepseek-ai/node-addon-landlock-run`): read-only the entire filesystem,
 * allow writes only to the entity home, the manager logs dir, and /dev/null.
 * The child cannot write anywhere else, even if the DSH version misbehaves.
 */
import { grantArgs, launcherPath } from '@deepseek-ai/node-addon-landlock-run'
import type { VersionLaunch } from '@dshm/shared'

export interface SandboxWrapOptions {
  homeDir: string
  logsDir: string
}

export interface WrappedLaunch {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

/**
 * Wrap a launch in the Landlock launcher. Throws on non-Linux platforms.
 * @param launch - the resolved dsh launch info (node + script + cwd).
 * @param options - writable roots the entity is allowed to touch.
 */
export function sandboxWrap(launch: VersionLaunch, options: SandboxWrapOptions): WrappedLaunch {
  if (process.platform !== 'linux') {
    throw new Error('isolation "sandbox" (landlock) requires Linux; current platform is ' + process.platform)
  }
  const launcher = launcherPath()
  const grants = grantArgs({
    readOnly: ['/'],
    readWrite: ['/dev/null', options.homeDir, options.logsDir],
  })
  return {
    command: launcher,
    args: [...grants, '--', process.execPath, ...launch.nodeArgs, launch.script],
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  }
}
