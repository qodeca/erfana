// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The external-link consent rules (sd-074b §5.5), extracted from the graph
 * builder so they can be tested without Electron.
 *
 * Before this module the dialog was `dialog.showMessageBox(options)` with no
 * parent and no log line, behind a process-wide promise chain. On Windows the
 * 2026-09-03 verification saw a click produce nothing visible and nothing in
 * the log. Whatever the cause of that one click, an unowned consent dialog is
 * wrong on its own — it is not modal to the app and can sit behind it — and a
 * consent path with no logging cannot be diagnosed. These tests pin the three
 * rules the module now enforces: parented, one at a time, always logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createExternalLinkConsent,
  describeExternalDestination,
  type ConsentAnswer,
  type ConsentWindow
} from './externalLinkConsent'

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../services/LoggingService', () => ({ logger: mockLogger }))

const WINDOW: ConsentWindow = { id: 7, isDestroyed: () => false }
const URL_ = 'https://example.com/docs?token=secret'

/** A dialog whose answer the test controls, and which can be held open. */
function makeDeps(answer: ConsentAnswer | (() => Promise<ConsentAnswer>) = { response: 0 }) {
  const showMessageBox = vi.fn(async (_w: ConsentWindow, _o: unknown) =>
    typeof answer === 'function' ? answer() : answer
  )
  const openExternal = vi.fn(async () => undefined)
  const resolveWindow = vi.fn((id: number) => (id === WINDOW.id ? WINDOW : null))
  const ask = createExternalLinkConsent({ resolveWindow, showMessageBox, openExternal })
  return { ask, showMessageBox, openExternal, resolveWindow }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createExternalLinkConsent — the dialog is owned by the asking window', () => {
  it('passes the resolved window as the first dialog argument', async () => {
    const { ask, showMessageBox } = makeDeps({ response: 0 })

    await ask(URL_, WINDOW.id)

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(showMessageBox.mock.calls[0][0]).toBe(WINDOW)
    expect(showMessageBox.mock.calls[0][1]).toMatchObject({
      type: 'question',
      buttons: ['Cancel', 'Open'],
      defaultId: 0,
      cancelId: 0
    })
  })

  it('names the origin in the dialog, never the full href', async () => {
    const { ask, showMessageBox } = makeDeps({ response: 0 })

    await ask(URL_, WINDOW.id)

    const options = showMessageBox.mock.calls[0][1] as { detail: string }
    expect(options.detail).toContain('https://example.com')
    expect(options.detail).not.toContain('secret')
  })

  it('refuses — and asks on no other window — when the asking window is gone', async () => {
    const { ask, showMessageBox, openExternal } = makeDeps({ response: 1 })

    await expect(ask(URL_, 999)).rejects.toThrow(/gone/)

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Preview external link: refused',
      expect.objectContaining({ reason: 'no-window' })
    )
  })
})

describe('createExternalLinkConsent — the answer decides', () => {
  it('opens the link on "Open"', async () => {
    const { ask, openExternal } = makeDeps({ response: 1 })

    await ask(URL_, WINDOW.id)

    expect(openExternal).toHaveBeenCalledWith(URL_)
    expect(mockLogger.info).toHaveBeenCalledWith('Preview external link: asking', expect.anything())
    expect(mockLogger.info).toHaveBeenCalledWith('Preview external link: opened', expect.anything())
  })

  it('opens nothing on Cancel and says so in the log', async () => {
    const { ask, openExternal } = makeDeps({ response: 0 })

    await ask(URL_, WINDOW.id)

    expect(openExternal).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Preview external link: cancelled',
      expect.anything()
    )
  })
})

describe('createExternalLinkConsent — one question at a time', () => {
  it('refuses a second activation while the first question is open, then recovers', async () => {
    let answer: (a: ConsentAnswer) => void = () => undefined
    const held = new Promise<ConsentAnswer>((resolve) => {
      answer = resolve
    })
    const { ask, showMessageBox, openExternal } = makeDeps(() => held)

    const first = ask(URL_, WINDOW.id)
    await expect(ask('https://other.example/', WINDOW.id)).rejects.toThrow(/already open/)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Preview external link: refused',
      expect.objectContaining({ reason: 'dialog-open' })
    )

    answer({ response: 0 })
    await first
    expect(openExternal).not.toHaveBeenCalled()

    // The gate is released: the next click asks again.
    await ask(URL_, WINDOW.id)
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('gates per window: a question open on window A does not refuse window B', async () => {
    // The dialog is modal to ITS window, so a second window's click would be
    // asked by the OS; refusing it with a "blocked link" badge was a leftover
    // of the process-wide chain.
    const other: ConsentWindow = { id: 8, isDestroyed: () => false }
    let answer: (a: ConsentAnswer) => void = () => undefined
    const held = new Promise<ConsentAnswer>((resolve) => {
      answer = resolve
    })
    const { ask, showMessageBox, resolveWindow } = makeDeps(() => held)
    resolveWindow.mockImplementation((id: number) => (id === other.id ? other : id === WINDOW.id ? WINDOW : null))

    const first = ask(URL_, WINDOW.id)
    const second = ask('https://other.example/', other.id)
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expect(showMessageBox.mock.calls[1][0]).toBe(other)

    answer({ response: 0 })
    await Promise.all([first, second])
  })

  it('logs "opened" only after the OS hand-off succeeded, and "open failed" when it rejects', async () => {
    // `shell.openExternal` rejects when the OS has no handler (mailto:/tel: on
    // a machine with no mail client); the log said "opened" for exactly the
    // click the reader saw refused.
    const { ask, openExternal } = makeDeps({ response: 1 })
    openExternal.mockRejectedValueOnce(new Error('no handler'))

    await expect(ask(URL_, WINDOW.id)).rejects.toThrow('no handler')

    expect(mockLogger.info).not.toHaveBeenCalledWith('Preview external link: opened', expect.anything())
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Preview external link: open failed',
      expect.objectContaining({ error: 'no handler' })
    )

    await ask(URL_, WINDOW.id)
    expect(mockLogger.info).toHaveBeenCalledWith('Preview external link: opened', expect.anything())
  })

  it('releases the gate when the OS hand-off rejects', async () => {
    const { ask, openExternal, showMessageBox } = makeDeps({ response: 1 })
    openExternal.mockRejectedValueOnce(new Error('no handler'))

    await expect(ask(URL_, WINDOW.id)).rejects.toThrow('no handler')

    await ask(URL_, WINDOW.id)
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })
})

describe('describeExternalDestination', () => {
  it('still names the origin for http(s) and the address for mailto', () => {
    expect(describeExternalDestination('https://example.com/a?b=c')).toBe('https://example.com')
    expect(describeExternalDestination('mailto:someone@example.com?body=x')).toBe(
      'mailto:someone@example.com'
    )
  })
})
