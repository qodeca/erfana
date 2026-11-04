// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File reads for `expect.poll` callbacks.
 *
 * Playwright's `expect.poll` retries a value that fails the matcher, but not a
 * callback that throws: the first rejection ends the poll. The app saves
 * atomically (temp file, then rename – `src/main/utils/atomicWrite.ts`), and
 * through Docker Desktop's shared folder the target can briefly read as
 * missing mid-rename. Returning `null` for that one case keeps the poll going;
 * any other error is a real failure and still ends it.
 */

import { readFile } from 'fs/promises'

/** Read `path` as UTF-8; `null` when it does not exist (ENOENT), every other error rethrown. */
export async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
