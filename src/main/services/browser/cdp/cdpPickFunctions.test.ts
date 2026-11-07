// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// @vitest-environment jsdom
/**
 * The pinned pick functions run for real, against a jsdom document. Each
 * source is a string the page runs, so nothing else in the suite would execute
 * it; `new Function` turns it into a function to call with the element as
 * `this`, as `Runtime.callFunctionOn` does.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { CDP_PAGE_FUNCTIONS, type CdpPageFunction } from './cdpPinned'
import {
  COMPUTED_STYLE_NAMES,
  PICK_ANCESTOR,
  PICK_CHAIN,
  PICK_CHAIN_MAX,
  PICK_PAGE_FUNCTIONS,
  PICK_STRING_MAX,
  PICK_STYLES,
  REACT_DEBUG_STACK,
  REACT_LOOKUP,
  SOURCE_ATTRIBUTE_NAMES
} from './cdpPickFunctions'

type PageFn = (this: unknown, ...args: unknown[]) => unknown

function compile(fn: CdpPageFunction): PageFn {
  return new Function(`return (${fn.source})`)() as PageFn
}

interface ChainValue {
  chain: Array<{ tag: string; id: string; cls: string; shadow: string | null; attrs: string[][]; w: number }>
  selectors: string[]
  closed: boolean
  connected: boolean
}

const chainOf = (el: Element): ChainValue => compile(PICK_CHAIN).call(el) as ChainValue
const byId = (id: string): HTMLElement => document.getElementById(id)!

describe('pinned pick functions', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="app" class="shell">
        <ul><li>one</li><li><button id="save" class="btn primary extra more" data-source="src/Save.tsx:4" data-other="x">Save</button></li></ul>
        <div id="1st:odd.id"><span>x</span></div>
        <div class="dup"></div><div class="dup"></div>
        <section id="host"></section>
        <section id="closed-host"></section>
      </main>`
  })

  it('are all registered in the pinned registry, read-only', () => {
    expect(PICK_PAGE_FUNCTIONS).toEqual([PICK_CHAIN, PICK_ANCESTOR, PICK_STYLES, REACT_LOOKUP, REACT_DEBUG_STACK])
    for (const fn of PICK_PAGE_FUNCTIONS) {
      expect(CDP_PAGE_FUNCTIONS).toContain(fn)
      expect(fn.throwOnSideEffect).toBe(true)
      expect(() => compile(fn)).not.toThrow()
    }
  })

  describe('pickChain', () => {
    it('lists the element and its ancestors to the root element, with the source attributes only', () => {
      const value = chainOf(byId('save'))
      expect(value.chain.map((e) => e.tag)).toEqual(['button', 'li', 'ul', 'main', 'body', 'html'])
      expect(value.chain[0]).toMatchObject({ id: 'save', cls: 'btn primary extra more', shadow: null, attrs: [['data-source', 'src/Save.tsx:4']] })
      expect(value.connected).toBe(true)
      expect(value.closed).toBe(false)
      expect(SOURCE_ATTRIBUTE_NAMES).toContain('data-source')
    })

    it('builds a unique selector, stopping at an id', () => {
      expect(chainOf(byId('save')).selectors).toEqual(['button#save'])
      expect(chainOf(document.querySelectorAll('li')[0]).selectors).toEqual(['li:nth-of-type(1)'])
      expect(chainOf(document.querySelectorAll('.dup')[1]).selectors).toEqual(['div.dup:nth-of-type(3)'])
    })

    it('escapes identifiers as CSSOM does: a leading digit, a colon and a dot', () => {
      const [selector] = chainOf(byId('1st:odd.id')).selectors
      expect(selector).toBe('div#\\31 st\\:odd\\.id')
      expect(document.querySelector(selector)).toBe(byId('1st:odd.id'))
    })

    it('escapes a lone dash, a NUL, control characters and a digit after a dash', () => {
      for (const id of ['-', 'a\u0000b', 'tab\tid', '-1x', 'ünï', 'a b']) {
        const el = document.createElement('i')
        el.id = id
        document.body.append(el)
        const [selector] = chainOf(el).selectors
        expect(document.querySelector(selector), id).toBe(id.includes('\u0000') ? null : el)
      }
    })

    it('crosses an open shadow root to its host, with one selector per root', () => {
      const root = byId('host').attachShadow({ mode: 'open' })
      root.innerHTML = '<p><b id="deep">x</b></p>'
      const value = chainOf(root.getElementById('deep')!)
      expect(value.chain.map((e) => [e.tag, e.shadow])).toEqual([
        ['b', 'open'],
        ['p', 'open'],
        ['section', null],
        ['main', null],
        ['body', null],
        ['html', null]
      ])
      expect(value.selectors).toEqual(['section#host', 'b#deep'])
    })

    it('ends the selectors at a closed shadow root and says so (025-FR-033)', () => {
      const root = byId('closed-host').attachShadow({ mode: 'closed' })
      root.innerHTML = '<em id="hidden">x</em>'
      const value = chainOf(root.querySelector('em')!)
      expect(value.closed).toBe(true)
      expect(value.selectors).toEqual(['section#closed-host'])
      expect(value.chain[0].shadow).toBe('closed')
    })

    it('cuts page strings to 500 code units and reports a detached element', () => {
      const el = document.createElement('div')
      el.className = 'c'.repeat(PICK_STRING_MAX + 50)
      const value = chainOf(el)
      expect(value.chain[0].cls).toHaveLength(PICK_STRING_MAX)
      expect(value.connected).toBe(false)
      expect(PICK_CHAIN_MAX).toBe(1000)
    })
  })

  it('pickAncestor walks k steps up, crossing a shadow root to its host; null past the root', () => {
    const ancestor = compile(PICK_ANCESTOR)
    const save = byId('save')
    expect(ancestor.call(save, 0)).toBe(save)
    expect(ancestor.call(save, 2)).toBe(save.closest('ul'))
    expect(ancestor.call(save, 99)).toBeNull()
    const root = byId('host').attachShadow({ mode: 'open' })
    root.innerHTML = '<b>x</b>'
    expect(ancestor.call(root.querySelector('b'), 1)).toBe(byId('host'))
  })

  it('pickStyles reads the 41 computed styles in order and a layout chain of up to three ancestors', () => {
    const value = compile(PICK_STYLES).call(byId('save')) as { styles: string[][]; layout: Array<{ tag: string }> }
    expect(value.styles.map(([name]) => name)).toEqual(COMPUTED_STYLE_NAMES)
    expect(COMPUTED_STYLE_NAMES).toHaveLength(41)
    expect(value.layout.map((l) => l.tag)).toEqual(['li', 'ul', 'main'])
    expect(value.styles.find(([n]) => n === 'display')?.[1]).toBe('inline-block')
  })

  describe('reactLookup', () => {
    const lookup = (el: unknown) => compile(REACT_LOOKUP).call(el) as { component: string | null; owners: string[]; source: unknown } | null

    it('answers null for an element React does not own', () => {
      expect(lookup(byId('save'))).toBeNull()
    })

    it('reads the nearest component, its owners and the JSX source of a React 18 development fiber', () => {
      function App(): null {
        return null
      }
      const Page = { displayName: 'PricingPage' }
      const ownerApp = { type: App, _debugOwner: null }
      const ownerPage = { type: { render: Page }, _debugOwner: ownerApp }
      const hero = { type: { displayName: 'Hero' }, _debugOwner: ownerPage, return: null }
      const host = { type: 'button', return: hero, _debugSource: { fileName: 'src/Hero.tsx', lineNumber: 42, columnNumber: 3 } }
      const el = byId('save') as unknown as Record<string, unknown>
      el['__reactFiber$abc'] = host
      expect(lookup(el)).toEqual({ component: 'Hero', owners: ['PricingPage', 'App'], source: { file: 'src/Hero.tsx', line: 42, column: 3 } })
    })

    it('finds the fiber on an ancestor (a text-only child), and gives no source without _debugSource', () => {
      const el = byId('save').parentElement as unknown as Record<string, unknown>
      el['__reactInternalInstance$x'] = { type: 'li', return: { type: function Row() {}, return: null } }
      expect(lookup(byId('save'))).toEqual({ component: 'Row', owners: [], source: null })
    })

    it('answers null for a fiber that is not an object, and cuts names', () => {
      const el = byId('save') as unknown as Record<string, unknown>
      el['__reactFiber$1'] = 'junk'
      expect(lookup(el)).toBeNull()
      el['__reactFiber$1'] = { type: 'b', return: { type: { displayName: 'N'.repeat(600) }, return: null }, _debugSource: { fileName: 5 } }
      expect(lookup(el)?.component).toHaveLength(PICK_STRING_MAX)
    })
  })

  describe('reactDebugStack (React 19)', () => {
    const debugStack = (el: unknown) => compile(REACT_DEBUG_STACK).call(el)

    it("answers the host fiber's _debugStack, by reference", () => {
      const stack = new Error('react-stack-top-frame')
      const el = byId('save') as unknown as Record<string, unknown>
      el['__reactFiber$abc'] = { type: 'button', _debugStack: stack, return: { type: function Row() {}, _debugStack: new Error('owner') } }
      expect(debugStack(el)).toBe(stack)
    })

    it('walks up to the nearest fiber with one, finding the fiber on an ancestor element', () => {
      const ownerStack = new Error('owner')
      const parent = byId('save').parentElement as unknown as Record<string, unknown>
      parent['__reactFiber$x'] = { type: 'li', return: { type: function Row() {}, _debugStack: ownerStack, return: null } }
      expect(debugStack(byId('save'))).toBe(ownerStack)
    })

    it('answers null without a fiber, for a fiber that is not an object, or with no _debugStack (production, React 18)', () => {
      expect(debugStack(byId('save'))).toBeNull()
      const el = byId('save') as unknown as Record<string, unknown>
      el['__reactFiber$1'] = 'junk'
      expect(debugStack(el)).toBeNull()
      el['__reactFiber$1'] = { type: 'b', _debugStack: 'text', return: { type: 'div', return: null } }
      expect(debugStack(el)).toBeNull()
    })
  })
})
