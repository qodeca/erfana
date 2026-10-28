// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay host against a page that fights it
 * (docs/designs/html-preview-comments.md §9.1 S4, S25, §10.2, §19 R3-7;
 * SEC-21, SEC-28, SEC-31).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { OVERLAY_REPAIRS_PER_SECOND } from './constants'
import { OverlayHost } from './overlayHost'
import { installBrowserDoubles, dispatchTrusted, type BrowserDoubles } from './__test-helpers__/browserDoubles'
import { microtasks } from './__test-helpers__/harness'

let doubles: BrowserDoubles
let clock: { now: number }
let onUnavailable: Mock<() => void>
let overlay: OverlayHost

/** The host element: the only `<div>` child of `<html>`. */
function host(): HTMLElement | undefined {
  return [...document.documentElement.children].find(el => el.localName === 'div') as HTMLElement | undefined
}

beforeEach(() => {
  doubles = installBrowserDoubles()
  clock = { now: 1_000 }
  onUnavailable = vi.fn<() => void>()
  overlay = new OverlayHost({ doc: document, now: () => clock.now, onUnavailable })
})

afterEach(() => {
  overlay.dispose()
  host()?.remove()
  document.body.innerHTML = ''
  doubles.restore()
})

describe('OverlayHost', () => {
  it('attaches one plain div to <html> with a CLOSED shadow root, in the top layer', () => {
    const root = overlay.ensure()
    const el = host() as HTMLElement
    expect(root).toBe(doubles.shadowRoots.at(-1))
    expect(el.parentNode).toBe(document.documentElement)
    expect(el.shadowRoot).toBeNull()
    expect(el.matches(':popover-open')).toBe(true)
    expect(el.style.getPropertyValue('position')).toBe('fixed')
    expect(el.style.getPropertyPriority('position')).toBe('important')
    expect(el.style.getPropertyValue('pointer-events')).toBe('none')
    expect(overlay.isHost(el)).toBe(true)
    expect(overlay.isHost(null)).toBe(false)
    // Second call: same root, nothing added.
    expect(overlay.ensure()).toBe(root)
    expect([...document.documentElement.children].filter(c => c.localName === 'div')).toHaveLength(1)
  })

  it('styles through an adopted constructable sheet only', () => {
    const root = overlay.ensure() as ShadowRoot
    overlay.setCss('.erf-hpc-root { color: red; }')
    expect(root.adoptedStyleSheets).toHaveLength(1)
    expect(doubles.sheetText(root.adoptedStyleSheets[0])).toBe('.erf-hpc-root { color: red; }')
    expect(root.querySelector('style')).toBeNull()
  })

  it('SEC-21 re-attaches a host the page removed, moved or restyled', async () => {
    overlay.ensure()
    const el = host() as HTMLElement

    el.remove()
    await microtasks()
    expect(el.parentNode).toBe(document.documentElement)

    clock.now += 1_000
    document.body.append(el)
    await microtasks()
    expect(el.parentNode).toBe(document.documentElement)

    clock.now += 1_000
    el.style.setProperty('display', 'none', 'important')
    el.setAttribute('hidden', '')
    el.setAttribute('inert', '')
    await microtasks()
    expect(el.style.getPropertyValue('display')).toBe('block')
    expect(el.hasAttribute('hidden')).toBe(false)
    expect(el.hasAttribute('inert')).toBe(false)
    expect(el.shadowRoot).toBeNull()
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('SEC-31 shows the host again after the page calls hidePopover()', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    doubles.hidePopover(el)
    await microtasks()
    expect(el.matches(':popover-open')).toBe(true)
  })

  it('ignores a forged toggle event and a no-op attribute write', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    for (let i = 0; i < 10; i += 1) {
      const forged = new Event('toggle')
      Object.defineProperty(forged, 'newState', { value: 'closed' })
      el.dispatchEvent(forged)
      const open = new Event('toggle')
      Object.defineProperty(open, 'newState', { value: 'open' })
      dispatchTrusted(el, open)
      el.setAttribute('popover', 'manual')
      await microtasks()
    }
    expect(overlay.unavailable).toBe(false)
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it(`SEC-28 gives up after ${OVERLAY_REPAIRS_PER_SECOND} repairs in one second – no spin`, async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    const append = vi.spyOn(document.documentElement, 'appendChild')
    for (let i = 0; i < 50; i += 1) {
      el.remove()
      await microtasks()
    }
    expect(append).toHaveBeenCalledTimes(OVERLAY_REPAIRS_PER_SECOND)
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(overlay.unavailable).toBe(true)
    expect(el.isConnected).toBe(false)
    // Gone for this document, even a second later.
    clock.now += 5_000
    expect(overlay.ensure()).toBeNull()
    append.mockRestore()
  })

  it('L1 a render that finds the host gone re-attaches on the same budget – no free re-attach loop', () => {
    overlay.ensure()
    const el = host() as HTMLElement
    const append = vi.spyOn(document.documentElement, 'appendChild')
    // Each render calls ensure(); the page removes the host before each one.
    for (let i = 0; i < 10; i += 1) {
      el.remove()
      overlay.ensure()
    }
    expect(append).toHaveBeenCalledTimes(OVERLAY_REPAIRS_PER_SECOND)
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(overlay.ensure()).toBeNull()
    append.mockRestore()
  })

  it('L1 a show the page cancelled is retried on the budget, then the overlay gives up – no spin', async () => {
    // As a page `beforetoggle` listener that calls preventDefault() leaves it.
    const show = vi.spyOn(HTMLElement.prototype, 'showPopover').mockImplementation(() => undefined)
    try {
      expect(overlay.ensure()).not.toBeNull()
      await microtasks()
      await microtasks()
      expect(show).toHaveBeenCalledTimes(1 + OVERLAY_REPAIRS_PER_SECOND)
      expect(onUnavailable).toHaveBeenCalledTimes(1)
      expect(overlay.unavailable).toBe(true)
    } finally {
      show.mockRestore()
    }
  })

  it('M1 adds its toggle listener again on every attach – document.open() erases it', async () => {
    const added = vi.spyOn(EventTarget.prototype, 'addEventListener')
    overlay.ensure()
    const el = host() as HTMLElement
    el.remove()
    await microtasks()
    const toggles = added.mock.calls.filter(([type]) => type === 'toggle')
    expect(toggles).toHaveLength(2)
    expect(toggles[0][1]).toBe(toggles[1][1])
    added.mockRestore()
  })

  it('repairs at the steady rate a page may need, a second apart', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    for (let i = 0; i < 10; i += 1) {
      clock.now += 1_000
      el.remove()
      await microtasks()
    }
    expect(overlay.unavailable).toBe(false)
    expect(el.parentNode).toBe(document.documentElement)
  })

  it('detaches, and re-attaches on the next ensure without spending the budget', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    overlay.detach()
    expect(host()).toBeUndefined()
    // Removing a shown popover fires a trusted toggle to `closed`: not a repair.
    dispatchTrusted(el, Object.assign(new Event('toggle'), { newState: 'closed' }))
    await microtasks()
    expect(host()).toBeUndefined()
    overlay.ensure()
    expect(host()?.parentNode).toBe(document.documentElement)
  })

  it('draws without a top layer where the Popover API is missing, and survives a refusing showPopover', () => {
    const noPopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover')
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover
    try {
      expect(overlay.ensure()).not.toBeNull()
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'showPopover', noPopover as PropertyDescriptor)
    }
    overlay.dispose()
    host()?.remove()

    const refusing = new OverlayHost({ doc: document, now: () => clock.now, onUnavailable })
    const show = vi.spyOn(HTMLElement.prototype, 'showPopover').mockImplementation(() => {
      throw new DOMException('not showable', 'InvalidStateError')
    })
    expect(refusing.ensure()).not.toBeNull()
    show.mockRestore()
    refusing.dispose()
  })

  it('treats an engine that cannot answer :popover-open as shown', async () => {
    const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(() => {
      throw new SyntaxError('unknown pseudo-class')
    })
    try {
      overlay.ensure()
      const el = host() as HTMLElement
      dispatchTrusted(el, Object.assign(new Event('toggle'), { newState: 'closed' }))
      await microtasks()
      expect(overlay.unavailable).toBe(false)
    } finally {
      matches.mockRestore()
    }
  })

  it('has nothing to attach to before <html> exists, and no sheet without a window', () => {
    const empty = document.implementation.createDocument(null, null, null)
    const bare = new OverlayHost({ doc: empty as unknown as Document, now: () => 0, onUnavailable })
    expect(bare.ensure()).toBeNull()

    const windowless = document.implementation.createHTMLDocument('x')
    const noWindow = new OverlayHost({ doc: windowless, now: () => 0, onUnavailable })
    expect(noWindow.ensure()).not.toBeNull()
    noWindow.setCss('.x {}')
    noWindow.dispose()
  })

  it('re-attaches to a replaced <html>', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    const oldRoot = document.documentElement
    const newRoot = document.createElement('html')
    newRoot.append(document.createElement('body'))
    document.replaceChild(newRoot, oldRoot)
    try {
      await microtasks()
      expect(el.parentNode).toBe(newRoot)
    } finally {
      el.remove()
      document.replaceChild(oldRoot, newRoot)
    }
  })

  it('ignores the page once it has given up, and a repair queued before dispose', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    for (let i = 0; i < 10; i += 1) {
      el.remove()
      await microtasks()
    }
    expect(overlay.unavailable).toBe(true)
    document.documentElement.append(el)
    doubles.hidePopover(el)
    await microtasks()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    el.remove()

    const fresh = new OverlayHost({ doc: document, now: () => clock.now, onUnavailable })
    fresh.ensure()
    const other = host() as HTMLElement
    dispatchTrusted(other, Object.assign(new Event('toggle'), { newState: 'closed' }))
    fresh.dispose()
    await microtasks()
    expect(other.isConnected).toBe(false)
  })

  it('waits for a new <html> when the page removes it', async () => {
    overlay.ensure()
    const el = host() as HTMLElement
    const html = document.documentElement
    document.removeChild(html)
    try {
      await microtasks()
      expect(el.isConnected).toBe(false)
      expect(overlay.unavailable).toBe(false)
    } finally {
      document.append(html)
    }
  })
})
