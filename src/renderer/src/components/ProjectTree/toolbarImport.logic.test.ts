// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * toolbarImport.logic.test.ts
 *
 * Verifies the toolbar Import side-effect contract: git status refreshes only
 * when the import produced an output path.
 */

import { describe, it, expect, vi } from 'vitest'
import { runToolbarImport } from './toolbarImport.logic'

describe('runToolbarImport', () => {
  it('refreshes git status when the import returns an output path', async () => {
    const importFile = vi.fn().mockResolvedValue('/proj/import/file.md')
    const refreshGitStatus = vi.fn()

    const result = await runToolbarImport(importFile, refreshGitStatus)

    expect(result).toBe('/proj/import/file.md')
    expect(importFile).toHaveBeenCalledTimes(1)
    expect(refreshGitStatus).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the import is cancelled (null result)', async () => {
    const importFile = vi.fn().mockResolvedValue(null)
    const refreshGitStatus = vi.fn()

    const result = await runToolbarImport(importFile, refreshGitStatus)

    expect(result).toBeNull()
    expect(importFile).toHaveBeenCalledTimes(1)
    expect(refreshGitStatus).not.toHaveBeenCalled()
  })

  it('propagates a rejection and does not refresh', async () => {
    const importFile = vi.fn().mockRejectedValue(new Error('import blew up'))
    const refreshGitStatus = vi.fn()

    await expect(runToolbarImport(importFile, refreshGitStatus)).rejects.toThrow('import blew up')
    expect(refreshGitStatus).not.toHaveBeenCalled()
  })
})
