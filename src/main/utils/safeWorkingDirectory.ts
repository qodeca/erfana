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
import { dirname } from 'path'

export interface SafeCwdEnv {
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  userDataPath: () => string
  chdir: (dir: string) => void
}

/** The folder chosen, or null when nothing was changed. */
export function moveToSafeWorkingDirectory(env: SafeCwdEnv): string | null {
  if (!env.isPackaged) return null
  // Windows: the install folder, already first in the DLL / exe search order.
  // Elsewhere: the app's own data folder.
  try {
    const target = env.platform === 'win32' ? dirname(env.execPath) : env.userDataPath()
    env.chdir(target)
    return target
  } catch {
    return null
  }
}
