// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Child frames ↔ `<iframe>` elements, and the click-shields over frames that
 * cannot take comments (docs/designs/html-preview-comments.md §6 "Frames",
 * §19 R3-3, R3-4; J-017).
 *
 * jsdom gives every `<iframe>` a real `contentWindow` but does not index them
 * on `window` (`window[0]` is undefined there). Chromium indexes child frames
 * in CREATION order, the same order as `WebFrameMain.frames` (spike S8), so
 * `exposeFrames` defines `window.length` and `window[i]` in the order a test
 * says the frames were created – which is what makes DOM order and frame
 * order differ, the case J-017 is about.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMMENT_HELLO_CHANNEL, HELLO_REPEAT_MAX, HELLO_REPEAT_MIN_MS, TOKEN_ATTRIBUTE } from './constants'
import { ANNOUNCE } from './controller'
import { EMPTY_FRAME_MAP, iframeOfKey, iframeSuffix, isShielded, mapChildFrames, shieldsOf } from './frames'
import { byId, createHarness, microtasks, mount, token, userMouse, type Harness } from './__test-helpers__/harness'
import { installBrowserDoubles } from './__test-helpers__/browserDoubles'

const LENGTH = Object.getOwnPropertyDescriptor(window, 'length') as PropertyDescriptor
let exposed = 0

/** Index `frames` on `window` in this (creation) order. */
function exposeFrames(frames: readonly HTMLIFrameElement[]): void {
  Object.defineProperty(window, 'length', { configurable: true, get: () => frames.length })
  frames.forEach((frame, index) => {
    Object.defineProperty(window, String(index), { configurable: true, get: () => frame.contentWindow })
  })
  exposed = Math.max(exposed, frames.length)
}

function frame(id: string, attributes = ''): HTMLIFrameElement {
  document.body.insertAdjacentHTML('beforeend', `<iframe id="${id}" ${attributes}></iframe>`)
  return byId(id) as HTMLIFrameElement
}

afterEach(() => {
  Object.defineProperty(window, 'length', LENGTH)
  for (let i = 0; i < exposed; i += 1) delete (window as unknown as Record<string, unknown>)[String(i)]
  exposed = 0
  document.body.innerHTML = ''
})

describe('mapChildFrames (J-017)', () => {
  it('J-017 maps child i to the <iframe> whose window is window[i], not to the i-th <iframe> in the DOM', () => {
    const a = frame('a', 'src="https://preview.erfana/a.html"')
    const b = frame('b', 'src="https://preview.erfana/b.html"')
    // A script adds a third frame and puts it FIRST in the DOM; it is still
    // the third child frame Chromium created.
    const added = document.createElement('iframe')
    added.id = 'added'
    document.body.prepend(added)
    exposeFrames([a, b, added])

    const map = mapChildFrames(window, document, [
      { key: 'k-a', commentable: true },
      { key: 'k-b', commentable: false },
      { key: 'k-added', commentable: true }
    ])
    expect(map.mismatch).toBe(false)
    expect(iframeOfKey(map, 'k-a')).toBe(a)
    expect(iframeOfKey(map, 'k-b')).toBe(b)
    expect(iframeOfKey(map, 'k-added')).toBe(added)
    expect(iframeOfKey(map, 'k-none')).toBeUndefined()
  })

  it('J-017 keeps the mapping when the page moves an iframe within the DOM', () => {
    const a = frame('a')
    const b = frame('b')
    exposeFrames([a, b])
    document.body.append(a)
    expect([...document.querySelectorAll('iframe')]).toEqual([b, a])
    const map = mapChildFrames(window, document, [
      { key: 'k-a', commentable: true },
      { key: 'k-b', commentable: true }
    ])
    expect(iframeOfKey(map, 'k-a')).toBe(a)
    expect(iframeOfKey(map, 'k-b')).toBe(b)
  })

  it('J-017 maps nothing – every frame shielded – when main’s count and window.length differ', () => {
    const a = frame('a')
    const b = frame('b')
    exposeFrames([a, b])
    const map = mapChildFrames(window, document, [{ key: 'k-a', commentable: true }])
    expect(map.mismatch).toBe(true)
    expect(map.byElement.size).toBe(0)
    expect(isShielded(map, a)).toBe(true)
    expect(isShielded(map, b)).toBe(true)
  })

  it('has no map before main sends a frame list, and skips a window with no <iframe> here', () => {
    expect(mapChildFrames(window, document, undefined)).toBe(EMPTY_FRAME_MAP)
    const a = frame('a')
    exposeFrames([a])
    Object.defineProperty(window, '0', { configurable: true, get: () => ({}) })
    const map = mapChildFrames(window, document, [{ key: 'k', commentable: true }])
    expect(map).toEqual({ byElement: new Map(), mismatch: false })
  })
})

