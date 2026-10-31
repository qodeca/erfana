// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment-mode toggle and Esc in comment mode (docs/designs/
 * html-preview-comments.md §3, §7.1, §10.1; M-052).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_COMMENT_TOGGLE,
  PREVIEW_FORWARDED_SHORTCUTS,
  attachInputForwarding,
  matchCommentToggle,
  matchForwardedShortcut,
  type CommentKeyState,
  type ForwardableInput,
  type InputForwardEvent
} from './previewInputForward'

function keyDown(overrides: Partial<ForwardableInput>): ForwardableInput {
  return { type: 'keyDown', key: '', code: '', control: false, meta: false, alt: false, shift: false, ...overrides }
}

const ON: CommentKeyState = { enabled: () => true, modeOn: () => false }
const MODE_ON: CommentKeyState = { enabled: () => true, modeOn: () => true }
const OFF: CommentKeyState = { enabled: () => false, modeOn: () => false }

const CTRL_ALT_M = keyDown({ key: 'm', code: 'KeyM', control: true, alt: true })
const CMD_OPT_M = keyDown({ key: 'µ', code: 'KeyM', meta: true, alt: true })

describe('M-052 the comment-mode toggle', () => {
  it('is its own frozen row, and only the comment stepper pair (C-13) joined the forward list', () => {
    expect(Object.isFrozen(PREVIEW_COMMENT_TOGGLE)).toBe(true)
    expect(PREVIEW_FORWARDED_SHORTCUTS.map(row => row.key)).toEqual(['f', 's', 'w', 'Escape', 'back', 'forward', 'comment-next', 'comment-previous'])
  })

  it('M-052 matches the typed m with exactly Ctrl+Alt (Windows, Linux) or Cmd+Option (macOS)', () => {
    expect(matchForwardedShortcut(CTRL_ALT_M, 'win32', ON)).toBe('comment-mode')
    expect(matchForwardedShortcut(CTRL_ALT_M, 'linux', ON)).toBe('comment-mode')
    expect(matchForwardedShortcut({ ...CTRL_ALT_M, key: 'M' }, 'win32', ON)).toBe('comment-mode')
    expect(matchForwardedShortcut(CMD_OPT_M, 'darwin', ON)).toBe('comment-mode')
    expect(matchForwardedShortcut({ ...CMD_OPT_M, key: 'm' }, 'darwin', ON)).toBe('comment-mode')
  })

  it('M-052 AltGr+M typing µ is not captured, nor is the physical key under another letter', () => {
    // AltGr is Ctrl+Alt on Windows; on a German layout it types µ.
    expect(matchCommentToggle({ ...CTRL_ALT_M, key: 'µ' }, 'win32')).toBe(false)
    // An AZERTY-style layout where the M position types another letter.
    expect(matchCommentToggle({ ...CTRL_ALT_M, key: ',', code: 'KeyM' }, 'win32')).toBe(false)
    // A layout where `m` sits on another physical key still matches.
    expect(matchCommentToggle({ ...CTRL_ALT_M, code: 'Semicolon' }, 'win32')).toBe(true)
  })

  it('M-052 Cmd+Option+M on macOS matches whatever non-ASCII character Option types on the M key', () => {
    // Polish layout: Option+M types Ķ (U+0136), seen on a real Mac.
    expect(matchCommentToggle({ ...CMD_OPT_M, key: String.fromCharCode(0x136) }, 'darwin')).toBe(true)
    // A layout whose M position types another ASCII letter keeps its chord.
    expect(matchCommentToggle({ ...CMD_OPT_M, key: ',' }, 'darwin')).toBe(false)
    // A non-ASCII character on another physical key is not the toggle.
    expect(matchCommentToggle({ ...CMD_OPT_M, code: 'KeyN' }, 'darwin')).toBe(false)
  })

  it('M-052 any other modifier set is not the toggle', () => {
    for (const input of [
      { ...CTRL_ALT_M, shift: true },
      { ...CTRL_ALT_M, meta: true },
      { ...CTRL_ALT_M, alt: false },
      { ...CTRL_ALT_M, control: false },
      { ...CTRL_ALT_M, type: 'keyUp' },
      keyDown({ key: 'm' })
    ]) {
      expect(matchCommentToggle(input, 'win32')).toBe(false)
    }
    expect(matchCommentToggle({ ...CMD_OPT_M, control: true }, 'darwin')).toBe(false)
    expect(matchCommentToggle(CTRL_ALT_M, 'darwin')).toBe(false)
    expect(matchCommentToggle(CMD_OPT_M, 'win32')).toBe(false)
  })

  it('M-052 is the page\'s own chord while comments are off, or unwired', () => {
    expect(matchForwardedShortcut(CTRL_ALT_M, 'win32', OFF)).toBeNull()
    expect(matchForwardedShortcut(CTRL_ALT_M, 'win32')).toBeNull()
  })
})

