// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * buildPreviewGraph – part 1's cause C3 (issue #124; part 1 §1.3, §1.4): the
 * zoom a view is sized with must come from the window the view lives in, never
 * from the first window Electron lists.
 *
 * WI-8 wrote the two-window case as `it.fails` while the defect stood (the view
 * came out `{100, 40, 400, 300}` instead of `{125, 50, 500, 375}`). WI-9 sizes
 * views with their host's zoom, so it is now a plain `it` that guards the fix.
 * The one-window case is the control: the same harness sizes the view
 * correctly, so a harness fault cannot pass for the fix. After C3, M10
 * (`zoom-mismatch`) is a tripwire: silent with the zoom dep the app runs with,
 * loud with one that ignores the host.
 *
 * Production passes no `getZoomFactor` to the graph (`src/main/index.ts`), so the
 * default under test here is the one the app runs with. The graph's zoom dep is
 * fed to the real bounds module unchanged, the way `previewLiveWiring.ts` does.
 *
 * Split from `buildPreviewGraph.test.ts`: a new file per WI-8's rules, and its
 * module-level mocks would change what that file tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BOUNDS_DROP_MESSAGE } from '../../../shared/dropReporter'
import type { GlobalSettings } from '../../../shared/ipc/global-settings-schema'
import type { PreviewBounds } from '../../../shared/ipc/preview-types'
import { logger } from '../../services/LoggingService'
import type { PreviewViewDeps } from '../../services/preview/PreviewViewService'
import { LIVE_BOUNDS_DROP_REASON } from '../../services/preview/previewBoundsDropLog'
import { createPreviewLiveBounds } from '../../services/preview/previewLiveBounds'
import { buildPreviewGraph, type BuildPreviewGraphDeps } from './buildPreviewGraph'

/** A window as `BrowserWindow.getAllWindows()` hands it back, with its own zoom. */
interface FakeWindow {
  readonly id: number
  isDestroyed(): boolean
  getContentBounds(): { x: number; y: number; width: number; height: number }
  readonly webContents: { getZoomFactor(): number }
}

const electron = vi.hoisted(() => ({ windows: [] as FakeWindow[] }))
/** What the graph handed the service it built. */
const built = vi.hoisted(() => ({ deps: null as PreviewViewDeps | null }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electron.windows, fromId: () => null },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false, on: vi.fn() }
}))
vi.mock('../../services/LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))
vi.mock('../../services/preview/PreviewViewService', () => ({
  PreviewViewService: class {
    constructor(deps: PreviewViewDeps) {
      built.deps = deps
    }
  }
}))

/** A window at `zoom`, large enough that no rect below is clamped. */
function fakeWindow(id: number, zoom: number): FakeWindow {
  return {
    id,
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 2000, height: 1500 }),
    webContents: { getZoomFactor: () => zoom }
  }
}

/** The placeholder rect in CSS px, and the same rect at a host zoom of 1.25. */
const CSS_RECT: PreviewBounds = { x: 100, y: 40, width: 400, height: 300 }
const AT_125: PreviewBounds = { x: 125, y: 50, width: 500, height: 375 }

/** The context of an M10 line: the zoom a view was sized with is not its host's. */
const ZOOM_MISMATCH = expect.objectContaining({ reason: LIVE_BOUNDS_DROP_REASON.zoomMismatch })

/**
 * Build the graph the way the app does – or with `getZoomFactor` injected – then
 * size one view living in `host` with the zoom dep the graph produced.
 *
 * @returns The DIP rect handed to the view.
 */
function sizeViewIn(
  host: FakeWindow,
  getZoomFactor?: BuildPreviewGraphDeps['getZoomFactor']
): PreviewBounds | undefined {
  buildPreviewGraph({
    getProjectPath: () => null,
    getSettings: () => ({}) as GlobalSettings,
    getZoomFactor
  })
  const deps = built.deps
  if (deps === null) throw new Error('the graph built no service')

  const setBounds = vi.fn()
  const bounds = createPreviewLiveBounds({
    panelId: 'preview-a',
    view: { setBounds },
    window: host,
    contents: { executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve(0)) },
    emit: { boundsApplied: vi.fn() },
    getZoomFactor: deps.getZoomFactor,
    isDefunct: () => false
  })
  bounds.apply(CSS_RECT, 0, false)
  return setBounds.mock.calls[0]?.[0] as PreviewBounds | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  electron.windows = []
  built.deps = null
})

describe('C3 – a view is sized with its host window’s zoom (#124 WI-8, WI-9)', () => {
  it('control: with one window, a view is sized with that window’s zoom', () => {
    const host = fakeWindow(1, 1.25)
    electron.windows = [host]

    expect(sizeViewIn(host)).toEqual(AT_125)
  })

  it('a view is sized with its host window’s zoom, not the first window’s', () => {
    // Two windows at different zooms; the preview lives in the second one.
    // `getAllWindows()` order is Electron's, not Erfana's to choose.
    const other = fakeWindow(1, 1)
    const host = fakeWindow(2, 1.25)
    electron.windows = [other, host]

    expect(sizeViewIn(host)).toEqual(AT_125)
  })
})

describe('M10 after C3 – a tripwire (#124 WI-9)', () => {
  it('stays silent with the zoom dep the app runs with, whatever window is first', () => {
    const host = fakeWindow(2, 1.25)
    electron.windows = [fakeWindow(1, 1), host]

    sizeViewIn(host)

    expect(logger.warn).not.toHaveBeenCalledWith(BOUNDS_DROP_MESSAGE, ZOOM_MISMATCH)
  })

  it('control: fires when a zoom dep that ignores the host is wired in', () => {
    const host = fakeWindow(1, 1.25)
    electron.windows = [host]

    sizeViewIn(host, () => 1)

    expect(logger.warn).toHaveBeenCalledWith(BOUNDS_DROP_MESSAGE, ZOOM_MISMATCH)
  })
})
