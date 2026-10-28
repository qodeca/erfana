// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One live view's page navigator (issue #124, WI-17b; part 3 §3.5).
 *
 * Keeps the panel's own Back and Forward list (`previewTabHistory.ts`, held by
 * the service so it survives a suspend) in step with what the view shows, and
 * tells the renderer each time it changes (`preview:pageChanged`). Every page it
 * names is a gated history entry in project space – never the URL that
 * committed. It is fed by `previewLivePage`:
 *
 *  - `loadEnded(end)` – a pending load ended. Every page load main starts here
 *    is tagged with an intent: the view's first page, a same-tab move (`open`)
 *    or a history step (`back`, `forward`). The intent ends with its pending
 *    load (part 2 §2.3) and on nothing else – not a fail event, not
 *    `did-start-navigation` (S15) – so a later move is never refused as pending
 *    for good. A commit, or an in-page step to the target, moves the history
 *    and names the entry; any other end changes nothing.
 *  - `inPageStep(url)` – a main-frame in-page step that ended no load: a
 *    `#section` jump, a script's hash change or `pushState`. With no intent
 *    pending, a step of the document on screen is recorded, so history stays
 *    in step with the page: pushed when it takes a recent user gesture, and
 *    otherwise put in place of the current entry, so a page cannot fill the
 *    list and evict where the reader came from (QG-7 S1). Taking the gesture
 *    spends it, so one real input buys one entry at most (QG-8 T1): a recorded
 *    step spends it, and so does a move or step of ours when it LANDS – not
 *    when it is asked for, so a refused or superseded one spends nothing. The
 *    window and the clock rule live with the input watch that keeps the
 *    gesture. A fragment past the contract's anchor bound is
 *    cut. A step whose URL names another document – a `pushState` to another
 *    path, which Chromium refuses a sandboxed page anyway – is never recorded,
 *    and is logged by panel digest only, without its URL (QG-7 S2).
 *
 * A reload is no move: its commit changes nothing here.
 *
 * A history step runs natively – `goToIndex()` onto the neighbouring Chromium
 * entry, with Chromium's scroll restore and no `will-navigate` (S6) – only when
 * that entry has exactly the target's URL. Otherwise – after a sleep, or with
 * frame entries in between – the target is loaded by URL. Never `goBack()` /
 * `goForward()`: Chromium's history intervention makes them skip the entry a
 * page `pushState`d from without a user gesture, and do nothing at all when
 * that leaves no entry – no event, and the step pending until the next load.
 *
 * @see src/main/services/preview/previewStillFrameFreshness.ts – the gesture clock and its window rule
 */
import type { PreviewPageChange, PreviewPageTarget } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  isNavigationKind,
  type PreviewLivePage,
  type PreviewPageLoadEnd,
  type PreviewPendingLoad
} from './previewLivePage'
import {
  currentEntry,
  historyState,
  pushEntry,
  replaceCurrent,
  stepHistory,
  type HistoryDirection,
  type PreviewTabHistory
} from './previewTabHistory'
import { samePreviewDocument } from './previewUrl'

/** One panel's history, which the service keeps (`previewPanelState.ts`). */
export interface PreviewPanelHistoryStore {
  get(): PreviewTabHistory | null
  set(history: PreviewTabHistory): void
}

/** How a view opens, as the service decided it (`previewViewNavigation.ts`). */
export interface PreviewLiveNavigationParams {
  readonly history: PreviewPanelHistoryStore
  /**
   * The history this view opens with: a new one-entry list, the one that
   * survived a suspend, or one rebuilt for the same panel. Its current entry is
   * the first page.
   */
  readonly initialHistory: PreviewTabHistory
  /** Whether that first page is the file the renderer asked for (`pageChanged.sameDocument`). */
  readonly initialSameDocument: boolean
}

/** A move main checked (`previewViewNavigation.ts` ran the gate). */
export interface PreviewNavigationMove {
  readonly kind: 'open' | HistoryDirection
  /** The gated entry, in project space: what history records and `pageChanged` names. */
  readonly target: PreviewPageTarget
  /** The target inside the view's real root: what is loaded. */
  readonly realPath: string
  /** For a step: the history it was checked against. */
  readonly basis?: PreviewTabHistory
}

/** The part of Electron's `webContents.navigationHistory` a step uses. */
export interface PreviewNativeHistory {
  getActiveIndex(): number
  getEntryAtIndex(index: number): { readonly url: string } | null | undefined
  /** Go to the entry at `index`, whatever Chromium's intervention marked (see the header). */
  goToIndex(index: number): void
}

