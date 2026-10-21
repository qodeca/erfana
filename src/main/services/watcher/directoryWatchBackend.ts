// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Directory watch backend seam (#211, design D6)
 *
 * Decides how the project's directory watcher is built. On Windows chokidar
 * opens one `fs.watch` handle per folder and scans the whole project while the
 * first tree read runs; on macOS chokidar 4+ dropped FSEvents and costs one
 * file descriptor per watched file, which exhausts the process FD table on a
 * large project. Both therefore get one native recursive watcher per project
 * (`fs.watch` is FSEvents on macOS, ~0 FDs per file). Linux keeps chokidar.
 *
 * `ERFANA_DIRECTORY_WATCHER=chokidar` forces chokidar on every platform. It is
 * for support and diagnosis only – there is no setting and no UI. Only that
 * exact value counts; any other non-empty value is ignored and logged.
 *
 * Nothing but `selectDirectoryWatchBackend` exists here at runtime, on purpose:
 * the main-process test setup replaces this module wholesale with a stub that
 * returns `chokidar`, so every suite that mocks chokidar runs the same code on a
 * Windows host as on Linux CI. Keep further runtime exports out of this file.
 */

import { logger } from '../LoggingService'

/** Which implementation watches a project directory. */
export type DirectoryWatchBackend = 'chokidar' | 'native-recursive'

/**
 * Why a native watcher lost track of changes and asks for a re-read (D3).
 * A closed set, so log lines carry a reason and never a Node error message.
 */
export type DirectoryWatchResyncReason = 'overflow' | 'backlog' | 'watch-error' | 'reopen'

/** Events whose single argument is an absolute path under the watched root. */
type DirectoryWatchPathEvent = 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'

/**
 * What the directory watcher service needs from either backend. chokidar's
 * `FSWatcher` satisfies it as is; chokidar never emits `resync`.
 */
export interface DirectoryWatchHandle {
  on(event: DirectoryWatchPathEvent, listener: (path: string) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'ready', listener: () => void): this
  on(event: 'resync', listener: (reason: DirectoryWatchResyncReason) => void): this
  close(): Promise<void>
}

const OVERRIDE_ENV_VAR = 'ERFANA_DIRECTORY_WATCHER'
const OVERRIDE_VALUE: DirectoryWatchBackend = 'chokidar'

/**
 * Choose the directory watch backend.
 *
 * @param platform - the host platform (`process.platform` by default)
 * @param env - the environment (`process.env` by default); only
 *   `ERFANA_DIRECTORY_WATCHER` is read
 * @returns `native-recursive` on Windows and macOS, otherwise `chokidar`;
 *   `chokidar` everywhere when the variable is exactly `chokidar`
 */
export function selectDirectoryWatchBackend(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env
): DirectoryWatchBackend {
  const override = env[OVERRIDE_ENV_VAR]
  if (override === OVERRIDE_VALUE) {
    return OVERRIDE_VALUE
  }
  // An empty value is how shells commonly "unset" a variable: treat it as absent
  if (override !== undefined && override !== '') {
    // The value itself is free text from the environment, so it is not logged
    logger.warn('Directory watcher override ignored: unknown value', {
      variable: OVERRIDE_ENV_VAR,
      accepted: [OVERRIDE_VALUE]
    })
  }
  return platform === 'win32' || platform === 'darwin' ? 'native-recursive' : 'chokidar'
}
