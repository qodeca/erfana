// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the export path helpers.
 *
 * The load-bearing case is `isSameExistingFile`: it is the only thing standing
 * between an unlucky filename and the destruction of the user's original
 * image, so its FAIL-CLOSED behaviour on an unanswerable `realpath` is pinned
 * explicitly rather than left to the happy path.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

const mockRealpath = vi.fn()
vi.mock('fs/promises', () => ({
  realpath: (path: string) => mockRealpath(path)
}))

import { forceExtension, isSameExistingFile, suggestExportFilename } from './exportPaths'

/** An `fs` error with a specific errno, as Node raises them. */
function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('suggestExportFilename', () => {
  it('keeps the folder and the base name when the extension changes', () => {
    expect(suggestExportFilename(join('/p', 'a.gif'), '.png')).toBe(join('/p', 'a.png'))
  })

  it('adds -export when the suggestion would land on the source file', () => {
    expect(suggestExportFilename(join('/p', 'a.png'), '.png')).toBe(join('/p', 'a-export.png'))
  })

  it('treats the collision case-insensitively', () => {
    expect(suggestExportFilename(join('/p', 'A.PNG'), '.png')).toBe(join('/p', 'A-export.png'))
  })

  it('sanitizes a Windows-reserved base name, which then no longer collides', () => {
    expect(suggestExportFilename(join('/p', 'CON.png'), '.png')).toBe(join('/p', '_CON.png'))
  })

  it('strips a leading dot, which also removes the collision', () => {
    expect(suggestExportFilename(join('/p', '.hidden.png'), '.png')).toBe(join('/p', 'hidden.png'))
  })

  it('replaces characters Windows rejects', () => {
    expect(suggestExportFilename(join('/p', 'a:b.gif'), '.png')).toBe(join('/p', 'a-b.png'))
  })

  it('falls back to a usable name when the base sanitizes away entirely', () => {
    expect(suggestExportFilename(join('/p', '...png'), '.png')).toBe(join('/p', 'image.png'))
  })

  it('suggests a .pdf name for the PDF target', () => {
    expect(suggestExportFilename(join('/p', 'chart.svg'), '.pdf')).toBe(join('/p', 'chart.pdf'))
  })
})

describe('forceExtension', () => {
  it('leaves a path that already carries the extension alone', () => {
    expect(forceExtension('/p/a.png', '.png')).toBe('/p/a.png')
  })

  it('matches the extension case-insensitively', () => {
    expect(forceExtension('/p/a.PNG', '.png')).toBe('/p/a.PNG')
  })

  it('appends rather than replaces, so a dotted name keeps its parts', () => {
    expect(forceExtension('/p/report.v2', '.pdf')).toBe('/p/report.v2.pdf')
  })
})

describe('isSameExistingFile', () => {
  it('is false when the destination does not exist yet', async () => {
    mockRealpath.mockImplementation(async (path: string) => {
      if (path === '/p/source.png') return '/p/source.png'
      throw errno('ENOENT')
    })
    expect(await isSameExistingFile('/p/new.png', '/p/source.png')).toBe(false)
  })

  it('is true when both paths canonicalize to the same file', async () => {
    mockRealpath.mockResolvedValue('/real/source.png')
    expect(await isSameExistingFile('/p/link.png', '/p/source.png')).toBe(true)
  })

  it('sees through a symlinked destination', async () => {
    mockRealpath.mockImplementation(async (path: string) =>
      path === '/p/alias.png' ? '/p/source.png' : '/p/source.png'
    )
    expect(await isSameExistingFile('/p/alias.png', '/p/source.png')).toBe(true)
  })

  it('is false for two genuinely different files', async () => {
    mockRealpath.mockImplementation(async (path: string) => path)
    expect(await isSameExistingFile('/p/other.png', '/p/source.png')).toBe(false)
  })

  it.each(['EACCES', 'ELOOP', 'ENOTDIR', 'EIO'])(
    'FAILS CLOSED when the destination realpath answers %s',
    async (code) => {
      mockRealpath.mockImplementation(async (path: string) => {
        if (path === '/p/source.png') return '/p/source.png'
        throw errno(code)
      })
      expect(await isSameExistingFile('/p/dest.png', '/p/source.png')).toBe(true)
    }
  )

  it('FAILS CLOSED when the SOURCE realpath cannot be answered', async () => {
    mockRealpath.mockImplementation(async () => {
      throw errno('EACCES')
    })
    expect(await isSameExistingFile('/p/dest.png', '/p/source.png')).toBe(true)
  })

  it('is false when the source itself has vanished', async () => {
    mockRealpath.mockImplementation(async () => {
      throw errno('ENOENT')
    })
    expect(await isSameExistingFile('/p/dest.png', '/p/gone.png')).toBe(false)
  })
})
