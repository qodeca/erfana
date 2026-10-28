// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview-page preload's IPC surface, observed at RUN time
 * (SEC-01; docs/adrs/0005-sub-frame-preload-one-receive-channel.md; security
 * review L7).
 *
 * `previewPage.contract.test.ts` reads the source; this test runs it. The
 * `electron` module is a recording stand-in: every property the preload reads
 * on the module and on `ipcRenderer` is written down while the preload loads
 * with comments on, in the main frame, and then works – a hello, a state
 * from main, a comment-mode pick, a keyboard step, a link click and a CSP
 * refusal. The surface it used must be `send` and one `on`, for the one
 * literal state channel, and every send must go to a channel main knows.
 * Anything else – `invoke`, `sendSync`, `once`, a second listener, a new
 * channel – fails here even if it slipped past the source scan.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  dispatchTrusted,
  installBrowserDoubles,
  type BrowserDoubles
} from './previewPageComments/__test-helpers__/browserDoubles'
import {
  PREVIEW_PAGE_LINK_CHANNEL,
  PREVIEW_PAGE_LINK_NOTE_CHANNEL
} from '../main/services/preview/previewLinkBridge'
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from '../main/services/preview/previewCspViolationBridge'
import { PreviewCommentPageChannels } from '../shared/ipc/preview-comment-channels'

type Listener = (event: unknown, payload: unknown) => void

const recording = vi.hoisted(() => ({
  /** Property names read on the `electron` module. */
  moduleKeys: [] as string[],
  /** Property names read, written or probed on `ipcRenderer`. */
  ipcKeys: [] as string[],
  sent: [] as Array<[string, unknown]>,
  listeners: [] as Array<[string, Listener]>
}))

vi.mock('electron', () => {
  const record = (into: string[], key: PropertyKey): void => {
    into.push(String(key))
  }
  const ipcRenderer = new Proxy(
    {},
    {
      get(_target, key) {
        record(recording.ipcKeys, key)
        if (key === 'send') return (channel: string, payload: unknown) => recording.sent.push([channel, payload])
        if (key === 'on') return (channel: string, listener: Listener) => recording.listeners.push([channel, listener])
        return undefined
      },
      set(_target, key) {
        record(recording.ipcKeys, `set:${String(key)}`)
        return false
      },
      has(_target, key) {
        record(recording.ipcKeys, `has:${String(key)}`)
        return false
      }
    }
  )
  return new Proxy(
    { ipcRenderer },
    {
      get(target, key) {
        record(recording.moduleKeys, key)
        return key === 'ipcRenderer' ? target.ipcRenderer : undefined
      }
    }
  )
})

/** What vitest's loader itself reads on a mocked module (is it a promise?): not the preload's doing. */
const LOADER_KEYS = new Set(['then'])

/** Every channel main listens on for this preload. */
const KNOWN_CHANNELS = new Set<string>([
  PREVIEW_PAGE_LINK_CHANNEL,
  PREVIEW_PAGE_LINK_NOTE_CHANNEL,
  PREVIEW_PAGE_CSP_VIOLATION_CHANNEL,
  PreviewCommentPageChannels.HELLO,
  PreviewCommentPageChannels.PICK,
  PreviewCommentPageChannels.ANCHORS
])

const ARGUMENT = '--erfana-hpc'

/** Let the link report's deferred task run. */
const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

let doubles: BrowserDoubles

beforeAll(async () => {
  // jsdom has no layout and no constructable sheets: the overlay's doubles.
  doubles = installBrowserDoubles()
  process.argv.push(ARGUMENT)
  await import('./previewPage')
  document.body.innerHTML = '<p id="para">Text</p><a id="out" href="https://example.com/x">out</a>'
  doubles.setBox(document.getElementById('para') as Element, { left: 0, top: 0, width: 100, height: 20 })
  const [, onState] = recording.listeners[0] ?? []
  const fromMain = (state: unknown): void => onState?.({ sender: 'main' }, state)

  // Comment mode: a pick by click, and a keyboard step.
  fromMain({ mode: true, commentable: true, icons: [] })
  const para = document.getElementById('para') as HTMLElement
  dispatchTrusted(para, new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1 }))
  dispatchTrusted(document.body, new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true }))

  // Mode off: a link click and a CSP refusal, the link and CSP reporter's work.
  fromMain({ mode: false, commentable: true, icons: [] })
  const link = document.getElementById('out') as HTMLAnchorElement
  // jsdom would follow the link: cancel it at the window, after the preload's
  // listener ran (the report then says `cancelled` – the same channel).
  const cancel = (event: Event): void => event.preventDefault()
  window.addEventListener('click', cancel)
  dispatchTrusted(link, new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1 }))
  window.removeEventListener('click', cancel)
  const csp = new Event('securitypolicyviolation', { bubbles: true, composed: true })
  Object.defineProperty(csp, 'blockedURI', { value: 'https://cdn.example/x.js' })
  Object.defineProperty(csp, 'effectiveDirective', { value: 'script-src' })
  dispatchTrusted(document.body, csp)
  await nextTask()
})

afterAll(() => {
  process.argv.splice(process.argv.indexOf(ARGUMENT), 1)
  document.body.innerHTML = ''
  doubles.restore()
})

describe('previewPage preload – the IPC surface it actually uses (L7)', () => {
  it('did the work this test drives: a hello, a pick, a link report and a CSP report', () => {
    const channels = recording.sent.map(([channel]) => channel)
    expect(channels).toContain(PreviewCommentPageChannels.HELLO)
    expect(channels).toContain(PreviewCommentPageChannels.PICK)
    expect(channels).toContain(PREVIEW_PAGE_LINK_NOTE_CHANNEL)
    expect(channels).toContain(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL)
  })

  it('reads nothing on the electron module but ipcRenderer', () => {
    expect(new Set(recording.moduleKeys.filter(key => !LOADER_KEYS.has(key)))).toEqual(new Set(['ipcRenderer']))
  })

  it('SEC-01 touches only send and on on ipcRenderer – on exactly once', () => {
    expect(new Set(recording.ipcKeys)).toEqual(new Set(['send', 'on']))
    expect(recording.ipcKeys.filter(key => key === 'on')).toHaveLength(1)
  })

  it('SEC-01 listens on the one literal state channel only', () => {
    expect(recording.listeners.map(([channel]) => channel)).toEqual([PreviewCommentPageChannels.STATE])
  })

  it('SEC-01 sends only on channels main knows', () => {
    for (const [channel] of recording.sent) expect(KNOWN_CHANNELS, channel).toContain(channel)
  })
})
