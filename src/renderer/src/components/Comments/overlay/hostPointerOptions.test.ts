// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The host's pointer wiring (#445): the options it hands `useHostPointerKeys`.
 */
import { describe, it, expect, vi } from 'vitest'
import { hostPointerOptions, type HostPointerParts } from './hostPointerOptions'
import { ANNOUNCE } from '../commentCopy'

function parts(over: Partial<HostPointerParts> = {}): HostPointerParts {
  return {
    live: true,
    mode: true,
    activePanel: true,
    adapter: {} as HostPointerParts['adapter'],
    scroller: null,
    scrollerLabel: 'Preview',
    windowOpen: false,
    onToggleMode: vi.fn(),
    onWindowEscape: vi.fn(),
    onPick: vi.fn(),
    onMenu: vi.fn(),
    onSay: vi.fn(),
    placements: [],
    file: null as unknown as HostPointerParts['file'],
    markOwner: 'marks-x',
    selection: { read: () => null, readInView: () => null, hideButton: vi.fn() },
    setMode: vi.fn(),
    modeButton: () => null,
    openThreads: vi.fn(),
    onScroll: vi.fn(),
    ...over
  }
}

describe('hostPointerOptions (#445)', () => {
  it('passes the host’s own actions through unchanged', () => {
    const p = parts()
    const o = hostPointerOptions(p)
    expect(o.onWindowEscape).toBe(p.onWindowEscape)
    expect(o.onPick).toBe(p.onPick)
    expect(o.onMenu).toBe(p.onMenu)
    expect(o.onScroll).toBe(p.onScroll)
    expect(o.onKeyMove).toBe(p.selection.hideButton)
    expect(o.scrollerLabel).toBe('Preview')
  })

  it('leaving the mode turns it off, says so, and moves focus to the mode button', () => {
    const button = document.createElement('button')
    document.body.append(button)
    const p = parts({ modeButton: () => button })
    hostPointerOptions(p).onExit()
    expect(p.setMode).toHaveBeenCalledWith(false)
    expect(p.onSay).toHaveBeenCalledWith(ANNOUNCE.modeOff)
    expect(document.activeElement).toBe(button)
    button.remove()
  })

  it('opening a mark opens that one thread at its target', () => {
    const p = parts()
    const at = document.createElement('p')
    hostPointerOptions(p).onOpenMark('t-1', at)
    expect(p.openThreads).toHaveBeenCalledWith(['t-1'], at)
  })

  it('with no selection, the selection reads are empty and no point is on it', () => {
    const o = hostPointerOptions(parts())
    expect(o.selectionRect()).toBeNull()
    expect(o.selectionTarget()).toBeNull()
    expect(o.onSelectionAt(1, 1)).toBe(false)
  })

  it('reads the selection’s box and target when there is one', () => {
    const rect = new DOMRect(1, 2, 3, 4)
    const target = document.createElement('p')
    const read = (() => ({ rect, lines: [] })) as unknown as HostPointerParts['selection']['read']
    const readInView = (() => ({
      target
    })) as unknown as HostPointerParts['selection']['readInView']
    const o = hostPointerOptions(parts({ selection: { read, readInView, hideButton: vi.fn() } }))
    expect(o.selectionRect()).toBe(rect)
    expect(o.selectionTarget()).toBe(target)
  })
})
