// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests that {@link MonacoMarkdownEditor} selects the Monaco language from the
 * file path (Issue #74, work item 75): unchanged `markdown` for `.md` and for
 * an absent path, and the mapped language for other extensions.
 *
 * The real `monaco-editor` value import does not resolve in the renderer test
 * env, so `@monaco-editor/react` and the worker-service disable are mocked; the
 * mocked `Editor` captures the `language` prop the component passes it.
 *
 * @see MonacoMarkdownEditor.tsx
 * @see monacoLanguage.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

/** The last props the mocked Monaco `Editor` received. */
const captured: { language?: string } = {}

vi.mock('@monaco-editor/react', () => ({
  default: (props: { language?: string }) => {
    captured.language = props.language
    return <div data-testid="mock-monaco" />
  },
  loader: { config: vi.fn() }
}))

// The top-level `disableWorkerLanguageServices(monaco)` call would touch the
// (unmocked) monaco namespace at import time; stub it to a no-op.
vi.mock('../../utils/monacoLanguageServices', () => ({
  disableWorkerLanguageServices: vi.fn()
}))

vi.mock('../../utils/monacoClipboardCommands', () => ({
  registerClipboardActions: vi.fn()
}))

vi.mock('monaco-editor', () => ({}))

import { MonacoMarkdownEditor } from './MonacoMarkdownEditor'

afterEach(() => cleanup())

describe('MonacoMarkdownEditor language selection', () => {
  beforeEach(() => {
    captured.language = undefined
  })

  it('uses markdown for a .md file', () => {
    render(<MonacoMarkdownEditor value="" onChange={() => {}} filePath="/proj/notes.md" />)
    expect(captured.language).toBe('markdown')
  })

  it('uses markdown when no file path is provided', () => {
    render(<MonacoMarkdownEditor value="" onChange={() => {}} />)
    expect(captured.language).toBe('markdown')
  })

  it('uses html for a .html file', () => {
    render(<MonacoMarkdownEditor value="" onChange={() => {}} filePath="/proj/page.html" />)
    expect(captured.language).toBe('html')
  })

  it('uses css for a .css file', () => {
    render(<MonacoMarkdownEditor value="" onChange={() => {}} filePath="/proj/styles.css" />)
    expect(captured.language).toBe('css')
  })
})
