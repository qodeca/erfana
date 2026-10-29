// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one comment-mode shortcut rule both processes ask (review finding M3;
 * docs/designs/comments/html-preview-comments.md §10.1, L14).
 */
import { describe, expect, it } from 'vitest'
import {
  commentModeKeyFromDomEvent,
  matchCommentModeKey,
  type CommentModeKeyInput
} from './commentModeKey'

type Mods = Partial<Pick<CommentModeKeyInput, 'meta' | 'control' | 'alt' | 'shift'>>

const press = (key: string, code: string, mods: Mods, type = 'keyDown'): CommentModeKeyInput => ({
  type,
  key,
  code,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...mods
})

const CTRL_ALT: Mods = { control: true, alt: true }
const CMD_OPT: Mods = { meta: true, alt: true }

describe('matchCommentModeKey', () => {
  it.each([
    ['Ctrl+Alt+M', press('m', 'KeyM', CTRL_ALT), true],
    ['Ctrl+Alt+M with Caps Lock', press('M', 'KeyM', CTRL_ALT), true],
    ['Ctrl+Alt+M on a layout with M elsewhere (Dvorak)', press('m', 'Period', CTRL_ALT), true],
    ['AltGr+M typing µ (German)', press('µ', 'KeyM', CTRL_ALT), false],
    ['AZERTY: the M position types ","', press(',', 'KeyM', CTRL_ALT), false],
    ['Ctrl+Alt+Shift+M', press('M', 'KeyM', { ...CTRL_ALT, shift: true }), false],
    ['Ctrl+Alt+Win+M', press('m', 'KeyM', { ...CTRL_ALT, meta: true }), false],
    ['Cmd+Option+M is the macOS chord', press('m', 'KeyM', CMD_OPT), false],
    ['Ctrl+M', press('m', 'KeyM', { control: true }), false],
    ['a key release', press('m', 'KeyM', CTRL_ALT, 'keyUp'), false]
  ])('Windows and Linux: %s → %s', (_name, input, expected) => {
    expect(matchCommentModeKey(input, false)).toBe(expected)
  })

  it.each([
    ['Cmd+Option+M', press('m', 'KeyM', CMD_OPT), true],
    ['Cmd+Option on KeyM typing µ (ABC)', press('µ', 'KeyM', CMD_OPT), true],
    ['Cmd+Option on KeyM typing Ķ (Polish)', press('Ķ', 'KeyM', CMD_OPT), true],
    ['Cmd+Option on KeyM as a dead key', press('Dead', 'KeyM', CMD_OPT), true],
    ['AZERTY: Cmd+Option on KeyM typing ","', press(',', 'KeyM', CMD_OPT), false],
    ['Cmd+Option typing µ on another key', press('µ', 'KeyN', CMD_OPT), false],
    ['Cmd+Option+Shift+M', press('M', 'KeyM', { ...CMD_OPT, shift: true }), false],
    ['Cmd+Ctrl+Option+M', press('m', 'KeyM', { ...CMD_OPT, control: true }), false],
    ['Ctrl+Option+M is the Windows chord', press('m', 'KeyM', CTRL_ALT), false]
  ])('macOS: %s → %s', (_name, input, expected) => {
    expect(matchCommentModeKey(input, true)).toBe(expected)
  })
})

describe('commentModeKeyFromDomEvent', () => {
  it('reads a DOM keydown as the press main sees', () => {
    const dom = { type: 'keydown', key: 'm', code: 'KeyM', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false }
    expect(commentModeKeyFromDomEvent(dom)).toEqual(press('m', 'KeyM', CTRL_ALT))
    expect(matchCommentModeKey(commentModeKeyFromDomEvent({ ...dom, type: 'keyup' }), false)).toBe(false)
  })
})
