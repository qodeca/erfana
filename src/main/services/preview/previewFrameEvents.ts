// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame events of one live view (issue #124, WI-14; design part 2
 * §2.5–§2.8). Attached to the view's own contents by `previewLiveWiring.ts`,
 * beside the lifecycle listeners, and detached by the view's teardown:
 *
 *  - `will-frame-navigate` – the frame guard. It fires for a `src` frame's
 *    first load and for a link inside a frame (S4); `preventDefault` cancels
 *    either silently, so the guard lists what it refuses itself. It never
 *    fires for a frame the browser's CSP refuses (S10) or for a `srcdoc` frame
 *    (S11).
 *  - `did-start-navigation` to `about:srcdoc` – a `srcdoc` frame, which cannot
 *    be stopped (S11): past a cap it is shown anyway and listed once (answer 9).
 *  - `did-fail-provisional-load` – the failed-load writer: a frame the browser
 *    refused before any other event (-30, S10; -27 for its own response). -20
 *    is the request filter's own cancel, already listed where it happened.
 *  - `did-frame-navigate` – which frames showed a document on this page. The
 *    empty `about:blank` a frame made by script commits first is none, so its
 *    next load is still its first, not a link inside it.
 *  - `did-stop-loading` – the page stopped loading, so its over-limit entries
 *    are written now rather than after the quiet time.
 *  - `console-message` – blocked hosts inside frames, for the permission band
 *    (`previewFrameCspConsole.ts`).
 *
 * No listener keeps a page. Each looks the page on screen up –
 * `pageScopes.committed()` – at the moment it writes, and each page's frame
 * counters, committed frames and over-limit timer live in its page scope, so
 * a page being replaced cannot write into its successor's badge (RS14). Main
 * runs no script in a page's frames, and a frame the guard cannot judge does
 * not load.
 */
import { webFrameMain } from 'electron'

import { SRCDOC_TOO_DEEP_ENTRY } from '../../../shared/previewFrameBadgeText'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { PreviewWebContentsHandle } from './PreviewSessionFactory'
import type { PreviewPageScope, PreviewPageScopeHolder } from './previewPageScope'
import {
  createPreviewFrameCspConsole,
  type PreviewFrameConsoleDetails
} from './previewFrameCspConsole'
import {
  decideFailedFrameLoad,
  decideFrameNavigation,
  decideSrcdocFrame,
  frameDepth,
  isAboutBlankUrl,
  isRefusedFrameCode,
  isSrcdocUrl,
  type PreviewFrameFacts,
  type PreviewFrameLike
} from './previewFrameGuard'

/** A main frame as the guard reads it: the root of the walk, and the page's frame count. */
interface PreviewMainFrameLike extends PreviewFrameLike {
  readonly framesInSubtree: readonly unknown[]
}

/** The `will-frame-navigate` details the guard reads (Electron 39). */
interface FrameNavigationEvent {
  readonly url: string
  readonly isMainFrame: boolean
  readonly frame: PreviewFrameLike | null
  preventDefault(): void
}

/** The `did-start-navigation` details the `srcdoc` check reads (Electron 39). */
interface FrameStartEvent {
  readonly url: string
  readonly isMainFrame: boolean
  readonly isSameDocument: boolean
  readonly frame: PreviewFrameLike | null
}

/** What the frame events need from their view. */
export interface PreviewFrameEventsDeps {
  readonly panelId: string
  /** The view's page: every listener is attached to it. */
  readonly contents: Pick<PreviewWebContentsHandle, 'on' | 'removeListener' | 'mainFrame'>
  /** The view's page scopes; only the page on screen is ever written. */
  readonly pageScopes: Pick<PreviewPageScopeHolder, 'committed'>
  /** This view's root token: the only one its frames may show. */
  readonly ownToken: string
  /** Resolve a frame from its process and routing ids; Electron's `webFrameMain.fromId` by default. */
  readonly frameFromIds?: (
    processId: number,
    routingId: number
  ) => PreviewFrameLike | null | undefined
  /** Clock for the console arrival cap. */
  readonly now?: () => number
}

/** One view's frame listeners. */
export interface PreviewFrameEvents {
  /** Detach every listener: the view is going. */
  dispose(): void
}

/** Electron's lookup, read at call time: a unit test's `electron` mock has none. */
function electronFrameFromIds(processId: number, routingId: number): PreviewFrameLike | undefined {
  return webFrameMain.fromId(processId, routingId)
}

/** Only the error's name: a message can quote a path or a preview URL (QG-7 S3). */
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** An error as a log line carries it: {@link nameOf}, plus `code` when it has one. */
function errorFieldsOf(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) {
    return { error: nameOf(error) }
  }
  const { code } = error as NodeJS.ErrnoException
  return typeof code === 'string' ? { error: error.name, code } : { error: error.name }
}

