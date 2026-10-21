// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `import:toolStatus` (#250): sender gate before the payload, strict schema,
 * cached read vs "Check again", never rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { IMPORT_CHANNELS } from '../../shared/ipc/import-channels'

const mockIpcMainHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
  dialog: { showOpenDialog: vi.fn() }
}))

const mockIsTrusted = vi.fn(() => true)
vi.mock('./senderValidation', () => ({
  isTrustedSender: (e: unknown) => mockIsTrusted(e),
  isTrustedAppSender: () => true
}))

const STATUS = { libreOffice: true, imageMagick: false, extensions: ['pdf', 'docx'], throttled: false }
const mockGetStatus = vi.fn(async () => STATUS)
const mockRecheck = vi.fn(async () => ({ ...STATUS, throttled: true }))
vi.mock('../services/import', () => ({
  converterRegistry: {},
  importService: {},
  importToolStatusService: {
    getStatus: () => mockGetStatus(),
    recheck: () => mockRecheck()
  }
}))
vi.mock('../services/FileService', () => ({ fileService: { getProjectPath: () => null } }))
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

const EVENT = {} as IpcMainInvokeEvent

async function handler(): Promise<(event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>> {
  const { registerDocumentImportHandlers } = await import('./import-handlers')
  registerDocumentImportHandlers()
  const found = mockIpcMainHandle.mock.calls.find((c) => c[0] === IMPORT_CHANNELS.TOOL_STATUS)?.[1]
  expect(found).toBeDefined()
  return found
}

describe('import:toolStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsTrusted.mockReturnValue(true)
  })

  it('returns the cached status for { recheck: false } without re-probing', async () => {
    const h = await handler()

    await expect(h(EVENT, { recheck: false })).resolves.toEqual({ success: true, ...STATUS })
    expect(mockGetStatus).toHaveBeenCalledTimes(1)
    expect(mockRecheck).not.toHaveBeenCalled()
  })

  it('runs "Check again" for { recheck: true } and passes the throttled flag through', async () => {
    const h = await handler()

    await expect(h(EVENT, { recheck: true })).resolves.toMatchObject({ success: true, throttled: true })
    expect(mockRecheck).toHaveBeenCalledTimes(1)
  })

  it('refuses an untrusted sender before looking at the payload', async () => {
    mockIsTrusted.mockReturnValue(false)
    const h = await handler()

    await expect(h(EVENT, { recheck: true })).resolves.toEqual({ success: false, error: 'Request refused' })
    expect(mockRecheck).not.toHaveBeenCalled()
    expect(mockGetStatus).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it.each([
    ['nothing', undefined],
    ['a bare boolean', true],
    ['a string flag', { recheck: 'yes' }],
    ['an extra key', { recheck: true, path: '/tmp/soffice' }]
  ])('rejects %s with success: false', async (_name, payload) => {
    const h = await handler()

    await expect(h(EVENT, payload)).resolves.toEqual({ success: false, error: 'Invalid request' })
    expect(mockRecheck).not.toHaveBeenCalled()
    expect(mockGetStatus).not.toHaveBeenCalled()
  })

  it('never rejects when detection throws', async () => {
    mockRecheck.mockRejectedValueOnce(new Error('boom'))
    const h = await handler()

    await expect(h(EVENT, { recheck: true })).resolves.toEqual({
      success: false,
      error: 'Could not check the import tools'
    })
  })
})
