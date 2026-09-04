// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the rasterize-harness preload.
 *
 * Two things are being held to:
 *
 * 1. **The surface is three verbs, and `imageExport.run` is NOT one of them.**
 *    The harness decodes untrusted image bytes; it must be able to answer an
 *    export, never to start one.
 * 2. **The per-export token is read defensively.** argv is walked in reverse
 *    and the value must be UUID-shaped, so an injected flag ahead of Electron's
 *    own `additionalArguments` cannot win and arbitrary text cannot leak into
 *    IPC.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IMAGE_EXPORT_CHANNELS } from '../shared/ipc/image-export-channels'

const { exposeInMainWorld, send, on } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn((key: string, value: unknown) => {
    ;(globalThis as unknown as Record<string, unknown>)[key] = value
  }),
  send: vi.fn(),
  on: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { send, on }
}))

// UUID-shaped (the preload validates the shape) but deliberately zero-entropy —
// a realistic UUID here trips gitleaks' generic-api-key rule.
const TOKEN = '00000000-0000-4000-8000-000000000000'
const OTHER_TOKEN = '11111111-1111-4111-8111-111111111111'

interface HarnessApi {
  ready: () => void
  onRender: (callback: (instruction: unknown) => void) => void
  postResult: (result: object) => void
}

/** Re-import the preload with a given argv so the token is re-read. */
async function loadPreload(argv: string[]): Promise<HarnessApi> {
  const originalArgv = process.argv
  process.argv = argv
  try {
    vi.resetModules()
    await import('./imageExport')
  } finally {
    process.argv = originalArgv
  }
  return (globalThis as unknown as { imageExportApi: HarnessApi }).imageExportApi
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exposed surface', () => {
  it('exposes exactly ready, onRender and postResult', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    expect(Object.keys(api).sort()).toEqual(['onRender', 'postResult', 'ready'])
  })

  it('does NOT expose a way to start an export', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    expect(api).not.toHaveProperty('run')
    expect(JSON.stringify(Object.keys(api))).not.toContain('run')
  })

  it('is exposed under its own global, separate from window.api', async () => {
    await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(exposeInMainWorld.mock.calls[0][0]).toBe('imageExportApi')
  })
})

describe('inlined channel names stay identical to the canonical ones', () => {
  // `imageExport.ts` deliberately spells the three harness channel names out
  // rather than importing IMAGE_EXPORT_CHANNELS as a value: two sandboxed
  // preload entries sharing one module make Rollup emit
  // `out/preload/chunks/*.js`, which a sandboxed preload cannot require, and
  // the whole app then boots into the root error screen. The annotation on
  // each inlined constant makes drift a typecheck failure; these assertions
  // make it a test failure too, so the duplication can never reach a user.
  it('uses the canonical HARNESS_READY channel for the handshake', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.ready()
    expect(send.mock.calls[0][0]).toBe(IMAGE_EXPORT_CHANNELS.HARNESS_READY)
  })

  it('uses the canonical HARNESS_RENDER channel for the subscription', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.onRender(() => {})
    expect(on.mock.calls[0][0]).toBe(IMAGE_EXPORT_CHANNELS.HARNESS_RENDER)
  })

  it('uses the canonical HARNESS_RESULT channel for results', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.postResult({ ok: true, width: 1, height: 1 })
    expect(send.mock.calls[0][0]).toBe(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT)
  })

  it('never reaches for RUN — the harness cannot start an export', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.ready()
    api.postResult({ ok: true, width: 1, height: 1 })
    const channels = send.mock.calls.map((call) => call[0])
    expect(channels).not.toContain(IMAGE_EXPORT_CHANNELS.RUN)
  })
})

describe('the per-export token', () => {
  it('tags the ready handshake', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.ready()
    expect(send).toHaveBeenCalledWith(IMAGE_EXPORT_CHANNELS.HARNESS_READY, { token: TOKEN })
  })

  it('tags every result', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.postResult({ ok: true, width: 4, height: 4 })
    expect(send).toHaveBeenCalledWith(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: true,
      width: 4,
      height: 4,
      token: TOKEN
    })
  })

  it('takes the LAST token in argv, because Electron appends its own last', async () => {
    const api = await loadPreload([
      'electron',
      `--image-export-token=${OTHER_TOKEN}`,
      `--image-export-token=${TOKEN}`
    ])
    api.ready()
    expect(send).toHaveBeenCalledWith(IMAGE_EXPORT_CHANNELS.HARNESS_READY, { token: TOKEN })
  })

  it('rejects a token that is not UUID-shaped, so junk never reaches IPC', async () => {
    const api = await loadPreload(['electron', '--image-export-token=; rm -rf /'])
    api.ready()
    expect(send).toHaveBeenCalledWith(IMAGE_EXPORT_CHANNELS.HARNESS_READY, { token: null })
  })

  it('sends a null token when the flag is absent entirely', async () => {
    const api = await loadPreload(['electron'])
    api.postResult({ ok: false, reason: 'decode' })
    expect(send).toHaveBeenCalledWith(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: false,
      reason: 'decode',
      token: null
    })
  })

  it('cannot be overridden by a result that carries its own token', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    api.postResult({ ok: true, width: 1, height: 1, token: OTHER_TOKEN } as object)
    expect(send.mock.calls[0][1]).toMatchObject({ token: TOKEN })
  })
})

describe('render subscription', () => {
  it('subscribes to the render channel and forwards the instruction', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    const received: unknown[] = []
    api.onRender((instruction) => received.push(instruction))

    expect(on).toHaveBeenCalledWith(IMAGE_EXPORT_CHANNELS.HARNESS_RENDER, expect.any(Function))
    const listener = on.mock.calls[0][1] as (event: unknown, payload: unknown) => void
    listener({}, { mode: 'bitmap' })
    expect(received).toEqual([{ mode: 'bitmap' }])
  })

  it('keeps forwarding, so a second instruction in one export still arrives', async () => {
    const api = await loadPreload(['electron', `--image-export-token=${TOKEN}`])
    const received: unknown[] = []
    api.onRender((instruction) => received.push(instruction))

    const listener = on.mock.calls[0][1] as (event: unknown, payload: unknown) => void
    listener({}, { mode: 'bitmap' })
    listener({}, { mode: 'svg' })
    expect(received).toHaveLength(2)
  })
})
