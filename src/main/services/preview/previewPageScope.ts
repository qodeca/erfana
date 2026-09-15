// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One page's state, and the holder that keeps a view's committed page and the
 * page main is loading (issue #124, WI-29; design §3, part 2 §2.3).
 *
 * A PAGE SCOPE holds what belongs to one page load: the failure log (the
 * badge), the blocked-host ledger, the CSP-violation dedupe and budgets, the
 * refused-frame set, and the frame bookkeeping (WI-14) – which frames showed a
 * document, the frames past the count cap and the timer that lists them. A new
 * page gets a new scope, so all of it resets together, by construction. Two past bugs came from resetting these by hand:
 * a failure log cleared without its dedupe bridge, and a ledger that outlived
 * a reload (#74).
 *
 * THE HOLDER, one per view, keeps two slots:
 *
 *  - committed – the page on screen. Every writer writes here and looks the
 *    slot up at the moment it writes. No writer keeps a scope, so a stale
 *    reference can never carry page A's late events into page B's badge.
 *  - pending – at most one page main has started loading. Only the protocol
 *    handler's refusal of that page's MAIN-FRAME document writes into it
 *    (`forMainDocument()`): the handler answers before the page commits, and a
 *    refused page still commits, with its 404 (spike S15).
 *
 * A pending scope is silent: its failures reach the renderer only once it is
 * committed, and then its snapshot – an empty list included – is sent at once,
 * so the badge mirrors main. A disposed scope is inert: its timers are
 * cancelled, later writes go nowhere and nothing is emitted, so a page that was
 * replaced, or a view that closed, cannot write into whatever comes next.
 *
 * A VIEW FAILURE belongs to the view, not to one page: the "allowlist invalid"
 * badge the session factory drains when it builds the view (#115). The holder
 * keeps it and puts it into every page it starts, so a reload, a live reload
 * and an approval all keep the badge; it goes when the view goes.
 *
 * The service creates the holder in `open()`, before the session;
 * `previewLivePage` fills and empties the pending slot; the live view's
 * teardown disposes it.
 */
import type { PreviewEmitters, PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  describeFramesOverLimit,
  type FrameOverLimitKind
} from '../../../shared/previewFrameBadgeText'
import type {
  IPreviewFailureLog,
  PreviewFailureEmit,
  PreviewFailureEntry
} from './PreviewFailureLog'
import {
  createPreviewBlockedLedger,
  createPreviewBlockedSink,
  type PreviewBlockedSink
} from './previewBlockedLedger'
import { createPreviewCspViolationBridge } from './previewCspViolationBridge'
import { createPreviewFrameRefusals, type PreviewFrameRefusals } from './previewFrameRefusals'

/** One page's state, as its writers see it. */
export interface PreviewPageScope {
  /** Record one failure on this page. Ignored once the page is gone. */
  recordFailure(input: PreviewFailureInput): void
  /** This page's failures, oldest first. */
  failures(): readonly PreviewFailureEntry[]
  /**
   * Report a refusal – from the network filter or the CSP – into this page's
   * failure log and blocked-host ledger. A refusal that changes the ledger
   * reaches the permission band as `hostBlocked`. Ignored once the page is gone.
   */
  readonly reportBlocked: PreviewBlockedSink
  /**
   * A CSP-violation payload the page's preload sent (unvalidated). It spends
   * THIS page's dedupe and budgets, then goes to this page's `reportBlocked`.
   */
  handleCspViolation(payload: unknown): void
  /** The frames refused on this page, one entry per address. */
  readonly frameRefusals: PreviewFrameRefusals
  /** This page's frame bookkeeping: the frame guard's memory (WI-14). */
  readonly frames: PreviewPageFrames
}

/**
 * What the frame writers remember about one page (issue #124, WI-14; part 2
 * §2.5–§2.7). It lives in the page scope, so a page that is replaced takes its
 * counters and its over-limit timer with it: a move that commits within the
 * quiet time never puts page A's entry into page B's badge (RS14).
 */
export interface PreviewPageFrames {
  /** A subframe committed a document on this page (`did-frame-navigate`). */
  noteCommitted(frameTreeNodeId: number): void
  /** Whether the subframe committed a document on this page before. */
  hasCommitted(frameTreeNodeId: number): boolean
  /** Whether this page already went past the frame-count cap. */
  isOverCap(): boolean
  /**
   * One more frame past the count cap: the page is marked past it, the frame
   * counted, and the page's one entry for its kind written
   * `FRAME_OVER_LIMIT_QUIET_MS` after the last such frame. Once that entry is
   * written, later frames are only counted.
   */
  countOverLimit(kind: FrameOverLimitKind): void
  /** Write the waiting over-limit entries now: the page stopped loading. */
  flushOverLimit(): void
}

/** A page scope as its holder drives it. */
export interface PreviewPageScopeHandle extends PreviewPageScope {
  /**
   * The page is on screen: its failures reach the renderer from now on, and
   * with `announce` its snapshot is sent at once, an empty list included.
   * Only a scope that has not gone live yet does anything.
   */
  goLive(announce: boolean): void
  /** End this page: its timers are cancelled, later writes ignored, nothing emitted. */
  dispose(): void
}

/** What one page scope is built from; the service supplies it per view. */
export interface PreviewPageScopeDeps {
  readonly panelId: string
  readonly emit: Pick<PreviewEmitters, 'failuresChanged' | 'hostBlocked'>
  /** The service's `createFailureLog` dep; the scope decides when its log may emit. */
  readonly createFailureLog: (onEmit: PreviewFailureEmit) => IPreviewFailureLog
}

/** A view's committed page and the page main is loading. */
export interface PreviewPageScopeHolder {
  /** The page on screen. Every writer but the main-document refusal writes here. */
  committed(): PreviewPageScope
  /**
   * Where the protocol handler's refusal of a MAIN-FRAME document goes: the
   * pending page when main is loading one, the committed page otherwise.
   */
  forMainDocument(): PreviewPageScope
  /**
   * Record a failure of the view rather than of one page (the allowlist's
   * load-time badge, #115): on the page on screen, on the page loading, and on
   * every page started later. Ignored once the view is gone.
   */
  recordViewFailure(input: PreviewFailureInput): void
  /**
   * Put a fresh, silent pending page, holding the view's failures, in place; an
   * earlier pending one is dropped.
   */
  beginPending(): void
  /**
   * The pending page becomes the page on screen: the old one is disposed and
   * the new one's snapshot is sent. Does nothing when nothing is pending.
   */
  commit(): void
  /** Dispose the pending page; the page on screen, its badge and its timers stay. */
  dropPending(): void
  /**
   * End the view: both pages and their timers go and nothing is emitted, so a
   * closed view's late snapshot cannot reach a reopened one (RA3-1). A later
   * write reaches an inert page; no page is created any more, and the view's
   * failures go with it.
   */
  dispose(): void
}

/**
 * Committed frames one page remembers. A memory bound, not a budget: only a
 * page that keeps committing new frames reaches it – `srcdoc` frames are not
 * capped (answer 9). Past it, a frame not remembered counts as one that never
 * showed a document, the stricter reading: its first load stays under the
 * count cap.
 */
const MAX_REMEMBERED_FRAMES = 1_024

/** The kinds an over-limit entry is written for, in the order they are listed. */
const OVER_LIMIT_KINDS: readonly FrameOverLimitKind[] = ['src', 'srcdoc']

/** One page's frame bookkeeping; its `dispose()` runs with the page's. */
function createPreviewPageFrames(
  frameRefusals: PreviewFrameRefusals
): PreviewPageFrames & { dispose(): void } {
  const committed = new Set<number>()
  const overLimit: Record<FrameOverLimitKind, number> = { src: 0, srcdoc: 0 }
  const listed: Record<FrameOverLimitKind, boolean> = { src: false, srcdoc: false }
  let overCap = false
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const cancelQuietTimer = (): void => {
    if (quietTimer !== null) {
      clearTimeout(quietTimer)
      quietTimer = null
    }
  }
  const flushOverLimit = (): void => {
    cancelQuietTimer()
    if (disposed) {
      return
    }
    for (const kind of OVER_LIMIT_KINDS) {
      if (overLimit[kind] > 0 && !listed[kind]) {
        listed[kind] = true
        frameRefusals.record('frame-over-limit', describeFramesOverLimit(overLimit[kind], kind))
      }
    }
  }

  return {
    noteCommitted(frameTreeNodeId) {
      if (!disposed && committed.size < MAX_REMEMBERED_FRAMES) {
        committed.add(frameTreeNodeId)
      }
    },
    hasCommitted: (frameTreeNodeId) => committed.has(frameTreeNodeId),
    isOverCap: () => overCap,
    countOverLimit(kind) {
      if (disposed) {
        return
      }
      overCap = true
      overLimit[kind] += 1
      if (!listed[kind]) {
        cancelQuietTimer()
        quietTimer = setTimeout(flushOverLimit, PREVIEW_LIMITS.FRAME_OVER_LIMIT_QUIET_MS)
      }
    },
    flushOverLimit,
    dispose() {
      disposed = true
      cancelQuietTimer()
      committed.clear()
      overCap = false
      overLimit.src = 0
      overLimit.srcdoc = 0
    }
  }
}

/** Build one page's scope. It starts silent; its holder makes it live. */
export function createPreviewPageScope(deps: PreviewPageScopeDeps): PreviewPageScopeHandle {
  const { panelId, emit } = deps
  let state: 'waiting' | 'live' | 'disposed' = 'waiting'
  // The log's latest `truncated`, noted even while silent, for the snapshot sent
  // when this page goes live. Should the log's coalesced emit not have run by
  // then, it still runs afterwards and carries the exact value.
  let truncated = false
  const failureLog = deps.createFailureLog((failures, isTruncated) => {
    truncated = isTruncated
    if (state === 'live') {
      emit.failuresChanged(panelId, failures, isTruncated)
    }
  })

  const recordFailure = (input: PreviewFailureInput): void => {
    if (state !== 'disposed') {
      failureLog.record(input)
    }
  }
  const blockedSink = createPreviewBlockedSink({
    panelId,
    ledger: createPreviewBlockedLedger(),
    recordFailure,
    emit
  })
  // The CSP half of the blocked-host signal. Chromium refuses an unapproved host
  // in the RENDERER, so `onBeforeRequest` – and with it the Approve prompt –
  // never sees it; the preload reports it instead, and it lands on the same sink
  // as a filter refusal: one failure type, one ledger, one dedupe rule. Wired
  // here, once per page, it can never be left unwired.
  const cspViolations = createPreviewCspViolationBridge({
    onBlockedHost: (origin, url, approvable, kind) =>
      blockedSink('blocked-host', origin, url, approvable, kind)
  })
  const frameRefusals = createPreviewFrameRefusals({ panelId, recordFailure })
  const frames = createPreviewPageFrames(frameRefusals)

  return {
    recordFailure,
    failures: () => failureLog.list(),
    reportBlocked: (kind, originOrHost, url, approvable, resourceKind) => {
      if (state !== 'disposed') {
        blockedSink(kind, originOrHost, url, approvable, resourceKind)
      }
    },
    handleCspViolation: (payload) => cspViolations.handleViolation(payload),
    frameRefusals,
    frames,
    goLive(announce) {
      if (state !== 'waiting') {
        return
      }
      state = 'live'
      if (announce) {
        emit.failuresChanged(panelId, failureLog.list(), truncated)
      }
    },
    dispose() {
      if (state === 'disposed') {
        return
      }
      state = 'disposed'
      failureLog.drop()
      cspViolations.dispose()
      frames.dispose()
      frameRefusals.close()
    }
  }
}

/**
 * Build a view's holder. The first page is committed, and live, from the start:
 * nothing is on screen yet, so a view's first load needs no pending page
 * (RA3-3), and that page stays silent until its first failure, as the view's
 * failure log always did.
 */
export function createPageScopeHolder(
  createScope: () => PreviewPageScopeHandle
): PreviewPageScopeHolder {
  let committed = createScope()
  committed.goLive(false)
  let pending: PreviewPageScopeHandle | null = null
  let disposed = false
  // The view's own failures, put into every page this holder starts (#115).
  const viewFailures: PreviewFailureInput[] = []

  const dropPending = (): void => {
    const scope = pending
    pending = null
    scope?.dispose()
  }

  return {
    committed: () => committed,
    forMainDocument: () => pending ?? committed,
    recordViewFailure(input) {
      if (disposed) {
        return
      }
      viewFailures.push(input)
      committed.recordFailure(input)
      pending?.recordFailure(input)
    },
    beginPending() {
      if (disposed) {
        return
      }
      dropPending()
      const scope = createScope()
      for (const failure of viewFailures) {
        scope.recordFailure(failure)
      }
      pending = scope
    },
    commit() {
      if (disposed || pending === null) {
        return
      }
      const previous = committed
      committed = pending
      pending = null
      previous.dispose()
      committed.goLive(true)
    },
    dropPending,
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      viewFailures.length = 0
      dropPending()
      committed.dispose()
    }
  }
}