/** Attach the frame guard, the `srcdoc` check, the failed-load writer and the frame console bridge. */
export function attachPreviewFrameEvents(deps: PreviewFrameEventsDeps): PreviewFrameEvents {
  const { panelId, contents, pageScopes, ownToken } = deps
  const frameFromIds = deps.frameFromIds ?? electronFrameFromIds
  let disposed = false

  const mainFrame = (): PreviewMainFrameLike | undefined =>
    contents.mainFrame as PreviewMainFrameLike | undefined

  /** The frame's id, or `null` when it is gone (or cannot be read) – skipped, then. */
  const frameIdFromIds = (processId: unknown, routingId: unknown): number | null => {
    if (!Number.isInteger(processId) || !Number.isInteger(routingId)) {
      return null
    }
    try {
      return frameFromIds(processId as number, routingId as number)?.frameTreeNodeId ?? null
    } catch {
      // Torn down between the event and the read: nothing left to list.
      return null
    }
  }

  const factsFor = (
    page: PreviewPageScope,
    frame: PreviewFrameLike,
    main: PreviewMainFrameLike
  ): PreviewFrameFacts => ({
    committedBefore: page.frames.hasCommitted(frame.frameTreeNodeId),
    pageOverCap: page.frames.isOverCap(),
    depth: () => frameDepth(frame, main.frameTreeNodeId),
    framesInTree: () => main.framesInSubtree.length
  })

  /** Fail closed: a frame the guard cannot judge does not load. */
  const refuseUnjudged = (event: FrameNavigationEvent, reason: string): void => {
    event.preventDefault()
    logger.warn('Preview frame guard refused a frame it could not judge', {
      panelId: stablePathDigest(panelId),
      reason
    })
  }

  const onWillFrameNavigate = (event: FrameNavigationEvent): void => {
    if (disposed || event.isMainFrame !== false) {
      return
    }
    const frame = event.frame
    const main = mainFrame()
    if (!frame || !main) {
      refuseUnjudged(event, 'frame-unavailable')
      return
    }
    try {
      const page = pageScopes.committed()
      const verdict = decideFrameNavigation({
        url: event.url,
        ownToken,
        ...factsFor(page, frame, main)
      })
      if (verdict.action === 'allow') {
        return
      }
      // Cancel first, then list: a cancelled first load is silent (S4).
      event.preventDefault()
      if (verdict.action === 'over-limit') {
        page.frames.countOverLimit('src')
      } else {
        page.frameRefusals.record(verdict.type, verdict.address)
      }
    } catch (error) {
      refuseUnjudged(event, nameOf(error))
    }
  }

  const onDidStartNavigation = (event: FrameStartEvent): void => {
    if (
      disposed ||
      event.isMainFrame !== false ||
      event.isSameDocument ||
      !isSrcdocUrl(event.url)
    ) {
      return
    }
    const frame = event.frame
    const main = mainFrame()
    if (!frame || !main) {
      return
    }
    try {
      const page = pageScopes.committed()
      const verdict = decideSrcdocFrame(factsFor(page, frame, main))
      if (verdict.tooDeep) {
        page.frameRefusals.record('frame-too-deep', SRCDOC_TOO_DEEP_ENTRY)
      }
      if (verdict.overLimit) {
        page.frames.countOverLimit('srcdoc')
      }
    } catch (error) {
      // Listing only: the frame shows either way (answer 9).
      logger.warn('Preview could not check a srcdoc frame against the frame caps', {
        panelId: stablePathDigest(panelId),
        ...errorFieldsOf(error)
      })
    }
  }

  const onDidFrameNavigate = (...args: unknown[]): void => {
    // (event, url, httpResponseCode, httpStatusText, isMainFrame, processId, routingId)
    const [, url, , , isMainFrame, processId, routingId] = args
    // The guard's inert rule: an empty `about:blank` is no document the page named.
    if (disposed || isMainFrame !== false || (typeof url === 'string' && isAboutBlankUrl(url))) {
      return
    }
    const frameId = frameIdFromIds(processId, routingId)
    if (frameId !== null) {
      pageScopes.committed().frames.noteCommitted(frameId)
    }
  }

  const onDidFailProvisionalLoad = (...args: unknown[]): void => {
    // (event, errorCode, errorDescription, validatedURL, isMainFrame, processId, routingId)
    const [, errorCode, , validatedURL, isMainFrame, processId, routingId] = args
    if (
      disposed ||
      isMainFrame !== false ||
      typeof errorCode !== 'number' ||
      !isRefusedFrameCode(errorCode) ||
      typeof validatedURL !== 'string'
    ) {
      return
    }
    const frameId = frameIdFromIds(processId, routingId)
    if (frameId === null) {
      return
    }
    const page = pageScopes.committed()
    const refusal = decideFailedFrameLoad({
      errorCode,
      url: validatedURL,
      ownToken,
      committedBefore: page.frames.hasCommitted(frameId)
    })
    if (refusal !== null) {
      page.frameRefusals.record(refusal.type, refusal.address)
    }
  }

  const onDidStopLoading = (): void => {
    if (!disposed) {
      pageScopes.committed().frames.flushOverLimit()
    }
  }

  const cspConsole = createPreviewFrameCspConsole({
    panelId,
    mainFrame,
    // Into the page on screen's own CSP dedupe, budgets and band (WI-29).
    report: (violation) => pageScopes.committed().handleCspViolation(violation),
    now: deps.now
  })
  const onConsoleMessage = (details: PreviewFrameConsoleDetails): void => {
    if (!disposed) {
      cspConsole.handle(details)
    }
  }

  const listeners: ReadonlyArray<readonly [string, (...args: never[]) => void]> = [
    ['will-frame-navigate', onWillFrameNavigate as (...args: never[]) => void],
    ['did-start-navigation', onDidStartNavigation as (...args: never[]) => void],
    ['did-frame-navigate', onDidFrameNavigate as (...args: never[]) => void],
    ['did-fail-provisional-load', onDidFailProvisionalLoad as (...args: never[]) => void],
    ['did-stop-loading', onDidStopLoading as (...args: never[]) => void],
    ['console-message', onConsoleMessage as (...args: never[]) => void]
  ]
  for (const [event, listener] of listeners) {
    contents.on(event, listener)
  }

  return {
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      for (const [event, listener] of listeners) {
        contents.removeListener(event, listener)
      }
      cspConsole.dispose()
    }
  }
}
