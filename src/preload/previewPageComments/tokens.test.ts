// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Token capture and strip (docs/designs/comments/html-preview-comments.md §6, §19
 * R3-2; J-011, SEC-04, SEC-26, SEC-30).
 *
 * jsdom has no HTML parser feeding a live document, so "parser-inserted"
 * nodes are appended one by one, the way Chromium's parser inserts them, and
 * a "later inline script" is code that runs after the next microtask
 * checkpoint – which Chromium runs before every parser-blocking script. The
 * real-Chromium check is e2e/html-preview-comments-preload.e2e.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOKENS_PER_DOCUMENT, TOKEN_ATTRIBUTE } from './constants'
import { TokenRegistry } from './tokens'
import { microtasks, token } from './__test-helpers__/harness'

const TOKENED = `[${TOKEN_ATTRIBUTE}]`

/** An element with `id` and the served token attribute. */
function served(tag: string, id: string, value: string): HTMLElement {
  const el = document.createElement(tag)
  el.id = id
  el.setAttribute(TOKEN_ATTRIBUTE, value)
  return el
}

let registry: TokenRegistry

beforeEach(() => {
  registry = new TokenRegistry(document, true)
  registry.start()
})

afterEach(() => {
  registry.stop()
  document.body.innerHTML = ''
})

describe('TokenRegistry – capture and strip', () => {
  it('J-011 strips every token before a later inline script runs, and maps each element', async () => {
    const a = served('main', 'a', token(1))
    const b = served('p', 'b', token(2))
    document.body.append(a)
    a.append(b)
    // The microtask checkpoint before a parser-blocking script.
    await microtasks()
    const seenByScript = document.querySelectorAll(TOKENED).length

    expect(seenByScript).toBe(0)
    expect(registry.tokenOf(a)).toBe(token(1))
    expect(registry.elementOf(token(2))).toBe(b)
    expect(registry.size).toBe(2)
  })

  it('takes a subtree a script inserted in one go, and tokens already in the document', async () => {
    document.body.innerHTML = `<div id="pre" ${TOKEN_ATTRIBUTE}="${token(9)}"></div>`
    const late = new TokenRegistry(document, true)
    late.start()
    expect(late.tokenOf(document.getElementById('pre') as Element)).toBe(token(9))
    late.stop()

    const wrapper = document.createElement('section')
    wrapper.innerHTML = `<ul ${TOKEN_ATTRIBUTE}="${token(3)}"><li id="li" ${TOKEN_ATTRIBUTE}="${token(4)}">x</li></ul>`
    document.body.append(wrapper)
    await microtasks()
    expect(registry.elementOf(token(4))).toBe(document.getElementById('li'))
    expect(document.querySelectorAll(TOKENED)).toHaveLength(0)
  })

  it('strips a malformed value without mapping it', async () => {
    document.body.append(served('div', 'bad', 'NOT-A-TOKEN'))
    await microtasks()
    expect(document.getElementById('bad')?.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false)
    expect(registry.size).toBe(0)
  })

  it('finds the nearest tokened ancestor, and nothing above an untokened root', async () => {
    const card = served('article', 'card', token(5))
    document.body.append(card)
    await microtasks()
    const built = document.createElement('span')
    card.append(built)
    expect(registry.nearestTokened(built)).toEqual({ element: card, token: token(5) })
    expect(registry.nearestTokened(card)).toEqual({ element: card, token: token(5) })
    expect(registry.nearestTokened(document.body)).toBeUndefined()
  })

  it('forgets an element that left the document', async () => {
    const gone = served('div', 'gone', token(6))
    document.body.append(gone)
    await microtasks()
    gone.remove()
    expect(registry.elementOf(token(6))).toBeUndefined()
  })

  it(`stops mapping past ${MAX_TOKENS_PER_DOCUMENT} tokens`, async () => {
    // Only the capped registry watches: the shared one would strip first.
    registry.stop()
    const capped = new TokenRegistry(document, true)
    // Reach the cap without building that many nodes: fill the private map.
    const internals = capped as unknown as { byToken: Map<string, WeakRef<Element>> }
    for (let i = 0; i < MAX_TOKENS_PER_DOCUMENT; i += 1) internals.byToken.set(`k${i}`, new WeakRef(document.body))
    capped.start()
    document.body.append(served('div', 'over', token(7)))
    await microtasks()
    expect(capped.elementOf(token(7))).toBeUndefined()
    expect(document.getElementById('over')?.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false)
    capped.stop()
  })
})

