// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's name search on a truncated tree (finding 32, PR #320 review
 * item 2): one bounded `file:findByName` per project and name, shared while
 * it runs, cached by project session, and nothing at all on a failure – which
 * is not cached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findByName = vi.hoisted(() => vi.fn())
vi.mock('../services/fileGateway', () => ({ fileGateway: { findByName } }))
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const generation = vi.hoisted(() => ({ value: 1 as number | undefined }))
vi.mock('../services/projectGeneration', () => ({ getLastSeenProjectGeneration: () => generation.value }))

import { clearNameSearchCache, searchProjectByName } from './useTerminalFileLinks'

beforeEach(() => {
  findByName.mockReset()
  generation.value = 1
  clearNameSearchCache()
})

describe('searchProjectByName', () => {
  it('asks main for the name below the project root and caches the answer per name', async () => {
    findByName.mockResolvedValue({ paths: ['/p/big/Card.tsx'], truncated: false })

    const found = { paths: ['/p/big/Card.tsx'], truncated: false }
    await expect(searchProjectByName('/p', 'Card.tsx')).resolves.toEqual(found)
    await expect(searchProjectByName('/p', 'card.TSX')).resolves.toEqual(found)

    expect(findByName).toHaveBeenCalledTimes(1)
    expect(findByName).toHaveBeenCalledWith({ dirPath: '/p', name: 'Card.tsx' })
  })

  it('answers nothing when the search fails, and asks again next time (review of #320, item 10)', async () => {
    findByName.mockRejectedValueOnce(new Error('Cannot read files outside the project directory'))
    findByName.mockResolvedValueOnce({ paths: ['/p/Card.tsx'], truncated: false })

    await expect(searchProjectByName('/p', 'Card.tsx')).resolves.toEqual({ paths: [], truncated: false })
    await expect(searchProjectByName('/p', 'Card.tsx')).resolves.toEqual({ paths: ['/p/Card.tsx'], truncated: false })
    expect(findByName).toHaveBeenCalledTimes(2)
  })

  it('does not keep a cut-short search that found nothing (main was busy)', async () => {
    findByName.mockResolvedValueOnce({ paths: [], truncated: true })
    findByName.mockResolvedValueOnce({ paths: ['/p/Card.tsx'], truncated: false })

    await searchProjectByName('/p', 'Card.tsx')
    await expect(searchProjectByName('/p', 'Card.tsx')).resolves.toEqual({ paths: ['/p/Card.tsx'], truncated: false })
  })

  it('asks again after the project session changes, for the same root (item 10)', async () => {
    findByName.mockResolvedValue({ paths: ['/p/Card.tsx'], truncated: false })
    await searchProjectByName('/p', 'Card.tsx')
    generation.value = 2
    await searchProjectByName('/p', 'Card.tsx')
    expect(findByName).toHaveBeenCalledTimes(2)
  })

  it('shares one search in flight between every caller of the same name (item 1)', async () => {
    let finish!: (r: { paths: string[]; truncated: boolean }) => void
    findByName.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))

    const first = searchProjectByName('/p', 'Card.tsx')
    const second = searchProjectByName('/p', 'CARD.tsx')
    finish({ paths: ['/p/Card.tsx'], truncated: false })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { paths: ['/p/Card.tsx'], truncated: false },
      { paths: ['/p/Card.tsx'], truncated: false }
    ])
    expect(findByName).toHaveBeenCalledTimes(1)
  })
})
