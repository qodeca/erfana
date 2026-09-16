// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page a live view shows, the one load main has started, and the main-frame
 * navigation feed that ends that load (issue #124, WI-29; design §3, part 2
 * §2.3).
 *
 * Every main-frame load main starts goes through `startPageLoad`: the first
 * load, the live reload and the approval reload now; the same-tab moves and
 * history steps from WI-17b. It puts a fresh pending page scope in place and
 * then runs the load. A pending load ends at the FIRST of four events:
 *
 *   1. A main-frame cross-document `did-navigate`. For the target's document it
 *      COMMITS: the pending scope becomes the committed one and the target
 *      becomes the current page; `httpResponseCode >= 400` marks the commit
 *      failed, because a refused page commits with its 404 (S15). For any
 *      other document it is DROPPED, and that commit has no intent.
 *   2. A main-frame `did-navigate-in-page` to the target: the step was
 *      same-document. Dropped.
 *   3. Another `startPageLoad`: superseded. Dropped – a superseded load fires
 *      no event of its own (S15).
 *   4. `did-stop-loading` while the load is still pending: stopped without a
 *      commit, as when the page calls `window.stop()` (S16). Dropped.
 *
 * Nothing else ends it, and spikes S15 and S16 measured why: no main-frame fail
 * event fires for a refused or a superseded load, and a stale `-3` naming the
 * OLD page arrives 3–4 ms after a commit; `did-finish-load` fires for the OLD
 * page while the new one is pending; `did-start-navigation` fires for
 * page-started moves that `will-navigate` then cancels; `did-start-loading`
 * fires only when the page was idle; and the load call's promise resolves
 * before the commit, or rejects `-3` naming the OLD page after it. So this
 * module listens to none of them. A drop leaves the committed page, its scope,
 * its watchers and its badge exactly as they were.
 *
 * Targets and event URLs are compared with `samePreviewDocument`: Chromium
 * re-encodes a raw fragment, so an exact string match could strand a load.
 *
 * Every end is reported through `onOutcome` (issue #124, WI-17b), after this
 * module's own work, so the page navigator's intent ends with its pending load
 * and never on anything else. A main-frame in-page step that ended no load – a
 * `#section` jump, a script's `pushState` – goes to `onInPageStep`.
 *
 * The main-frame feed is attached here, on the view's own contents, rather than
 * as `wirePreviewLifecycle` hooks, because that module does not report
 * `did-navigate` or `did-navigate-in-page`.
 */
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { PreviewWebContentsHandle } from './PreviewSessionFactory'
import type { PreviewPageScopeHolder } from './previewPageScope'
import { samePreviewDocument } from './previewUrl'

/** Only the error's name: a listener's message can carry a path (QG-7 S5's class). */
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** A Node errno code such as `EACCES`, when the error carries one as a string. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return typeof error.code === 'string' ? error.code : undefined
}

/** A commit at or above this status is a failed page (a refused page commits with its 404, S15). */
const FAILED_COMMIT_MIN_STATUS = 400

/**
 * How a main-frame load started.
 *
 * - `initial` – a view's first load (open, resume): no pending page scope, as
 *   the committed one is new and empty (RA3-3).
 * - `reload` – the live reload or an approval: always cross-document, always
 *   a pending page scope.
 * - `open`, `back`, `forward` – a same-tab move or a history step (WI-17b): a
 *   pending page scope unless the target is the document already on screen,
 *   whose badge, watchers and frames an anchor step keeps (RS2-1).
 */
export type PreviewPageLoadKind = 'initial' | 'reload' | 'open' | 'back' | 'forward'

/**
 * Whether a load is a navigation main started for the tab – a same-tab move or
 * a history step – rather than a view's first load or a reload (part 3 §3.6).
 * The one "is this a move" rule (QG-6 A6). An allow-list, so a kind added
 * later counts as no move until it is named here.
 */
export function isNavigationKind(kind: PreviewPageLoadKind): boolean {
  return kind === 'open' || kind === 'back' || kind === 'forward'
}

