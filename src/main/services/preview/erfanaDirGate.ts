// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `.erfana/` directory gate (Issue #74, work item 18, X3).
 *
 * The allowlist write-back (design §3.3) derives its temp path from
 * `dirname(settingsPath)`, so if `.erfana` were a symlink BOTH the temp write
 * and the atomic rename would land inside the symlink target. A repo shipping
 * `.erfana -> ../../.claude` would then have Erfana overwrite that file on the
 * single most expected action in the feature. This gate closes that:
 *
 *   1. `lstat` — if `.erfana` exists AND is a symlink → REFUSE.
 *   2. absent → `mkdir` NON-recursively (mode 0o700), so an existing symlink
 *      raises `EEXIST` rather than being silently followed (`mkdir -p` does).
 *   3. `realpath`, then require `relative(realRoot, real) === '.erfana'` — the
 *      same `path.relative`-based containment rule `previewPathResolve` uses,
 *      not a second one, tightened to the exact expected name.
 */

import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { AppError, ErrorCode } from '../../../shared/errors'

const ERFANA_DIR_NAME = '.erfana'
const ERFANA_DIR_MODE = 0o700

/**
 * Resolve (creating if needed) the project's `.erfana` directory, refusing any
 * symlinked or out-of-root resolution.
 *
 * @param realRoot MUST already be the `fsPromises.realpath` of the project root,
 *   so the final `relative` comparison is symlink-free on the root side.
 * @returns the real absolute path to `<realRoot>/.erfana`.
 * @throws AppError(SYMLINK_ATTACK) if `.erfana` is a symlink or resolves outside
 *   the root.
 */
export async function resolveErfanaDir(realRoot: string): Promise<string> {
  const erfanaPath = join(realRoot, ERFANA_DIR_NAME)

  // 1. Refuse a symlinked `.erfana` outright.
  let exists = true
  try {
    const st = await lstat(erfanaPath)
    if (st.isSymbolicLink()) {
      throw new AppError(
        'Refusing to use a symlinked .erfana directory',
        ErrorCode.SYMLINK_ATTACK
      )
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      exists = false
    } else {
      throw error
    }
  }

  // 2. Create non-recursively when absent. A symlink planted between the lstat
  // and here raises EEXIST here (mkdir does not follow), which we surface as a
  // symlink refusal rather than trusting it.
  if (!exists) {
    try {
      await mkdir(erfanaPath, { mode: ERFANA_DIR_MODE })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new AppError(
          'Refusing to use a symlinked .erfana directory',
          ErrorCode.SYMLINK_ATTACK
        )
      }
      throw error
    }
  }

  // 3. Resolve and require containment at exactly `.erfana` (same relative-based
  // rule as previewPathResolve's confinement, tightened to the exact name).
  const real = await realpath(erfanaPath)
  if (relative(realRoot, real) !== ERFANA_DIR_NAME) {
    throw new AppError(
      'Resolved .erfana directory escapes the project root',
      ErrorCode.SYMLINK_ATTACK
    )
  }

  return real
}
