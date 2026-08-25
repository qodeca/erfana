// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared image-format facts.
 *
 * The reason this module exists is that the same list used to be maintained by
 * hand in two places and was about to be maintained in three. So the assertions
 * that matter are the CONSISTENCY ones: every extension has a MIME type, every
 * MIME type is in the enum tuple, and the path regex is really derived from the
 * array rather than being a fourth hand-written copy.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect } from 'vitest'
import {
  EXPORTABLE_IMAGE_PATH,
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  IMAGE_MIME_VALUES,
  getImageMimeType,
  isSupportedImageExtension
} from './image-formats'

describe('image format constants', () => {
  it('lists the eight supported extensions', () => {
    expect([...IMAGE_EXTENSIONS]).toEqual([
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.svg',
      '.bmp',
      '.ico'
    ])
  })

  it('maps every extension to a MIME type', () => {
    for (const extension of IMAGE_EXTENSIONS) {
      expect(IMAGE_MIME_TYPES[extension]).toMatch(/^image\//)
    }
  })

  it('keeps IMAGE_MIME_VALUES in step with the map in both directions', () => {
    expect(new Set(IMAGE_MIME_VALUES)).toEqual(new Set(Object.values(IMAGE_MIME_TYPES)))
  })

  it('carries the two MIME types the export harness depends on', () => {
    expect(getImageMimeType('.svg')).toBe('image/svg+xml')
    expect(getImageMimeType('.ico')).toBe('image/x-icon')
  })

  it('resolves an extension case-insensitively', () => {
    expect(getImageMimeType('.PNG')).toBe('image/png')
  })

  it('returns null for an unsupported extension', () => {
    expect(getImageMimeType('.tiff')).toBeNull()
  })

  it('recognises supported extensions in either case', () => {
    expect(isSupportedImageExtension('.JPEG')).toBe(true)
    expect(isSupportedImageExtension('.txt')).toBe(false)
  })
})

describe('EXPORTABLE_IMAGE_PATH', () => {
  it.each([...IMAGE_EXTENSIONS])('accepts a POSIX path ending in %s', (extension) => {
    expect(EXPORTABLE_IMAGE_PATH.test(`/p/a${extension}`)).toBe(true)
  })

  it('accepts a Windows path — the pattern is separator-agnostic', () => {
    expect(EXPORTABLE_IMAGE_PATH.test('C:\\Users\\a\\pictures\\shot.PNG')).toBe(true)
  })

  it.each(['/p/notes.md', '/p/report.pdf', '/p/archive.png.zip', '/p/png'])(
    'rejects %s',
    (path) => {
      expect(EXPORTABLE_IMAGE_PATH.test(path)).toBe(false)
    }
  )

  it('is derived from the extension array, not written out again', () => {
    const derived = IMAGE_EXTENSIONS.map((extension) => extension.slice(1)).join('|')
    expect(EXPORTABLE_IMAGE_PATH.source).toContain(derived)
  })
})
