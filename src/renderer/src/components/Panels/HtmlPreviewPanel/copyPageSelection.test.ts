// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Copy selection in the HTML preview menu (#463): the renderer half asks main
 * by panel id only, and never rejects – a refusal and a failed invoke are
 * logged, without the path-derived panel id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { copySelection, logger } = vi.hoisted(() => ({
  copySelection: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('../../../services/previewGateway', () => ({ previewGateway: { copySelection } }))
vi.mock('../../../utils/logger', () => ({ logger }))

import { copyPageSelection } from './copyPageSelection'

const PANEL = 'preview-/users/alice/site/a.html'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('copyPageSelection', () => {
  it('asks main to copy in that panel, sending the panel id and nothing else', async () => {
    copySelection.mockResolvedValueOnce({ ok: true })

    await expect(copyPageSelection(PANEL)).resolves.toBe(true)
    expect(copySelection).toHaveBeenCalledWith(PANEL)
    expect(copySelection.mock.calls[0]).toHaveLength(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a refusal, without the panel id, and answers false', async () => {
    copySelection.mockResolvedValueOnce({ ok: false })

    await expect(copyPageSelection(PANEL)).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('alice')
  })

  it('never rejects when the invoke does: it logs and answers false', async () => {
    copySelection.mockRejectedValueOnce(new Error('no handler'))

    await expect(copyPageSelection(PANEL)).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalledWith('HTML preview copy failed', expect.any(Error))
  })
})
