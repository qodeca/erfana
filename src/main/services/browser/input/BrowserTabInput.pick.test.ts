// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `BrowserTabInput.attachPick` (spec 025 commit 14): the pick pipeline
 * attached after construction gets pick mode, Up and Down and every capture
 * effect.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BrowserTabInput, type TabInputPick } from './BrowserTabInput'
import { FakeInputContents, keyDown } from './__test-helpers__/fakeInputContents'

let contents: FakeInputContents
let pick: { [K in keyof TabInputPick]: Mock<TabInputPick[K]> }

function make(extra: { refine?: (move: 'parent' | 'child') => void } = {}): BrowserTabInput {
  return new BrowserTabInput({
    tabId: 'browser-tab-7',
    contents,
    platform: 'darwin',
    clock: { now: () => 10_000 },
    events: { forwardedKey: vi.fn(), pageFocus: vi.fn(), pick: vi.fn() },
    macAppKeys: { quit: vi.fn(), hide: vi.fn(), hideOthers: vi.fn(), minimize: vi.fn() },
    ...extra
  })
}

function loadAndFocus(): void {
  contents.emit('did-navigate', {}, 'https://a.test/')
  contents.focused = true
  contents.emit('focus')
}

beforeEach(() => {
  contents = new FakeInputContents()
  pick = { mode: vi.fn<TabInputPick['mode']>(), refine: vi.fn<TabInputPick['refine']>(), onEffect: vi.fn<TabInputPick['onEffect']>() }
})

describe('BrowserTabInput.attachPick', () => {
  it('tells the attached pipeline when pick mode turns on and off', () => {
    const input = make()
    input.attachPick(pick)
    loadAndFocus()
    contents.press(keyDown('e', ['meta']))
    expect(pick.mode).toHaveBeenCalledWith(true)
    contents.press(keyDown('Escape'))
    expect(pick.mode).toHaveBeenLastCalledWith(false)
  })

  it('sends Up and Down in pick mode to the pipeline', () => {
    const input = make()
    input.attachPick(pick)
    loadAndFocus()
    contents.press(keyDown('e', ['meta']))
    contents.press(keyDown('ArrowUp'))
    contents.press(keyDown('ArrowDown'))
    expect(pick.refine.mock.calls).toEqual([['parent'], ['child']])
  })

  it('prefers a refine dependency given at construction over the attached pipeline', () => {
    const refine = vi.fn()
    make({ refine }).attachPick(pick)
    loadAndFocus()
    contents.press(keyDown('e', ['meta']))
    contents.press(keyDown('ArrowUp'))
    expect(refine).toHaveBeenCalledWith('parent')
    expect(pick.refine).not.toHaveBeenCalled()
  })

  it('hands every capture effect to the pipeline', () => {
    const input = make()
    input.attachPick(pick)
    loadAndFocus()
    contents.press(keyDown('e', ['meta']))
    input.dispatch({ type: 'hover', element: true })
    contents.press(keyDown('Enter'))
    expect(pick.onEffect).toHaveBeenCalledWith({ type: 'startCapture', freeze: false })
  })

  it('does nothing for pick before a pipeline is attached', () => {
    make()
    loadAndFocus()
    expect(() => contents.press(keyDown('e', ['meta']))).not.toThrow()
    expect(() => contents.press(keyDown('ArrowUp'))).not.toThrow()
  })
})
