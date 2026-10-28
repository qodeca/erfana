// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Same-tab moves, history steps and the page a view opens on, for the preview
 * service (issue #124, WI-17b; part 3 §3.1, §3.4, §3.5). The fallback split
 * named for `PreviewViewService.ts` (design §3), which keeps only the wiring.
 *
 * One gate for every page main shows in place (RX8) – a `preview:navigate`
 * target, a Back or Forward entry (a script's `pushState` entry included) and
 * the entry a resume opens on alike:
 *
 *   1. re-confined on the view's REAL root – no build-folder exception, the dot
 *      rule kept; a page that is gone is `PREVIEW_NAV_TARGET_MISSING`, any
 *      other refusal `PREVIEW_NAV_TARGET_REFUSED`;
 *   2. `.html` / `.htm`, on the real target;
 *   3. eligible, by the main-side check read in project space. No check, or a
 *      check that fails, refuses: the gate fails closed.
 *
 * A page that passes is named in project space by `toProjectPath`
 * (`previewUrl.ts`) – the spelling the project tree uses, also for a project
 * reached through a symlink; it is loaded at its real path.
 *
 * Main is authoritative on resume (RS6, RX2-6, RX3-1): a panel whose history
 * survived a suspend reopens on `history[index]` when it passes the gate. When
 * it does not, the tab's own page takes its place, with a one-entry history one
 * generation on – but it is judged first (QG-7 item 11), because the tab was
 * made before the suspend and what it may show can have changed since:
 *
 *   - no `.html`, refused by the eligibility check, or impossible to judge at
 *     all: NOTHING opens. `startingPage` answers with the code, the open fails
 *     with it and the tab shows its failed state, rather than showing a page
 *     main would refuse every move onto. Neither check has a second chance
 *     later: the protocol handler serves whatever the view asks for inside the
 *     root, page type and eligibility included;
 *   - impossible to LOCATE (gone, or outside the root): loaded at the path the
 *     renderer sent, as a first open loads it. That one the handler does catch
 *     – it re-confines every request – so the page fails there as it always
 *     did, which is what the tab already showed before the suspend.
 *
 * The FIRST open is the one path that runs step 1 alone: the renderer's page is
 * re-confined on the real root, loaded at its real path and named in project
 * space, as a move is, so a project reached through a symlink serves its first
 * page too. It checks no page type and no eligibility, as no first open ever
 * has (technical debt) – the renderer checked eligibility before it made the
 * tab. A page step 1 refuses is loaded at the path the renderer sent, and fails
 * there as it always did.
 */
import { isAbsolute } from 'node:path'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewNavigateRequest } from '../../../shared/ipc/preview-navigation-schema'
import type {
  PreviewHistoryState,
  PreviewNavigateResult,
  PreviewPageTarget
} from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { PreviewLiveView } from './PreviewLiveView'
import type { PreviewEligibilityCheck } from './previewLiveTypes'
import { isPreviewPagePath } from './previewLinkDisposition'
import type { PreviewLiveNavigationParams, PreviewPanelHistoryStore } from './previewPageNavigator'
import type { IPreviewPanelState } from './previewPanelState'
import { confinePath } from './previewPathResolve'
import {
  createTabHistory,
  currentEntry,
  dropNeighbour,
  historyState,
  neighbourEntry,
  replaceCurrent
} from './previewTabHistory'
import { toProjectPath } from './previewUrl'

/** The part of a live view the navigation reads and drives. */
export type PreviewNavigableView = Pick<
  PreviewLiveView,
  'projectPath' | 'realRoot' | 'navigate' | 'isNavigationPending'
>

/** A registry entry, as `PreviewViewRegistry.entry` returns it. */
export interface PreviewNavigableEntry {
  readonly view: PreviewNavigableView
  readonly windowId: number
}

/** What the navigation needs from the service. */
export interface PreviewViewNavigationDeps {
  readonly registry: { entry(panelId: string): PreviewNavigableEntry | null }
  readonly panelState: Pick<IPreviewPanelState, 'history' | 'setHistory'>
  /** The eligibility check, read when used: the service's deps are set after this is built. */
  readonly checkEligibility: () => PreviewEligibilityCheck | undefined
  /** Confinement; {@link confinePath} by default. */
  readonly confine?: typeof confinePath
}

/**
 * What a view opens on: the page below, or the gate's refusal of a resume whose
 * own page AND the tab's own both failed it (QG-7 item 11). A refusal is an
 * answer, never a rejection.
 */
export type PreviewStartingPageResult =
  | ({ readonly ok: true } & PreviewStartingPage)
  | { readonly ok: false; readonly errorCode: ErrorCode }

/** The page a view opens on, and the history it opens with. */
export interface PreviewStartingPage {
  /**
   * What the view loads first: the page's real path – main's checked page on a
   * resume, else the renderer's page located on the real root – or the path the
   * renderer sent, when that page cannot be located.
   */
  readonly filePath: string
  readonly navigation: PreviewLiveNavigationParams
}

/**
 * The service's navigation half. Function properties, not methods: the service
 * hands `navigate` on as its own member, unbound.
 */
export interface PreviewViewNavigation {
  /** `preview:navigate` for a panel of `windowId`. Never rejects on a refusal: it answers with a code. */
  readonly navigate: (
    request: PreviewNavigateRequest,
    windowId: number
  ) => Promise<PreviewNavigateResult>
  /**
   * The page a view opens on: main's history on a resume, else the page the
   * renderer asked for. `realRoot` is the new session's. A resume whose page
   * and whose tab's page both fail the gate answers a refusal. Never rejects.
   */
  readonly startingPage: (
    request: { readonly panelId: string; readonly filePath: string },
    realRoot: string,
    projectPath: string
  ) => Promise<PreviewStartingPageResult>
}

/** The gate's verdict on one target. */
type GateVerdict =
  | { readonly ok: true; readonly entry: PreviewPageTarget; readonly realPath: string }
  | { readonly ok: false; readonly errorCode: ErrorCode }

/** A target the gate's step 1 located: its project-space name and real path. */
type LocatedPage = Extract<GateVerdict, { readonly ok: true }>

/** Where a view's pages are: its real root, and main's project root. */
interface ViewRoots {
  readonly realRoot: string
  readonly projectPath: string
}

const refusedWith = (errorCode: ErrorCode): GateVerdict => ({ ok: false, errorCode })

/** Build the navigation half of one service. */
export function createPreviewViewNavigation(
  deps: PreviewViewNavigationDeps
): PreviewViewNavigation {
  const confine = deps.confine ?? confinePath

  async function isEligible(filePath: string, projectPath: string): Promise<boolean> {
    const check = deps.checkEligibility()
    if (check === undefined) {
      return false
    }
    try {
      return (await check(filePath, projectPath)).eligible
    } catch (error) {
      // Only the error's name: its message may carry the path.
      logger.warn('Preview navigation: the eligibility check failed; refusing the page', {
        error: error instanceof Error ? error.name : typeof error
      })
      return false
    }
  }

  /**
   * The gate's step 1 alone: re-confined on the real root, named in project
   * space, with its real path to load. A first open runs only this.
   */
  async function locate(target: PreviewPageTarget, roots: ViewRoots): Promise<GateVerdict> {
    if (!isAbsolute(target.filePath)) {
      return refusedWith(ErrorCode.PREVIEW_NAV_TARGET_REFUSED)
    }
    const verdict = await confine(roots.realRoot, target.filePath)
    if (!verdict.ok) {
      return refusedWith(
        verdict.reason === 'missing'
          ? ErrorCode.PREVIEW_NAV_TARGET_MISSING
          : ErrorCode.PREVIEW_NAV_TARGET_REFUSED
      )
    }
    const filePath = toProjectPath(roots.projectPath, roots.realRoot, verdict.realTarget)
    return { ok: true, entry: { filePath, anchor: target.anchor }, realPath: verdict.realTarget }
  }

  /** The gate's steps 2 and 3 on a located page: `.html`/`.htm`, then eligible. */
  async function passesChecks(located: LocatedPage, roots: ViewRoots): Promise<boolean> {
    return (
      isPreviewPagePath(located.realPath) &&
      (await isEligible(located.entry.filePath, roots.projectPath))
    )
  }

  /** The one gate (RX8): confined on the real root, `.html`/`.htm`, eligible. */
  async function gate(target: PreviewPageTarget, roots: ViewRoots): Promise<GateVerdict> {
    const located = await locate(target, roots)
    if (!located.ok) {
      return located
    }
    return (await passesChecks(located, roots))
      ? located
      : refusedWith(ErrorCode.PREVIEW_NAV_TARGET_REFUSED)
  }

  /** The panel's live view, only when it lives in `windowId`. */
  function viewIn(panelId: string, windowId: number): PreviewNavigableView | null {
    const entry = deps.registry.entry(panelId)
    return entry !== null && entry.windowId === windowId ? entry.view : null
  }

  function refuse(
    request: PreviewNavigateRequest,
    errorCode: ErrorCode,
    history?: PreviewHistoryState
  ): PreviewNavigateResult {
    logger.info('Preview navigation refused', {
      panelId: stablePathDigest(request.panelId),
      action: request.action,
      phase: request.phase,
      errorCode
    })
    return history === undefined ? { ok: false, errorCode } : { ok: false, errorCode, history }
  }

  async function navigate(
    request: PreviewNavigateRequest,
    windowId: number
  ): Promise<PreviewNavigateResult> {
    const { panelId } = request
    const view = viewIn(panelId, windowId)
    const basis = deps.panelState.history(panelId)
    if (view === null || basis === null) {
      return refuse(request, ErrorCode.PREVIEW_NAV_UNAVAILABLE)
    }
    let wanted: PreviewPageTarget | null
    if (request.action === 'open') {
      wanted = { filePath: request.filePath, anchor: request.anchor }
    } else {
      // A step is only ever against main's current list, and only onto an entry.
      wanted =
        request.generation === basis.generation ? neighbourEntry(basis, request.action) : null
    }
    if (wanted === null) {
      return refuse(request, ErrorCode.PREVIEW_NAV_SKIPPED)
    }

    const verdict = await gate(wanted, view)
    // The gate awaited: the view, or the list, may have moved on meanwhile.
    const history = deps.panelState.history(panelId)
    if (viewIn(panelId, windowId) !== view || history === null) {
      return refuse(request, ErrorCode.PREVIEW_NAV_UNAVAILABLE)
    }
    if (request.action !== 'open' && history !== basis) {
      return refuse(request, ErrorCode.PREVIEW_NAV_SKIPPED)
    }
    if (!verdict.ok) {
      if (request.action !== 'open' && verdict.errorCode === ErrorCode.PREVIEW_NAV_TARGET_MISSING) {
        // RU2-3: the entry whose page is gone leaves the list, so the next
        // step in that direction goes one entry further.
        const next = dropNeighbour(history, request.action)
        deps.panelState.setHistory(panelId, next)
        return refuse(request, verdict.errorCode, historyState(next))
      }
      return refuse(request, verdict.errorCode)
    }

    const answer: PreviewNavigateResult = {
      ok: true,
      target: verdict.entry,
      generation: history.generation
    }
    if (request.phase === 'check') {
      return answer
    }
    // Only a move or step main started is pending; a reload is superseded (RS2-5).
    if (view.isNavigationPending()) {
      return refuse(request, ErrorCode.PREVIEW_NAV_SKIPPED)
    }
    const started = view.navigate({
      kind: request.action,
      target: verdict.entry,
      realPath: verdict.realPath,
      basis: history
    })
    return started ? answer : refuse(request, ErrorCode.PREVIEW_NAV_UNAVAILABLE)
  }

  function historyStore(panelId: string): PreviewPanelHistoryStore {
    return {
      get: () => deps.panelState.history(panelId),
      set: (history) => deps.panelState.setHistory(panelId, history)
    }
  }

  /**
   * The renderer's page as a first open loads it, located like a move: its real
   * path to load and its project-space name. A page `locate` refuses, or a
   * `locate` that throws, keeps the path the renderer sent. Never rejects.
   */
  async function locateRendererPage(
    request: { readonly panelId: string; readonly filePath: string },
    roots: ViewRoots
  ): Promise<{ readonly entry: PreviewPageTarget; readonly filePath: string }> {
    const sent: PreviewPageTarget = { filePath: request.filePath, anchor: null }
    try {
      const located = await locate(sent, roots)
      if (located.ok) {
        return { entry: located.entry, filePath: located.realPath }
      }
    } catch (error) {
      logger.warn('Preview open: locating the page failed; loading it as sent', {
        panelId: stablePathDigest(request.panelId),
        error: error instanceof Error ? error.name : typeof error
      })
    }
    return { entry: sent, filePath: sent.filePath }
  }

  /**
   * The gate on a resume, answering a refusal when it throws: an open must not
   * fail on the gate itself, and a page the gate could not judge is not shown.
   */
  async function resumeGate(
    target: PreviewPageTarget,
    roots: ViewRoots,
    panelId: string
  ): Promise<GateVerdict> {
    try {
      return await gate(target, roots)
    } catch (error) {
      logger.warn('Preview resume: the gate failed', {
        panelId: stablePathDigest(panelId),
        error: error instanceof Error ? error.name : typeof error
      })
      return refusedWith(ErrorCode.PREVIEW_NAV_UNAVAILABLE)
    }
  }

  /** A page to open on, with a one-entry history at `generation`. */
  function opensOn(
    history: PreviewPanelHistoryStore,
    entry: PreviewPageTarget,
    filePath: string,
    generation: number
  ): PreviewStartingPageResult {
    return {
      ok: true,
      filePath,
      navigation: {
        history,
        initialHistory: createTabHistory(entry, generation),
        // The file the tab asked for, in whatever spelling it sent.
        initialSameDocument: true
      }
    }
  }

  /**
   * The tab's own page, when main's page failed the gate (QG-7 item 11): judged
   * on its type and its eligibility, which nothing downstream checks again, and
   * located as a first open locates it, which the protocol handler does check
   * again. The header holds the rule and its reason.
   */
  async function fallbackPage(
    request: { readonly panelId: string; readonly filePath: string },
    roots: ViewRoots,
    history: PreviewPanelHistoryStore,
    generation: number
  ): Promise<PreviewStartingPageResult> {
    const { panelId } = request
    const sent: PreviewPageTarget = { filePath: request.filePath, anchor: null }
    let located: GateVerdict
    try {
      located = await locate(sent, roots)
    } catch (error) {
      // Judged by nobody is not judged: only the error's name, never its message.
      logger.warn("Preview resume: the tab's own page could not be judged; opening nothing", {
        panelId: stablePathDigest(panelId),
        error: error instanceof Error ? error.name : typeof error
      })
      return { ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }
    }
    if (!located.ok) {
      return opensOn(history, sent, sent.filePath, generation)
    }
    if (!(await passesChecks(located, roots))) {
      logger.warn("Preview resume: the tab's own page did not pass the gate; opening nothing", {
        panelId: stablePathDigest(panelId)
      })
      return { ok: false, errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED }
    }
    return opensOn(history, located.entry, located.realPath, generation)
  }

  async function startingPage(
    request: { readonly panelId: string; readonly filePath: string },
    realRoot: string,
    projectPath: string
  ): Promise<PreviewStartingPageResult> {
    const { panelId, filePath: rendererPath } = request
    const roots: ViewRoots = { realRoot, projectPath }
    const history = historyStore(panelId)
    const prior = deps.panelState.history(panelId)
    if (prior === null) {
      // A first open: step 1 alone, on the page the renderer named.
      const page = await locateRendererPage(request, roots)
      return opensOn(history, page.entry, page.filePath, 0)
    }

    const verdict = await resumeGate(currentEntry(prior), roots, panelId)
    if (!verdict.ok) {
      logger.warn("Preview resume: main's page did not pass the gate; trying the tab's own", {
        panelId: stablePathDigest(panelId),
        errorCode: verdict.errorCode
      })
      return fallbackPage(request, roots, history, prior.generation + 1)
    }
    const sameDocument = verdict.entry.filePath === rendererPath
    if (!sameDocument) {
      logger.warn("Preview resume: the tab named another page; main's history wins", {
        panelId: stablePathDigest(panelId)
      })
    }
    return {
      ok: true,
      filePath: verdict.realPath,
      navigation: {
        history,
        initialHistory: replaceCurrent(prior, verdict.entry),
        initialSameDocument: sameDocument
      }
    }
  }

  return { navigate, startingPage }
}
