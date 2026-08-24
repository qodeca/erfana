// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview allowlist-handler tests (Issue #74, item 46).
 *
 * Covers: `approveHost` ignores any payload-supplied root (root comes from the
 * store's injected accessor, not the request); on success it calls
 * `store.approveHost` THEN `service.applyApprovedHosts` with the returned set;
 * a store failure maps the AppError code into the result; an untrusted sender is
 * rejected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError, ErrorCode } from '../../../shared/errors'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import { registerPreviewAllowlistHandlers } from './allowlist-handlers'

type Handler = (event: unknown, arg: unknown) => unknown
const handlers: Record<string, Handler> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers[channel] = handler
    }),
    removeHandler: vi.fn()
  }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const event = {} as IpcMainInvokeEvent
const APPROVED = ['cdn.example.com'] as const

function setup(overrides?: {
  approveHost?: ReturnType<typeof vi.fn>
  applyApprovedHosts?: ReturnType<typeof vi.fn>
  trusted?: boolean
}): {
  approveHost: ReturnType<typeof vi.fn>
  applyApprovedHosts: ReturnType<typeof vi.fn>
} {
  const approveHost = overrides?.approveHost ?? vi.fn(async () => APPROVED)
  const applyApprovedHosts = overrides?.applyApprovedHosts ?? vi.fn(async () => undefined)
  registerPreviewAllowlistHandlers({
    allowlistStore: { approveHost },
    service: { applyApprovedHosts },
    isTrustedSender: () => overrides?.trusted ?? true
  })
  return { approveHost, applyApprovedHosts }
}

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
})

describe('registerPreviewAllowlistHandlers', () => {
  it('calls store.approveHost then service.applyApprovedHosts with the new set', async () => {
    const { approveHost, applyApprovedHosts } = setup()

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'cdn.example.com'
    })

    expect(approveHost).toHaveBeenCalledWith('cdn.example.com')
    expect(applyApprovedHosts).toHaveBeenCalledWith('p1', APPROVED)
    expect(approveHost.mock.invocationCallOrder[0]).toBeLessThan(
      applyApprovedHosts.mock.invocationCallOrder[0]
    )
    expect(result).toEqual({ ok: true, hosts: APPROVED })
  })

  it('ignores a payload-supplied projectRoot (.strict rejects it; store untouched)', async () => {
    const { approveHost, applyApprovedHosts } = setup()

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'cdn.example.com',
      projectRoot: '/evil/root'
    })

    // The extra key fails `.strict()`, so nothing runs and no root is honoured.
    expect(approveHost).not.toHaveBeenCalled()
    expect(applyApprovedHosts).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false })
  })

  it('never forwards the payload host as a root — approveHost gets only the host', async () => {
    const { approveHost } = setup()

    await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'cdn.example.com'
    })

    // approveHost is the store's single argument; the store resolves the root
    // itself from ProjectService, so the handler passes no path at all.
    expect(approveHost).toHaveBeenCalledTimes(1)
    expect(approveHost.mock.calls[0]).toEqual(['cdn.example.com'])
  })

  it('maps an AppError from the store into the result errorCode', async () => {
    const approveHost = vi.fn(async () => {
      throw new AppError('nope', ErrorCode.PREVIEW_HOST_NOT_APPROVABLE)
    })
    const applyApprovedHosts = vi.fn(async () => undefined)
    setup({ approveHost, applyApprovedHosts })

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'bad_host'
    })

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE })
    expect(applyApprovedHosts).not.toHaveBeenCalled()
  })

  it('rejects an untrusted sender (store untouched)', async () => {
    const { approveHost } = setup({ trusted: false })

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'cdn.example.com'
    })

    expect(approveHost).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false })
  })
})
