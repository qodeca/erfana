// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview lifecycle-handler tests (Issue #74, item 44).
 *
 * Covers: an untrusted sender is rejected (service untouched); a malformed
 * payload is rejected; and open / close / setBounds delegate to the service.
 * electron's ipcMain is mocked to capture the registered handlers; the service,
 * eligibility, window resolver and sender predicate are injected fakes.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { PreviewChannels } from '../../../shared/ipc/preview-channels'
import type { PreviewBoundsPayload } from '../../../shared/ipc/preview-schema'
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
    expect(result).toMatchObject({ ok: false })
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
    // `ack` arrives as `undefined` for an ordinary pump push: the flag is
    // omitted from the wire payload rather than sent as `false`, so a
    // steady-state push is byte-identical to what it was before it existed.
    expect(service.setBounds).toHaveBeenCalledWith('p1', BOUNDS, 5, undefined)
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
    expect(service.setBounds).toHaveBeenCalledWith('p1', BOUNDS, 6, true)
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
