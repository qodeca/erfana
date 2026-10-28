// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewGroupKeys}: keys pressed on the dockview group
 * element reach the ACTIVE preview's key chain exactly once.
 *
 * @see usePreviewGroupKeys.ts
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { usePreviewGroupKeys, type UsePreviewGroupKeysOptions } from './usePreviewGroupKeys'

type GroupChangeListener = () => void

/** A fake dockview group: just the element the hook listens on. */
function makeGroup(): { element: HTMLElement } {
  const element = document.createElement('div')
  element.tabIndex = -1
  document.body.appendChild(element)
  return { element }
}

/** A fake panel api whose group can be swapped, as a dockview move does. */
function makeApi(group: { element: HTMLElement }, isActive = true) {
  const groupListeners = new Set<GroupChangeListener>()
  const api = {
    isActive,
    group,
    onDidGroupChange: vi.fn((cb: GroupChangeListener) => {
      groupListeners.add(cb)
      return { dispose: vi.fn(() => groupListeners.delete(cb)) }
    }),
    /** Dockview's move: the group changes first, then the event fires. */
    moveTo(next: { element: HTMLElement }) {
      api.group = next
      for (const cb of [...groupListeners]) cb()
    },
    groupListeners
  }
  return api
}

/** The comment-mode chord on Windows/Linux. */
const CHORD: KeyboardEventInit = { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true, bubbles: true }

function press(target: EventTarget, init: KeyboardEventInit = CHORD): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

function mount(api: ReturnType<typeof makeApi>, onKey = vi.fn(), root: HTMLElement | null = null) {
  const rootRef = { current: root }
  const hook = renderHook(
    (props: UsePreviewGroupKeysOptions) => usePreviewGroupKeys(props),
    {
      initialProps: {
        api: api as unknown as UsePreviewGroupKeysOptions['api'],
        rootRef,
        onKey
      }
    }
  )
  return { ...hook, onKey, rootRef }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('usePreviewGroupKeys', () => {
  it('hands a key on the group element to the handler once', () => {
    const group = makeGroup()
    const { onKey } = mount(makeApi(group))

    const event = press(group.element)

    expect(onKey).toHaveBeenCalledTimes(1)
    expect(onKey).toHaveBeenCalledWith(event)
  })

  it('hears a key from a descendant of the group element (a tab)', () => {
    const group = makeGroup()
    const tab = document.createElement('div')
    group.element.appendChild(tab)
    const { onKey } = mount(makeApi(group))

    press(tab)

    expect(onKey).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an inactive panel, and reads the gate at key time', () => {
    const group = makeGroup()
    const api = makeApi(group, false)
    const { onKey } = mount(api)

    press(group.element)
    expect(onKey).not.toHaveBeenCalled()

    api.isActive = true
    press(group.element)
    expect(onKey).toHaveBeenCalledTimes(1)
  })

  it('with two previews in one group, only the active one acts', () => {
    const group = makeGroup()
    const first = mount(makeApi(group, true))
    const second = mount(makeApi(group, false))

    press(group.element)

    expect(first.onKey).toHaveBeenCalledTimes(1)
    expect(second.onKey).not.toHaveBeenCalled()
  })

  it('skips an event someone already prevented', () => {
    const group = makeGroup()
    const { onKey } = mount(makeApi(group))
    const inner = document.createElement('button')
    group.element.appendChild(inner)
    inner.addEventListener('keydown', (event) => event.preventDefault())

    press(inner)

    expect(onKey).not.toHaveBeenCalled()
  })

  it('leaves a key typed inside the panel root to the root handler', () => {
    const group = makeGroup()
    // The root inside the group element: the double-fire case the check exists for.
    const root = document.createElement('div')
    const button = document.createElement('button')
    root.appendChild(button)
    group.element.appendChild(root)
    const { onKey } = mount(makeApi(group), vi.fn(), root)

    press(button)
    expect(onKey).not.toHaveBeenCalled()

    press(group.element)
    expect(onKey).toHaveBeenCalledTimes(1)
  })

  it('removes the listener and the group subscription on unmount', () => {
    const group = makeGroup()
    const api = makeApi(group)
    const { onKey, unmount } = mount(api)

    unmount()
    press(group.element)

    expect(onKey).not.toHaveBeenCalled()
    expect(api.groupListeners.size).toBe(0)
  })

  it('re-attaches to the new group on a group change and leaves the old one', () => {
    const before = makeGroup()
    const after = makeGroup()
    const api = makeApi(before)
    const { onKey } = mount(api)

    api.moveTo(after)
    press(before.element)
    expect(onKey).not.toHaveBeenCalled()

    press(after.element)
    expect(onKey).toHaveBeenCalledTimes(1)
  })

  it('calls the latest handler without re-attaching', () => {
    const group = makeGroup()
    const api = makeApi(group)
    const first = vi.fn()
    const { rerender, rootRef } = mount(api, first)
    const second = vi.fn()

    rerender({
      api: api as unknown as UsePreviewGroupKeysOptions['api'],
      rootRef,
      onKey: second
    })
    press(group.element)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(api.onDidGroupChange).toHaveBeenCalledTimes(1)
  })

  it('attaches nothing without an api or a group', () => {
    expect(() =>
      renderHook(() => usePreviewGroupKeys({ api: undefined, rootRef: { current: null }, onKey: vi.fn() }))
    ).not.toThrow()

    const api = makeApi(undefined as unknown as { element: HTMLElement })
    const onKey = vi.fn()
    expect(() => mount(api, onKey)).not.toThrow()
  })
})
