// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * screenshotOverlay preload tests
 *
 * Focus: the one-way log bridge added for #60. The overlay window never gets
 * `window.api`, so without this bridge a failure inside it leaves no record at
 * all. Coverage:
 * - `overlayApi.log` sends on the SHARED `logging:log` channel (no new channel)
 * - the log payload is forwarded verbatim and carries no capture token
 * - the pre-existing tokenised verbs are unchanged
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SCREENSHOT_CHANNELS } from '../shared/ipc/screenshot-channels'
import type { LogEntry } from '../shared/ipc/logging-schema'

const { exposeInMainWorld, send } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn((key: string, value: unknown) => {
    ;(globalThis as unknown as Record<string, unknown>)[key] = value
  }),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { send }
}))

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

interface OverlayApi {
  areaSelected: (selection: { x: number; y: number; width: number; height: number }) => void
  areaCancelled: () => void
  log: (entry: LogEntry) => void
}

/** Re-imports the preload with a given argv so the token is re-read. */
async function loadOverlayPreload(argv: string[]): Promise<OverlayApi> {
  const originalArgv = process.argv
  process.argv = argv
  try {
    vi.resetModules()
    await import('./screenshotOverlay')
  } finally {
    process.argv = originalArgv
  }
  return (globalThis as unknown as { overlayApi: OverlayApi }).overlayApi
}

const ENTRY: LogEntry = {
  level: 'fatal',
  message: '[GlobalErrorTrail] uncaught error',
  timestamp: '2026-08-11T10:00:00.000Z',
  source: 'renderer',
  context: { route: 'area-select' },
  error: { name: 'TypeError', message: 'boom', stack: 'TypeError: boom' }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete (globalThis as unknown as Record<string, unknown>).overlayApi
})

describe('screenshotOverlay preload — log bridge (#60)', () => {
  it('exposes log alongside the capture verbs', async () => {
    const overlayApi = await loadOverlayPreload(['electron', '.', `--overlay-token=${TOKEN}`])

    expect(typeof overlayApi.log).toBe('function')
    expect(typeof overlayApi.areaSelected).toBe('function')
    expect(typeof overlayApi.areaCancelled).toBe('function')
  })

  it('sends the entry on the shared logging:log channel', async () => {
    const overlayApi = await loadOverlayPreload(['electron', '.', `--overlay-token=${TOKEN}`])

    overlayApi.log(ENTRY)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('logging:log', ENTRY)
  })

  it('introduces no additional channel for logging', async () => {
    const overlayApi = await loadOverlayPreload(['electron', '.', `--overlay-token=${TOKEN}`])

    overlayApi.log(ENTRY)

    const channels = send.mock.calls.map(([channel]) => channel)
    expect(channels).toEqual(['logging:log'])
  })

  it('does not attach the capture token to a log payload', async () => {
    const overlayApi = await loadOverlayPreload(['electron', '.', `--overlay-token=${TOKEN}`])

    overlayApi.log(ENTRY)

    const [, payload] = send.mock.calls[0]
    expect(payload).not.toHaveProperty('token')
  })

  it('still logs when the overlay was launched without a valid token', async () => {
    // The trail must survive the degraded launch path — that is exactly when
    // something has already gone wrong.
    const overlayApi = await loadOverlayPreload(['electron', '.'])

    overlayApi.log(ENTRY)

    expect(send).toHaveBeenCalledWith('logging:log', ENTRY)
  })

  it('leaves the tokenised capture verbs unchanged', async () => {
    const overlayApi = await loadOverlayPreload(['electron', '.', `--overlay-token=${TOKEN}`])

    const selection = { x: 1, y: 2, width: 3, height: 4 }
    overlayApi.areaSelected(selection)
    overlayApi.areaCancelled()

    expect(send).toHaveBeenNthCalledWith(1, SCREENSHOT_CHANNELS.AREA_SELECTED, {
      token: TOKEN,
      selection
    })
    expect(send).toHaveBeenNthCalledWith(2, SCREENSHOT_CHANNELS.AREA_CANCELLED, { token: TOKEN })
  })
})