/** What the navigator needs from its view. */
export interface PreviewPageNavigatorDeps {
  readonly panelId: string
  readonly page: Pick<PreviewLivePage, 'startPageLoad' | 'pendingLoad' | 'currentPage'>
  readonly navigation: PreviewLiveNavigationParams
  /** The `erfana-preview://` URL a file inside the view's real root is served at. */
  readonly urlFor: (absPath: string) => string
  readonly loadUrl: (url: string) => Promise<unknown>
  /** The view's native history, or `null` when it has none. */
  readonly nativeHistory: () => PreviewNativeHistory | null
  readonly emitPageChanged: (change: PreviewPageChange) => void
  /** A move or step started: the pipeline pauses until it ends. */
  readonly onMoveStarted: () => void
  /**
   * Take the view's recent user gesture, if there is one (QG-7 S1): an in-page
   * step is pushed only then, and otherwise takes the current entry's place.
   * The call SPENDS the gesture (QG-8 T1), so it is made once per recorded
   * step, and once when a move or step lands –
   * `PreviewStillFrameFreshness.takeRecentGesture` in production.
   */
  readonly takeRecentGesture: () => boolean
  /** The view is going away: nothing is written any more. */
  readonly isDefunct: () => boolean
}

/** One live view's navigator. */
export interface PreviewPageNavigator {
  /** Load the view's first page – the current entry of its history – at `realPath`. */
  loadFirst(realPath: string): Promise<void>
  /** Start a checked move or history step. A load that cannot start throws. */
  move(move: PreviewNavigationMove): Promise<void>
  /** Whether a move or step main started (`open`, `back`, `forward`) is still pending. */
  isNavigationPending(): boolean
  /** `previewLivePage`'s outcome: a pending load ended. */
  loadEnded(end: PreviewPageLoadEnd): void
  /** `previewLivePage`'s feed: a main-frame in-page step that ended no load. */
  inPageStep(url: string): void
}

/** What a load main started is for. */
interface Intent {
  readonly kind: 'initial' | PreviewNavigationMove['kind']
  readonly target: PreviewPageTarget
  /** The load it rides on: the object `pendingLoad()` returned. */
  readonly load: PreviewPendingLoad
  readonly basis?: PreviewTabHistory
}

/**
 * Electron's `navigationHistory` (Electron 32 and later), read structurally:
 * `PreviewWebContentsHandle` does not declare it, and a fake without one simply
 * loads every step by URL.
 */
