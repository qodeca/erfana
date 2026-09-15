// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview lifecycle-handler tests (Issue #74, item 44).
 *
 * Covers: an untrusted sender is rejected (service untouched); a malformed
 * payload is rejected; open / close / setBounds delegate to the service; and
 * the setBounds channel's rate-capped drop lines (issue #124, M1–M3).
 * electron's ipcMain is mocked to capture the registered handlers; the service,
 * eligibility, window resolver and sender predicate are injected fakes.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PreviewBoundsPayload } from '../../../shared/ipc/preview-schema'
import { BOUNDS_DROP_MESSAGE } from '../../../shared/dropReporter'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../../services/LoggingService'
import { SET_BOUNDS_DROP_REASON } from '../../services/preview/previewBoundsDropLog'
import {
  registerPreviewLifecycleHandlers,
  type PreviewLifecycleHandlerDeps,
  type PreviewLifecycleService
} from './lifecycle-handlers'

type Handler = (event: unknown, arg: unknown) => unknown
const handlers: Record<string, Handler> = {}
const listeners: Record<string, Handler> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers[channel] = handler
    }),
    on: vi.fn((channel: string, listener: Handler) => {
      listeners[channel] = listener
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn()
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const BOUNDS: PreviewBoundsPayload = { x: 0, y: 0, width: 100, height: 100 }
const FAKE_WINDOW = {
  id: 1,
  isDestroyed: () => false,
  contentView: {},
  getContentBounds: () => BOUNDS
} as never

function makeService(): PreviewLifecycleService & {
  open: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  setVisibility: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
} {
  return {
    open: vi.fn(async () => ({ ok: true }) as const),
    close: vi.fn(async () => undefined),
    setBounds: vi.fn(),
    setVisibility: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined)
  }
}

function setup(overrides?: Partial<PreviewLifecycleHandlerDeps>): {
  service: ReturnType<typeof makeService>
  eligibilityCheck: ReturnType<typeof vi.fn>
  trusted: { value: boolean }
  dispose: () => void
} {
  const service = makeService()
  const eligibilityCheck = vi.fn(async () => ({ eligible: true }) as const)
  const trusted = { value: true }
  const dispose = registerPreviewLifecycleHandlers({
    service,
    eligibility: { check: eligibilityCheck },
    getProjectPath: () => '/project',
    isTrustedSender: () => trusted.value,
    isTrustedAppSender: () => true,
    resolveWindow: () => FAKE_WINDOW,
    ...overrides
  })
  return { service, eligibilityCheck, trusted, dispose }
}

const event = {} as IpcMainInvokeEvent & IpcMainEvent

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  for (const key of Object.keys(listeners)) delete listeners[key]
})