/** The load main started and has not seen end. */
export interface PreviewPendingLoad {
  /** The page being loaded: an absolute path in the view's real root. */
  readonly filePath: string
  readonly kind: PreviewPageLoadKind
  /** Whether a pending page scope was put in place for it. */
  readonly scoped: boolean
}

/** Why a pending load ended: rule 1 commits or drops, rule 2 steps in page, rules 3 and 4 drop. */
export type PreviewPageLoadEndReason =
  | 'committed'
  | 'same-document'
  | 'other-document'
  | 'superseded'
  | 'stopped'
  | 'not-started'

/** How a pending load ended, as `onOutcome` reports it (issue #124, WI-17b). */
export interface PreviewPageLoadEnd {
  /** The load that ended – the object `pendingLoad()` returned for it. */
  readonly load: PreviewPendingLoad
  readonly reason: PreviewPageLoadEndReason
  /** A commit at status 400 or above – a refused page commits with its 404 (S15). */
  readonly failed: boolean
  /** The committed page before this end; after a commit, `currentPage()` is the load's. */
  readonly previousPage: string
}

/** What the page module needs from its view. */
export interface PreviewLivePageDeps {
  readonly panelId: string
  /** The view's page: the main-frame navigation feed is attached to it. */
  readonly contents: Pick<PreviewWebContentsHandle, 'on' | 'removeListener'>
  /** The view's page scopes. This module only fills and empties the pending slot. */
  readonly pageScopes: Pick<PreviewPageScopeHolder, 'beginPending' | 'commit' | 'dropPending'>
  /** The page the view opens on. */
  readonly initialPage: string
  /** The `erfana-preview://` URL a local file is served at. */
  readonly urlFor: (absPath: string) => string
  /** Every end of a pending load, after the page and its scopes are settled. */
  readonly onOutcome?: (end: PreviewPageLoadEnd) => void
  /** A main-frame in-page step that ended no pending load. */
  readonly onInPageStep?: (url: string) => void
}

/** One live view's page. */
export interface PreviewLivePage {
  /** The committed page – the page on screen. Every page-path read goes through here. */
  currentPage(): string
  /** The load main started and has not seen end, or `null`. */
  pendingLoad(): PreviewPendingLoad | null
  /**
   * Start a main-frame load of `target`, an absolute path in the view's root.
   *
   * The returned promise settles with `load`'s and never rejects: a load's
   * outcome arrives through the navigation feed, never through its promise. A
   * `load` that throws synchronously never started, so its pending load ends
   * at once and the error reaches the caller unchanged.
   */
  startPageLoad(
    target: string,
    kind: PreviewPageLoadKind,
    load: () => Promise<unknown> | void
  ): Promise<void>
  /** Stop listening and forget the pending load; the holder is its owner's to dispose. */
  dispose(): void
}

/** Why a pending load ended without a commit. */
type PreviewPendingEnd = Exclude<PreviewPageLoadEndReason, 'committed'>

interface PendingRecord extends PreviewPendingLoad {
  /** The URL the target is served at, for `samePreviewDocument`. */
  readonly url: string
}