export function nativeHistoryOf(contents: object): PreviewNativeHistory | null {
  return (contents as { navigationHistory?: PreviewNativeHistory }).navigationHistory ?? null
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** Both sides normalised, so Chromium's re-encoded fragment still matches (S15). */
function sameUrl(a: string, b: string): boolean {
  const left = parseUrl(a)
  const right = parseUrl(b)
  return left !== null && right !== null && left.href === right.href
}

function withAnchor(url: string, anchor: string | null): string {
  return anchor === null ? url : `${url}#${anchor}`
}

/** The fragment in the raw form link anchors use (`URL.hash` without its `#`), cut to the contract. */
function anchorOf(url: URL): string | null {
  return url.hash.length > 1 ? url.hash.slice(1, PREVIEW_LIMITS.NAV_MAX_ANCHOR_CHARS + 1) : null
}

/** Build the navigator of one live view; it writes the view's first history at once. */
export function createPreviewPageNavigator(deps: PreviewPageNavigatorDeps): PreviewPageNavigator {
  const { navigation } = deps
  let intent: Intent | null = null
  // The file of the document on screen, as history names it.
  let shownFile = currentEntry(navigation.initialHistory).filePath

  if (navigation.history.get() !== navigation.initialHistory) {
    navigation.history.set(navigation.initialHistory)
  }

  const history = (): PreviewTabHistory => navigation.history.get() ?? navigation.initialHistory

  function announce(
    entry: PreviewPageTarget,
    next: PreviewTabHistory,
    sameDocument: boolean,
    failed: boolean
  ): void {
    deps.emitPageChanged({
      filePath: entry.filePath,
      anchor: entry.anchor,
      sameDocument,
      failed,
      ...historyState(next)
    })
  }

  /** Start a load and tag it with its intent. A load that never started throws. */
  function start(
    kind: Intent['kind'],
    target: PreviewPageTarget,
    realPath: string,
    load: () => Promise<unknown> | void,
    basis?: PreviewTabHistory
  ): Promise<void> {
    // Ends the load before it first, which ends that load's intent.
    const started = deps.page.startPageLoad(realPath, kind, load)
    // Electron reports a load's events from later tasks, never from inside the
    // call, so the load is still the pending one here.
    const pending = deps.page.pendingLoad()
    if (pending !== null && pending.filePath === realPath && pending.kind === kind) {
      intent = { kind, target, load: pending, basis }
      if (kind !== 'initial') {
        deps.onMoveStarted()
      }
    }
    return started
  }

  /** The native step onto `url`, when the neighbouring Chromium entry is exactly it. */
  function nativeStep(direction: HistoryDirection, url: string): (() => void) | null {
    const native = deps.nativeHistory()
    if (native === null) {
      return null
    }
    try {
      const at = native.getActiveIndex() + (direction === 'back' ? -1 : 1)
      const entry = at < 0 ? null : native.getEntryAtIndex(at)
      if (!entry || !sameUrl(entry.url, url)) {
        return null
      }
      // By index: `goBack()` / `goForward()` skip an entry the intervention marked.
      return () => native.goToIndex(at)
    } catch {
      return null
    }
  }

  /** The history once a move landed. */
  function advance(current: PreviewTabHistory, landed: Intent): PreviewTabHistory {
    if (landed.kind === 'initial') {
      return current
    }
    if (landed.kind === 'open') {
      return pushEntry(current, landed.target)
    }
    // A step through the very list it was checked against; the entry takes
    // the gated spelling.
    if (current === landed.basis) {
      return replaceCurrent(stepHistory(current, landed.kind), landed.target)
    }
    // The list changed meanwhile: record the page the tab shows now.
    return pushEntry(current, landed.target)
  }

  /**
   * The entry an in-page step names, or `null` when it is not one to record.
   * Only the document on screen is: a page never names a history entry by URL
   * (QG-7 S2), and the URL it tried stays out of the log.
   */
  function inPageEntry(url: string): PreviewPageTarget | null {
    const parsed = parseUrl(url)
    if (parsed === null || !samePreviewDocument(url, deps.urlFor(deps.page.currentPage()))) {
      logger.info('Preview page: an in-page step to another document was not recorded', {
        panelId: stablePathDigest(deps.panelId)
      })
      return null
    }
    return { filePath: shownFile, anchor: anchorOf(parsed) }
  }

  return {
    loadFirst(realPath: string): Promise<void> {
      const entry = currentEntry(navigation.initialHistory)
      const url = withAnchor(deps.urlFor(realPath), entry.anchor)
      return start('initial', entry, realPath, () => deps.loadUrl(url))
    },

    move(move: PreviewNavigationMove): Promise<void> {
      const url = withAnchor(deps.urlFor(move.realPath), move.target.anchor)
      const native = move.kind === 'open' ? null : nativeStep(move.kind, url)
      return start(
        move.kind,
        move.target,
        move.realPath,
        native ?? (() => deps.loadUrl(url)),
        move.basis
      )
    },

    isNavigationPending(): boolean {
      const load = deps.page.pendingLoad()
      return load !== null && isNavigationKind(load.kind)
    },

    loadEnded(end: PreviewPageLoadEnd): void {
      const landed = intent
      if (landed === null || end.load !== landed.load) {
        // A reload, or a load no intent rides on: no move.
        return
      }
      intent = null
      if (deps.isDefunct() || (end.reason !== 'committed' && end.reason !== 'same-document')) {
        // Dropped – superseded, stopped, another document, never started: the
        // history is unchanged and there is nothing to tell.
        return
      }
      if (landed.kind !== 'initial') {
        // The input that asked for this move or step bought its entry: spent at
        // the landing, so a hash step on the page right after replaces (T1). A
        // move dropped above spends nothing.
        deps.takeRecentGesture()
      }
      const current = history()
      const next = advance(current, landed)
      if (next !== current) {
        navigation.history.set(next)
      }
      shownFile = landed.target.filePath
      const sameDocument =
        landed.kind === 'initial'
          ? navigation.initialSameDocument
          : end.reason === 'same-document' || !end.load.scoped
      announce(landed.target, next, sameDocument, end.failed)
    },

    inPageStep(url: string): void {
      // While a load of ours is on its way, the page being left does not count.
      if (intent !== null || deps.isDefunct()) {
        return
      }
      const entry = inPageEntry(url)
      if (entry === null) {
        return
      }
      const current = history()
      // Only a step the reader took adds an entry; a script's own step takes
      // the current one's place, so it cannot evict the pages before (S1).
      // Taken here, after every early return, so only a recorded step spends
      // the gesture, and the next step without new input replaces (T1).
      const next = deps.takeRecentGesture()
        ? pushEntry(current, entry)
        : replaceCurrent(current, entry)
      if (next !== current) {
        navigation.history.set(next)
        announce(entry, next, true, false)
      }
    }
  }
}
