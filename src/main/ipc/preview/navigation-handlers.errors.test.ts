// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:navigate` when the service throws (issue #124, QG-7 S5). The handler
 * answers `PREVIEW_NAV_UNAVAILABLE` and logs the error through
 * `redactedLogError`, so the path a Node error quotes never reaches the log.
 * electron's ipcMain is mocked to capture the handler.
 *
 * The same pin holds for the two preview-service catch-alls that log an error
 * the same way – the protocol handler and the request filter (QG-8 T4) – each
 * driven through its own captured listener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PreviewNavigateRequest } from '../../../shared/ipc/preview-navigation-schema'
import { logger } from '../../services/LoggingService'
import { attach as attachProtocol } from '../../services/preview/PreviewProtocolHandler'
import { attach as attachFilter } from '../../services/preview/PreviewRequestFilter'
import {
  FILTER_DEPS,
  details,
  makeContext,
  makeSession,
  type OnBeforeListener
} from '../../services/preview/__test-helpers__/previewRequestFilterMocks'
import { registerPreviewNavigationHandlers } from './navigation-handlers'

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

const HOME = '/Users/alice'
const UNAVAILABLE = { ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }
const REQUEST: PreviewNavigateRequest = {
  panelId: 'preview-/users/alice/site/a.html',
  phase: 'check',
  action: 'open',
  filePath: `${HOME}/site/b.html`,
  anchor: null
}

let dispose: (() => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  dispose?.()
  dispose = null
})

/** Invoke `preview:navigate` once, over a service whose `navigate` throws `thrown`. */
function invokeThrowing(thrown: unknown): Promise<unknown> {
  dispose = registerPreviewNavigationHandlers({
    service: {
      navigate: async () => {
        throw thrown
      }
    },
    isTrustedSender: () => true,
    resolveWindow: () => ({ id: 1 })
  })
  return handlers[PreviewChannels.NAVIGATE]({ sender: {} }, REQUEST)
}

/** The `Error` handed to the one `logger.error` line, which must read `line`. */
function loggedError(line = 'preview:navigate failed'): Error | undefined {
  expect(logger.error).toHaveBeenCalledTimes(1)
  const [message, error] = vi.mocked(logger.error).mock.calls[0]
  expect(message).toBe(line)
  return error
}

/** A Node error quoting the absolute path it failed on. */
function eacces(): Error {
  return Object.assign(new Error(`EACCES: permission denied, open '${HOME}/site/b.html'`), {
    code: 'EACCES',
    errno: -13,
    syscall: 'open'
  })
}

/** The logged copy of an `eacces()` error: the path cut, from the message and the stack. */
function expectPathCut(logged: Error | undefined): void {
  expect(logged?.message).toBe('EACCES: permission denied, open [redacted-path]')
  expect(`${logged?.message}\n${logged?.stack}`).not.toContain(HOME)
}

describe('preview:navigate – a service that throws', () => {
  it('answers UNAVAILABLE and logs a Node error with its quoted path cut', async () => {
    const enoent = Object.assign(
      new Error(`ENOENT: no such file or directory, realpath '${HOME}/site/b.html'`),
      { code: 'ENOENT', errno: -2, syscall: 'realpath' }
    )

    await expect(invokeThrowing(enoent)).resolves.toEqual(UNAVAILABLE)

    const logged = loggedError()
    expect(logged).not.toBe(enoent)
    // The placeholder replaces the quotes too.
    expect(logged?.message).toBe('ENOENT: no such file or directory, realpath [redacted-path]')
    // The stack repeats the message: neither may hold the user's folders.
    expect(`${logged?.message}\n${logged?.stack}`).not.toContain(HOME)
  })

  it('logs no error object for a throw that is not an Error', async () => {
    await expect(invokeThrowing(`${HOME}/site/b.html`)).resolves.toEqual(UNAVAILABLE)

    expect(loggedError()).toBeUndefined()
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(HOME)
  })
})

describe('the preview protocol handler – a request that throws (QG-8 T4)', () => {
  it('answers 500 and logs a Node error with its quoted path cut', async () => {
    const error = eacces()
    const handle = vi.fn()
    const detach = attachProtocol({ protocol: { handle, unhandle: vi.fn() } } as never, {
      resolve: () => null,
      recordFailure: vi.fn(),
      recordDocumentFailure: vi.fn(),
      recordFrameRefusal: vi.fn(),
      ledger: {
        take: () => {
          throw error
        }
      }
    })
    const listener = handle.mock.calls[0][1] as (request: unknown) => Promise<Response>

    const response = await listener({ url: 'erfana-preview://t/b.html', method: 'GET' })
    detach()

    expect(response.status).toBe(500)
    expectPathCut(loggedError('Preview protocol handler error'))
  })
})

describe('the preview request filter – a listener that throws (QG-8 T4)', () => {
  it('cancels the request and logs a Node error with its quoted path cut', () => {
    const error = eacces()
    const session = makeSession()
    const context = makeContext([])
    context.recordFrameRefusal.mockImplementation(() => {
      throw error
    })
    const detach = attachFilter(session.session, context.ctx, FILTER_DEPS)
    const listener = session.onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    const callback = vi.fn()

    listener(details(1, 'https://evil.example/', 'subFrame'), callback)
    detach()

    expect(callback.mock.calls).toEqual([[{ cancel: true }]])
    expectPathCut(loggedError('Preview request filter listener error'))
  })
})