/** Build the page module of one live view and attach its navigation feed. */
export function createPreviewLivePage(deps: PreviewLivePageDeps): PreviewLivePage {
  const { panelId, contents, pageScopes, urlFor } = deps
  let committedPage = deps.initialPage
  let pending: PendingRecord | null = null
  let disposed = false

  /**
   * Tell the listeners. Both run inside Electron event listeners, where a
   * throw is an uncaught main-process exception, so one is contained here.
   */
  function notify(run: () => void): void {
    try {
      run()
    } catch (error) {
      // By name and code only: a listener's error – a watcher retarget, for one
      // – can quote the page's path in its message.
      logger.error('Preview page: a navigation listener failed', undefined, {
        panelId: stablePathDigest(panelId),
        error: nameOf(error),
        code: codeOf(error)
      })
    }
  }

  /** End the pending load without a commit; the committed page stays as it was. */
  function end(reason: PreviewPendingEnd): void {
    const load = pending
    if (load === null) {
      return
    }
    pending = null
    if (load.scoped) {
      pageScopes.dropPending()
    }
    // A same-document step ending is that step's normal outcome; every other
    // end is worth a line when a tab seems not to have moved.
    if (reason !== 'same-document') {
      logger.info('Preview page load ended without a commit', {
        panelId: stablePathDigest(panelId),
        kind: load.kind,
        reason
      })
    }
    const outcome: PreviewPageLoadEnd = { load, reason, failed: false, previousPage: committedPage }
    notify(() => deps.onOutcome?.(outcome))
  }

  // Rule 1. Electron emits `did-navigate` for the main frame only.
  const onDidNavigate = (_event: unknown, url: unknown, httpResponseCode: unknown): void => {
    if (disposed || typeof url !== 'string') {
      return
    }
    const load = pending
    if (load === null) {
      // No load main started. A page that reloads itself commits its own
      // document, which changes nothing. Anything else moves nothing either:
      // top navigations are cancelled, so this should not happen.
      if (!samePreviewDocument(url, urlFor(committedPage))) {
        logger.warn('Preview page: a commit main did not start; the current page is unchanged', {
          panelId: stablePathDigest(panelId)
        })
      }
      return
    }
    if (!samePreviewDocument(url, load.url)) {
      // Taken as the move, a page that reloaded itself would make the tab claim
      // the target while it shows the old page.
      end('other-document')
      return
    }
    const previousPage = committedPage
    pending = null
    committedPage = load.filePath
    if (load.scoped) {
      pageScopes.commit()
    }
    const failed =
      typeof httpResponseCode === 'number' && httpResponseCode >= FAILED_COMMIT_MIN_STATUS
    if (failed) {
      logger.info('Preview page committed with an error status', {
        panelId: stablePathDigest(panelId),
        kind: load.kind,
        status: httpResponseCode
      })
    }
    const outcome: PreviewPageLoadEnd = { load, reason: 'committed', failed, previousPage }
    notify(() => deps.onOutcome?.(outcome))
  }

  // Rule 2. This event fires for subframes too (S4), so only the main frame counts.
  const onDidNavigateInPage = (_event: unknown, url: unknown, isMainFrame: unknown): void => {
    if (disposed || isMainFrame !== true || typeof url !== 'string') {
      return
    }
    const load = pending
    // A reload is always cross-document. An in-page step the OLD page takes in
    // the meantime – a scroll spy's `replaceState` – names that same document
    // and must not end the reload.
    if (load !== null && load.kind !== 'reload' && samePreviewDocument(url, load.url)) {
      end('same-document')
      return
    }
    // A step of the page on screen: history follows it (issue #124, WI-17b).
    notify(() => deps.onInPageStep?.(url))
  }

  // Rule 4. In S16 it never fired between a start and a commit that followed.
  const onDidStopLoading = (): void => {
    if (!disposed) {
      end('stopped')
    }
  }

  contents.on('did-navigate', onDidNavigate as (...args: never[]) => void)
  contents.on('did-navigate-in-page', onDidNavigateInPage as (...args: never[]) => void)
  contents.on('did-stop-loading', onDidStopLoading as (...args: never[]) => void)

  return {
    currentPage: () => committedPage,
    pendingLoad: () => pending,
    startPageLoad(target, kind, load) {
      if (disposed) {
        return Promise.resolve()
      }
      // Rule 3.
      end('superseded')
      const url = urlFor(target)
      const scoped =
        kind === 'reload' ||
        (kind !== 'initial' && !samePreviewDocument(url, urlFor(committedPage)))
      if (scoped) {
        pageScopes.beginPending()
      }
      const record: PendingRecord = { filePath: target, kind, scoped, url }
      pending = record
      let started: Promise<unknown> | void
      try {
        started = load()
      } catch (error) {
        // The load never started, so no event will ever end it.
        if (pending === record) {
          end('not-started')
        }
        throw error
      }
      return Promise.resolve(started).then(
        () => undefined,
        () => undefined
      )
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      pending = null
      contents.removeListener('did-navigate', onDidNavigate as (...args: never[]) => void)
      contents.removeListener(
        'did-navigate-in-page',
        onDidNavigateInPage as (...args: never[]) => void
      )
      contents.removeListener('did-stop-loading', onDidStopLoading as (...args: never[]) => void)
    }
  }
}
