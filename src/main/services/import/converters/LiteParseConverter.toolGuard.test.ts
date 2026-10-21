// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LiteParseConverter refuses a conversion before LiteParse runs when the tool
 * it would resolve by name is untrusted (#250).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, untrustedToolMessage } from '../../../../shared/errors'

const mockParse = vi.fn()
vi.mock('@llamaindex/liteparse', () => ({
  LiteParse: vi.fn().mockImplementation(() => ({ parse: mockParse, screenshot: vi.fn() }))
}))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/mock/app/path' } }))
vi.mock('../../../utils/fileUtils', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  validateFileForImport: vi.fn().mockResolvedValue({ valid: true, sizeInMB: 1, fileName: 'a.docx' })
}))

const mockWarn = vi.fn()
vi.mock('../../LoggingService', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
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

  it('refuses with IMPORT_UNTRUSTED_TOOL naming the tool, logs a redacted path, and never calls LiteParse', async () => {
    mockFind.mockReturnValue({ name: 'soffice', path: '/work/repo/soffice', reason: 'project' })

    const result = await new LiteParseConverter({ libreOffice: 'found' }).convert('/docs/a.docx')

    expect(result).toEqual({
      success: false,
      error: untrustedToolMessage('soffice', 'project'),
      errorCode: ErrorCode.IMPORT_UNTRUSTED_TOOL
    })
    expect(result.error).toContain('Erfana will not run LibreOffice: soffice is in the open project. Remove that folder from PATH')
    expect(mockFind).toHaveBeenCalledWith('docx', ['/work/repo'])
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mockWarn.mock.calls[0])).not.toContain('/work/repo')
    expect(mockParse).not.toHaveBeenCalled()
  })

  it('converts when every tool is trusted', async () => {
    mockFind.mockReturnValue(null)

    const result = await new LiteParseConverter({ libreOffice: 'found' }).convert('/docs/a.docx')

    expect(result.success).toBe(true)
    expect(mockParse).toHaveBeenCalled()
  })
})
