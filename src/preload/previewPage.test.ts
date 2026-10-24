// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Behaviour of the sealed preview page's preload (sd-074b §5.1).
 *
 * `previewPage.contract.test.ts` pins what the source must and must not
 * contain. This file loads the real module, sends real DOM events through it,
 * and checks what reaches `ipcRenderer`, because that is the whole of what the
 * sealed page can tell main:
 *
 * - a trusted click or middle click on a link reports the link, once, with the
 *   button, the modifiers, the target and the `download` flag;
 * - a page-made (untrusted) event, a cancelled click, a non-link click, a right
 *   click and a same-document link report nothing;
 * - a trusted CSP refusal of an http(s) URI reports the URI and directive, even
 *   when the page stops the event's propagation; a keyword URI or a page-made
 *   event reports nothing.
 *
 * TRUSTED EVENTS. The preload ignores any event whose `isTrusted` is false, and
 * jsdom's public `dispatchEvent` always makes it false, as the DOM spec says.
 * `dispatchTrusted` below therefore marks the event trusted and dispatches it
 * the way jsdom fires its own browser-made events (`fireAnEvent` in
 * jsdom/lib/jsdom/living/helpers/events.js). It relies on two jsdom internals,
 * `implForWrapper` and `_dispatch`; the first test checks the helper still
 * produces a trusted event, so a jsdom upgrade that changes them fails here
 * instead of making every "nothing is sent" test pass for the wrong reason.
 */
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

// The preload imports only `ipcRenderer`; anything else it reached for would be
// undefined here and throw.
vi.mock('electron', () => ({ ipcRenderer: { send } }))

const LINK_CHANNEL = 'preview-page:linkActivated'
const CSP_CHANNEL = 'preview-page:cspViolation'

const requireFromHere = createRequire(import.meta.url)
const { implForWrapper } = requireFromHere('jsdom/lib/jsdom/living/generated/utils.js') as {
  implForWrapper: (wrapper: object) => unknown
}

interface JsdomEventImpl {
  isTrusted: boolean
}

interface JsdomEventTargetImpl {
  _dispatch: (event: JsdomEventImpl) => boolean
}

/** Dispatch `event` at `target` as a browser-made (trusted) event. */
function dispatchTrusted(target: EventTarget, event: Event): void {
  const eventImpl = implForWrapper(event) as JsdomEventImpl
  eventImpl.isTrusted = true
  ;(implForWrapper(target) as JsdomEventTargetImpl)._dispatch(eventImpl)
}

/** A trusted click (or middle click) as the user's pointer would make it. */
function userClick(target: EventTarget, type: 'click' | 'auxclick' = 'click', init: MouseEventInit = {}): void {
  dispatchTrusted(target, new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }))
}

/** A CSP refusal as Chromium reports it. jsdom has no SecurityPolicyViolationEvent. */
function cspEvent(blockedURI: string, effectiveDirective?: string): Event {
  const event = new Event('securitypolicyviolation', { bubbles: true, composed: true })
  Object.defineProperty(event, 'blockedURI', { value: blockedURI })
  if (effectiveDirective !== undefined) {
    Object.defineProperty(event, 'effectiveDirective', { value: effectiveDirective })
  }
  return event
}

/** Let the preload's deferred link report (a microtask) run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Add `html` to the body and return the element matching `selector`. */
function mount(html: string, selector: string): Element {
  document.body.insertAdjacentHTML('beforeend', html)
  const element = document.body.querySelector(selector)
  if (element === null) throw new Error(`mount: nothing matches ${selector}`)
  return element
}

const resolved = (href: string): string => new URL(href, document.baseURI).href

const NO_MODIFIERS = { meta: false, ctrl: false, shift: false, alt: false }

beforeAll(async () => {
  // Loaded once: the module adds its document listeners as a side effect, and
  // loading it again would add a second set.
  await import('./previewPage')
})

beforeEach(() => {
  send.mockClear()
})

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('previewPage preload – test harness', () => {
  it('dispatchTrusted produces a trusted event, and dispatchEvent does not', () => {
    const seen: boolean[] = []
    const record = (event: Event): void => {
      seen.push(event.isTrusted)
    }
    document.addEventListener('probe', record)
    try {
      dispatchTrusted(document.body, new Event('probe', { bubbles: true }))
      document.body.dispatchEvent(new Event('probe', { bubbles: true }))
    } finally {
      document.removeEventListener('probe', record)
    }
    expect(seen).toEqual([true, false])
  })
})

