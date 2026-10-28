// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pin elements, resolved once per page change (security review L9;
 * docs/designs/comments/html-preview-comments.md §6 "JS-built elements").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePath } from './domPath'
import { TOKEN_ATTRIBUTE } from './constants'
import { IconResolver } from './iconResolver'
import type { IconState } from './state'
import { TokenRegistry } from './tokens'
import { installBrowserDoubles, type BrowserDoubles } from './__test-helpers__/browserDoubles'
import { microtasks, token } from './__test-helpers__/harness'

// The real walk, counted.
vi.mock('./domPath', async importOriginal => {
  const actual = await importOriginal<typeof import('./domPath')>()
  return { ...actual, resolvePath: vi.fn(actual.resolvePath) }
})

let doubles: BrowserDoubles
let registry: TokenRegistry
let version = 0
let resolver: IconResolver

beforeEach(async () => {
  doubles = installBrowserDoubles()
  registry = new TokenRegistry(document, true)
  registry.start()
  document.body.innerHTML = `<ul id="list" ${TOKEN_ATTRIBUTE}="${token(1)}"><li id="one">a</li><li id="two">b</li></ul>`
  await microtasks()
  registry.closeWindow()
  for (const id of ['list', 'one', 'two']) {
    doubles.setBox(document.getElementById(id) as Element, { left: 0, top: 0, width: 10, height: 10 })
  }
  version = 0
  resolver = new IconResolver(registry, () => version)
})

afterEach(() => {
  registry.stop()
  document.body.innerHTML = ''
  doubles.restore()
})

const icon = (extra: Partial<IconState> = {}): IconState => ({ key: 'k', token: token(1), count: 1, status: 'open', ...extra })
const second: IconState['runtime'] = { path: 'li:nth-of-type(2)', tag: 'li' }

describe('IconResolver', () => {
  it('resolves a tokened element and a JS-built one below it, with whether each is rendered', () => {
    const list = document.getElementById('list')
    const two = document.getElementById('two') as Element
    doubles.setVisible(two, false)
    expect(resolver.resolve([icon(), icon({ key: 'r', runtime: second })])).toEqual([
      { icon: icon(), element: list, visible: true },
      { icon: icon({ key: 'r', runtime: second }), element: two, visible: false }
    ])
  })

  it('names nothing for an unknown token, a missing path or a different tag', () => {
    const resolved = resolver.resolve([
      icon({ token: token(9) }),
      icon({ runtime: { path: 'li:nth-of-type(7)', tag: 'li' } }),
      icon({ runtime: { path: 'li:nth-of-type(1)', tag: 'p' } })
    ])
    expect(resolved.map(r => [r.element, r.visible])).toEqual([
      [undefined, false],
      [undefined, false],
      [undefined, false]
    ])
  })

  it('L9 walks a path once per page change, however often the overlay renders', () => {
    const walk = vi.mocked(resolvePath)
    walk.mockClear()
    const icons = [icon({ runtime: second })]
    for (let i = 0; i < 20; i += 1) resolver.resolve(icons)
    expect(walk).toHaveBeenCalledTimes(1)

    // The page changed: the path is walked again, and finds the new second item.
    const list = document.getElementById('list') as Element
    list.prepend(document.createElement('li'))
    version += 1
    expect(resolver.resolve(icons)[0].element).toBe(document.getElementById('one'))
    expect(walk).toHaveBeenCalledTimes(2)

    // A cached element that left the document is walked again even at the same version.
    ;(document.getElementById('one') as Element).remove()
    expect(resolver.resolve(icons)[0].element).toBe(document.getElementById('two'))
    expect(walk).toHaveBeenCalledTimes(3)

    // A cached miss stays a miss until the page changes.
    const missing = [icon({ runtime: { path: 'li:nth-of-type(9)', tag: 'li' } })]
    resolver.resolve(missing)
    resolver.resolve(missing)
    expect(walk).toHaveBeenCalledTimes(4)
  })
})
