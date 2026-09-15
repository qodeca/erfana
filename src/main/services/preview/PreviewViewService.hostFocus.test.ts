// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The way back out of a previewed page, through the whole service (issue #124,
 * QG-11a H1).
 *
 * Over the shared navigation harness, so the key goes through the real
 * `before-input-event` listener a real `PreviewLiveView` wired: Escape pressed
 * in the page hands native focus to the HOST window's contents before main
 * tells the renderer, and a key that moves no focus leaves it in the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeHarness, removeProjects } from './__test-helpers__/previewViewServiceNavHarness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeProjects()
})

/** A key press in the page, as Chromium's pre-dispatch pipeline reports it. */
function press(key: string, modifiers: { meta?: boolean } = {}) {
  const event = { preventDefault: vi.fn() }
  const input = {
    type: 'keyDown',
    key,
    code: '',
    control: false,
    meta: modifiers.meta === true,
    alt: false,
    shift: false
  }
  return { event, input }
}

describe('PreviewViewService – forwarded keys and host focus', () => {
  it('focuses the host contents before the forwarded Escape reaches the renderer', async () => {
    const forward = vi.fn<(panelId: string, key: string) => void>()
    const h = makeHarness({ onForwardedShortcut: forward })
    const page = await h.openCommitted('a.html')

    const { event, input } = press('Escape')
    page.emit('before-input-event', event, input)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledWith('panel-A', 'Escape')
    expect(h.hostContents.focus).toHaveBeenCalledTimes(1)
    expect(h.hostContents.focus.mock.invocationCallOrder[0]).toBeLessThan(
      forward.mock.invocationCallOrder[0]
    )
  })

  it('focuses the host for a forwarded Find (the find input is host chrome)', async () => {
    const forward = vi.fn<(panelId: string, key: string) => void>()
    const h = makeHarness({ onForwardedShortcut: forward })
    const page = await h.openCommitted('a.html')

    const { event, input } = press('f', { meta: true })
    page.emit('before-input-event', event, input)

    expect(forward).toHaveBeenCalledWith('panel-A', 'f')
    expect(h.hostContents.focus).toHaveBeenCalledTimes(1)
  })

  it('leaves focus in the page for a forwarded export (Cmd+S)', async () => {
    const forward = vi.fn<(panelId: string, key: string) => void>()
    const h = makeHarness({ onForwardedShortcut: forward })
    const page = await h.openCommitted('a.html')

    const { event, input } = press('s', { meta: true })
    page.emit('before-input-event', event, input)

    expect(forward).toHaveBeenCalledWith('panel-A', 's')
    expect(h.hostContents.focus).not.toHaveBeenCalled()
  })

  it('never steals focus for a key main does not forward', async () => {
    const forward = vi.fn<(panelId: string, key: string) => void>()
    const h = makeHarness({ onForwardedShortcut: forward })
    const page = await h.openCommitted('a.html')

    const { event, input } = press('a')
    page.emit('before-input-event', event, input)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
    expect(h.hostContents.focus).not.toHaveBeenCalled()
  })

  it('still forwards Escape when the host contents is already gone', async () => {
    const forward = vi.fn<(panelId: string, key: string) => void>()
    const h = makeHarness({ onForwardedShortcut: forward })
    const page = await h.openCommitted('a.html')
    h.hostContents.isDestroyed.mockReturnValue(true)

    const { event, input } = press('Escape')
    expect(() => page.emit('before-input-event', event, input)).not.toThrow()

    expect(h.hostContents.focus).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledWith('panel-A', 'Escape')
  })

  it('moves no focus when there is no renderer to tell about the key', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    const { event, input } = press('Escape')
    page.emit('before-input-event', event, input)

    expect(h.hostContents.focus).not.toHaveBeenCalled()
  })
})