describe('previewPage preload – link activation', () => {
  // A link click makes jsdom try to follow the link, and jsdom cannot navigate,
  // so it logs "Not implemented: navigation" from a timer that `settle()` waits
  // for. The sealed page refuses that navigation too (CSP sandbox, main's
  // will-navigate deny). Drop exactly that line; every other error still prints.
  const JSDOM_NAVIGATION = 'Error: Not implemented: navigation'
  let consoleError: MockInstance<typeof console.error> | undefined

  beforeEach(() => {
    const original = console.error.bind(console)
    consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith(JSDOM_NAVIGATION)) return
      original(...args)
    })
  })

  afterEach(() => {
    consoleError?.mockRestore()
  })

  it('reports a primary click on a link, once', async () => {
    const link = mount('<a href="other.html">Other</a>', 'a')

    userClick(link)
    await settle()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(LINK_CHANNEL, {
      href: resolved('other.html'),
      rawHref: 'other.html',
      target: '',
      download: false,
      button: 0,
      modifiers: NO_MODIFIERS
    })
  })

  it('reports a middle click (auxclick) with its target, download flag and modifiers', async () => {
    const link = mount('<a href="../up.pdf" target="_blank" download>Up</a>', 'a')

    userClick(link, 'auxclick', { button: 1, ctrlKey: true, shiftKey: true })
    await settle()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(LINK_CHANNEL, {
      href: resolved('../up.pdf'),
      rawHref: '../up.pdf',
      target: '_blank',
      download: true,
      button: 1,
      modifiers: { meta: false, ctrl: true, shift: true, alt: false }
    })
  })

  it('reports the meta and alt modifiers', async () => {
    const link = mount('<a href="next.html">Next</a>', 'a')

    userClick(link, 'click', { metaKey: true, altKey: true })
    await settle()

    expect(send).toHaveBeenCalledWith(
      LINK_CHANNEL,
      expect.objectContaining({ modifiers: { meta: true, ctrl: false, shift: false, alt: true } })
    )
  })

  it('finds the link from a click on an element inside it', async () => {
    const inner = mount('<a href="nested.html"><span><em>deep</em></span></a>', 'em')

    userClick(inner)
    await settle()

    expect(send).toHaveBeenCalledWith(LINK_CHANNEL, expect.objectContaining({ rawHref: 'nested.html' }))
  })

  it('finds a link inside an open shadow root', async () => {
    const host = mount('<div id="host"></div>', '#host')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<a href="shadow.html"><span>inside</span></a>'
    const inner = shadow.querySelector('span')
    if (inner === null) throw new Error('shadow content missing')

    userClick(inner)
    await settle()

    expect(send).toHaveBeenCalledWith(LINK_CHANNEL, expect.objectContaining({ rawHref: 'shadow.html' }))
  })

  it('reports an image-map area like a link', async () => {
    const area = mount('<map name="m"><area href="area.html" shape="default" alt="Area"></map>', 'area')

    userClick(area)
    await settle()

    expect(send).toHaveBeenCalledWith(LINK_CHANNEL, expect.objectContaining({ rawHref: 'area.html' }))
  })

  it('falls back to the document base target, read on every click', async () => {
    const link = mount('<a href="base.html">Base</a>', 'a')
    document.head.insertAdjacentHTML('beforeend', '<base target="_top">')

    userClick(link)
    await settle()
    expect(send).toHaveBeenLastCalledWith(LINK_CHANNEL, expect.objectContaining({ target: '_top' }))

    // The page can change <base> at runtime; the next click must see it.
    document.head.querySelector('base')?.setAttribute('target', 'frame-two')
    userClick(link)
    await settle()
    expect(send).toHaveBeenLastCalledWith(LINK_CHANNEL, expect.objectContaining({ target: 'frame-two' }))
  })

  it('prefers the link’s own target over the base target', async () => {
    document.head.insertAdjacentHTML('beforeend', '<base target="_top">')
    const link = mount('<a href="own.html" target="named">Own</a>', 'a')

    userClick(link)
    await settle()

    expect(send).toHaveBeenCalledWith(LINK_CHANNEL, expect.objectContaining({ target: 'named' }))
  })

  it('reports a link whose href does not parse, and leaves the verdict to main', async () => {
    // The href getter falls back to the attribute text when it is not a URL;
    // the same-document check cannot parse it either, so it is not treated as
    // an in-page anchor. Main re-parses it and owns the decision.
    const link = mount('<a href="http://[broken">Broken</a>', 'a')

    userClick(link)
    await settle()

    expect(send).toHaveBeenCalledWith(
      LINK_CHANNEL,
      expect.objectContaining({ href: 'http://[broken', rawHref: 'http://[broken' })
    )
  })

  it('keeps the href read at click time when the page removes the attribute afterwards', async () => {
    // The resolved href is captured during the click; the raw attribute is read
    // in the deferred report, after every page listener has run.
    const link = mount('<a href="gone.html">Gone</a>', 'a')
    const strip = (): void => link.removeAttribute('href')
    window.addEventListener('click', strip)
    try {
      userClick(link)
      await settle()
    } finally {
      window.removeEventListener('click', strip)
    }

    expect(send).toHaveBeenCalledWith(
      LINK_CHANNEL,
      expect.objectContaining({ href: resolved('gone.html'), rawHref: '' })
    )
  })

  it('reports nothing for a click the page made itself (untrusted)', async () => {
    const link = mount('<a href="forged.html">Forged</a>', 'a') as HTMLAnchorElement

    link.click()
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    await settle()

    expect(send).not.toHaveBeenCalled()
  })

  it('reports nothing when the page cancels the click before the preload sees it', async () => {
    const link = mount('<a href="handled.html">Handled</a>', 'a')
    link.addEventListener('click', (event) => event.preventDefault())

    userClick(link)
    await settle()

    expect(send).not.toHaveBeenCalled()
  })

  it('reports nothing when a later page listener cancels the click', async () => {
    // A window listener runs after the preload's document listener, so only the
    // deferred re-check can see this cancellation.
    const link = mount('<a href="router.html">Router</a>', 'a')
    const cancel = (event: Event): void => event.preventDefault()
    window.addEventListener('click', cancel)
    try {
      userClick(link)
      await settle()
    } finally {
      window.removeEventListener('click', cancel)
    }

    expect(send).not.toHaveBeenCalled()
  })

  it('reports nothing for a right click', async () => {
    const link = mount('<a href="menu.html">Menu</a>', 'a')

    userClick(link, 'auxclick', { button: 2 })
    await settle()

    expect(send).not.toHaveBeenCalled()
  })

  it('reports nothing for a click outside any link', async () => {
    const paragraph = mount('<p>Just text</p>', 'p')

    userClick(paragraph)
    await settle()

    expect(send).not.toHaveBeenCalled()
  })

  it('reports nothing for an anchor without an href', async () => {
    const anchor = mount('<a name="spot">Spot</a>', 'a')

    userClick(anchor)
    await settle()

    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['a fragment', '#section'],
    ['an empty href', ''],
    ['a bare hash', '#']
  ])('reports nothing for %s of the current document', async (_label, href) => {
    const link = mount(`<a href="${href}">Here</a>`, 'a')

    userClick(link)
    await settle()

    expect(send).not.toHaveBeenCalled()
  })
})

