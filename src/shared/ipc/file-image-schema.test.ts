// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  ImageReadRequestSchema,
  ImageReadResponseSchema,
  MAX_IMAGE_VERSION_LENGTH
} from './file-image-schema'

describe('file:readImage request schema', () => {
  it('accepts a path with a version and a path without one', () => {
    expect(
      ImageReadRequestSchema.parse({ filePath: '/p/shot.png', knownVersion: '12:34:56' })
    ).toEqual({ filePath: '/p/shot.png', knownVersion: '12:34:56' })

    expect(ImageReadRequestSchema.parse({ filePath: '/p/shot.png' })).toEqual({
      filePath: '/p/shot.png'
    })
  })

  it('drops an explicitly undefined version rather than failing', () => {
    // The preload bridge always sends the second argument, so an omitted
    // version reaches the handler as `undefined`.
    const parsed = ImageReadRequestSchema.parse({
      filePath: '/p/shot.png',
      knownVersion: undefined
    })
    expect(parsed.knownVersion).toBeUndefined()
  })

  it('rejects an empty path and an empty version', () => {
    expect(ImageReadRequestSchema.safeParse({ filePath: '' }).success).toBe(false)
    expect(
      ImageReadRequestSchema.safeParse({ filePath: '/p/shot.png', knownVersion: '' }).success
    ).toBe(false)
  })

  it('bounds the version token length', () => {
    const atLimit = 'v'.repeat(MAX_IMAGE_VERSION_LENGTH)
    expect(
      ImageReadRequestSchema.safeParse({ filePath: '/p/shot.png', knownVersion: atLimit }).success
    ).toBe(true)
    expect(
      ImageReadRequestSchema.safeParse({
        filePath: '/p/shot.png',
        knownVersion: `${atLimit}v`
      }).success
    ).toBe(false)
  })
})

describe('file:readImage response schema', () => {
  it('parses the ok branch', () => {
    expect(
      ImageReadResponseSchema.parse({
        status: 'ok',
        dataUrl: 'data:image/png;base64,AAAA',
        version: '12:34:56'
      })
    ).toEqual({ status: 'ok', dataUrl: 'data:image/png;base64,AAAA', version: '12:34:56' })
  })

  it('parses the unchanged branch, which carries no bytes', () => {
    const parsed = ImageReadResponseSchema.parse({ status: 'unchanged', version: '12:34:56' })
    expect(parsed).toEqual({ status: 'unchanged', version: '12:34:56' })
    expect('dataUrl' in parsed).toBe(false)
  })

  it('rejects an ok response with no bytes and an unknown status', () => {
    expect(ImageReadResponseSchema.safeParse({ status: 'ok', version: '1:2:3' }).success).toBe(false)
    expect(ImageReadResponseSchema.safeParse({ status: 'stale', version: '1:2:3' }).success).toBe(
      false
    )
  })
})
