// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared probe for the U+212A sibling-folder tests (security review F1).
 *
 * The attack needs `projk` and `proj<U+212A>` to be two folders. NTFS keeps
 * them apart; a case-insensitive APFS volume (the macOS default) folds the
 * Kelvin sign to `k`, so the second `mkdir` fails with EEXIST and the attack
 * cannot be staged – nor mounted. Tests that build both folders on disk skip
 * there; the pure `win32` path tests still run everywhere.
 *
 * The Kelvin sign is built with `String.fromCharCode`, never typed or escaped,
 * so no tool can silently turn it into a plain `K`.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** U+212A KELVIN SIGN, which `toLowerCase` folds to `k`. */
export const KELVIN = String.fromCharCode(0x212a)

/**
 * Whether the temp folder's file system keeps `projk` and `proj<U+212A>` as
 * two folders. Probed once, at import.
 */
export const KELVIN_SIBLING_IS_DISTINCT: boolean = (() => {
  const base = mkdtempSync(join(tmpdir(), 'kelvin-probe-'))
  try {
    mkdirSync(join(base, 'projk'))
    mkdirSync(join(base, `proj${KELVIN}`))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})()
