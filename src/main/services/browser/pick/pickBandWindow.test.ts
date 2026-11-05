// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { windows, views } = vi.hoisted(() => ({ windows: [] as unknown[], views: [] as unknown[] }))

vi.mock('electron', () => {
  class FakeView {
    visible = true
    colour: string | null = null
    bounds: unknown = null
    constructor() {
      views.push(this)
    }
    setVisible(v: boolean): void {
      this.visible = v
    }
    setBackgroundColor(c: string): void {
      this.colour = c
    }
    setBounds(b: unknown): void {
      this.bounds = b
    }
  }
  class FakeBaseWindow {
    readonly children: FakeView[] = []
    readonly contentView = { addChildView: (v: FakeView) => this.children.push(v) }
    ignoreMouse: boolean | null = null
    visible = false
    destroyed = false
    readonly calls: string[] = []
    bounds: unknown = null
    constructor(readonly options: Record<string, unknown>) {
      windows.push(this)
    }
    setIgnoreMouseEvents(ignore: boolean): void {
      this.calls.push('setIgnoreMouseEvents')
      this.ignoreMouse = ignore
    }
    setBounds(b: unknown): void {
      this.calls.push('setBounds')
      this.bounds = b
    }
    isVisible(): boolean {
      return this.visible
    }
    showInactive(): void {
      this.calls.push('showInactive')
      this.visible = true
    }
    show(): void {
      throw new Error('the band must never be shown with focus')
    }
    focus(): void {
      throw new Error('the band must never take focus')
    }
    hide(): void {
      this.calls.push('hide')
      this.visible = false
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  return { BaseWindow: FakeBaseWindow, View: FakeView }
})

import type { BaseWindow } from 'electron'
import { BAND_STRIP_COUNT, bandStrips } from './pickBand'
import { canPlaceBandWindow, openBandWindow } from './pickBandWindow'

interface FakeWindow {
  options: Record<string, unknown>
  children: Array<{ visible: boolean; colour: string | null; bounds: unknown }>
  ignoreMouse: boolean | null
  visible: boolean
  destroyed: boolean
  calls: string[]
  bounds: unknown
}

const PAIR = { ink: '#161312', paper: '#ffffff' }

function open() {
  const parent = new EventEmitter()
  const events = { moved: vi.fn(), hidden: vi.fn(), closed: vi.fn() }
  const surface = openBandWindow(parent as unknown as BaseWindow, events)
  const window = windows.at(-1) as FakeWindow
  return { parent, events, surface, window }
}

describe('canPlaceBandWindow', () => {
  it('places a child window everywhere but under a Wayland compositor', () => {
    expect(canPlaceBandWindow('darwin', { WAYLAND_DISPLAY: 'wayland-0' }, '')).toBe(true)
    expect(canPlaceBandWindow('win32', {}, '')).toBe(true)
    expect(canPlaceBandWindow('linux', {}, '')).toBe(true)
    expect(canPlaceBandWindow('linux', { XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: '' }, '')).toBe(true)
    expect(canPlaceBandWindow('linux', { XDG_SESSION_TYPE: 'wayland' }, '')).toBe(false)
    expect(canPlaceBandWindow('linux', { WAYLAND_DISPLAY: 'wayland-0' }, '')).toBe(false)
    // An explicit switch wins over the session.
    expect(canPlaceBandWindow('linux', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }, 'x11')).toBe(true)
    expect(canPlaceBandWindow('linux', {}, 'wayland')).toBe(false)
  })
})

describe('openBandWindow', () => {
  beforeEach(() => {
    windows.length = 0
    views.length = 0
  })

  it('is a hidden, frameless, transparent child that can never take focus and passes the mouse through before it is ever shown', () => {
    const { window } = open()
    expect(window.options).toMatchObject({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false
    })
    expect(window.options.parent).toBeDefined()
    expect(window.ignoreMouse).toBe(true)
    expect(window.calls[0]).toBe('setIgnoreMouseEvents')
    expect(window.children).toHaveLength(BAND_STRIP_COUNT)
    expect(window.children.every((v) => !v.visible)).toBe(true)
  })

  it('draws each strip in its tone, hides unused slots, moves only when the bounds change, and shows without focus', () => {
    const { surface, window } = open()
    const strips = bandStrips({ x: 10, y: 10, width: 20, height: 20 }, { width: 100, height: 100 })
    surface.draw({ x: 5, y: 6, width: 100, height: 100 }, strips, PAIR)
    expect(window.bounds).toEqual({ x: 5, y: 6, width: 100, height: 100 })
    expect(window.children.map((v) => v.colour)).toEqual([...Array(4).fill(PAIR.ink), ...Array(4).fill(PAIR.paper)])
    expect(window.children.map((v) => v.bounds)).toEqual(strips.map((s) => s.rect))
    expect(window.visible).toBe(true)
    surface.draw({ x: 5, y: 6, width: 100, height: 100 }, strips.slice(0, 2), PAIR)
    expect(window.calls.filter((c) => c === 'setBounds')).toHaveLength(1)
    expect(window.calls.filter((c) => c === 'showInactive')).toHaveLength(1)
    expect(window.children.map((v) => v.visible)).toEqual([true, true, false, false, false, false, false, false])
    surface.draw({ x: 7, y: 6, width: 100, height: 100 }, strips, PAIR)
    expect(window.calls.filter((c) => c === 'setBounds')).toHaveLength(2)
    surface.hide()
    expect(window.visible).toBe(false)
  })

  it('follows the parent: moved on move, restore and show; hidden on minimise and hide; gone when it closes', () => {
    const { parent, events, window } = open()
    for (const name of ['move', 'restore', 'show']) parent.emit(name)
    expect(events.moved).toHaveBeenCalledTimes(3)
    for (const name of ['minimize', 'hide']) parent.emit(name)
    expect(events.hidden).toHaveBeenCalledTimes(2)
    parent.emit('closed')
    expect(window.destroyed).toBe(true)
    expect(events.closed).toHaveBeenCalledTimes(1)
    expect(parent.eventNames()).toEqual([])
  })

  it('destroy closes the window and unhooks the parent; drawing and hiding a destroyed window do nothing', () => {
    const { parent, surface, window, events } = open()
    surface.destroy()
    expect(window.destroyed).toBe(true)
    expect(parent.eventNames()).toEqual([])
    expect(events.closed).toHaveBeenCalledTimes(1)
    surface.draw({ x: 0, y: 0, width: 1, height: 1 }, [], PAIR)
    surface.hide()
    surface.destroy()
    expect(window.calls).toEqual(['setIgnoreMouseEvents'])
  })
})
