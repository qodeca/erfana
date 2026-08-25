// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared test harness for the {@link ImageViewerPanel} suites.
 *
 * The panel's tests were split by concern across four files (characterization,
 * refresh, status, deleted-banner). They all need the same ~150 lines of
 * environment scaffolding – a fake `window.api`, a fake file watcher whose
 * listeners the test drives by hand, and jsdom patches for the image decode
 * pipeline. This module owns that scaffolding so the split files stay small and
 * cannot drift apart.
 *
 * @module ImageViewerPanel/__test__/testUtils
 * @see ImageViewerPanel.test.tsx for the characterization baseline
 */

import { vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, type RenderResult } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import type { ImageReadResponse } from '../../../../../../shared/ipc/file-image-schema'
import type {
  ImageExportRequest,
  ImageExportResponse
} from '../../../../../../shared/ipc/image-export-schema'
import { ImageViewerPanel } from '../ImageViewerPanel'
import { TEST_IDS } from '../../../../constants/testids'

/** Panel params shape the viewer consumes. */
export type ImageViewerProps = IDockviewPanelProps<{ filePath: string }>

type WatchCallback = (data: { filePath: string }) => void
type WatchErrorCallback = (data: { filePath: string; error: string }) => void

/** Intrinsic size the fake decoder reports before a test overrides it. */
const DEFAULT_NATURAL_SIZE = { width: 800, height: 600 }

/** Container box used by every `getBoundingClientRect` call under test. */
const CONTAINER_BOX = { width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }

/** Default file path used by {@link ImageViewerHarness.renderAndSettle}. */
export const DEFAULT_IMAGE_PATH = '/proj/icon.png'

/** The fake `window.api.fileWatch` bridge. */
export interface MockFileWatch {
  start: Mock
  stop: Mock
  pause: Mock
  resume: Mock
  onFileChanged: Mock
  onFileDeleted: Mock
  onFileError: Mock
}

/** Handles returned by {@link installImageViewerHarness}. */
export interface ImageViewerHarness {
  /**
   * The bytes the fake disk is currently serving.
   *
   * Not a bridge of its own – {@link ImageViewerHarness.readImage} calls it for
   * the `dataUrl` half of an `ok` response. Point it at new bytes (or make it
   * reject) to stage "the file was rewritten" / "the read failed", and assert
   * on its call count to count reads.
   */
  readBytes: Mock<(path: string) => Promise<string>>
  /**
   * Fake `window.api.file.readImage` – the real bridge under test.
   *
   * Its default implementation answers `ok` with {@link ImageViewerHarness.readBytes}
   * and a FRESH version every call, i.e. "the file genuinely changed", which is
   * what every watcher event in these suites represents. Override it (see
   * {@link ImageViewerHarness.serveUnchanged}) to exercise the skip path.
   */
  readImage: Mock<(path: string, knownVersion?: string) => Promise<ImageReadResponse>>
  /**
   * Makes the fake disk hold still: from now on a read whose `knownVersion`
   * matches the version last handed out answers `unchanged`, and no bytes are
   * read. Returns to normal on the next `beforeEach`.
   */
  serveUnchanged: () => void
  /**
   * Undoes {@link ImageViewerHarness.serveUnchanged} – the file moved again, so
   * the next read is a full one carrying a fresh version. This is the default,
   * so it is only needed after a deliberate `serveUnchanged`.
   */
  serveChanged: () => void
  /** Fake `window.api.file.getStats`. */
  getStats: Mock<(path: string) => Promise<{ size: number }>>
  /**
   * Fake `window.api.imageExport.run` (issue #73).
   *
   * Answers a plain success for whichever target was asked for - a written file
   * for `png`/`pdf`, no `filePath` for `clipboard` - so a suite that only cares
   * that the button is wired needs no setup. Override it to stage a
   * cancellation, a failure or a qualifier-bearing selection.
   */
  imageExportRun: Mock<(request: ImageExportRequest) => Promise<ImageExportResponse>>
  /** Fake `window.api.fileWatch` bridge. */
  fileWatch: MockFileWatch
  /**
   * Overrides the intrinsic size reported by both the DOM `<img>` and the
   * off-DOM `new Image()` decoder, so a "the file was rewritten at a different
   * size" scenario is set up in one call.
   */
  setNaturalSize: (width: number, height: number) => void
  /** Emits a watcher `changed` event to every subscribed listener. */
  emitChanged: (filePath: string) => void
  /** Emits a watcher `deleted` event to every subscribed listener. */
  emitDeleted: (filePath: string) => void
  /** Emits a watcher `error` event to every subscribed listener. */
  emitWatchError: (filePath: string, error: string) => void
  /**
   * Builds the minimal `IDockviewPanelProps` surface the panel consumes.
   *
   * The returned `api` keeps a live title, so the same object can be handed to
   * a tab component and the tab will re-render when the panel calls `setTitle`.
   */
  makeProps: (filePath: string) => ImageViewerProps
  /** Renders the panel, waits for the initial load to settle, returns the view. */
  renderAndSettle: (filePath?: string) => Promise<RenderResult>
}

