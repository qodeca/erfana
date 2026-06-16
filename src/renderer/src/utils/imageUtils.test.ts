// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image Utility Tests
 *
 * Tests for image utility functions in imageUtils.ts:
 * - IMAGE_EXTENSIONS: Supported image file extensions constant
 * - isImageFile(): Check if file has image extension
 * - getImageFormat(): Get normalized format name from extension
 * - getImageMimeType(): Get MIME type from extension
 */

import { describe, it, expect } from 'vitest'
import {
  IMAGE_EXTENSIONS,
  isImageFile,
  getImageFormat,
  getImageMimeType
} from './imageUtils'

describe('imageUtils', () => {
  // ============================================================================
  // IMAGE_EXTENSIONS Tests
  // ============================================================================

  describe('IMAGE_EXTENSIONS', () => {
    it('includes common raster formats', () => {
      expect(IMAGE_EXTENSIONS).toContain('.png')
      expect(IMAGE_EXTENSIONS).toContain('.jpg')
      expect(IMAGE_EXTENSIONS).toContain('.jpeg')
      expect(IMAGE_EXTENSIONS).toContain('.gif')
      expect(IMAGE_EXTENSIONS).toContain('.webp')
    })

    it('includes SVG format', () => {
      expect(IMAGE_EXTENSIONS).toContain('.svg')
    })

    it('includes legacy formats', () => {
      expect(IMAGE_EXTENSIONS).toContain('.bmp')
      expect(IMAGE_EXTENSIONS).toContain('.ico')
    })

    it('has expected total count', () => {
      expect(IMAGE_EXTENSIONS.length).toBe(8)
    })

    it('all extensions start with dot', () => {
      for (const ext of IMAGE_EXTENSIONS) {
        expect(ext.startsWith('.')).toBe(true)
      }
    })

    it('all extensions are lowercase', () => {
      for (const ext of IMAGE_EXTENSIONS) {
        expect(ext).toBe(ext.toLowerCase())
      }
    })
  })

  // ============================================================================
  // isImageFile Tests
  // ============================================================================

  describe('isImageFile()', () => {
    describe('valid image files', () => {
      it('returns true for PNG files', () => {
        expect(isImageFile('photo.png')).toBe(true)
        expect(isImageFile('PHOTO.PNG')).toBe(true)
        expect(isImageFile('Photo.Png')).toBe(true)
      })

      it('returns true for JPEG files', () => {
        expect(isImageFile('photo.jpg')).toBe(true)
        expect(isImageFile('photo.jpeg')).toBe(true)
        expect(isImageFile('PHOTO.JPG')).toBe(true)
        expect(isImageFile('PHOTO.JPEG')).toBe(true)
      })

      it('returns true for GIF files', () => {
        expect(isImageFile('animation.gif')).toBe(true)
        expect(isImageFile('ANIMATION.GIF')).toBe(true)
      })

      it('returns true for WebP files', () => {
        expect(isImageFile('image.webp')).toBe(true)
        expect(isImageFile('IMAGE.WEBP')).toBe(true)
      })

      it('returns true for SVG files', () => {
        expect(isImageFile('diagram.svg')).toBe(true)
        expect(isImageFile('DIAGRAM.SVG')).toBe(true)
      })

      it('returns true for BMP files', () => {
        expect(isImageFile('bitmap.bmp')).toBe(true)
        expect(isImageFile('BITMAP.BMP')).toBe(true)
      })

      it('returns true for ICO files', () => {
        expect(isImageFile('favicon.ico')).toBe(true)
        expect(isImageFile('FAVICON.ICO')).toBe(true)
      })
    })

    describe('files with paths', () => {
      it('handles absolute paths', () => {
        expect(isImageFile('/Users/user/photos/image.png')).toBe(true)
        expect(isImageFile('C:\\Users\\user\\photos\\image.jpg')).toBe(true)
      })

      it('handles relative paths', () => {
        expect(isImageFile('./images/photo.gif')).toBe(true)
        expect(isImageFile('../assets/icon.svg')).toBe(true)
      })

      it('handles nested paths', () => {
        expect(isImageFile('/a/b/c/d/e/image.webp')).toBe(true)
      })
    })

    describe('non-image files', () => {
      it('returns false for markdown files', () => {
        expect(isImageFile('document.md')).toBe(false)
      })

      it('returns false for text files', () => {
        expect(isImageFile('notes.txt')).toBe(false)
      })

      it('returns false for code files', () => {
        expect(isImageFile('script.js')).toBe(false)
        expect(isImageFile('styles.css')).toBe(false)
        expect(isImageFile('component.tsx')).toBe(false)
      })

      it('returns false for document files', () => {
        expect(isImageFile('report.pdf')).toBe(false)
        expect(isImageFile('spreadsheet.xlsx')).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('returns false for empty string', () => {
        expect(isImageFile('')).toBe(false)
      })

      it('returns false for files without extension', () => {
        expect(isImageFile('noextension')).toBe(false)
        expect(isImageFile('Makefile')).toBe(false)
      })

      it('returns true for hidden files with image extension', () => {
        expect(isImageFile('.png')).toBe(true)
        expect(isImageFile('.hidden.jpg')).toBe(true)
      })

      it('returns false for backup files with image-like names', () => {
        expect(isImageFile('photo.png.bak')).toBe(false)
        expect(isImageFile('image.jpg.backup')).toBe(false)
      })

      it('returns false for files with multiple dots', () => {
        expect(isImageFile('file.min.js')).toBe(false)
        expect(isImageFile('archive.tar.gz')).toBe(false)
      })

      it('handles files ending with image extension that are not images', () => {
        expect(isImageFile('fakepng')).toBe(false)
      })
    })
  })

  // ============================================================================
  // getImageFormat Tests
  // ============================================================================

  describe('getImageFormat()', () => {
    describe('known formats', () => {
      it('returns PNG for .png files', () => {
        expect(getImageFormat('image.png')).toBe('PNG')
        expect(getImageFormat('IMAGE.PNG')).toBe('PNG')
      })

      it('returns JPEG for .jpg and .jpeg files', () => {
        expect(getImageFormat('photo.jpg')).toBe('JPEG')
        expect(getImageFormat('photo.jpeg')).toBe('JPEG')
        expect(getImageFormat('PHOTO.JPG')).toBe('JPEG')
        expect(getImageFormat('PHOTO.JPEG')).toBe('JPEG')
      })

      it('returns GIF for .gif files', () => {
        expect(getImageFormat('animation.gif')).toBe('GIF')
        expect(getImageFormat('ANIMATION.GIF')).toBe('GIF')
      })

      it('returns WebP for .webp files', () => {
        expect(getImageFormat('image.webp')).toBe('WebP')
        expect(getImageFormat('IMAGE.WEBP')).toBe('WebP')
      })

      it('returns SVG for .svg files', () => {
        expect(getImageFormat('diagram.svg')).toBe('SVG')
        expect(getImageFormat('DIAGRAM.SVG')).toBe('SVG')
      })

      it('returns BMP for .bmp files', () => {
        expect(getImageFormat('bitmap.bmp')).toBe('BMP')
        expect(getImageFormat('BITMAP.BMP')).toBe('BMP')
      })

      it('returns ICO for .ico files', () => {
        expect(getImageFormat('favicon.ico')).toBe('ICO')
        expect(getImageFormat('FAVICON.ICO')).toBe('ICO')
      })
    })

    describe('unknown formats', () => {
      it('returns unknown for empty string', () => {
        expect(getImageFormat('')).toBe('unknown')
      })

      it('returns unknown for files without extension', () => {
        expect(getImageFormat('noextension')).toBe('unknown')
      })

      it('returns unknown for non-image extensions', () => {
        expect(getImageFormat('document.md')).toBe('unknown')
        expect(getImageFormat('script.js')).toBe('unknown')
        expect(getImageFormat('styles.css')).toBe('unknown')
      })

      it('returns unknown for unsupported image formats', () => {
        expect(getImageFormat('image.tiff')).toBe('unknown')
        expect(getImageFormat('image.raw')).toBe('unknown')
        expect(getImageFormat('image.psd')).toBe('unknown')
      })
    })

    describe('with paths', () => {
      it('extracts format from full path', () => {
        expect(getImageFormat('/path/to/image.png')).toBe('PNG')
        expect(getImageFormat('C:\\Users\\user\\photo.jpg')).toBe('JPEG')
      })
    })
  })

  // ============================================================================
  // getImageMimeType Tests
  // ============================================================================

  describe('getImageMimeType()', () => {
    describe('with leading dot', () => {
      it('returns correct MIME for PNG', () => {
        expect(getImageMimeType('.png')).toBe('image/png')
        expect(getImageMimeType('.PNG')).toBe('image/png')
      })

      it('returns correct MIME for JPEG', () => {
        expect(getImageMimeType('.jpg')).toBe('image/jpeg')
        expect(getImageMimeType('.jpeg')).toBe('image/jpeg')
        expect(getImageMimeType('.JPG')).toBe('image/jpeg')
      })

      it('returns correct MIME for GIF', () => {
        expect(getImageMimeType('.gif')).toBe('image/gif')
      })

      it('returns correct MIME for WebP', () => {
        expect(getImageMimeType('.webp')).toBe('image/webp')
      })

      it('returns correct MIME for SVG', () => {
        expect(getImageMimeType('.svg')).toBe('image/svg+xml')
      })

      it('returns correct MIME for BMP', () => {
        expect(getImageMimeType('.bmp')).toBe('image/bmp')
      })

      it('returns correct MIME for ICO', () => {
        expect(getImageMimeType('.ico')).toBe('image/x-icon')
      })
    })

    describe('without leading dot', () => {
      it('returns correct MIME for PNG', () => {
        expect(getImageMimeType('png')).toBe('image/png')
      })

      it('returns correct MIME for JPEG', () => {
        expect(getImageMimeType('jpg')).toBe('image/jpeg')
        expect(getImageMimeType('jpeg')).toBe('image/jpeg')
      })

      it('returns correct MIME for GIF', () => {
        expect(getImageMimeType('gif')).toBe('image/gif')
      })

      it('returns correct MIME for WebP', () => {
        expect(getImageMimeType('webp')).toBe('image/webp')
      })

      it('returns correct MIME for SVG', () => {
        expect(getImageMimeType('svg')).toBe('image/svg+xml')
      })
    })

    describe('unknown extensions', () => {
      it('returns octet-stream for unknown', () => {
        expect(getImageMimeType('.txt')).toBe('application/octet-stream')
        expect(getImageMimeType('unknown')).toBe('application/octet-stream')
        expect(getImageMimeType('')).toBe('application/octet-stream')
      })
    })
  })
})
