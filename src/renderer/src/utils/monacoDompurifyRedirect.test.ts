// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  isMonacoVendoredDompurify,
  monacoOwnDompurify,
  MONACO_DOMPURIFY_SOURCE,
  MONACO_DOMPURIFY_VIRTUAL_ID
} from '../../../../electron.vite.monaco-dompurify'

const VENDORED = './dompurify/dompurify.js'

describe('Monaco DOMPurify redirect', () => {
  it('matches Monaco importing its vendored copy, on POSIX and Windows paths', () => {
    expect(isMonacoVendoredDompurify(VENDORED, '/p/node_modules/monaco-editor/esm/vs/base/browser/domSanitize.js')).toBe(true)
    expect(isMonacoVendoredDompurify(VENDORED, 'C:\\p\\node_modules\\monaco-editor\\esm\\vs\\base\\browser\\domSanitize.js')).toBe(true)
  })

  it('leaves every other import alone', () => {
    expect(isMonacoVendoredDompurify('dompurify', '/p/node_modules/mermaid/dist/x.mjs')).toBe(false)
    expect(isMonacoVendoredDompurify(VENDORED, '/p/node_modules/other/index.js')).toBe(false)
    expect(isMonacoVendoredDompurify(VENDORED, undefined)).toBe(false)
  })

  it('resolves to a virtual module that builds its own instance from the npm code', () => {
    const plugin = monacoOwnDompurify()
    const resolveId = plugin.resolveId as (s: string, i?: string) => unknown
    const load = plugin.load as (id: string) => unknown
    expect(resolveId(VENDORED, '/p/node_modules/monaco-editor/esm/a.js')).toBe(MONACO_DOMPURIFY_VIRTUAL_ID)
    expect(load(MONACO_DOMPURIFY_VIRTUAL_ID)).toBe(MONACO_DOMPURIFY_SOURCE)
    expect(MONACO_DOMPURIFY_SOURCE).toContain("from 'dompurify'")
    expect(MONACO_DOMPURIFY_SOURCE).toContain('purify(window)')
  })
})
