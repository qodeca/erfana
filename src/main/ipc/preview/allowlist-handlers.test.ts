// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview allowlist-handler tests (Issue #74, item 46).
 *
 * Covers: `approveOrigin` ignores any payload-supplied root (root comes from the
 * store's injected accessor, not the request); on success it calls
 * `store.approveOrigin` THEN `service.applyApprovedHosts` with the returned set;
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
const APPROVED = ['https://cdn.example.com'] as const

function setup(overrides?: {
  approveOrigin?: ReturnType<typeof vi.fn>
  applyApprovedHosts?: ReturnType<typeof vi.fn>
  trusted?: boolean
}): {
  approveOrigin: ReturnType<typeof vi.fn>
  applyApprovedHosts: ReturnType<typeof vi.fn>
} {
  const approveOrigin = overrides?.approveOrigin ?? vi.fn(async () => APPROVED)
  const applyApprovedHosts = overrides?.applyApprovedHosts ?? vi.fn(async () => undefined)
  registerPreviewAllowlistHandlers({
    allowlistStore: { approveOrigin },
    service: { applyApprovedHosts },
    isTrustedSender: () => overrides?.trusted ?? true,
    isTrustedAppSender: () => true
  })
  return { approveOrigin, applyApprovedHosts }
}

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
})

describe('registerPreviewAllowlistHandlers', () => {
  it('calls store.approveOrigin then service.applyApprovedHosts with the new set', async () => {
    const { approveOrigin, applyApprovedHosts } = setup()

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'https://cdn.example.com'
    })

    expect(approveOrigin).toHaveBeenCalledWith('https://cdn.example.com')
    expect(applyApprovedHosts).toHaveBeenCalledWith('p1', APPROVED)
    expect(approveOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      applyApprovedHosts.mock.invocationCallOrder[0]
    )
    expect(result).toEqual({ ok: true, hosts: APPROVED })
  })

  it('ignores a payload-supplied projectRoot (.strict rejects it; store untouched)', async () => {
    const { approveOrigin, applyApprovedHosts } = setup()

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'https://cdn.example.com',
      projectRoot: '/evil/root'
    })

    // The extra key fails `.strict()`, so nothing runs and no root is honoured.
    expect(approveOrigin).not.toHaveBeenCalled()
    expect(applyApprovedHosts).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false })
  })

  it('never forwards the payload host as a root — approveOrigin gets only the host', async () => {
    const { approveOrigin } = setup()

    await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'https://cdn.example.com'
    })

    // approveOrigin is the store's single argument; the store resolves the root
    // itself from ProjectService, so the handler passes no path at all.
    expect(approveOrigin).toHaveBeenCalledTimes(1)
    expect(approveOrigin.mock.calls[0]).toEqual(['https://cdn.example.com'])
  })

  it('maps an AppError from the store into the result errorCode', async () => {
    const approveOrigin = vi.fn(async () => {
      throw new AppError('nope', ErrorCode.PREVIEW_HOST_NOT_APPROVABLE)
    })
    const applyApprovedHosts = vi.fn(async () => undefined)
    setup({ approveOrigin, applyApprovedHosts })

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'bad_host'
    })

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE })
    expect(applyApprovedHosts).not.toHaveBeenCalled()
  })

  it('rejects an untrusted sender (store untouched)', async () => {
    const { approveOrigin } = setup({ trusted: false })

    const result = await handlers[PreviewChannels.APPROVE_HOST](event, {
      panelId: 'p1',
      host: 'https://cdn.example.com'
    })

    expect(approveOrigin).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false })
  })
})
