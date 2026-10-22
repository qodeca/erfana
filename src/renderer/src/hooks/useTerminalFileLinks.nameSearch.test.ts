// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's name search on a truncated tree (finding 32, PR #320 review
 * item 2): one bounded `file:findByName` per project and name, cached, and
 * nothing at all on a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findByName = vi.hoisted(() => vi.fn())
vi.mock('../services/fileGateway', () => ({ fileGateway: { findByName } }))
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { clearNameSearchCache, searchProjectByName } from './useTerminalFileLinks'

beforeEach(() => {
  findByName.mockReset()
  clearNameSearchCache()
})

describe('searchProjectByName', () => {
  it('asks main for the name below the project root and caches the answer per name', async () => {
    findByName.mockResolvedValue({ paths: ['/p/big/Card.tsx'], truncated: false })

    await expect(searchProjectByName('/p', 'Card.tsx')).resolves.toEqual(['/p/big/Card.tsx'])
    await expect(searchProjectByName('/p', 'card.TSX')).resolves.toEqual(['/p/big/Card.tsx'])

    expect(findByName).toHaveBeenCalledTimes(1)
    expect(findByName).toHaveBeenCalledWith({ dirPath: '/p', name: 'Card.tsx' })
  })

  it('answers nothing when the search fails', async () => {
    findByName.mockRejectedValue(new Error('Cannot read files outside the project directory'))

    await expect(searchProjectByName('/p', 'Card.tsx')).resolves.toEqual([])
  })
})
