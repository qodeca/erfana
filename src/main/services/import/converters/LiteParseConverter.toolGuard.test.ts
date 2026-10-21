// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LiteParseConverter refuses a conversion before LiteParse runs when the tool
 * it would resolve by name is untrusted (#250).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, ERROR_MESSAGES } from '../../../../shared/errors'

const mockParse = vi.fn()
vi.mock('@llamaindex/liteparse', () => ({
  LiteParse: vi.fn().mockImplementation(() => ({ parse: mockParse, screenshot: vi.fn() }))
}))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/mock/app/path' } }))
vi.mock('../../../utils/fileUtils', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  validateFileForImport: vi.fn().mockResolvedValue({ valid: true, sizeInMB: 1, fileName: 'a.docx' })
}))

const mockFind = vi.fn()
vi.mock('../conversionToolGuard', () => ({
  findUntrustedConversionTool: (...args: unknown[]) => mockFind(...args),
  currentUntrustedRoots: () => ['/work/repo']
}))

import { LiteParseConverter } from './LiteParseConverter'

describe('LiteParseConverter – conversion tool guard (#250)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParse.mockResolvedValue({ pages: [{ pageNum: 1, text: 'hi' }], text: 'hi' })
  })

  it('refuses with IMPORT_UNTRUSTED_TOOL and never calls LiteParse', async () => {
    mockFind.mockReturnValue({ name: 'soffice', path: '/work/repo/soffice' })

    const result = await new LiteParseConverter({ libreOffice: true, imageMagick: false }).convert('/docs/a.docx')

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES[ErrorCode.IMPORT_UNTRUSTED_TOOL],
      errorCode: ErrorCode.IMPORT_UNTRUSTED_TOOL
    })
    expect(mockFind).toHaveBeenCalledWith('docx', ['/work/repo'])
    expect(mockParse).not.toHaveBeenCalled()
  })

  it('converts when every tool is trusted', async () => {
    mockFind.mockReturnValue(null)

    const result = await new LiteParseConverter({ libreOffice: true, imageMagick: false }).convert('/docs/a.docx')

    expect(result.success).toBe(true)
    expect(mockParse).toHaveBeenCalled()
  })
})
