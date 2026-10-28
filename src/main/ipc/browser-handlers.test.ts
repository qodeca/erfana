// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the `browser:openFile` IPC handler (issue #124, part 4 §4.1).
 *
 * The gate order is the point: an untrusted sender – another origin, a
 * subframe, or a previewed page on `erfana-preview://` – is refused BEFORE the
 * payload is parsed and before the service is reached, by both the
 * process-wide gate in `registry.ts` and this channel's own `isTrustedSender`.
 * The project path comes from main's `fileService`, never from the payload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { IpcMainInvokeEvent } from 'electron'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { BROWSER_CHANNELS } from '../../shared/ipc/browser-channels'
import { BrowserOpenFileResponseSchema } from '../../shared/ipc/browser-schema'

type Listener = (...args: unknown[]) => Promise<unknown>

const mockIpcMainHandle = vi.fn()
/** The handler as written in `browser-handlers.ts`, before the registry wraps it. */
const innerListeners = new Map<string, Listener>()

// This suite exercises the REAL sender predicates; `setupTests.main.ts` stubs
// them true by default for the other handler suites.
vi.unmock('./senderValidation')

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockIpcMainHandle(...args) }
}))

const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

// The real registry, so the outer gate runs; the inner listener is recorded on
// the way through so this channel's own gate can be driven directly.
vi.mock('./registry', async importOriginal => {
  const actual = await importOriginal<typeof import('./registry')>()
  return {
    ...actual,
    registerHandle: (channel: string, listener: Listener) => {
      innerListeners.set(channel, listener)
      actual.registerHandle(channel, listener as Parameters<typeof actual.registerHandle>[1])
    }
  }
})

const mockOpenFile = vi.fn()
vi.mock('../services/browserLaunch/BrowserLaunchService', () => ({
  browserLaunchService: { openFile: (...args: unknown[]) => mockOpenFile(...args) }
}))

const mockGetProjectPath = vi.fn()
vi.mock('../services/FileService', () => ({
  fileService: { getProjectPath: () => mockGetProjectPath() }
}))

/** Same derivation `senderValidation.ts` uses for the production trust pin. */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href
const TRUSTED_FRAME = { url: RENDERER_FILE_URL, parent: null }
const PROJECT = '/Users/someone/Private Projects/site'
const PAGE = `${PROJECT}/index.html`

const UNTRUSTED_SENDERS = [
  ['another origin', { url: 'https://evil.example.com/', parent: null }],
  ['a subframe of the app renderer', { url: RENDERER_FILE_URL, parent: {} }],
  [
    'a previewed page',
    {
      url: 'erfana-preview://0123456789abcdef0123456789abcdef/Users/someone/site/index.html',
      parent: null
    }
  ],
  ['an event with no frame', null]
] as const

function makeEvent(frame: { url: string; parent: unknown } | null): IpcMainInvokeEvent {
  return { senderFrame: frame, sender: { id: 7 } } as unknown as IpcMainInvokeEvent
}

/** Register the handlers; return the gated handler and the channel's own listener. */
async function getHandlers(): Promise<{ gated: Listener; inner: Listener }> {
  const { registerBrowserHandlers } = await import('./browser-handlers')
  registerBrowserHandlers()
  const entry = mockIpcMainHandle.mock.calls.find(call => call[0] === BROWSER_CHANNELS.OPEN_FILE)
  return { gated: entry![1], inner: innerListeners.get(BROWSER_CHANNELS.OPEN_FILE)! }
}

function invalidRequest(): unknown {
  return {
    success: false,
    errorCode: ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST,
    error: ERROR_MESSAGES[ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST]
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  innerListeners.clear()
  mockIs.dev = false
  mockGetProjectPath.mockReturnValue(PROJECT)
  mockOpenFile.mockResolvedValue({ success: true, usedFallback: false })
})

describe('browser:openFile – registration', () => {
  it('registers exactly one channel, browser:openFile', async () => {
    await getHandlers()
    expect(mockIpcMainHandle.mock.calls.map(call => call[0])).toEqual(['browser:openFile'])
  })
})

describe('browser:openFile – the process-wide gate (registry.ts)', () => {
  it.each(UNTRUSTED_SENDERS)('refuses %s and NEVER calls the service', async (_label, frame) => {
    const { gated } = await getHandlers()
    expect(() => gated(makeEvent(frame), { filePath: PAGE })).toThrow(/Untrusted sender/)
    expect(mockOpenFile).not.toHaveBeenCalled()
  })
})

