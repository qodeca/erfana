// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:exportPdf` and the suggested name (issue #124, P3-AC2). The handler
 * hands the service the panel id and the fallback name only; the view names
 * the export after the page on screen (`PreviewViewService.exportName.test.ts`).
 * A request that tries to carry a file name is refused, so the name can never
 * come from the renderer. The registry is mocked to capture the handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import { logger } from '../../services/LoggingService'
import { registerPreviewFindHandlers } from './find-handlers'

type Handler = (event: unknown, arg: unknown) => Promise<unknown>
const handlers: Record<string, Handler> = {}

vi.mock('../registry', () => ({
  registerHandle: vi.fn((channel: string, handler: Handler) => {
    handlers[channel] = handler
  }),
  unregisterHandle: vi.fn((channel: string) => {
    delete handlers[channel]
  })
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const service = {
  find: vi.fn(),
  stopFind: vi.fn(),
  exportPdf: vi.fn(async () => ({ ok: true as const, path: '/out/pricing.pdf' }))
}

let dispose: (() => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  dispose = registerPreviewFindHandlers({ service, isTrustedSender: () => true })
})

afterEach(() => {
  dispose?.()
  dispose = null
})

const exportPdf = (request: unknown): Promise<unknown> =>
  handlers[PreviewChannels.EXPORT_PDF]({}, request)

describe('preview:exportPdf — the suggested name', () => {
  it('hands the service the panel id and the fallback name only', async () => {
    await expect(exportPdf({ panelId: 'panel-A' })).resolves.toEqual({
      ok: true,
      path: '/out/pricing.pdf'
    })
    expect(service.exportPdf).toHaveBeenCalledWith('panel-A', 'preview')
  })

  it('refuses a request that carries a file name', async () => {
    await expect(exportPdf({ panelId: 'panel-A', suggestedName: 'chosen' })).resolves.toEqual({
      ok: false,
      errorCode: ErrorCode.UNKNOWN_ERROR
    })
    expect(service.exportPdf).not.toHaveBeenCalled()
  })
})

describe('log lines carry no path and no sender URL (QG-8 T4, T5)', () => {
  const HOME = '/Users/alice'
  const FIND = { panelId: 'panel-A', text: 'x', forward: true, findNext: false, matchCase: false }

  /** A Node error quoting the absolute path it failed on. */
  const eacces = (): Error =>
    Object.assign(new Error(`EACCES: permission denied, open '${HOME}/site/a.html'`), {
      code: 'EACCES',
      errno: -13,
      syscall: 'open'
    })

  const failing: [string, unknown, Mock][] = [
    [PreviewChannels.FIND, FIND, service.find],
    [PreviewChannels.STOP_FIND, { panelId: 'panel-A' }, service.stopFind],
    [PreviewChannels.EXPORT_PDF, { panelId: 'panel-A' }, service.exportPdf]
  ]

  it.each(failing)('%s: logs a Node error with its path cut', async (channel, request, call) => {
    const error = eacces()
    call.mockImplementationOnce(() => {
      throw error
    })

    await handlers[channel]({}, request)

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [line, logged] = vi.mocked(logger.error).mock.calls[0]
    expect(line).toBe(`${channel} failed`)
    expect(logged?.message).toBe('EACCES: permission denied, open [redacted-path]')
    // The stack repeats the message: neither may hold the user's folders.
    expect(`${logged?.message}\n${logged?.stack}`).not.toContain(HOME)
  })

  it.each([PreviewChannels.FIND, PreviewChannels.STOP_FIND, PreviewChannels.EXPORT_PDF])(
    '%s: logs an untrusted sender with no URL in the line',
    async (channel) => {
      dispose?.()
      dispose = registerPreviewFindHandlers({ service, isTrustedSender: () => false })

      await handlers[channel]({ senderFrame: { url: `file://${HOME}/site/evil.html` } }, {})

      expect(vi.mocked(logger.warn).mock.calls).toEqual([
        [`Rejected ${channel} from untrusted sender`]
      ])
    }
  )
})
