// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_MAX_CHARS,
  mayTypeIntoTerminal,
  needsPasteCheck,
  pasteConfirmConfig,
  pastePreview,
  type TerminalPasteGuardDeps
} from './terminalPasteGuard'

function deps(pageWritten: boolean | Error, answer = true): TerminalPasteGuardDeps & { confirm: ReturnType<typeof vi.fn> } {
  return {
    pageWroteClipboard: vi.fn(() => (pageWritten instanceof Error ? Promise.reject(pageWritten) : Promise.resolve(pageWritten))),
    confirm: vi.fn(() => Promise.resolve(answer))
  }
}

describe('needsPasteCheck', () => {
  it.each([
    ['line feed', 'ls\n'],
    ['carriage return', 'ls\r'],
    ['tab', 'a\tb'],
    ['escape', '\u001b[31m'],
    ['NUL', 'a\u0000'],
    ['DEL', 'a\u007f'],
    ['C1 control', 'a\u009b']
  ])('flags a %s', (_name, text) => {
    expect(needsPasteCheck(text)).toBe(true)
  })

  it.each([[''], ['npm run dev'], ['naïve – “quoted” 🙂']])('passes plain text %j', text => {
    expect(needsPasteCheck(text)).toBe(false)
  })
})

describe('pastePreview', () => {
  it('draws line breaks and control characters visibly', () => {
    expect(pastePreview('a\r\nb\u001bc\td\u007f')).toBe('a⏎b␛c␉d␡')
  })

  it('draws a C1 control character as the replacement sign', () => {
    expect(pastePreview('x\u0085y\u009bz')).toBe('x�y�z')
  })

  it('cuts long text at a whole character with an ellipsis', () => {
    const text = '🙂'.repeat(PREVIEW_MAX_CHARS + 5)
    const shown = pastePreview(text)
    expect(shown.endsWith('…')).toBe(true)
    expect(Array.from(shown)).toHaveLength(PREVIEW_MAX_CHARS + 1)
  })

  it('keeps short text whole', () => {
    expect(pastePreview('echo hi')).toBe('echo hi')
  })
})

describe('pasteConfirmConfig', () => {
  it('names the page, the line break and shows the text for a paste', () => {
    const config = pasteConfirmConfig('rm -rf ~\n', 'paste')
    expect(config.title).toBe('Paste text a web page copied?')
    expect(config.message).toContain('a line break')
    expect(config.message).toContain('rm -rf ~⏎')
    expect(config.confirmLabel).toBe('Paste')
    expect(config.danger).toBe(true)
  })

  it('names a control character and the drop for a dropped text', () => {
    const config = pasteConfirmConfig('x\u001b', 'externalDrop')
    expect(config.title).toBe('Drop text from outside Erfana?')
    expect(config.message).toContain('a control character')
    expect(config.confirmLabel).toBe('Drop')
  })
})

describe('mayTypeIntoTerminal (025-AC-009, S-17)', () => {
  it('types text with no line break or control character without asking anything', async () => {
    const d = deps(true)
    expect(await mayTypeIntoTerminal('npm test', 'paste', d)).toBe(true)
    expect(d.pageWroteClipboard).not.toHaveBeenCalled()
    expect(d.confirm).not.toHaveBeenCalled()
  })

  it('pastes risky text with no question when no page wrote it', async () => {
    const d = deps(false)
    expect(await mayTypeIntoTerminal('one\ntwo', 'paste', d)).toBe(true)
    expect(d.confirm).not.toHaveBeenCalled()
  })

  it('asks before pasting risky text a page wrote, and follows the answer', async () => {
    expect(await mayTypeIntoTerminal('one\ntwo', 'paste', deps(true, true))).toBe(true)
    const refused = deps(true, false)
    expect(await mayTypeIntoTerminal('one\ntwo', 'paste', refused)).toBe(false)
    expect(refused.confirm).toHaveBeenCalledTimes(1)
  })

  it('asks when the page-written check fails', async () => {
    const d = deps(new Error('no bridge'), false)
    expect(await mayTypeIntoTerminal('a\u001bb', 'paste', d)).toBe(false)
    expect(d.confirm).toHaveBeenCalledTimes(1)
  })

  it('always asks before a risky drop from outside, without the clipboard check', async () => {
    const d = deps(false, false)
    expect(await mayTypeIntoTerminal('one\ntwo', 'externalDrop', d)).toBe(false)
    expect(d.pageWroteClipboard).not.toHaveBeenCalled()
    expect(d.confirm).toHaveBeenCalledTimes(1)
  })

  it('does not type when the confirmation itself fails', async () => {
    const d: TerminalPasteGuardDeps = { pageWroteClipboard: async () => true, confirm: () => Promise.reject(new Error('x')) }
    expect(await mayTypeIntoTerminal('a\nb', 'paste', d)).toBe(false)
  })
})
