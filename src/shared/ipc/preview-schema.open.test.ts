// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The bounds on a request path into the preview (issue #124, QG-7 S7). Every
 * `filePath` this contract carries stops at 4096 characters, so an oversized
 * path is refused at the boundary rather than reaching the service.
 */
import { describe, expect, it } from 'vitest'

import {
  PreviewCheckEligibilityRequestSchema,
  PreviewOpenRequestSchema
} from './preview-schema'

const BOUNDS = { x: 0, y: 0, width: 800, height: 600 }

/** An absolute path exactly `length` characters long. */
const pathOf = (length: number): string => '/' + 'a'.repeat(length - 1)

const request = (filePath: string): unknown => ({ panelId: 'preview-a', filePath, bounds: BOUNDS })

describe('PreviewOpenRequestSchema – filePath', () => {
  it('accepts a path of 4096 characters', () => {
    expect(PreviewOpenRequestSchema.safeParse(request(pathOf(4096))).success).toBe(true)
  })

  it('refuses a path of 4097 characters, on filePath', () => {
    const result = PreviewOpenRequestSchema.safeParse(request(pathOf(4097)))

    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'too_big', path: ['filePath'] })
    ])
  })
})

describe('PreviewCheckEligibilityRequestSchema – filePath', () => {
  it('accepts a path of 4096 characters', () => {
    expect(PreviewCheckEligibilityRequestSchema.safeParse({ filePath: pathOf(4096) }).success).toBe(
      true
    )
  })

  it('refuses a path of 4097 characters, on filePath', () => {
    const result = PreviewCheckEligibilityRequestSchema.safeParse({ filePath: pathOf(4097) })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'too_big', path: ['filePath'] })
    ])
  })
})
