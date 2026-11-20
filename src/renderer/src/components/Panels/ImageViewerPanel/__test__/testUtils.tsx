// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared test harness for the {@link ImageViewerPanel} suites.
 *
 * The panel's tests were split by concern across several files
 * (characterization, refresh, status, deleted-banner, recover). They all need
 * the same environment scaffolding – a fake `window.api`, a fake watch layer
 * the test drives by hand (installed as the window's freshness environment,
 * #478 S15), and jsdom patches for the image decode pipeline. This module owns
 * that scaffolding so the split files stay small and cannot drift apart.
 *
 * The fake watch layer keeps one stamp per file: `emitChanged` moves it on (as
 * a write would) and tells every subscription on the file. The file's presence
 * is `getStats`: a rejecting `getStats` is a file that is gone, which is what
 * the tracker's probe asks before it shows a delete.
 *
 * @module ImageViewerPanel/__test__/testUtils
 * @see ImageViewerPanel.test.tsx for the characterization baseline
 */

import { vi, beforeEach, afterEach, expect, type Mock } from 'vitest'
import { act, render, screen, cleanup, waitFor, type RenderResult } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import type { ImageReadRequest, ImageReadResponse } from '../../../../../../shared/ipc/file-image-schema'
import type {
  ImageExportRequest,
  ImageExportResponse
} from '../../../../../../shared/ipc/image-export-schema'
import type {
  FileStamp,
  FreshnessSource,
  ProbeReply,
  SubscribeReply,
  SubscribeRequest,
  WatchEvent,
  WatchEventListener
} from '../../../../../../shared/freshness/freshnessTypes'
import { realClock } from '../../../../../../shared/clock'
import { setFreshnessEnvironmentForTests } from '../../../../services/freshness/windowFreshness'
import { ImageViewerPanel } from '../ImageViewerPanel'
import { TEST_IDS } from '../../../../constants/testids'

/** Panel params shape the viewer consumes. */
export type ImageViewerProps = IDockviewPanelProps<{ filePath: string }>

/** Intrinsic size the fake decoder reports before a test overrides it. */
const DEFAULT_NATURAL_SIZE = { width: 800, height: 600 }

/** Container box used by every `getBoundingClientRect` call under test. */
const CONTAINER_BOX = { width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }

/** Default file path used by {@link ImageViewerHarness.renderAndSettle}. */
export const DEFAULT_IMAGE_PATH = '/proj/icon.png'

/** The fake watch layer's subscribe and unsubscribe, as spies a test can assert on or script. */
export interface MockFileWatch {
  /** Answers `started` with the file's stamp unless a test scripts another reply. */
  subscribe: Mock<(request: SubscribeRequest) => Promise<SubscribeReply>>
  unsubscribe: Mock<(watchId: string) => Promise<void>>
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
   * Its default implementation answers `ok` with {@link ImageViewerHarness.readBytes},
   * the file's current stamp and a FRESH version every call, i.e. "the file
   * genuinely changed". Override it (see {@link ImageViewerHarness.serveUnchanged})
   * to exercise the skip path.
   */
  readImage: Mock<(request: ImageReadRequest) => Promise<ImageReadResponse>>
  /**
   * Makes the fake disk hold still: from now on a read whose `knownVersion`
   * matches the version last handed out answers `unchanged`, and no bytes are
   * read. Returns to normal on the next `beforeEach`.
   */
  serveUnchanged: () => void
  /** Undoes {@link ImageViewerHarness.serveUnchanged}. */
  serveChanged: () => void
  /** Fake `window.api.file.getStats`; also the fake watch layer's "is the file there". */
  getStats: Mock<(request: { filePath: string }) => Promise<{ size: number }>>
  /**
   * Fake `window.api.imageExport.run` (issue #73).
   *
   * Answers a plain success for whichever target was asked for - a written file
   * for `png`/`pdf`, no `filePath` for `clipboard` - so a suite that only cares
   * that the button is wired needs no setup. Override it to stage a
   * cancellation, a failure or a qualifier-bearing selection.
   */
  imageExportRun: Mock<(request: ImageExportRequest) => Promise<ImageExportResponse>>
  /** The fake watch layer. */
  fileWatch: MockFileWatch
  /**
   * Overrides the intrinsic size reported by both the DOM `<img>` and the
   * off-DOM `new Image()` decoder, so a "the file was rewritten at a different
   * size" scenario is set up in one call.
   */
  setNaturalSize: (width: number, height: number) => void
  /** The file was rewritten (to `size` bytes, if given): its stamp moves on and every subscription on it hears `changed`. */
  emitChanged: (filePath: string, options?: { size?: number }) => void
  /** The file was replaced without an event yet (a slow atomic save): its stamp moves on silently. */
  replaceFile: (filePath: string) => void
  /** Every subscription on the file hears `deleted`; the probe (`getStats`) decides whether it is gone. */
  emitDeleted: (filePath: string) => void
  /**
   * The file's watch died (`ended`, watcher error) and cannot be restarted:
   * the automatic restart is refused, so the tab stops following.
   */
  emitWatchError: (filePath: string, error: string) => void
  /**
   * Builds the minimal `IDockviewPanelProps` surface the panel consumes.
   *
   * The returned `api` keeps a live title, so the same object can be handed to
   * a tab component and the tab will re-render when the panel calls `setTitle`.
   */
  makeProps: (filePath: string) => ImageViewerProps
  /** Renders the panel, waits for its first image and for its watch's subscribe reply to land, returns the view. */
  renderAndSettle: (filePath?: string) => Promise<RenderResult>
}

/**
 * Installs the shared image-viewer test environment.
 *
 * Call once at module scope in a test file; it registers its own `beforeEach`
 * and `afterEach`, so every test gets a clean watch layer, clean mocks and a
 * fresh `portal-root`. The returned handles are stable across tests – capture
 * them once and use them inside `it` blocks.
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

  /** Live subscriptions (watch id → path), per-file stamps, event listeners. */
  const subscriptions = new Map<string, string>()
  const stamps = new Map<string, FileStamp>()
  const eventListeners = new Set<WatchEventListener>()
  let stampSeq = 0

  const stampOf = (filePath: string): FileStamp => {
    let stamp = stamps.get(filePath)
    if (!stamp) {
      stamp = { size: 2048, mtimeMs: 1, ctimeMs: 1, ino: '1', hash: 'h0' }
      stamps.set(filePath, stamp)
    }
    return stamp
  }
  const emitTo = (filePath: string, make: (watchId: string) => WatchEvent): void => {
    const events = [...subscriptions].filter(([, path]) => path === filePath).map(([watchId]) => make(watchId))
    for (const event of events) for (const listener of [...eventListeners]) listener(event)
  }

  /** A write: the file's stamp moves on (no event). */
  const moveStamp = (filePath: string, size?: number): void => {
    stampSeq += 1
    stamps.set(filePath, {
      ...stampOf(filePath),
      ...(size !== undefined ? { size } : {}),
      mtimeMs: 1 + stampSeq,
      ctimeMs: 1 + stampSeq,
      hash: `h${stampSeq}`
    })
  }

  const readBytes = vi.fn<(path: string) => Promise<string>>()
  const readImage = vi.fn<(request: ImageReadRequest) => Promise<ImageReadResponse>>()
  const getStats = vi.fn<(request: { filePath: string }) => Promise<{ size: number }>>()
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

  /** Default bridge behaviour: every read is a real read of fresh bytes. */
  const alwaysChanged = async ({ filePath }: ImageReadRequest): Promise<ImageReadResponse> => {
    const dataUrl = await readBytes(filePath)
    versionSeq += 1
    servedVersion = `v${versionSeq}`
    return { status: 'ok', dataUrl, version: servedVersion, stamp: stampOf(filePath) }
  }

  const startedFor = async ({ watchId, filePath }: SubscribeRequest): Promise<SubscribeReply> => {
    subscriptions.set(watchId, filePath)
    return { status: 'started', stamp: stampOf(filePath), liveRefresh: 'full' }
  }

  const fileWatch: MockFileWatch = {
    subscribe: vi.fn(startedFor),
    unsubscribe: vi.fn(async (watchId: string) => {
      subscriptions.delete(watchId)
    })
  }

  const source: FreshnessSource = {
    subscribe: (request) => fileWatch.subscribe(request),
    unsubscribe: (watchId) => fileWatch.unsubscribe(watchId),
    probe: async (filePath, knownHash): Promise<ProbeReply> => {
      try {
        await getStats({ filePath })
      } catch {
        return { status: 'missing' }
      }
      const stamp = stampOf(filePath)
      return { status: knownHash !== undefined && knownHash === stamp.hash ? 'same' : 'changed', stamp }
    },
    readText: async () => ({ status: 'missing' }),
    onEvent: (listener) => {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    }
  }

  let restoreEnvironment: (() => void) | null = null
  let idSeq = 0

  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
  const originalImage = globalThis.Image

  beforeEach(() => {
    naturalSize = { ...DEFAULT_NATURAL_SIZE }
    subscriptions.clear()
    stamps.clear()
    eventListeners.clear()
    stampSeq = 0

    versionSeq = 0
    servedVersion = 'v0'
    readBytes.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
    readImage.mockReset().mockImplementation(alwaysChanged)
    getStats.mockReset().mockResolvedValue({ size: 2048 })
    imageExportRun.mockReset().mockImplementation(exportSucceeds)
    fileWatch.subscribe.mockReset().mockImplementation(startedFor)
    fileWatch.unsubscribe.mockClear()
    restoreEnvironment = setFreshnessEnvironmentForTests({
      source,
      // No save port: the viewer never saves, and its environment cannot reach one (A7)
      clock: realClock,
      newId: () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
      onCheck: () => () => {}
    })

    // NOTE: extend `window`, never `vi.stubGlobal('window', …)` – replacing the
    // window object destroys React's DOM internals.
    ;(window as unknown as { api: unknown }).api = {
      file: { readImage, getStats },
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
    restoreEnvironment?.()
    restoreEnvironment = null
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

  /**
   * Settled means the tab follows its file, not only that its first image is
   * on screen: the watch starts after that image (`ready`), so without this
   * wait an event a test emits next could reach no subscription at all, or
   * reach one whose `started` reply the tracker has not taken yet – which the
   * real IPC never does, because main's reply always lands before any event
   * for the id. One macrotask after the reply lets the tracker take it.
   */
  const waitForWatchReply = async (): Promise<void> => {
    await waitFor(() => expect(fileWatch.subscribe).toHaveBeenCalled())
    await act(async () => {
      await Promise.allSettled(fileWatch.subscribe.mock.results.map((result) => result.value))
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
      else await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

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
      readImage.mockImplementation(async (request) =>
        request.knownVersion === servedVersion
          ? { status: 'unchanged', version: servedVersion, stamp: stampOf(request.filePath) }
          : alwaysChanged(request)
      )
    },
    serveChanged: () => {
      readImage.mockImplementation(alwaysChanged)
    },
    fileWatch,
    setNaturalSize: (width, height) => {
      naturalSize = { width, height }
    },
    emitChanged: (filePath, options = {}) => {
      moveStamp(filePath, options.size)
      emitTo(filePath, (watchId) => ({ watchId, kind: 'changed' }))
    },
    replaceFile: (filePath) => moveStamp(filePath),
    emitDeleted: (filePath) => {
      emitTo(filePath, (watchId) => ({ watchId, kind: 'deleted' }))
    },
    emitWatchError: (filePath) => {
      fileWatch.subscribe.mockImplementationOnce(async () => ({ status: 'refused', code: 'WATCH_FAILED' }))
      emitTo(filePath, (watchId) => {
        subscriptions.delete(watchId)
        return { watchId, kind: 'ended', reason: 'watcher-error' }
      })
    },
    makeProps,
    renderAndSettle: async (filePath = DEFAULT_IMAGE_PATH) => {
      const view = render(<ImageViewerPanel {...makeProps(filePath)} />)
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
      await waitForWatchReply()
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
