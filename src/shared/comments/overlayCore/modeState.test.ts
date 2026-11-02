// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { reduceCommentMode, type CommentModeEvent, type CommentModeStep } from './modeState'

const OFF = { on: false }
const ON = { on: true }
const ESC: CommentModeEvent = { type: 'escape' }

describe('modeState (shared overlay core)', () => {
  it('024-AC-001 modeState turns on and off when the window says so', () => {
    expect(reduceCommentMode(OFF, { type: 'set', on: true })).toEqual<CommentModeStep>({
      on: true,
      changed: true,
      requestExit: false,
      consumed: false
    })
    expect(reduceCommentMode(ON, { type: 'set', on: false })).toEqual<CommentModeStep>({
      on: false,
      changed: true,
      requestExit: false,
      consumed: false
    })
  })

  it('024-AC-001 modeState: the window repeating the mode changes nothing', () => {
    for (const on of [false, true]) {
      expect(reduceCommentMode({ on }, { type: 'set', on })).toEqual<CommentModeStep>({
        on,
        changed: false,
        requestExit: false,
        consumed: false
      })
    }
  })

  it('024-AC-001 modeState: Esc in comment mode leaves it, tells the window and keeps the key from the page', () => {
    expect(reduceCommentMode(ON, ESC)).toEqual<CommentModeStep>({
      on: false,
      changed: true,
      requestExit: true,
      consumed: true
    })
  })

  it('024-AC-001 modeState: Esc outside comment mode is the page’s', () => {
    expect(reduceCommentMode(OFF, ESC)).toEqual<CommentModeStep>({
      on: false,
      changed: false,
      requestExit: false,
      consumed: false
    })
  })

  it('024-AC-001 modeState: a second Esc after leaving does nothing', () => {
    const first = reduceCommentMode(ON, ESC)
    expect(reduceCommentMode(first, ESC).requestExit).toBe(false)
  })

  it('024-AC-001 modeState never changes the state it is given', () => {
    const state = Object.freeze({ on: true })
    reduceCommentMode(state, ESC)
    reduceCommentMode(state, { type: 'set', on: false })
    expect(state).toEqual({ on: true })
  })
})
