// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Move a packaged app's working directory somewhere no project can be (#250).
 *
 * Defence in depth for every spawn by bare name: on Windows the process's
 * current directory is part of the executable search, and on POSIX an empty or
 * `.` PATH entry resolves against it. A packaged app inherits whatever folder
 * launched it – a terminal sitting in a cloned repository, for one.
 *
 * Packaged only: in development `electron-vite dev` and the e2e launcher rely
 * on the repository as cwd. Nothing in `src/main` resolves a relative path
 * against `process.cwd()` (checked when this was added); `spawnNewInstance`
 * passes absolute paths when packaged.
 */
import { mkdirSync } from 'fs'
import { win32 } from 'path'
import { redactPath } from './redactUserInput'

export interface SafeCwdEnv {
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  userDataPath: () => string
  chdir: (dir: string) => void
  /** Create the folder if needed (on a first launch userData may not exist yet). */
  mkdir?: (dir: string) => void
  /** Told when the move fails; the path it gets is already redacted. */
  warn?: (message: string, context: Record<string, unknown>) => void
}

/** The folder chosen, or null when nothing was changed. */
export function moveToSafeWorkingDirectory(env: SafeCwdEnv): string | null {
  if (!env.isPackaged) return null
  // Windows: the install folder, already first in the DLL / exe search order.
  // Elsewhere: the app's own data folder.
  let target = ''
  try {
    target = env.platform === 'win32' ? win32.dirname(env.execPath) : env.userDataPath()
    const mkdir = env.mkdir ?? ((dir: string) => mkdirSync(dir, { recursive: true }))
    if (env.platform !== 'win32') mkdir(target)
    env.chdir(target)
    return target
  } catch (error) {
    try {
      env.warn?.('Could not move the working directory to a safe folder', {
        path: target ? redactPath(target) : '(unknown)',
        code: (error as NodeJS.ErrnoException)?.code ?? 'unknown'
      })
    } catch {
      // Logging must never stop startup.
    }
    return null
  }
}