describe('registerPreviewLifecycleHandlers', () => {
  it('registers all six control channels', () => {
    setup()
    expect(handlers[PreviewChannels.CHECK_ELIGIBILITY]).toBeTypeOf('function')
    expect(handlers[PreviewChannels.OPEN]).toBeTypeOf('function')
    expect(handlers[PreviewChannels.CLOSE]).toBeTypeOf('function')
    expect(handlers[PreviewChannels.RELOAD]).toBeTypeOf('function')
    expect(listeners[PreviewChannels.SET_BOUNDS]).toBeTypeOf('function')
    expect(listeners[PreviewChannels.SET_VISIBILITY]).toBeTypeOf('function')
  })

  it('unregisters every channel it registered', () => {
    // THE GAP. `preview:setZoom` was registered and left behind by the
    // disposer, whose own doc says it "removes all of them". Latent today —
    // there is one call site and it disposes only at quit — but the bundle is
    // modelled as re-registrable, and `ipcMain.handle` THROWS on a second
    // registration for the same channel, which would abort the find and
    // allowlist bundles registered after it.
    //
    // Derived from what was registered rather than restated, so a channel added
    // later cannot be forgotten here the way SET_ZOOM was.
    const { dispose } = setup()
    const registered = [...Object.keys(handlers), ...Object.keys(listeners)]
    expect(registered.length).toBeGreaterThan(0)

    dispose()

    const removed = [
      ...(ipcMain.removeHandler as unknown as Mock).mock.calls.map((c) => c[0] as string),
      ...(ipcMain.removeListener as unknown as Mock).mock.calls.map((c) => c[0] as string)
    ]
    expect([...registered].sort()).toEqual([...new Set(removed)].sort())
  })

  it('rejects an untrusted sender on open (service untouched)', async () => {
    const { service, trusted } = setup()
    trusted.value = false

    const result = await handlers[PreviewChannels.OPEN](event, {
      panelId: 'p1',
      filePath: '/project/a.html',
      bounds: BOUNDS
    })

    expect(service.open).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, errorCode: expect.any(String) })
  })

  it('rejects a malformed open payload (missing bounds)', async () => {
    const { service } = setup()

    const result = await handlers[PreviewChannels.OPEN](event, {
      panelId: 'p1',
      filePath: '/project/a.html'
    })

    expect(service.open).not.toHaveBeenCalled()
    // A named code, so a renderer log line says WHY (a 249-char path used to
    // fail here as UNKNOWN_ERROR with nothing on screen, 2026-09-03).
    expect(result).toEqual({ ok: false, errorCode: 'PREVIEW_OPEN_INVALID_REQUEST' })
  })

  it('rejects an open payload carrying a forbidden projectPath key (.strict)', async () => {
    const { service } = setup()

    await handlers[PreviewChannels.OPEN](event, {
      panelId: 'p1',
      filePath: '/project/a.html',
      bounds: BOUNDS,
      projectPath: '/evil'
    })

    expect(service.open).not.toHaveBeenCalled()
  })

  it('open delegates a valid request to the service with the resolved window', async () => {
    const { service } = setup()

    const result = await handlers[PreviewChannels.OPEN](event, {
      panelId: 'p1',
      filePath: '/project/a.html',
      bounds: BOUNDS
    })

    expect(service.open).toHaveBeenCalledTimes(1)
    expect(service.open).toHaveBeenCalledWith(
      { panelId: 'p1', filePath: '/project/a.html', bounds: BOUNDS },
      FAKE_WINDOW
    )
    expect(result).toEqual({ ok: true })
  })

  it('close delegates to the service', async () => {
    const { service } = setup()
    await handlers[PreviewChannels.CLOSE](event, { panelId: 'p1' })
    expect(service.close).toHaveBeenCalledWith('p1')
  })

  it('setBounds delegates panelId, bounds and seq to the service', () => {
    const { service } = setup()
    listeners[PreviewChannels.SET_BOUNDS](event, { panelId: 'p1', bounds: BOUNDS, seq: 5 })
    // `ack` and `settled` arrive as `undefined` for an ordinary pump push: the
    // flags are omitted from the wire payload rather than sent as `false`, so a
    // steady-state push is byte-identical to what it was before they existed.
    expect(service.setBounds).toHaveBeenCalledWith('p1', BOUNDS, 5, undefined, undefined)
  })

  it('forwards a request for a bounds confirmation', () => {
    // The flag is what makes a transition that REVEALS Erfana's chrome wait for
    // the page to move. Dropped here, the renderer would render controls into
    // space the page is still painting over — and a native view takes input
    // over its rect whatever the DOM says.
    const { service } = setup()
    listeners[PreviewChannels.SET_BOUNDS](event, {
      panelId: 'p1',
      bounds: BOUNDS,
      seq: 6,
      ack: true
    })
    expect(service.setBounds).toHaveBeenCalledWith('p1', BOUNDS, 6, true, undefined)
  })

  it('forwards the settled push that ends a window-edge resize hold (issue #124)', () => {
    // Main shows a held view again once this push is applied. Dropped here,
    // every window-edge drag would end on the hold's timeouts instead.
    const { service } = setup()
    listeners[PreviewChannels.SET_BOUNDS](event, {
      panelId: 'p1',
      bounds: BOUNDS,
      seq: 8,
      settled: true
    })
    expect(service.setBounds).toHaveBeenCalledWith('p1', BOUNDS, 8, undefined, true)
  })

  it('refuses a setBounds payload carrying an unknown key', () => {
    // The schema is `.strict()`. Adding an optional field must not turn the
    // payload into an open bag.
    const { service } = setup()
    listeners[PreviewChannels.SET_BOUNDS](event, {
      panelId: 'p1',
      bounds: BOUNDS,
      seq: 7,
      smuggled: true
    })
    expect(service.setBounds).not.toHaveBeenCalled()
  })

  it('setVisibility delegates to the service', () => {
    const { service } = setup()
    listeners[PreviewChannels.SET_VISIBILITY](event, {
      panelId: 'p1',
      visible: false,
      reason: 'dialog'
    })
    expect(service.setVisibility).toHaveBeenCalledWith('p1', false, 'dialog')
  })

  it('checkEligibility returns the verdict from the eligibility service', async () => {
    const { eligibilityCheck } = setup()
    const result = await handlers[PreviewChannels.CHECK_ELIGIBILITY](event, {
      filePath: '/project/a.html'
    })
    expect(eligibilityCheck).toHaveBeenCalledWith('/project/a.html', '/project')
    expect(result).toEqual({ eligible: true })
  })

  it('checkEligibility reports outside-project when no project is open', async () => {
    const { eligibilityCheck } = setup({ getProjectPath: () => null })
    const result = await handlers[PreviewChannels.CHECK_ELIGIBILITY](event, {
      filePath: '/x/a.html'
    })
    expect(eligibilityCheck).not.toHaveBeenCalled()
    expect(result).toEqual({ eligible: false, reason: 'outside-project' })
  })
})