describe('inline frames and <frame> elements (L6)', () => {
  it('L6 shields an inline frame even when main’s list says it is commentable', () => {
    const inline = [frame('srcdoc', 'srcdoc="<p>x</p>"'), frame('blank', 'src="about:blank"'), frame('js', 'src="javascript:void 0"'), frame('none')]
    exposeFrames(inline)
    const map = mapChildFrames(window, document, inline.map((_, i) => ({ key: `k-${i}`, commentable: true })))
    for (const element of inline) {
      expect(isShielded(map, element), element.id).toBe(true)
      expect(iframeSuffix(map, element)).toEqual({ kind: 'inline-frame' })
    }
  })

  it('L6 shields a project frame the page navigated to about:blank, keeping its src (a stale list)', () => {
    const mine = frame('mine', 'src="https://preview.erfana/mine.html"')
    exposeFrames([mine])
    const map = mapChildFrames(window, document, [{ key: 'k-mine', commentable: true }])
    expect(isShielded(map, mine)).toBe(false)
    // Same window, same `src`; the document it shows is now the parent's own.
    Object.defineProperty(mine, 'contentDocument', { configurable: true, get: () => ({ URL: 'about:blank' }) })
    expect(isShielded(map, mine)).toBe(true)
    expect(iframeSuffix(map, mine)).toEqual({ kind: 'inline-frame' })
    // A cross-origin document reads as null: main's list decides.
    Object.defineProperty(mine, 'contentDocument', { configurable: true, get: () => null })
    expect(isShielded(map, mine)).toBe(false)
  })

  it('L6 maps and shields <frame> elements too (a <frameset> page)', () => {
    const set = document.createElement('frameset')
    const kept = document.createElement('frame')
    kept.src = 'https://preview.erfana/kept.html'
    const refused = document.createElement('frame')
    refused.src = 'https://cdn.example/x.html'
    set.append(kept, refused)
    document.body.append(set)
    Object.defineProperty(window, 'length', { configurable: true, get: () => 2 })
    Object.defineProperty(window, '0', { configurable: true, get: () => kept.contentWindow })
    Object.defineProperty(window, '1', { configurable: true, get: () => refused.contentWindow })
    exposed = 2
    const map = mapChildFrames(window, document, [
      { key: 'k-kept', commentable: true },
      { key: 'k-refused', commentable: false }
    ])
    expect(iframeOfKey(map, 'k-kept')).toBe(kept)
    expect(isShielded(map, kept)).toBe(false)
    expect(isShielded(map, refused)).toBe(true)
    expect(iframeSuffix(map, kept)).toEqual({ kind: 'frame', file: 'kept.html' })
  })

  it('shields only rendered frames on screen', () => {
    const doubles = installBrowserDoubles()
    try {
      const shown = frame('shown')
      const off = frame('off')
      const hidden = frame('hidden')
      doubles.setBox(shown, { left: 0, top: 0, width: 100, height: 100 })
      doubles.setBox(off, { left: 0, top: 5_000, width: 100, height: 100 })
      doubles.setBox(hidden, { left: 0, top: 0, width: 100, height: 100 })
      doubles.setVisible(hidden, false)
      const shields = shieldsOf(document, EMPTY_FRAME_MAP, { width: 800, height: 600 })
      expect(shields.map(s => s.frame)).toEqual([shown])
    } finally {
      doubles.restore()
    }
  })
})

describe('frame labels and shields', () => {
  it('names a commentable frame’s file, and says why another one cannot take comments', () => {
    const file = frame('file', 'src="https://preview.erfana/docs/other%20page.html?x=1#y"')
    const refused = frame('refused', 'src="https://cdn.example/widget.html"')
    const inline = [
      frame('srcdoc', 'srcdoc="<p>x</p>"'),
      frame('blank', 'src="about:blank"'),
      frame('js', 'src="javascript:void 0"'),
      frame('none')
    ]
    exposeFrames([file, refused, ...inline])
    const map = mapChildFrames(window, document, [
      { key: 'k-file', commentable: true },
      { key: 'k-refused', commentable: false },
      ...inline.map((_, i) => ({ key: `k-${i}`, commentable: false }))
    ])
    expect(isShielded(map, file)).toBe(false)
    expect(iframeSuffix(map, file)).toEqual({ kind: 'frame', file: 'other page.html' })
    expect(iframeSuffix(map, refused)).toEqual({ kind: 'refused-frame' })
    for (const element of inline) expect(iframeSuffix(map, element)).toEqual({ kind: 'inline-frame' })
  })
})