describe('TokenRegistry – the token rule (R3-2)', () => {
  it('SEC-26 accepts a token only on its first sighting before DOMContentLoaded', async () => {
    const early = served('div', 'early', token(1))
    document.body.append(early)
    await microtasks()
    // The parser's last batch is still queued when the event fires.
    const last = served('div', 'last', token(2))
    document.body.append(last)
    registry.closeWindow()
    expect(registry.isAccepting).toBe(false)
    expect(registry.tokenOf(last)).toBe(token(2))

    // After the window: a script-created node with a token copied from a
    // fetch response (or read by an observer) is ignored – and no longer
    // even stripped: the observer stopped with the window (L9).
    const scripted = served('div', 'scripted', token(3))
    document.body.append(scripted)
    const replay = served('div', 'replay', token(1))
    document.body.append(replay)
    await microtasks()
    expect(registry.tokenOf(scripted)).toBeUndefined()
    expect(registry.elementOf(token(3))).toBeUndefined()
    expect(registry.tokenOf(replay)).toBeUndefined()
    // …and cannot void the element that really carries it.
    expect(registry.elementOf(token(1))).toBe(early)
    expect([...document.querySelectorAll(TOKENED)]).toEqual([scripted, replay])
  })

  it('L9 stops observing when the window closes – later mutations cost nothing', async () => {
    const early = served('div', 'early', token(1))
    document.body.append(early)
    await microtasks()
    const observed = vi.spyOn(MutationObserver.prototype, 'disconnect')
    registry.closeWindow()
    expect(observed).toHaveBeenCalledTimes(1)
    observed.mockRestore()
    // A later mutation is not seen at all: its token stays where the page put it.
    early.setAttribute(TOKEN_ATTRIBUTE, token(2))
    await microtasks()
    expect(early.getAttribute(TOKEN_ATTRIBUTE)).toBe(token(2))
    expect(registry.tokenOf(early)).toBe(token(1))
    expect(registry.elementOf(token(2))).toBeUndefined()
  })

  it('SEC-30 voids a token seen on two elements in one load – neither is mapped', async () => {
    // A component that copies its attributes onto an inner node (S1c).
    const outer = served('x-copy', 'outer', token(4))
    document.body.append(outer)
    outer.append(served('span', 'inner', token(4)))
    await microtasks()
    expect(registry.tokenOf(outer)).toBeUndefined()
    expect(registry.elementOf(token(4))).toBeUndefined()
    expect(document.querySelectorAll(TOKENED)).toHaveLength(0)

    // A third sighting stays void.
    document.body.append(served('b', 'third', token(4)))
    await microtasks()
    expect(registry.elementOf(token(4))).toBeUndefined()
  })

  it('SEC-30 voids both tokens of an element that shows a second one', async () => {
    const el = served('div', 'el', token(5))
    document.body.append(el)
    await microtasks()
    el.setAttribute(TOKEN_ATTRIBUTE, token(6))
    await microtasks()
    expect(registry.tokenOf(el)).toBeUndefined()
    expect(registry.elementOf(token(5))).toBeUndefined()
    expect(registry.elementOf(token(6))).toBeUndefined()
  })

  it('keeps the mapping when the same element shows its own token again', async () => {
    const el = served('div', 'el', token(8))
    document.body.append(el)
    await microtasks()
    el.setAttribute(TOKEN_ATTRIBUTE, token(8))
    await microtasks()
    expect(registry.elementOf(token(8))).toBe(el)
    expect(el.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false)
  })

  it('SEC-04 a page that rewrites or forges tokens after load names nothing', async () => {
    const real = served('button', 'real', token(1))
    const other = served('p', 'other', token(2))
    document.body.append(real, other)
    await microtasks()
    registry.closeWindow()

    // Swap: the page puts the button's token on the paragraph, and a made-up
    // one on the button.
    other.setAttribute(TOKEN_ATTRIBUTE, token(1))
    real.setAttribute(TOKEN_ATTRIBUTE, token(99))
    await microtasks()

    expect(registry.tokenOf(other)).toBe(token(2))
    expect(registry.tokenOf(real)).toBe(token(1))
    expect(registry.elementOf(token(99))).toBeUndefined()
    // Left in place, read by nothing.
    expect(document.querySelectorAll(TOKENED)).toHaveLength(2)
  })

  it('accepts nothing when it starts after the parse', async () => {
    const late = new TokenRegistry(document, false)
    late.start()
    document.body.append(served('div', 'late', token(1)))
    await microtasks()
    expect(late.size).toBe(0)
    late.stop()
    late.stop()
    late.closeWindow()
  })

  it('starts before <html> exists (the preload runs at document start) and takes what the parser adds', async () => {
    const parsing = document.implementation.createHTMLDocument('')
    parsing.removeChild(parsing.documentElement)
    const early = new TokenRegistry(parsing, true)
    early.start()
    const html = parsing.createElement('html')
    parsing.append(html)
    const body = parsing.createElement('body')
    html.append(body)
    body.append(parsing.createTextNode('text first'))
    const el = parsing.createElement('p')
    el.setAttribute(TOKEN_ATTRIBUTE, token(11))
    body.append(el)
    await microtasks()
    expect(early.elementOf(token(11))).toBe(el)
    expect(el.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false)
    early.stop()
  })

  it('starts once', () => {
    registry.start()
    expect(registry.isAccepting).toBe(true)
  })
})
