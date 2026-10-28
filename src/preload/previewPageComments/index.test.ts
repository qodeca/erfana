// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Installing the comment overlay in a frame: the one receive channel, the
 * hello at `DOMContentLoaded`, and clean removal (docs/designs/html-preview-comments.md
 * §8, §9.2; SEC-01).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_HELLO_CHANNEL, COMMENT_STATE_CHANNEL } from './constants'
import { commentsRequested, installPreviewPageComments, type InstalledComments } from './index'
import { dispatchTrusted, installBrowserDoubles, type BrowserDoubles } from './__test-helpers__/browserDoubles'

const { send, on, removeListener } = vi.hoisted(() => ({
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({ ipcRenderer: { send, on, removeListener } }))

let installed: InstalledComments | undefined
let doubles: BrowserDoubles | undefined

afterEach(() => {
  installed?.dispose()
  installed = undefined
  doubles?.restore()
  doubles = undefined
  delete (document as unknown as Record<string, unknown>).readyState
  for (const el of [...document.documentElement.children]) if (el.localName === 'div') el.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** Install as the preload does at document start, while the parser runs. */
function installWhileLoading(): InstalledComments {
  doubles = installBrowserDoubles()
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
  const result = installPreviewPageComments()
  delete (document as unknown as Record<string, unknown>).readyState
  return result
}

/** The state handler the overlay registered. */
function stateHandler(): (event: unknown, state: unknown) => void {
  const [channel, handler] = on.mock.calls[0] as [string, (event: unknown, state: unknown) => void]
  expect(channel).toBe(COMMENT_STATE_CHANNEL)
  return handler
}

describe('commentsRequested', () => {
  it('is true only when main passed the comments argument', () => {
    expect(commentsRequested(['electron', '--type=renderer', '--erfana-hpc'])).toBe(true)
    expect(commentsRequested(['electron', '--type=renderer'])).toBe(false)
    expect(commentsRequested(['--erfana-hpc=0'])).toBe(false)
    expect(commentsRequested()).toBe(process.argv.includes('--erfana-hpc'))
  })
})

describe('installPreviewPageComments', () => {
  it('SEC-01 listens on the one state channel and says hello at DOMContentLoaded, once', () => {
    installed = installWhileLoading()
    expect(on).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()

    dispatchTrusted(document, new Event('DOMContentLoaded'))
    dispatchTrusted(document, new Event('DOMContentLoaded'))
    expect(send.mock.calls).toEqual([[COMMENT_HELLO_CHANNEL, {}]])
  })

  it('a forged DOMContentLoaded neither closes the token window nor says hello', () => {
    installed = installWhileLoading()
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(send).not.toHaveBeenCalled()
  })

  it('routes main’s state to the controller and ignores a malformed one', () => {
    installed = installWhileLoading()
    const handler = stateHandler()
    handler({}, { mode: true, commentable: true, icons: [] })
    expect(installed.controller.mode).toBe(true)
    handler({}, { mode: 'yes' })
    expect(installed.controller.mode).toBe(true)
    handler({}, { mode: false, commentable: true, icons: [] })
    expect(installed.controller.mode).toBe(false)
  })

  it('rate-limits picks on the page’s own clock', () => {
    installed = installWhileLoading()
    dispatchTrusted(document, new Event('DOMContentLoaded'))
    stateHandler()({}, { mode: true, commentable: true, icons: [] })
    const now = vi.spyOn(window.performance, 'now').mockReturnValue(5_000)
    document.body.innerHTML = '<p id="p">text</p>'
    for (let i = 0; i < 7; i += 1) {
      dispatchTrusted(document.getElementById('p') as Element, new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    }
    expect(now).toHaveBeenCalled()
    expect(send.mock.calls.filter(([channel]) => channel === 'preview-page:commentPick')).toHaveLength(5)
    now.mockRestore()
  })

  it('says hello at once when installed after the parse', () => {
    doubles = installBrowserDoubles()
    installed = installPreviewPageComments(window, document)
    expect(send.mock.calls).toEqual([[COMMENT_HELLO_CHANNEL, {}]])
  })

  it('dispose removes the same listener it added, and the input guards', () => {
    installed = installWhileLoading()
    const handler = stateHandler()
    handler({}, { mode: true, commentable: true, icons: [] })
    installed.dispose()
    expect(removeListener).toHaveBeenCalledWith(COMMENT_STATE_CHANNEL, handler)

    // Guards gone: a trusted click in what was comment mode reaches the page.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    const page = vi.fn()
    document.body.addEventListener('click', page)
    dispatchTrusted(document.body, click)
    document.body.removeEventListener('click', page)
    expect(page).toHaveBeenCalledTimes(1)
    expect(click.defaultPrevented).toBe(false)
    installed = undefined
  })
})
