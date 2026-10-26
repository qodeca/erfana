// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a pick says (docs/designs/html-preview-comments.md §5.3, §6, §8,
 * decisions 16–17 and 34, §19 R3-5, R3-8; J-007, J-008, SEC-05, SEC-06).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PICKS_PER_SECOND, PICK_BOX_MAX_PX, SNAPSHOT_MAX_BYTES, TOKEN_ATTRIBUTE } from './constants'
import { pathBelow, quoteOf, resolvePath, snapshotOf, whiteSpaceOf } from './domPath'
import { boxOfElement, describeTarget, elementPoint, PickLimiter, screenOf, viewOf } from './picks'
import { TokenRegistry } from './tokens'
import { microtasks, token } from './__test-helpers__/harness'

let registry: TokenRegistry

/** Serve `html` with tokens, then build the rest by script after the window closed. */
async function page(html: string): Promise<void> {
  document.body.innerHTML = html
  await microtasks()
  registry.closeWindow()
}

beforeEach(() => {
  registry = new TokenRegistry(document, true)
  registry.start()
})

afterEach(() => {
  registry.stop()
  document.body.innerHTML = ''
})

const byId = (id: string): Element => document.getElementById(id) as Element
/** jsdom lays nothing out: every box is empty. */
const NO_BOX = { x: 0, y: 0, w: 0, h: 0 }

