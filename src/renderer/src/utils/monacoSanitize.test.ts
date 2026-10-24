// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import mermaidPurify from 'dompurify'
// Monaco's internal ESM module ships no type declarations, so this import is untyped.
import { sanitizeHtml } from 'monaco-editor/esm/vs/base/browser/domSanitize.js'

/**
 * Monaco renders hover and markdown content through its own sanitizer. The
 * Vite plugin in electron.vite.monaco-dompurify.ts swaps its vendored DOMPurify
 * for an instance built from the npm code. vitest.renderer.ts inlines
 * monaco-editor and loads that plugin, so these tests run through the redirect.
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

/**
 * Mermaid uses the shared npm instance and registers permanent hooks on it.
 * Monaco's sanitizer calls removeAllHooks() after every call, so it must run on
 * its own instance, or it would wipe Mermaid's hooks (and Mermaid's hooks would
 * leak into Monaco's output).
 */
describe('Monaco and Mermaid DOMPurify isolation', () => {
  it('keeps Mermaid hooks alive across a Monaco sanitize and keeps them out of its output', () => {
    const mermaidHook = vi.fn()
    mermaidPurify.addHook('afterSanitizeAttributes', mermaidHook)
    try {
      const out = String(sanitizeHtml('<a href="https://example.com">x</a>'))
      expect(out).toContain('example.com')
      expect(mermaidHook).not.toHaveBeenCalled()

      mermaidPurify.sanitize('<b>y</b>')
      expect(mermaidHook).toHaveBeenCalled()
    } finally {
      mermaidPurify.removeAllHooks()
    }
  })
})