describe('setBounds drop lines (issue #124, M1–M3)', () => {
  let clock = 0
  const now = (): number => clock
  /** {@link BOUNDS} as a drop line carries it. */
  const LOGGED_RECT = { x: 0, y: 0, w: 100, h: 100 }

  beforeEach(() => {
    clock = 0
    vi.mocked(logger.warn).mockClear()
    vi.mocked(logger.error).mockClear()
    vi.mocked(logger.info).mockClear()
  })

  it('M1: logs an untrusted sender with fixed fields only – no sender URL', () => {
    const { service, trusted } = setup({ now })
    trusted.value = false

    listeners[PreviewChannels.SET_BOUNDS](
      { senderFrame: { url: 'erfana-preview://token/secret/a.html' } },
      { panelId: 'p1', bounds: BOUNDS, seq: 1 }
    )

    expect(service.setBounds).not.toHaveBeenCalled()
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [BOUNDS_DROP_MESSAGE, { source: 'main', reason: SET_BOUNDS_DROP_REASON.untrustedSender }]
    ])
  })

  it('M2: logs a malformed push with its panel id when that field is valid', () => {
    const { service } = setup({ now })

    listeners[PreviewChannels.SET_BOUNDS](event, { panelId: 'p1', bounds: BOUNDS, seq: -1 })

    expect(service.setBounds).not.toHaveBeenCalled()
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [
        BOUNDS_DROP_MESSAGE,
        {
          source: 'main',
          reason: SET_BOUNDS_DROP_REASON.invalidPayload,
          panelId: stablePathDigest('p1')
        }
      ]
    ])
  })

  it.each([
    ['no payload', null],
    ['a number', 42],
    ['an empty panel id', { panelId: '', bounds: BOUNDS, seq: 1 }],
    ['a panel id that is not a string', { panelId: 7, bounds: BOUNDS, seq: 1 }]
  ])('M2: names no panel for %s', (_case, payload) => {
    setup({ now })

    listeners[PreviewChannels.SET_BOUNDS](event, payload)

    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [BOUNDS_DROP_MESSAGE, { source: 'main', reason: SET_BOUNDS_DROP_REASON.invalidPayload }]
    ])
  })

  it('M3: logs a throwing handler at error, with the push and the error', () => {
    const { service } = setup({ now })
    const failure = new Error('view gone')
    service.setBounds.mockImplementation(() => {
      throw failure
    })

    listeners[PreviewChannels.SET_BOUNDS](event, { panelId: 'p1', bounds: BOUNDS, seq: 9 })

    expect(vi.mocked(logger.error).mock.calls).toEqual([
      [
        BOUNDS_DROP_MESSAGE,
        failure,
        {
          source: 'main',
          reason: SET_BOUNDS_DROP_REASON.handlerThrew,
          panelId: stablePathDigest('p1'),
          seq: 9,
          rect: LOGGED_RECT
        }
      ]
    ])
  })

  it('M3: logs a thrown non-error without an error object', () => {
    const { service } = setup({ now })
    service.setBounds.mockImplementation(() => {
      throw 'not an Error'
    })

    listeners[PreviewChannels.SET_BOUNDS](event, { panelId: 'p1', bounds: BOUNDS, seq: 9 })

    expect(vi.mocked(logger.error).mock.calls).toEqual([
      [
        BOUNDS_DROP_MESSAGE,
        undefined,
        expect.objectContaining({ reason: SET_BOUNDS_DROP_REASON.handlerThrew })
      ]
    ])
  })

  it('caps repeats: one line per reason per window, the next saying how many were swallowed', () => {
    const { trusted } = setup({ now })
    trusted.value = false

    for (let i = 0; i < 3; i += 1) {
      listeners[PreviewChannels.SET_BOUNDS](event, {})
    }
    clock += PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS
    listeners[PreviewChannels.SET_BOUNDS](event, {})

    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [BOUNDS_DROP_MESSAGE, { source: 'main', reason: SET_BOUNDS_DROP_REASON.untrustedSender }],
      [
        BOUNDS_DROP_MESSAGE,
        { source: 'main', reason: SET_BOUNDS_DROP_REASON.untrustedSender, suppressed: 2 }
      ]
    ])
  })

  it('writes the first line of every reason inside one window', () => {
    const { service, trusted } = setup({ now })
    service.setBounds.mockImplementation(() => {
      throw new Error('boom')
    })

    trusted.value = false
    listeners[PreviewChannels.SET_BOUNDS](event, {})
    trusted.value = true
    listeners[PreviewChannels.SET_BOUNDS](event, {})
    listeners[PreviewChannels.SET_BOUNDS](event, { panelId: 'p1', bounds: BOUNDS, seq: 1 })

    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1)
  })
})

