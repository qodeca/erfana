// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fakes for the browser input suites: key and mouse events as Electron's
 * `before-input-event` / `before-mouse-event` deliver them, and a page
 * `webContents` with the input surface (`TabInputContents`). Events are
 * fired by hand with `emit`.
 */
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'
import type { BrowserKeyInput } from '../../../../../shared/browser/browserKeys'

/** A preventable event that remembers whether it was prevented. */
export interface FakeEvent {
  preventDefault(): void
  readonly prevented: boolean
}

export function fakeEvent(): FakeEvent {
  let prevented = false
  return {
    preventDefault: () => {
      prevented = true
    },
    get prevented() {
      return prevented
    }
  }
}

type Mod = 'meta' | 'control' | 'alt' | 'shift'

/**
 * A key press. `code` defaults to the US-layout code of a letter or digit, and
 * to the key name for named keys.
 */
export function keyDown(key: string, mods: readonly Mod[] = [], extra: Partial<BrowserKeyInput> = {}): BrowserKeyInput {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key
  return {
    type: 'keyDown',
    key,
    code,
    meta: mods.includes('meta'),
    control: mods.includes('control'),
    alt: mods.includes('alt'),
    shift: mods.includes('shift'),
    isAutoRepeat: false,
    isComposing: false,
    ...extra
  }
}

export function keyUp(press: BrowserKeyInput): BrowserKeyInput {
  return { ...press, type: 'keyUp', isAutoRepeat: false }
}

export function autoRepeat(press: BrowserKeyInput): BrowserKeyInput {
  return { ...press, isAutoRepeat: true }
}

/** A page `webContents` with the surface `BrowserTabInput` uses. */
export class FakeInputContents extends EventEmitter {
  destroyed = false
  focused = false
  focus = vi.fn(() => {
    this.focused = true
  })
  isFocused = (): boolean => this.focused
  isDestroyed = (): boolean => this.destroyed
  setIgnoreMenuShortcuts = vi.fn()
  executeJavaScriptInIsolatedWorld = vi.fn(async (): Promise<unknown> => undefined)
  copy = vi.fn()
  paste = vi.fn()
  cut = vi.fn()
  selectAll = vi.fn()
  undo = vi.fn()
  redo = vi.fn()

  /** Fire `before-input-event` and return the event, to read whether it was prevented. */
  key(input: BrowserKeyInput): FakeEvent {
    const event = fakeEvent()
    this.emit('before-input-event', event, input)
    return event
  }

  /** Press and release `input`; returns whether each was prevented. */
  press(input: BrowserKeyInput): { down: boolean; up: boolean } {
    const down = this.key(input).prevented
    const up = this.key(keyUp(input)).prevented
    return { down, up }
  }

  /** Fire `before-mouse-event` and return the event. */
  mouse(type: string, button?: 'left' | 'middle' | 'right'): FakeEvent {
    const event = fakeEvent()
    this.emit('before-mouse-event', event, button === undefined ? { type } : { type, button })
    return event
  }

  /** A left click; returns whether the press and the release were prevented. */
  click(button: 'left' | 'middle' | 'right' = 'left'): { down: boolean; up: boolean } {
    const down = this.mouse('mouseDown', button).prevented
    const up = this.mouse('mouseUp', button).prevented
    return { down, up }
  }
}