describe('browser:openFile – the channel’s own isTrustedSender gate', () => {
  it.each(UNTRUSTED_SENDERS)('refuses %s with INVALID_REQUEST', async (_label, frame) => {
    const { inner } = await getHandlers()
    expect(await inner(makeEvent(frame), { filePath: PAGE })).toEqual(invalidRequest())
    expect(mockOpenFile).not.toHaveBeenCalled()
  })

  it('refuses the app entry on another route, which the process-wide gate lets through', async () => {
    // The screenshot overlay loads the same bundled file with a hash route.
    const overlay = { url: `${RENDERER_FILE_URL}#/screenshot-overlay`, parent: null }
    const { gated } = await getHandlers()
    expect(await gated(makeEvent(overlay), { filePath: PAGE })).toEqual(invalidRequest())
    expect(mockOpenFile).not.toHaveBeenCalled()
  })

  it('runs BEFORE the schema, so a bad sender never reaches Zod', async () => {
    const { inner } = await getHandlers()
    await inner(makeEvent({ url: 'https://evil.example.com', parent: null }), { nope: true })
    const warnings = mockLogger.warn.mock.calls.map(call => String(call[0]))
    expect(warnings).toEqual(['Rejected browser:openFile from untrusted sender'])
  })

  it('logs a previewed sender with its path redacted', async () => {
    const { inner } = await getHandlers()
    await inner(makeEvent(UNTRUSTED_SENDERS[2][1]), { filePath: PAGE })
    const logged = JSON.stringify(mockLogger.warn.mock.calls)
    expect(logged).toContain('[redacted]/index.html')
    expect(logged).not.toContain('someone')
  })

  it('accepts the dev-server origin only in dev with ELECTRON_RENDERER_URL set', async () => {
    mockIs.dev = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    try {
      const { gated } = await getHandlers()
      const devFrame = { url: 'http://localhost:5173/', parent: null }
      await gated(makeEvent(devFrame), { filePath: PAGE })
      expect(mockOpenFile).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('browser:openFile – payload validation', () => {
  it.each([
    ['a missing path', {}],
    ['an empty path', { filePath: '' }],
    ['a path over 4096 characters', { filePath: '/' + 'a'.repeat(4096) }],
    ['a non-string path', { filePath: ['/p/a.html'] }],
    ['an extra key (an address)', { filePath: PAGE, url: 'https://example.com' }],
    ['a bare string', PAGE],
    ['no payload', undefined]
  ])('refuses %s without calling the service', async (_label, payload) => {
    const { gated } = await getHandlers()
    expect(await gated(makeEvent(TRUSTED_FRAME), payload)).toEqual(invalidRequest())
    expect(mockOpenFile).not.toHaveBeenCalled()
  })

  it('does not log the refused path – the issue message describes the shape only', async () => {
    const { gated } = await getHandlers()
    await gated(makeEvent(TRUSTED_FRAME), { filePath: PAGE, extra: PAGE })
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('Private Projects')
  })
})

describe('browser:openFile – delegation', () => {
  it('passes the path and main’s own project path to the service', async () => {
    const { gated } = await getHandlers()
    await gated(makeEvent(TRUSTED_FRAME), { filePath: PAGE })
    expect(mockOpenFile).toHaveBeenCalledWith(PAGE, PROJECT)
  })

  it('passes a null project through, so the service answers NO_PROJECT', async () => {
    mockGetProjectPath.mockReturnValue(null)
    const { gated } = await getHandlers()
    await gated(makeEvent(TRUSTED_FRAME), { filePath: PAGE })
    expect(mockOpenFile).toHaveBeenCalledWith(PAGE, null)
  })

  it('passes a Windows path through unchanged', async () => {
    const windowsPage = 'C:\\Users\\a\\site\\index.HTM'
    const { gated } = await getHandlers()
    await gated(makeEvent(TRUSTED_FRAME), { filePath: windowsPage })
    expect(mockOpenFile).toHaveBeenCalledWith(windowsPage, PROJECT)
  })

  it('returns the service response verbatim', async () => {
    mockOpenFile.mockResolvedValue({ success: true, usedFallback: true })
    const { gated } = await getHandlers()
    expect(await gated(makeEvent(TRUSTED_FRAME), { filePath: PAGE })).toEqual({
      success: true,
      usedFallback: true
    })
  })

  it('never leaks a raw error when the service throws', async () => {
    const raw = Object.assign(new Error(`EACCES: permission denied, open '${PAGE}'`), {
      code: 'EACCES'
    })
    mockOpenFile.mockRejectedValue(raw)
    const { gated } = await getHandlers()
    const response = await gated(makeEvent(TRUSTED_FRAME), { filePath: PAGE })

    expect(response).toEqual({
      success: false,
      errorCode: ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED,
      error: ERROR_MESSAGES[ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED]
    })
    expect(BrowserOpenFileResponseSchema.safeParse(response).success).toBe(true)
    expect(JSON.stringify(response)).not.toContain('Private Projects')
    const loggedError = mockLogger.error.mock.calls[0][1] as Error
    expect(loggedError.message).not.toContain('Private Projects')
  })
})
