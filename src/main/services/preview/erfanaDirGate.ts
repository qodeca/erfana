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
 *   3. `realpath`, then require `realPathWithin(realRoot, real) === '.erfana'` —
 *      the exact realpath-prefix containment rule `previewPathResolve` decides
 *      with, not a second one, tightened to the exact expected name. Never
 *      `path.relative`: on win32 it folds case with JavaScript's `toLowerCase`,
 *      which maps U+212A KELVIN SIGN to `k`, so a `.erfana` swapped after
 *      step 1 for a junction into the sibling `…\proj<U+212A>\.erfana` would
 *      count as inside the root `…\projk` (security review F1).
 */

import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError, ErrorCode } from '../../../shared/errors'
import { realPathWithin } from './previewPathResolve'

const ERFANA_DIR_NAME = '.erfana'
const ERFANA_DIR_MODE = 0o700

/**
 * Resolve (creating if needed) the project's `.erfana` directory, refusing any
 * symlinked or out-of-root resolution.
 *
 * @param realRoot MUST already be the `fsPromises.realpath` of the project root,
 *   so the final exact-prefix comparison is symlink-free on the root side and
 *   spelled the way `realpath` spells the resolved `.erfana`.
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

  // 3. Resolve and require containment at exactly `.erfana`: the exact
  // realpath-prefix rule previewPathResolve decides with (see the header for
  // why it is not `path.relative`), tightened to the exact name.
  const real = await realpath(erfanaPath)
  if (realPathWithin(realRoot, real) !== ERFANA_DIR_NAME) {
    throw new AppError(
      'Resolved .erfana directory escapes the project root',
      ErrorCode.SYMLINK_ATTACK
    )
  }

  return real
}
