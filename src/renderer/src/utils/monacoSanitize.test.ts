// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
// @ts-expect-error -- Monaco's internal ESM module ships no type declarations
import { sanitizeHtml } from 'monaco-editor/esm/vs/base/browser/domSanitize.js'

/**
 * Monaco renders hover and markdown content through its own sanitizer. This
 * guards that it still strips script-capable markup (the build swaps its
 * vendored DOMPurify for the npm one, see electron.vite.config.ts).
 */
describe('Monaco HTML sanitizer', () => {
  it('strips an onerror handler from an image', () => {
    const out = String(sanitizeHtml('<img src=x onerror=alert(1)>'))
    expect(out).not.toMatch(/onerror/i)
  })

  it('strips script elements and keeps safe text', () => {
    const out = String(sanitizeHtml('<b>hi</b><script>alert(1)</script>'))
    expect(out).not.toMatch(/<script/i)
    expect(out).toContain('hi')
  })
})