describe('previewPage preload – CSP refusals', () => {
  it('reports a refused https subresource with its directive', () => {
    const image = mount('<img alt="">', 'img')

    dispatchTrusted(image, cspEvent('https://cdn.example/x.png', 'img-src'))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(CSP_CHANNEL, {
      blockedURI: 'https://cdn.example/x.png',
      effectiveDirective: 'img-src'
    })
  })

  it('reports a refused http subresource, with an empty directive when none is given', () => {
    dispatchTrusted(document.body, cspEvent('http://plain.example/app.js'))

    expect(send).toHaveBeenCalledWith(CSP_CHANNEL, {
      blockedURI: 'http://plain.example/app.js',
      effectiveDirective: ''
    })
  })

  it('still reports when the page stops the event at its target (capture phase)', () => {
    const widget = mount('<div id="widget"></div>', '#widget')
    widget.addEventListener('securitypolicyviolation', (event) => event.stopPropagation())

    dispatchTrusted(widget, cspEvent('https://hidden.example/lib.js', 'script-src-elem'))

    expect(send).toHaveBeenCalledWith(CSP_CHANNEL, {
      blockedURI: 'https://hidden.example/lib.js',
      effectiveDirective: 'script-src-elem'
    })
  })

  it.each(['inline', 'eval', 'wasm-eval', 'trusted-types-sink', 'data', 'data:image/png;base64,AAAA', ''])(
    'reports nothing for the non-host URI %j',
    (blockedURI) => {
      dispatchTrusted(document.body, cspEvent(blockedURI, 'script-src'))

      expect(send).not.toHaveBeenCalled()
    }
  )

  it('reports nothing for a violation the page forged (untrusted)', () => {
    document.body.dispatchEvent(cspEvent('https://never-referenced.example/', 'img-src'))

    expect(send).not.toHaveBeenCalled()
  })
})
