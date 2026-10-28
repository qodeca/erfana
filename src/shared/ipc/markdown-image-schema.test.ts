// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `markdown-image:read` contract (#71): a strict request, a closed list of
 * image types, and a response that is either bytes, "unchanged" or a reason.
 */
import { describe, it, expect } from 'vitest'
import {
  MARKDOWN_IMAGE_EXTENSIONS,
  MarkdownImageReadRequestSchema,
  MarkdownImageReadResponseSchema,
  isMarkdownImagePath
} from './markdown-image-schema'
import { IMAGE_EXTENSIONS } from './image-formats'

describe('markdown-image schema', () => {
  it('allows only the five web image types, all of which the app already knows', () => {
    expect([...MARKDOWN_IMAGE_EXTENSIONS]).toEqual(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
    for (const extension of MARKDOWN_IMAGE_EXTENSIONS) {
      expect(IMAGE_EXTENSIONS as readonly string[]).toContain(extension)
    }
  })

  it.each([
    ['/p/a.PNG', true],
    ['C:\\p\\a.Svg', true],
    ['/p/a.jpeg', true],
    ['/p/a.bmp', false],
    ['/p/a.ico', false],
    ['/p/a.png.txt', false],
    ['/p/png', false]
  ])('isMarkdownImagePath(%s) is %s', (path, expected) => {
    expect(isMarkdownImagePath(path)).toBe(expected)
  })

  it('accepts a path with an optional version and nothing else', () => {
    expect(MarkdownImageReadRequestSchema.safeParse({ filePath: '/p/a.png' }).success).toBe(true)
    expect(MarkdownImageReadRequestSchema.safeParse({ filePath: '/p/a.png', knownVersion: '1:2:3' }).success).toBe(true)
    expect(MarkdownImageReadRequestSchema.safeParse({ filePath: '/p/a.png', documentPath: '/x' }).success).toBe(false)
    expect(MarkdownImageReadRequestSchema.safeParse({ filePath: '' }).success).toBe(false)
    expect(MarkdownImageReadRequestSchema.safeParse({ filePath: '/p/a.png', knownVersion: 'v'.repeat(129) }).success).toBe(false)
  })

  it('describes each answer by its status', () => {
    expect(MarkdownImageReadResponseSchema.safeParse({ status: 'ok', dataUrl: 'data:,', version: '1' }).success).toBe(true)
    expect(MarkdownImageReadResponseSchema.safeParse({ status: 'unchanged', version: '1' }).success).toBe(true)
    expect(MarkdownImageReadResponseSchema.safeParse({ status: 'refused', reason: 'too-large' }).success).toBe(true)
    expect(MarkdownImageReadResponseSchema.safeParse({ status: 'refused', reason: 'other' }).success).toBe(false)
  })
})
