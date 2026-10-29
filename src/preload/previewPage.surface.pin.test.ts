// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page-reachable surface of the preview-page preload, pinned whole
 * (spec 024, 024-FR-020; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 2 NFR-005, § 6 commit 4, § 8 C26).
 *
 * INVARIANT PIN – never updated by the spec 024 refactor. `surface.test.ts`
 * snapshots the MAIN preload's `window.api`; `previewPage.ipcSurface.test.ts`
 * proves this preload uses only `send` and one `on`, to known channels. Neither
 * fixes the exact list of channels nor the fields each message carries. This
 * test does: it loads the preload with comments on, drives every message it
 * can send (hello, open, menu, keyboard step, exit, anchors, link note, link,
 * CSP report), and snapshots
 *
 * - the globals the preload adds to the page's window (none: no contextBridge),
 * - what it reads on the `electron` module and on `ipcRenderer`,
 * - the channels it listens on and sends on,
 * - every field path of every message per channel.
 *
 * Spec 024 promises "no API, channel or listener is added to the page"
 * (§ 2): a change here breaks that promise.
 */
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  dispatchTrusted,
  installBrowserDoubles,
  type BrowserDoubles
} from './previewPageComments/__test-helpers__/browserDoubles'

type Listener = (event: unknown, payload: unknown) => void

const recording = vi.hoisted(() => ({
  moduleKeys: [] as string[],
  ipcKeys: [] as string[],
  sent: [] as Array<[string, unknown]>,
  listeners: [] as Array<[string, Listener]>
}))

vi.mock('electron', () => {
  const ipcRenderer = new Proxy(
    {},
    {
      get(_target, key) {
        recording.ipcKeys.push(String(key))
        if (key === 'send') return (channel: string, payload: unknown) => recording.sent.push([channel, payload])
        if (key === 'on') return (channel: string, listener: Listener) => recording.listeners.push([channel, listener])
        return undefined
      }
    }
  )
  return new Proxy(
    { ipcRenderer },
    {
      get(target, key) {
        recording.moduleKeys.push(String(key))
        return key === 'ipcRenderer' ? target.ipcRenderer : undefined
      }
    }
  )
})

/** What vitest's loader itself reads on a mocked module. */
const LOADER_KEYS = new Set(['then'])

const { implForWrapper } = createRequire(import.meta.url)('jsdom/lib/jsdom/living/generated/utils.js') as {
  implForWrapper: (wrapper: object) => Record<string, unknown>
}
const ARGUMENT = '--erfana-hpc'

let doubles: BrowserDoubles
let addedGlobals: string[] = []

