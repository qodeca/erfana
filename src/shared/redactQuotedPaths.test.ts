// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared quoted-path redaction. Main's `redactedLogError` keeps
 * its own syscall-shaped cases in `redactUserInput.test.ts`.
 *
 * @see redactQuotedPaths.ts
 */
import { describe, expect, it } from 'vitest'

import { redactQuotedPaths } from './redactQuotedPaths'

describe('redactQuotedPaths', () => {
  it.each([
    ["ENOENT: no such file or directory, scandir 'C:\\Users\\alice\\proj\\scratch'", 'scandir'],
    ["EPERM: operation not permitted, open '/Users/alice/notes.md'", 'open'],
    ["EBUSY: resource busy or locked, open '\\\\host\\share\\notes.md'", 'open']
  ])('drops the path from %s', (message, syscall) => {
    const redacted = redactQuotedPaths(message)

    expect(redacted).not.toMatch(/alice|host/)
    expect(redacted).toContain(`${syscall} [redacted-path]`)
  })

  it('drops both operands of a rename', () => {
    expect(redactQuotedPaths("EXDEV: cross-device link not permitted, rename '/a/x' -> '/b/y'")).toBe(
      'EXDEV: cross-device link not permitted, rename [redacted-path] -> [redacted-path]'
    )
  })

  it('keeps the Electron IPC prefix and quoted prose that is not a path', () => {
    const message =
      "Error invoking remote method 'file:writeFile': Error: EPERM: operation not permitted, open 'D:\\work\\a.md'"

    expect(redactQuotedPaths(message)).toBe(
      "Error invoking remote method 'file:writeFile': Error: EPERM: operation not permitted, open [redacted-path]"
    )
  })
})
