// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:focusPage` (issue #124, QG-8 U1): the handler's gates.
 *
 * The sender check, the strict payload, the sender's own window, the service's
 * refusals and a service that throws — every one of them answers the same
 * `{ ok: false }`, and none of them throws. `electron`'s `ipcMain` is mocked to
 * capture the registered handler, as in `navigation-handlers.errors.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'

import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import { logger } from '../../services/LoggingService'
import { registerPreviewFocusHandlers } from './focus-handlers'

type Handler = (event: unknown, arg: unknown) => Promise<unknown>
const handlers: Record<string, Handler> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers[channel] = handler
    }),
    removeHandler: vi.fn((channel: string) => {
      delete handlers[channel]
    })
  },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })) }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const PANEL_ID = 'preview-/users/alice/site/a.html'
const WINDOW_ID = 1
const REFUSED = { ok: false }

let dispose: (() => void) | null = null

/** Register the handler over a service and a sender/window pair. */
function register(options: {
  focusPage?: (panelId: string, windowId: number) => boolean
  trusted?: boolean
  window?: { id: number } | null
}): { focusPage: ReturnType<typeof vi.fn> } {
  const focusPage = vi.fn(options.focusPage ?? (() => true))
  dispose = registerPreviewFocusHandlers({
    service: { focusPage },
    isTrustedSender: () => options.trusted !== false,
    resolveWindow: () => (options.window === undefined ? { id: WINDOW_ID } : options.window)
  })
  return { focusPage }
}

/** Invoke the registered channel once. */
const invoke = (arg: unknown): Promise<unknown> =>
  handlers[PreviewChannels.FOCUS_PAGE]({ sender: {} }, arg)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  dispose?.()
  dispose = null
})

describe('preview:focusPage', () => {
  it("focuses the page of the panel, in the sender's own window", async () => {
    const { focusPage } = register({})

    await expect(invoke({ panelId: PANEL_ID })).resolves.toEqual({ ok: true })
    expect(focusPage).toHaveBeenCalledWith(PANEL_ID, WINDOW_ID)
  })

  it("passes the service's refusal on as a plain flag", async () => {
    // "Not live", "not drawn" and "another window's view" are all decided by the
    // service; the handler must not invent an answer of its own.
    const { focusPage } = register({ focusPage: () => false })

    await expect(invoke({ panelId: PANEL_ID })).resolves.toEqual(REFUSED)
    expect(focusPage).toHaveBeenCalledTimes(1)
  })

  it('refuses an untrusted sender without reading the payload', async () => {
    const { focusPage } = register({ trusted: false })

    // A payload no schema would accept: the answer is still the sender refusal,
    // which is what proves the gate ran BEFORE the parse.
    await expect(invoke({ panelId: 42, extra: true })).resolves.toEqual(REFUSED)
    expect(focusPage).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Rejected preview:focusPage from untrusted sender')
  })

  it.each([
    ['no payload at all', undefined],
    ['an empty object', {}],
    ['a panel id that is not a string', { panelId: 42 }],
    ['an empty panel id', { panelId: '' }],
    ['a panel id past the bound', { panelId: 'p'.repeat(257) }],
    ['an extra key', { panelId: PANEL_ID, focus: true }]
  ])('refuses %s', async (_name, payload) => {
    const { focusPage } = register({})

    await expect(invoke(payload)).resolves.toEqual(REFUSED)
    expect(focusPage).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected preview:focusPage with invalid payload',
      expect.objectContaining({ error: expect.any(String) })
    )
  })

  it('refuses when the sender belongs to no window', async () => {
    const { focusPage } = register({ window: null })

    await expect(invoke({ panelId: PANEL_ID })).resolves.toEqual(REFUSED)
    expect(focusPage).not.toHaveBeenCalled()
  })

  describe('the default window resolver', () => {
    /** Register without `resolveWindow`, so the handler falls back to Electron's. */
    function registerDefault(): { focusPage: ReturnType<typeof vi.fn> } {
      const focusPage = vi.fn(() => true)
      dispose = registerPreviewFocusHandlers({
        service: { focusPage },
        isTrustedSender: () => true
      })
      return { focusPage }
    }

    it("resolves the sender's own window, and hands its id to the service", async () => {
      const sender = { id: 'renderer-contents' }
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce({
        id: 7
      } as unknown as BrowserWindow)
      const { focusPage } = registerDefault()

      await expect(
        handlers[PreviewChannels.FOCUS_PAGE]({ sender }, { panelId: PANEL_ID })
      ).resolves.toEqual({ ok: true })

      expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender)
      expect(focusPage).toHaveBeenCalledWith(PANEL_ID, 7)
    })

    it('refuses a sender that belongs to no window, without asking the service', async () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(null)
      const { focusPage } = registerDefault()

      await expect(invoke({ panelId: PANEL_ID })).resolves.toEqual(REFUSED)
      expect(focusPage).not.toHaveBeenCalled()
    })
  })

  it('answers a refusal when the service throws, and logs the error with its path cut', async () => {
    const home = '/Users/alice'
    dispose = registerPreviewFocusHandlers({
      service: {
        focusPage: () => {
          throw Object.assign(new Error(`EACCES: permission denied, open '${home}/site/a.html'`), {
            code: 'EACCES'
          })
        }
      },
      isTrustedSender: () => true,
      resolveWindow: () => ({ id: WINDOW_ID })
    })

    await expect(invoke({ panelId: PANEL_ID })).resolves.toEqual(REFUSED)

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [line, error] = vi.mocked(logger.error).mock.calls[0]
    expect(line).toBe('preview:focusPage failed')
    expect(error?.message).toBe('EACCES: permission denied, open [redacted-path]')
    expect(`${error?.message}\n${error?.stack}`).not.toContain(home)
  })

  it('removes the channel when the bundle is disposed', () => {
    register({})
    expect(handlers[PreviewChannels.FOCUS_PAGE]).toBeDefined()

    dispose?.()
    dispose = null

    expect(handlers[PreviewChannels.FOCUS_PAGE]).toBeUndefined()
  })
})