describe('describeTarget (J-007)', () => {
  it('sends only the token for an element that is in the file', async () => {
    await page(`<button id="cta" ${TOKEN_ATTRIBUTE}="${token(1)}">Buy</button>`)
    expect(describeTarget(registry, byId('cta'))).toEqual({ token: token(1), tag: 'button', ws: 'preserve', box: NO_BOX })
  })

  it('J-007 describes a JS-built element below its nearest tokened ancestor', async () => {
    await page(`<ul id="list" ${TOKEN_ATTRIBUTE}="${token(2)}"><li>one</li></ul>`)
    const list = byId('list')
    list.insertAdjacentHTML('beforeend', '<li>two</li><li id="built">three <b>bold</b></li>')
    const target = describeTarget(registry, byId('built'))
    expect(target).toEqual({
      token: token(2),
      tag: 'ul',
      ws: 'preserve',
      box: NO_BOX,
      runtime: {
        path: 'li:nth-of-type(3)',
        tag: 'li',
        // textContent joins the items' text with no separator.
        quote: { exact: 'three bold', prefix: 'onetwo', suffix: '' },
        snapshot: '<li id="built">three <b>bold</b></li>'
      }
    })
    expect(resolvePath(list, target.runtime?.path ?? '')).toBe(byId('built'))
  })

  it('flags a runtime snapshot it had to cut', async () => {
    await page(`<div id="host" ${TOKEN_ATTRIBUTE}="${token(4)}"></div>`)
    const built = document.createElement('pre')
    built.textContent = 'x'.repeat(SNAPSHOT_MAX_BYTES)
    byId('host').append(built)
    const runtime = describeTarget(registry, built).runtime
    expect(runtime?.truncated).toBe(true)
    expect(new TextEncoder().encode(runtime?.snapshot).length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
  })

  it('sends no token when no ancestor has one (a page served raw)', async () => {
    await page('<p id="raw">raw</p>')
    expect(describeTarget(registry, byId('raw'))).toEqual({})
  })

  it('falls back to the ancestor alone when the path or tag is too long to describe', async () => {
    await page(`<div id="root" ${TOKEN_ATTRIBUTE}="${token(3)}"></div>`)
    let cur = byId('root')
    for (let i = 0; i < 60; i += 1) {
      const next = document.createElement('section')
      cur.append(next)
      cur = next
    }
    const ancestorOnly = { token: token(3), tag: 'div', ws: 'preserve', box: NO_BOX }
    expect(describeTarget(registry, cur)).toEqual(ancestorOnly)
    const long = document.createElement(`x-${'y'.repeat(40)}`)
    byId('root').append(long)
    expect(describeTarget(registry, long)).toEqual(ancestorOnly)
    // A name main's schema would refuse is not described either.
    const odd = document.createElementNS('http://www.w3.org/1999/xhtml', 'x-é')
    byId('root').append(odd)
    expect(describeTarget(registry, odd)).toEqual(ancestorOnly)
  })

  it('J-007 strips nested erfana blocks and token attributes from the snapshot, keeping other comments', () => {
    document.body.innerHTML =
      '<div id="s"><!-- erfana:comment v1 id=c-x\nstatus: open\n--><p>kept</p><!-- an ordinary note --></div>'
    byId('s').setAttribute(TOKEN_ATTRIBUTE, 'abcdefabcdef')
    const { snapshot, truncated } = snapshotOf(byId('s'))
    expect(snapshot).toBe('<div id="s"><p>kept</p><!-- an ordinary note --></div>')
    expect(truncated).toBe(false)
  })

  it('drops an unterminated block to the end', () => {
    const el = document.createElement('div')
    el.append(document.createComment(' erfana:comment v1 id=c-x'))
    expect(snapshotOf(el).snapshot).toBe('<div></div>')
  })

  it(`cuts a snapshot over ${SNAPSHOT_MAX_BYTES} bytes on a code point, never ending in -`, () => {
    const el = document.createElement('pre')
    // 3-byte characters, then a run of dashes right at the cut.
    el.textContent = `${'€'.repeat((SNAPSHOT_MAX_BYTES - 6) / 3)}----------`
    const { snapshot, truncated } = snapshotOf(el)
    expect(truncated).toBe(true)
    expect(new TextEncoder().encode(snapshot).length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES)
    expect(snapshot.endsWith('-')).toBe(false)
    expect(snapshot.startsWith('<pre>€')).toBe(true)
  })

  it('quotes nothing for an element without text, and cuts long text and context', () => {
    document.body.innerHTML = `<div id="scope">${'a '.repeat(100)}<i id="empty"></i><b id="long">${'z'.repeat(300)}</b>${'😀'.repeat(40)}</div>`
    expect(quoteOf(byId('scope'), byId('empty'))).toBeUndefined()
    const quote = quoteOf(byId('scope'), byId('long'))
    expect(quote?.exact).toHaveLength(200)
    expect(quote?.prefix.length).toBeLessThanOrEqual(32)
    expect([...(quote?.suffix ?? '')].every(ch => ch === '😀')).toBe(true)
  })

  it('cuts a quote without splitting a surrogate pair', () => {
    document.body.innerHTML = `<div id="scope">${'😀'.repeat(20)}<b id="t">${'x'.repeat(199)}😀😀</b></div>`
    const quote = quoteOf(byId('scope'), byId('t'))
    expect(quote?.exact).toBe('x'.repeat(199))
    expect([...(quote?.prefix ?? '')].every(ch => ch === '😀')).toBe(true)
  })
})

describe('paths and white space', () => {
  it('builds and resolves a nested path, and refuses a non-descendant or a malformed one', () => {
    document.body.innerHTML = '<main id="m"><p></p><div><p></p><p id="t"></p></div></main><aside id="x"></aside>'
    expect(pathBelow(byId('m'), byId('t'))).toBe('div:nth-of-type(1) > p:nth-of-type(2)')
    expect(pathBelow(byId('m'), byId('m'))).toBe('')
    expect(pathBelow(byId('m'), byId('x'))).toBeUndefined()
    expect(resolvePath(byId('m'), '')).toBe(byId('m'))
    expect(resolvePath(byId('m'), 'div')).toBeUndefined()
    expect(resolvePath(byId('m'), 'div:nth-of-type(2) > p:nth-of-type(1)')).toBeUndefined()
  })

  it('R3-8 reports collapse only when the anchor’s parent collapses white space', () => {
    document.body.innerHTML = '<div id="p"><span id="a"></span></div>'
    const style = (collapse: string, whiteSpace: string) => () =>
      ({ getPropertyValue: (name: string) => (name === 'white-space-collapse' ? collapse : whiteSpace) }) as never
    const real = window.getComputedStyle
    try {
      window.getComputedStyle = style('collapse', '')
      expect(whiteSpaceOf(byId('a'))).toBe('collapse')
      window.getComputedStyle = style('preserve-breaks', '')
      expect(whiteSpaceOf(byId('a'))).toBe('preserve')
      window.getComputedStyle = style('', 'nowrap')
      expect(whiteSpaceOf(byId('a'))).toBe('collapse')
      window.getComputedStyle = style('', 'pre-wrap')
      expect(whiteSpaceOf(byId('a'))).toBe('preserve')
    } finally {
      window.getComputedStyle = real
    }
    expect(whiteSpaceOf(document.documentElement)).toBe('preserve')
    const orphan = document.implementation.createHTMLDocument('x').createElement('div')
    orphan.append(document.implementation.createHTMLDocument('y').createElement('span'))
    const detachedDoc = document.implementation.createDocument(null, 'root', null)
    const child = detachedDoc.createElement('child')
    detachedDoc.documentElement.append(child)
    expect(whiteSpaceOf(child)).toBe('preserve')
  })
})

describe('the tag and box main checks (R3-13 L5, R3-6)', () => {
  it('L5 names the tokened element itself, not the JS-built one below it', async () => {
    await page(`<section id="s" ${TOKEN_ATTRIBUTE}="${token(5)}"><p id="p">x</p></section>`)
    const built = document.createElement('span')
    byId('s').append(built)
    expect(describeTarget(registry, built)).toMatchObject({ token: token(5), tag: 'section', runtime: { tag: 'span' } })
  })

  it('L5 leaves out an own tag main would refuse, so main refuses the pick', async () => {
    await page(`<x-é id="odd" ${TOKEN_ATTRIBUTE}="${token(6)}"></x-é>`)
    expect(byId('odd').localName).toBe('x-é')
    expect(describeTarget(registry, byId('odd'))).toEqual({ token: token(6), ws: 'preserve', box: NO_BOX })
  })

  it('R3-6 sends the picked element’s border box, rounded and bounded', async () => {
    await page(`<div id="d" ${TOKEN_ATTRIBUTE}="${token(7)}"></div>`)
    const el = byId('d')
    el.getBoundingClientRect = () =>
      ({ left: 10.4, top: -5.6, width: 3e7, height: Number.NaN }) as DOMRect
    expect(boxOfElement(el)).toEqual({ x: 10, y: -6, w: PICK_BOX_MAX_PX, h: 0 })
    el.getBoundingClientRect = () => ({ left: -3e7, top: 0, width: -4, height: 2 }) as DOMRect
    expect(boxOfElement(el)).toEqual({ x: -PICK_BOX_MAX_PX, y: 0, w: 0, h: 2 })
  })
})

describe('the pick payload (J-008, SEC-05)', () => {
  it('J-008 leaves the isolated world as enums, a token and finite numbers only', async () => {
    await page(`<button id="cta" ${TOKEN_ATTRIBUTE}="${token(1)}">Buy</button>`)
    const payload = {
      kind: 'menu',
      via: 'pointer',
      ...describeTarget(registry, byId('cta')),
      screen: screenOf({ screenX: 10.6, screenY: Number.NaN } as MouseEvent),
      view: viewOf(window)
    }
    // A structured clone keeps nothing but plain data: no element, no function.
    const cloned = structuredClone(payload)
    expect(cloned).toEqual(payload)
    expect(Object.keys(payload).sort()).toEqual(['box', 'kind', 'screen', 'tag', 'token', 'via', 'view', 'ws'])
    expect(payload.screen).toEqual({ x: 11, y: 0 })
    for (const value of Object.values(payload.view)) expect(Number.isFinite(value)).toBe(true)
  })

  it('SEC-05 never carries a file path, an offset or an element', async () => {
    await page(`<div id="d" ${TOKEN_ATTRIBUTE}="${token(1)}"></div>`)
    byId('d').append(document.createElement('span'))
    const target = describeTarget(registry, byId('d').firstElementChild as Element)
    const text = JSON.stringify(target)
    expect(text).not.toMatch(/offset|realPath|file:|erfana-preview:/)
    expect(Object.keys(target).sort()).toEqual(['box', 'runtime', 'tag', 'token', 'ws'])
    expect(Object.keys(target.runtime ?? {}).sort()).toEqual(['path', 'snapshot', 'tag'])
  })

  it('reports the view, with the hash only when it fits', () => {
    const view = viewOf(window)
    expect(view).toEqual({ w: window.innerWidth, h: window.innerHeight, dpr: 1, x: 0, y: 0 })
    const fake = {
      innerWidth: 800.4,
      innerHeight: Number.POSITIVE_INFINITY,
      devicePixelRatio: Number.NaN,
      scrollX: 10,
      scrollY: 20,
      location: { hash: '#slide-3' }
    } as unknown as Window
    expect(viewOf(fake)).toEqual({ w: 800, h: 0, dpr: 1, x: 10, y: 20, hash: '#slide-3' })
    const longHash = { ...fake, location: { hash: `#${'x'.repeat(600)}` } } as unknown as Window
    expect(viewOf(longHash).hash).toBeUndefined()
  })

  it('places a keyboard pick at the element’s top-left + 4 px', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ left: 10.2, top: 20.7 }) as DOMRect
    expect(elementPoint(el)).toEqual({ x: 14, y: 25 })
  })
})

describe('PickLimiter (SEC-06)', () => {
  it(`SEC-06 1,000 picks in one second → at most ${PICKS_PER_SECOND} pass, the rest counted`, () => {
    let now = 0
    const limiter = new PickLimiter(() => now)
    let passed = 0
    for (let i = 0; i < 1_000; i += 1) {
      now = i // 1,000 picks across 1,000 ms
      if (limiter.tryTake()) passed += 1
    }
    expect(passed).toBe(PICKS_PER_SECOND)
    expect(limiter.dropped).toBe(1_000 - PICKS_PER_SECOND)

    // A burst at one instant: exactly the bucket.
    const burst = new PickLimiter(() => 5_000)
    const accepted = Array.from({ length: 1_000 }, () => burst.tryTake()).filter(Boolean).length
    expect(accepted).toBe(PICKS_PER_SECOND)
  })

  it('refills over time', () => {
    let now = 0
    const limiter = new PickLimiter(() => now)
    for (let i = 0; i < PICKS_PER_SECOND; i += 1) limiter.tryTake()
    expect(limiter.tryTake()).toBe(false)
    now = 1_000
    expect(limiter.tryTake()).toBe(true)
  })
})
