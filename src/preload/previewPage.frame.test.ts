// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview-page preload loaded in a SUB-FRAME (SEC-22; HTML Preview
 * comments, docs/designs/html-preview-comments.md §9.2,
 * docs/adrs/0005-sub-frame-preload-one-receive-channel.md).
 *
 * With `htmlPreview.comments.enabled` the preload also runs in every frame,
 * and main passes `--erfana-hpc`.
 * There it must install only the comment overlay: a frame's link clicks and
 * CSP refusals are not the page's, so the link and CSP reporters stay off.
 * Split from `previewPage.test.ts` because the module runs its side effects
 * once per load and the frame needs `window.top` stubbed BEFORE that load.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dispatchTrusted } from './previewPageComments/__test-helpers__/browserDoubles'

const { send, on, removeListener } = vi.hoisted(() => ({
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({ ipcRenderer: { send, on, removeListener } }))

/** The parent frame's window, as a frame's preload sees it. */
const PARENT = {}

/** What the module sent and listened for while it loaded (mock calls clear before each test). */
const atLoad: { sent: unknown[][]; listened: unknown[][] } = { sent: [], listened: [] }

beforeAll(async () => {
  Object.defineProperty(window, 'top', { configurable: true, get: () => PARENT })
  // A view built with comments on: main passes the comments argument.
  process.argv.push('--erfana-hpc')
  await import('./previewPage')
  atLoad.sent = [...send.mock.calls]
  atLoad.listened = [...on.mock.calls]
})

afterAll(() => {
  delete (window as unknown as Record<string, unknown>).top
  process.argv.splice(process.argv.indexOf('--erfana-hpc'), 1)
})

describe('previewPage preload in a frame (SEC-22)', () => {
  it('SEC-22 installs the comment overlay: one listener, and a hello at DOMContentLoaded', () => {
    expect(atLoad.listened).toEqual([['preview-page:commentState', expect.any(Function)]])
    expect(atLoad.sent).toEqual([['preview-page:commentHello', {}]])
  })

  it('SEC-22 reports no link click and no CSP refusal for the frame', async () => {
    document.body.insertAdjacentHTML('beforeend', '<a id="out" href="https://example.com/">out</a>')
    const link = document.getElementById('out') as HTMLAnchorElement
    // jsdom would try to follow the link; the click is cancelled at the window
    // after the (absent) preload listener would have run.
    const cancel = (event: Event): void => event.preventDefault()
    window.addEventListener('click', cancel)
    try {
      dispatchTrusted(link, new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }))
      const csp = new Event('securitypolicyviolation', { bubbles: true, composed: true })
      Object.defineProperty(csp, 'blockedURI', { value: 'https://cdn.example/x.js' })
      Object.defineProperty(csp, 'effectiveDirective', { value: 'script-src' })
      dispatchTrusted(document.body, csp)
      await new Promise(resolve => setTimeout(resolve, 0))
    } finally {
      window.removeEventListener('click', cancel)
      document.body.innerHTML = ''
    }
    expect(send).not.toHaveBeenCalled()
  })
})