/** Every field path of `value`: `a`, `a.b`, `a[]`, `a[].b`, sorted. */
function fieldPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    const own = prefix === '' ? [] : [`${prefix}[]`]
    return [...own, ...value.flatMap(item => fieldPaths(item, `${prefix}[]`).filter(p => p !== `${prefix}[]`))]
  }
  if (typeof value !== 'object' || value === null) return prefix === '' ? [] : [prefix]
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`
    return [path, ...fieldPaths(child, path).filter(p => p !== path)]
  })
}

const click = (target: Element, init: MouseEventInit = {}): void =>
  dispatchTrusted(target, new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1, ...init }))
const key = (init: KeyboardEventInit): void =>
  dispatchTrusted(document.body, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init }))

/** Wait until `channel` has carried a message matching `match`. */
async function sentOn(channel: string, match: (payload: Record<string, unknown>) => boolean = () => true): Promise<void> {
  await vi.waitFor(() => {
    if (!recording.sent.some(([c, p]) => c === channel && match(p as Record<string, unknown>))) throw new Error(`nothing on ${channel} yet`)
  })
}

const T = 'data-erfana-el'

beforeAll(async () => {
  doubles = installBrowserDoubles()
  const before = new Set(Object.getOwnPropertyNames(window))
  process.argv.push(ARGUMENT)
  // The preload starts while the document is still parsing, as in the browser:
  // the elements parsed now carry tokens main minted (the token window).
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
  await import('./previewPage')
  addedGlobals = Object.getOwnPropertyNames(window).filter(name => !before.has(name)).sort()
  document.body.innerHTML =
    `<main id="main" ${T}="aaaaaaaaaaaa"><p id="para" ${T}="aaaaaaaaaaab">Text</p>` +
    `<button id="cta" ${T}="aaaaaaaaaaac">Buy</button></main><a id="out" href="https://example.com/x">out</a>`
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
  delete (document as unknown as Record<string, unknown>).readyState
  dispatchTrusted(document, new Event('DOMContentLoaded', { bubbles: true }))
  await sentOn('preview-page:commentHello')
  const para = document.getElementById('para') as HTMLElement
  const cta = document.getElementById('cta') as HTMLElement
  doubles.setBox(document.getElementById('main') as HTMLElement, { left: 0, top: 0, width: 600, height: 300 })
  doubles.setBox(para, { left: 0, top: 0, width: 100, height: 20 })
  doubles.setBox(cta, { left: 100, top: 100, width: 80, height: 30 })
  // A script-built element below a tokened one: its pick carries `runtime`.
  const built = document.createElement('span')
  built.textContent = 'added later'
  para.append(built)
  doubles.setBox(built, { left: 0, top: 0, width: 40, height: 20 })
  const [, onState] = recording.listeners[0] ?? []
  const fromMain = (state: unknown): void => onState?.({ sender: 'main' }, state)

  // Comment mode with one pin on the button: every pick kind and the anchors report.
  fromMain({ mode: true, commentable: true, showIcons: true, icons: [{ key: 'pin-1', token: 'aaaaaaaaaaac', count: 1, status: 'open' }] })
  click(para)
  // Hover the script-built element first, so the click picks it rather than the held <p>.
  dispatchTrusted(document.body, new MouseEvent('pointermove', { bubbles: true, composed: true, clientX: 5, clientY: 5 }))
  click(built, { clientX: 5, clientY: 5 })
  dispatchTrusted(para, new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2 }))
  const host = [...document.documentElement.children].find(el => el.localName === 'div') as HTMLElement
  // The pin sits above the button's top-right corner (182, 74, 24 × 24), as in input.test.ts J-013.
  click(host, { clientX: 190, clientY: 80 })
  // The pin pick holds the button: Alt+↑ steps to its parent (a `step`), Enter opens it (a keyboard pick).
  key({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
  key({ key: 'Enter', code: 'Enter' })
  await sentOn('preview-page:commentPick', p => p.kind === 'step')
  key({ key: 'Escape', code: 'Escape' })
  await sentOn('preview-page:commentAnchors')

  // Mode off: a link the page cancels (a `cancelled` note), one it does not (a report), and a CSP refusal.
  fromMain({ mode: false, commentable: true, icons: [] })
  const link = document.getElementById('out') as HTMLAnchorElement
  const cancel = (event: Event): void => event.preventDefault()
  window.addEventListener('click', cancel)
  click(link)
  window.removeEventListener('click', cancel)
  // jsdom cannot navigate: drop this one anchor's activation behaviour, so the
  // uncancelled click reaches the preload's report and goes nowhere.
  implForWrapper(link)._activationBehavior = () => undefined
  click(link)
  const csp = new Event('securitypolicyviolation', { bubbles: true, composed: true })
  Object.defineProperty(csp, 'blockedURI', { value: 'https://cdn.example/x.js' })
  Object.defineProperty(csp, 'effectiveDirective', { value: 'script-src' })
  dispatchTrusted(document.body, csp)
  await sentOn('preview-page:linkActivated')
})

afterAll(() => {
  process.argv.splice(process.argv.indexOf(ARGUMENT), 1)
  document.body.innerHTML = ''
  doubles.restore()
})

describe('previewPage preload – page-reachable surface (invariant)', () => {
  it('PIN-S-001 adds no global to the page window', () => {
    expect(addedGlobals).toEqual([])
  })

  it('PIN-S-002 reads only ipcRenderer on electron, and only send and on on it', () => {
    expect([...new Set(recording.moduleKeys.filter(k => !LOADER_KEYS.has(k)))].sort()).toEqual(['ipcRenderer'])
    expect([...new Set(recording.ipcKeys)].sort()).toEqual(['on', 'send'])
  })

  it('PIN-S-003 the channels it listens and sends on, and every field each message carries', () => {
    const fields: Record<string, string[]> = {}
    for (const [channel, payload] of recording.sent) {
      fields[channel] = [...new Set([...(fields[channel] ?? []), ...fieldPaths(payload)])].sort()
    }
    const kinds = recording.sent
      .filter(([channel]) => channel === 'preview-page:commentPick')
      .map(([, payload]) => (payload as { kind: string }).kind)
    expect({
      listens: recording.listeners.map(([channel]) => channel),
      sends: Object.keys(fields).sort(),
      pickKindsDriven: [...new Set(kinds)].sort(),
      fields: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)))
    }).toMatchSnapshot()
  })
})