describe('frames in the controller (J-017)', () => {
  let h: Harness
  const T = TOKEN_ATTRIBUTE

  beforeEach(async () => {
    h = createHarness()
    mount(
      [
        `<iframe id="mine" src="https://preview.erfana/mine.html" ${T}="${token(1)}"></iframe>`,
        `<iframe id="theirs" src="https://cdn.example/x.html" ${T}="${token(2)}"></iframe>`
      ].join(''),
      {
        mine: { left: 0, top: 0, width: 400, height: 200 },
        theirs: { left: 0, top: 300, width: 400, height: 200 }
      },
      h.doubles
    )
    h.doubles.setBox(document.body, { left: 0, top: 0, width: 800, height: 600 })
    await microtasks()
    h.controller.documentReady()
    h.send.mockClear()
  })

  afterEach(() => {
    h.dispose()
  })

  const shields = (): number => h.root()?.querySelector('.erf-hpc-shields')?.children.length ?? 0
  const hellos = (): number => h.sent(COMMENT_HELLO_CHANNEL).length
  const childFrames = [
    { key: 'k-mine', commentable: true },
    { key: 'k-theirs', commentable: false }
  ]

  it('J-017 shields only the frame that cannot take comments, and only in comment mode', () => {
    exposeFrames([byId('mine') as HTMLIFrameElement, byId('theirs') as HTMLIFrameElement])
    h.state({ mode: true, childFrames })
    expect(shields()).toBe(1)
    userMouse(h.host() as HTMLElement, 'click', { x: 10, y: 310, button: 0 })
    expect(h.sent('preview-page:commentPick')).toEqual([expect.objectContaining({ kind: 'open', token: token(2) })])
    h.state({ mode: false, childFrames })
    expect(shields()).toBe(0)
    expect(hellos()).toBe(0)
  })

  it('draws no shield for a frame scrolled out of the viewport', () => {
    exposeFrames([byId('mine') as HTMLIFrameElement, byId('theirs') as HTMLIFrameElement])
    h.doubles.setBox(byId('theirs'), { left: 0, top: 5_000, width: 400, height: 200 })
    h.state({ mode: true, childFrames })
    expect(shields()).toBe(0)
  })

  it('J-017 a script-added frame the list does not hold yet: shield all, ask main again – at most once a second', () => {
    const mine = byId('mine') as HTMLIFrameElement
    const theirs = byId('theirs') as HTMLIFrameElement
    const added = document.createElement('iframe')
    added.src = 'https://preview.erfana/added.html'
    document.body.prepend(added)
    h.doubles.setBox(added, { left: 500, top: 0, width: 100, height: 100 })
    exposeFrames([mine, theirs, added])

    h.state({ mode: true, childFrames })
    expect(shields()).toBe(3)
    expect(hellos()).toBe(1)
    h.controller.renderNow()
    expect(hellos()).toBe(1)
    h.clock.now += HELLO_REPEAT_MIN_MS
    h.controller.renderNow()
    expect(hellos()).toBe(2)

    // Main answers with the new frame: mapped, and the page's own frame is commentable again.
    h.state({ mode: true, childFrames: [...childFrames, { key: 'k-added', commentable: true }] })
    expect(shields()).toBe(1)
    expect(hellos()).toBe(2)
  })

  it(`stops asking after ${HELLO_REPEAT_MAX} repeats in one document`, () => {
    exposeFrames([byId('mine') as HTMLIFrameElement, byId('theirs') as HTMLIFrameElement])
    h.state({ mode: true, childFrames: [childFrames[0]] })
    for (let i = 0; i < HELLO_REPEAT_MAX * 2; i += 1) {
      h.clock.now += HELLO_REPEAT_MIN_MS
      h.controller.renderNow()
    }
    expect(hellos()).toBe(HELLO_REPEAT_MAX)
  })

  it('J-017 focusFrame moves the keyboard picker to that child’s <iframe> (Alt+↑ out of a frame)', () => {
    exposeFrames([byId('mine') as HTMLIFrameElement, byId('theirs') as HTMLIFrameElement])
    h.state({ mode: true, childFrames })
    h.state({ mode: true, childFrames, focusFrame: 'k-mine' })
    expect(h.root()?.querySelector('[role="status"]')?.textContent).toBe(ANNOUNCE.showing('iframe#mine · frame mine.html'))
    // A key main no longer knows moves nothing.
    h.state({ mode: true, childFrames, focusFrame: 'k-gone' })
    expect(h.root()?.querySelector('.erf-hpc-label')?.textContent).toBe('iframe#mine · frame mine.html400×200')
  })
})