/**
 * Installs the shared image-viewer test environment.
 *
 * Call once at module scope in a test file; it registers its own `beforeEach`
 * and `afterEach`, so every test gets a clean watcher, clean mocks and a fresh
 * `portal-root`. The returned handles are stable across tests – capture them
 * once and use them inside `it` blocks.
 *
 * @returns Mock bridges, watcher emitters and render helpers
 *
 * @example
 * ```tsx
 * const h = installImageViewerHarness()
 *
 * it('refreshes on a change event', async () => {
 *   await h.renderAndSettle()
 *   h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
 *   h.emitChanged(DEFAULT_IMAGE_PATH)
 * })
 * ```
 */
export function installImageViewerHarness(): ImageViewerHarness {
  let naturalSize = { ...DEFAULT_NATURAL_SIZE }

  let changedListeners: WatchCallback[] = []
  let deletedListeners: WatchCallback[] = []
  let errorListeners: WatchErrorCallback[] = []

  const readBytes = vi.fn<(path: string) => Promise<string>>()
  const readImage = vi.fn<(path: string, knownVersion?: string) => Promise<ImageReadResponse>>()
  const getStats = vi.fn<(path: string) => Promise<{ size: number }>>()
  const imageExportRun = vi.fn<(request: ImageExportRequest) => Promise<ImageExportResponse>>()

  /** Default export behaviour: it worked, and nothing needed reporting. */
  const exportSucceeds = async ({ target }: ImageExportRequest): Promise<ImageExportResponse> =>
    target === 'clipboard'
      ? { success: true, target, output: { width: 800, height: 600 } }
      : {
          success: true,
          target,
          filePath: `/exports/icon.${target}`,
          output: { width: 800, height: 600 }
        }

  /** Version counter behind the fake disk; bumped per minted version. */
  let versionSeq = 0
  /** Version the fake disk last handed out, for the `unchanged` answer. */
  let servedVersion = 'v0'

  /**
   * Default bridge behaviour: every read is a real read of fresh bytes.
   *
   * A watcher event in these suites always stands for a genuine rewrite, so the
   * version differs every time and the hook never takes the skip path unless a
   * test asks for it.
   */
  const alwaysChanged = async (path: string): Promise<ImageReadResponse> => {
    const dataUrl = await readBytes(path)
    versionSeq += 1
    servedVersion = `v${versionSeq}`
    return { status: 'ok', dataUrl, version: servedVersion }
  }

  const fileWatch: MockFileWatch = {
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    pause: vi.fn().mockResolvedValue({ success: true }),
    resume: vi.fn().mockResolvedValue({ success: true }),
    onFileChanged: vi.fn((cb: WatchCallback) => {
      changedListeners.push(cb)
      return () => {
        changedListeners = changedListeners.filter((l) => l !== cb)
      }
    }),
    onFileDeleted: vi.fn((cb: WatchCallback) => {
      deletedListeners.push(cb)
      return () => {
        deletedListeners = deletedListeners.filter((l) => l !== cb)
      }
    }),
    onFileError: vi.fn((cb: WatchErrorCallback) => {
      errorListeners.push(cb)
      return () => {
        errorListeners = errorListeners.filter((l) => l !== cb)
      }
    })
  }

  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
  const originalImage = globalThis.Image

  beforeEach(() => {
    naturalSize = { ...DEFAULT_NATURAL_SIZE }
    changedListeners = []
    deletedListeners = []
    errorListeners = []

    versionSeq = 0
    servedVersion = 'v0'
    readBytes.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
    readImage.mockReset().mockImplementation(alwaysChanged)
    getStats.mockReset().mockResolvedValue({ size: 2048 })
    imageExportRun.mockReset().mockImplementation(exportSucceeds)
    fileWatch.start.mockClear().mockResolvedValue({ success: true })
    fileWatch.stop.mockClear().mockResolvedValue({ success: true })
    fileWatch.pause.mockClear()
    fileWatch.resume.mockClear()

    // NOTE: extend `window`, never `vi.stubGlobal('window', …)` – replacing the
    // window object destroys React's DOM internals.
    ;(window as unknown as { api: unknown }).api = {
      file: { readImage, getStats },
      fileWatch,
      imageExport: { run: imageExportRun }
    }

    // jsdom lays everything out as 0x0; the fit maths needs a real box.
    Element.prototype.getBoundingClientRect = vi.fn(
      () => CONTAINER_BOX as DOMRect
    ) as unknown as typeof Element.prototype.getBoundingClientRect

    // jsdom never loads image bytes, so `naturalWidth`/`naturalHeight` are always
    // 0 and `HTMLImageElement.prototype.decode` does not exist. Both the DOM
    // element and the off-DOM `new Image()` decoder read the same mock size, so a
    // test changes dimensions in one place.
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => naturalSize.width
    })
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get: () => naturalSize.height
    })
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      writable: true,
      value: function decode(this: HTMLImageElement) {
        return this.src ? Promise.resolve() : Promise.reject(new Error('no src'))
      }
    })

    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    globalThis.Image = originalImage

    // The three properties defined above do not exist on a real
    // HTMLImageElement.prototype, so they are deleted rather than restored -
    // leaving them behind would let one suite's fake decoder leak into the
    // next file that renders an <img> (QG-6 finding L9).
    // `naturalWidth` / `naturalHeight` are readonly in lib.dom, hence the
    // Record cast rather than Partial<HTMLImageElement>.
    const imageProto = HTMLImageElement.prototype as unknown as Record<string, unknown>
    delete imageProto.naturalWidth
    delete imageProto.naturalHeight
    delete imageProto.decode

    document.getElementById('portal-root')?.remove()
    vi.useRealTimers()
  })

  // A LIVE title: `setTitle` updates `api.title` and notifies
  // `onDidTitleChange` subscribers, exactly as dockview does. A `vi.fn()` stub
  // let a test assert "setTitle was called" while the tab component rendered
  // nothing at all - which is the defect QG-11a H5 caught.
  const makeProps = (filePath: string): ImageViewerProps => {
    const titleListeners = new Set<(event: { title: string }) => void>()

    const api = {
      id: `panel-${filePath}`,
      isVisible: true,
      isActive: true,
      title: undefined as string | undefined,
      close: vi.fn(),
      setTitle: vi.fn((title: string) => {
        api.title = title
        for (const listener of [...titleListeners]) listener({ title })
      }),
      onDidTitleChange: vi.fn((listener: (event: { title: string }) => void) => {
        titleListeners.add(listener)
        return { dispose: () => titleListeners.delete(listener) }
      }),
      onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() }))
    }

    return { params: { filePath }, api } as unknown as ImageViewerProps
  }

  return {
    readBytes,
    readImage,
    getStats,
    imageExportRun,
    serveUnchanged: () => {
      readImage.mockImplementation(async (path, knownVersion) =>
        knownVersion === servedVersion
          ? { status: 'unchanged', version: servedVersion }
          : alwaysChanged(path)
      )
    },
    serveChanged: () => {
      readImage.mockImplementation(alwaysChanged)
    },
    fileWatch,
    setNaturalSize: (width, height) => {
      naturalSize = { width, height }
    },
    emitChanged: (filePath) => {
      for (const listener of [...changedListeners]) listener({ filePath })
    },
    emitDeleted: (filePath) => {
      for (const listener of [...deletedListeners]) listener({ filePath })
    },
    emitWatchError: (filePath, error) => {
      for (const listener of [...errorListeners]) listener({ filePath, error })
    },
    makeProps,
    renderAndSettle: async (filePath = DEFAULT_IMAGE_PATH) => {
      const view = render(<ImageViewerPanel {...makeProps(filePath)} />)
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
      return view
    }
  }
}

/**
 * Every `role="alert"` in the tree EXCEPT the panel's export alert region.
 *
 * The export feature (issue #73) mounts a permanently-present, empty
 * `role="alert"` region - a live region added to the DOM together with its text
 * is not announced, so it has to exist while idle. A bare `getAllByRole('alert')`
 * therefore no longer means "a banner or an error screen is showing", which is
 * what the assertions using this helper are actually about.
 *
 * @returns The alert elements that carry real content, in document order
 */
export function alertsExcludingExportRegion(): HTMLElement[] {
  return screen
    .queryAllByRole('alert')
    .filter((element) => element.dataset.testid !== TEST_IDS.IMAGE_VIEWER_EXPORT_ALERT)
}