describe('log lines carry no path and no sender URL (QG-8 T4, T5)', () => {
  const HOME = '/Users/alice'
  const PANEL = { panelId: 'p1' }
  const OPEN = { ...PANEL, filePath: '/a.html', bounds: BOUNDS }
  const VISIBILITY = { ...PANEL, visible: false, reason: 'dialog' }
  const PUSH = { ...PANEL, bounds: BOUNDS, seq: 1 }
  type Failing = [string, 'throws' | 'rejects', unknown, (s: ReturnType<typeof setup>) => Mock]
  const invoke = (channel: string, sender: unknown, request: unknown): unknown =>
    (handlers[channel] ?? listeners[channel])(sender, request)

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
    vi.mocked(logger.error).mockClear()
  })

  /** Channel, how the service fails, the request, and the service call that fails. */
  const failing: Failing[] = [
    [PreviewChannels.CHECK_ELIGIBILITY, 'rejects', { filePath: '/a' }, (s) => s.eligibilityCheck],
    [PreviewChannels.OPEN, 'rejects', OPEN, (s) => s.service.open],
    [PreviewChannels.CLOSE, 'rejects', PANEL, (s) => s.service.close],
    [PreviewChannels.RELOAD, 'rejects', PANEL, (s) => s.service.reload],
    [PreviewChannels.SET_VISIBILITY, 'rejects', VISIBILITY, (s) => s.service.setVisibility],
    [PreviewChannels.SET_VISIBILITY, 'throws', VISIBILITY, (s) => s.service.setVisibility],
    [PreviewChannels.SET_BOUNDS, 'throws', PUSH, (s) => s.service.setBounds]
  ]

  it.each(failing)('%s, service %s: logs a Node error, path cut', async (channel, how, req, fn) => {
    const error = Object.assign(new Error(`EACCES: permission denied, open '${HOME}/a.html'`), {
      code: 'EACCES',
      errno: -13,
      syscall: 'open'
    })
    const mock = fn(setup())
    if (how === 'rejects') {
      mock.mockRejectedValue(error)
    } else {
      mock.mockImplementation(() => {
        throw error
      })
    }

    await invoke(channel, event, req)

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))
    const [, logged, fields] = vi.mocked(logger.error).mock.calls[0]
    expect(logged?.message).toBe('EACCES: permission denied, open [redacted-path]')
    // The stack repeats the message: neither may hold the user's folders.
    expect(`${logged?.stack}\n${JSON.stringify(fields ?? {})}`).not.toContain(HOME)
  })

  it.each([
    PreviewChannels.CHECK_ELIGIBILITY,
    PreviewChannels.OPEN,
    PreviewChannels.CLOSE,
    PreviewChannels.RELOAD,
    PreviewChannels.SET_VISIBILITY
  ])('%s: logs an untrusted sender with no URL in the line', async (channel) => {
    const { trusted } = setup()
    trusted.value = false

    await invoke(channel, { senderFrame: { url: `file://${HOME}/a.html` } }, {})

    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [`Rejected ${channel} from untrusted sender`]
    ])
  })
})