describe('Esc in comment mode', () => {
  const escape = keyDown({ key: 'Escape', code: 'Escape' })

  it('stays with the page while comment mode is on, so its preload leaves the mode', () => {
    expect(matchForwardedShortcut(escape, 'win32', MODE_ON)).toBeNull()
  })

  it('is forwarded as before otherwise, and the other keys are unchanged in the mode', () => {
    expect(matchForwardedShortcut(escape, 'win32', ON)).toBe('Escape')
    expect(matchForwardedShortcut(escape, 'win32')).toBe('Escape')
    expect(matchForwardedShortcut(keyDown({ key: 'f', control: true }), 'win32', MODE_ON)).toBe('f')
  })

  it('the attached listener prevents the toggle\'s default and leaves Esc alone in the mode', () => {
    let listener: ((event: InputForwardEvent, input: ForwardableInput) => void) | undefined
    const target = {
      on: vi.fn((_event: 'before-input-event', l: typeof listener) => (listener = l)),
      removeListener: vi.fn()
    }
    let mode = false
    const forwarded: string[] = []
    const detach = attachInputForwarding(target, key => forwarded.push(key), 'win32', {
      enabled: () => true,
      modeOn: () => mode
    })
    const toggleEvent = { preventDefault: vi.fn() }
    listener!(toggleEvent, CTRL_ALT_M)
    expect(toggleEvent.preventDefault).toHaveBeenCalledTimes(1)
    mode = true
    const escEvent = { preventDefault: vi.fn() }
    listener!(escEvent, escape)
    expect(escEvent.preventDefault).not.toHaveBeenCalled()
    expect(forwarded).toEqual(['comment-mode'])
    detach()
    expect(target.removeListener).toHaveBeenCalledTimes(1)
  })
})

describe('C-13 the comment stepper keys with focus in the page', () => {
  const ALT_F9 = keyDown({ key: 'F9', code: 'F9', alt: true })
  const ALT_SHIFT_F9 = keyDown({ key: 'F9', code: 'F9', alt: true, shift: true })

  it('024-AC-019 C-13 Alt+F9 is the next comment and Alt+Shift+F9 the previous, on every system, while comments are on', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(matchForwardedShortcut(ALT_F9, platform, ON)).toBe('comment-next')
      expect(matchForwardedShortcut(ALT_SHIFT_F9, platform, ON)).toBe('comment-previous')
      expect(matchForwardedShortcut(ALT_F9, platform, MODE_ON)).toBe('comment-next')
    }
  })

  it('024-AC-019 C-13 off for the view, or with Ctrl, Cmd or no Alt, the press stays with the page', () => {
    expect(matchForwardedShortcut(ALT_F9, 'win32', OFF)).toBeNull()
    expect(matchForwardedShortcut(ALT_F9, 'win32')).toBeNull()
    expect(matchForwardedShortcut({ ...ALT_F9, control: true }, 'win32', ON)).toBeNull()
    expect(matchForwardedShortcut({ ...ALT_F9, meta: true }, 'darwin', ON)).toBeNull()
    expect(matchForwardedShortcut(keyDown({ key: 'F9', code: 'F9' }), 'win32', ON)).toBeNull()
    expect(matchForwardedShortcut(keyDown({ key: 'F8', code: 'F8', alt: true }), 'win32', ON)).toBeNull()
    expect(matchForwardedShortcut({ ...ALT_F9, type: 'keyUp' }, 'win32', ON)).toBeNull()
  })

  it('024-AC-019 C-13 matches the physical key: an F-row that types something else still steps', () => {
    expect(matchForwardedShortcut(keyDown({ key: 'MediaPlayPause', code: 'F9', alt: true }), 'darwin', ON)).toBe('comment-next')
  })

  it('024-AC-019 C-13 the forwarder hides the press from the page and reports the step', () => {
    let listener: ((event: InputForwardEvent, input: ForwardableInput) => void) | undefined
    const target = { on: vi.fn((_: 'before-input-event', l: typeof listener) => (listener = l)), removeListener: vi.fn() }
    const forwarded: string[] = []
    attachInputForwarding(target, key => forwarded.push(key), 'win32', ON)
    const event = { preventDefault: vi.fn() }
    listener!(event, ALT_SHIFT_F9)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(forwarded).toEqual(['comment-previous'])
  })
})
