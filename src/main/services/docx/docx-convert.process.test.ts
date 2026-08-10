// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the DOCX conversion child's pure helpers (toBytes, runConversion).
 * The parentPort message loop is not wired in the test environment
 * (`process.parentPort` is undefined), so importing the module is side-effect free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so the fn exists before the hoisted vi.mock factory runs (this file
// imports the module under test statically, unlike HtmlToDocxConverter.test.ts).
const mockHTMLtoDOCX = vi.hoisted(() => vi.fn())
vi.mock('@turbodocx/html-to-docx', () => ({ default: mockHTMLtoDOCX }))

import { toBytes, runConversion } from './docx-convert.process'

describe('docx-convert.process', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('toBytes', () => {
    it('normalises a Buffer to a Uint8Array', async () => {
      const out = await toBytes(Buffer.from([1, 2, 3]))
      expect(out).toBeInstanceOf(Uint8Array)
      expect(Array.from(out)).toEqual([1, 2, 3])
    })

    it('passes through a Uint8Array', async () => {
      const out = await toBytes(new Uint8Array([4, 5]))
      expect(Array.from(out)).toEqual([4, 5])
    })

    it('normalises an ArrayBuffer', async () => {
      const ab = new ArrayBuffer(2)
      new Uint8Array(ab).set([6, 7])
      const out = await toBytes(ab)
      expect(Array.from(out)).toEqual([6, 7])
    })

    it('normalises a Blob', async () => {
      const blob = new Blob([new Uint8Array([8, 9])])
      const out = await toBytes(blob)
      expect(Array.from(out)).toEqual([8, 9])
    })

    it('throws on an unexpected result type', async () => {
      await expect(toBytes('not a buffer')).rejects.toThrow('Unexpected result type')
      await expect(toBytes(12345)).rejects.toThrow('Unexpected result type')
      await expect(toBytes(null)).rejects.toThrow('Unexpected result type')
    })
  })

  describe('runConversion', () => {
    it('calls HTMLtoDOCX with the html and returns normalised bytes', async () => {
      mockHTMLtoDOCX.mockResolvedValue(Buffer.from('DOCX'))

      const out = await runConversion('<p>x</p>')

      expect(out).toBeInstanceOf(Uint8Array)
      expect(Buffer.from(out).toString()).toBe('DOCX')
      // (html, header, options, footer)
      expect(mockHTMLtoDOCX).toHaveBeenCalledTimes(1)
      expect(mockHTMLtoDOCX.mock.calls[0][0]).toBe('<p>x</p>')
      expect(mockHTMLtoDOCX.mock.calls[0][1]).toBeNull()
      expect(mockHTMLtoDOCX.mock.calls[0][3]).toBeNull()
    })

    it('propagates a library error', async () => {
      mockHTMLtoDOCX.mockRejectedValue(new Error('boom'))
      await expect(runConversion('<p>x</p>')).rejects.toThrow('boom')
    })
  })
})
