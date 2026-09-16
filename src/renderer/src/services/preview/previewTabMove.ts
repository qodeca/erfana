// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The same-tab move coordinator (issue #124, part 3 §3.6).
 *
 * Moves preview tab T to page B – a same-tab link, Back or Forward – under the
 * one-file-one-tab rule (user answer 2): every other tab in this window that
 * shows B closes, editors included, and a dirty editor's edits are never
 * dropped without the user's answer.
 *
 * NOTHING IRREVERSIBLE HAPPENS UNTIL MAIN ACCEPTS THE MOVE (RS4): 1. check
 * with main; 2. find the other tabs showing the checked target (T excluded);
 * 3. ask, only when one of those editors is dirty – their autosave is held, and
 * released on every ending but a move; Save writes now, Don't save is remembered; 4. commit with main – a refusal closes and discards nothing;
 * 5. close the other tabs (`closePanel` clears the dirty flag, so a "Don't
 * save" editor's edits go here, after main accepted the move).
 *
 * ONE MOVE PER PANEL (RS5): from the check until the commit's answer, prompt
 * included, further moves for the panel are ignored and logged – which also
 * drops a held Back key's repeats. The lock is released in a `finally`.
 *
 * A PROMPT THAT FAILS IS A CANCEL (RX2-5): a rejection or an unknown answer is
 * Cancel; the dialog context resolves `cancel` when its provider unmounts. A
 * coordinator without a prompt refuses every move that needs one (RX11).
 *
 * The announcement (§3.8) is written to the tab store just before the commit
 * and cleared on every other ending. Toasts carry file names; logs never a path,
 * so a log line names a tab by `stablePathDigest(panelId)` (QG-7 S3).
 *
 * @module previewTabMove
 * @see docs/design/design-issue-124-part3.md §3.6, §3.8
 */
import type { DockviewApi, IDockviewPanel } from 'dockview'

import { ErrorCode } from '../../../../shared/errors'
import type { PreviewNavigateRequest } from '../../../../shared/ipc/preview-navigation-schema'
import type {
  PreviewNavigateResult,
  PreviewPageTarget
} from '../../../../shared/ipc/preview-types'
import {
  usePreviewTabStore,
  type PreviewMoveOrigin,
  type PreviewTabStoreState
} from '../../stores/usePreviewTabStore'
import { stablePathDigest } from '../../utils/fileUtils'
import type { logger as rendererLogger } from '../../utils/logger'
import { findEditorTabsShowing, findPreviewTabShowing } from '../../utils/openFileInPanel'
import { nameOf, refusalToast } from './previewTabMoveMessages'

/**
 * Where the coordinator puts focus after the prompt: T's Back button, looked up
 * inside T's own panel element. `PreviewNavControls` (WI-20) renders Back with
 * `data-preview-nav="back"`.
 */
export const PREVIEW_BACK_BUTTON_SELECTOR = '[data-preview-nav="back"]'

/** A move to perform: open a page in the tab, or step its history. */
export type PreviewMoveRequest =
  | {
      /** Tab T, the one that moves. */
      panelId: string
      /** Who started it; decides what the panel announces (UX §6). */
      origin: PreviewMoveOrigin
      action: 'open'
      /** Project-space path of the page, as main reported it. */
      filePath: string
      /** Fragment without its `#`, or `null`. */
      anchor: string | null
    }
  | {
      panelId: string
      origin: PreviewMoveOrigin
      action: 'back' | 'forward'
    }

/** What the unsaved-changes prompt is asked. */
export interface PreviewMovePromptRequest {
  /** File name of the page, e.g. `pricing.html`. */
  fileName: string
  /** `conflict` when a dirty editor's file changed on disk: Save is not offered. */
  variant: 'save' | 'conflict'
}

/** The prompt's answer; `discard` is "Don't save" and "Discard my changes". */
export type PreviewMovePromptAnswer = 'save' | 'discard' | 'cancel'

/** The unsaved-changes prompt – in production, the dialog context's `showUnsavedChanges`. */
export type PreviewMovePrompt = (request: PreviewMovePromptRequest) => Promise<PreviewMovePromptAnswer>

/** A toast the coordinator shows; the shape `showGlobalToast` takes. */
export interface PreviewMoveToast {
  type: 'error' | 'info'
  title: string
  message: string
}

/** Why a move ended without moving, beyond main's own error codes. */
export type PreviewMoveRefusal = ErrorCode | 'no-prompt'

/** How a move ended. */
export type PreviewMoveOutcome =
  /** Main accepted the move; `closed` are the other tabs that were closed. */
  | { status: 'moved'; target: PreviewPageTarget; closed: readonly string[] }
  /** Main refused at `check` or `commit`, or a prompt was needed and there was none. */
  | { status: 'refused'; phase: 'check' | 'commit'; reason: PreviewMoveRefusal }
  /** The user answered Cancel (or the prompt failed). */
  | { status: 'cancelled' }
  /** "Save" was chosen and the write failed; nothing closed. */
  | { status: 'save-failed' }
  /** Not attempted: the tab is already moving, or no project is open. */
  | { status: 'ignored'; reason: 'busy' | 'no-project' }
  /** An unexpected throw; logged, nothing closed after it. */
  | { status: 'failed' }

/** The tab-store slice the coordinator reads and writes. */
export type PreviewTabMoveStore = Pick<
  PreviewTabStoreState,
  'getTab' | 'setHistory' | 'setAnnouncement' | 'setLastMove'
>

/** Everything the coordinator touches, injected so every branch is testable. */
export interface PreviewTabMoveDeps {
  /** This window's editor-area dockview api, or `null` when no project is open. */
  getDockviewApi: () => Pick<DockviewApi, 'panels' | 'getPanel'> | null
  /** `preview:navigate` (the preview bridge). */
  navigate: (request: PreviewNavigateRequest) => Promise<PreviewNavigateResult>
  /** Closes a tab and clears its dirty flag (`tabOperations.closePanel`). */
  closePanel: (panelId: string) => void
  /** The editor tab has unsaved edits (`useProjectStore.dirtyPanelIds`). */
  isDirty: (panelId: string) => boolean
  /** The editor tab is in its "changed on disk" state (the save registry). */
  hasConflict: (panelId: string) => boolean
  /** Saves an editor tab by id; `false` when the write failed (the save registry). */
  save: (panelId: string) => Promise<boolean>
  /** Pauses an editor tab's autosave; the returned release re-arms it and never throws (the save registry). */
  holdAutosave: (panelId: string) => () => void
  /** The unsaved-changes prompt; without one, a move that needs it is refused. */
  prompt?: PreviewMovePrompt | null
  /** Puts focus on T's Back button, one animation frame later. */
  focusBack: (panelId: string) => void
  /** Shows a toast (`showGlobalToast`). */
  showToast: (toast: PreviewMoveToast) => void
  /** Logger; never given a path. */
  logger: Pick<typeof rendererLogger, 'info' | 'warn' | 'error'>
  /** The tab store; defaults to {@link usePreviewTabStore}. */
  tabs?: PreviewTabMoveStore
}

/** A mounted coordinator. */
export interface PreviewTabMove {
  /** Runs one move; never rejects. Resolves with how it ended. */
  move(request: PreviewMoveRequest): Promise<PreviewMoveOutcome>
  /** Whether the tab's move lock is held – from the check until the commit's answer. */
  isMoving(panelId: string): boolean
}

/** The production tab-store slice, read fresh on every call. */
const TAB_STORE: PreviewTabMoveStore = {
  getTab: (panelId) => usePreviewTabStore.getState().getTab(panelId),
  setHistory: (panelId, history) => usePreviewTabStore.getState().setHistory(panelId, history),
  setAnnouncement: (panelId, announcement) =>
    usePreviewTabStore.getState().setAnnouncement(panelId, announcement),
  setLastMove: (panelId, lastMove) => usePreviewTabStore.getState().setLastMove(panelId, lastMove)
}

/** A panel's `params.filePath` – the page it shows now, never read from its id. */
function pageOf(panel: IDockviewPanel | undefined): string | undefined {
  const value = (panel?.params as { filePath?: unknown } | undefined)?.filePath
  return typeof value === 'string' ? value : undefined
}

/**
 * The other tabs in this window showing a page, T excluded (§3.6 step 2).
 * Both kinds go through the shared lookups in `openFileInPanel.ts`, so "shows
 * this page" has one definition. The preview lookup returns only its first
 * match and takes no exclude, so T and each hit leave the pool and it runs
 * again – bounded by the panel count.
 */
function findOtherTabs(
  api: Pick<DockviewApi, 'panels'>,
  panelId: string,
  filePath: string
): { previews: string[]; editors: string[] } {
  let pool = api.panels.filter((panel) => panel.id !== panelId)
  const previews: string[] = []
  for (let hit = findPreviewTabShowing({ panels: pool }, filePath); hit; ) {
    previews.push(hit.id)
    const found = hit
    pool = pool.filter((panel) => panel !== found)
    hit = findPreviewTabShowing({ panels: pool }, filePath)
  }
  const editors = findEditorTabsShowing({ panels: pool }, filePath).map((panel) => panel.id)
  return { previews, editors }
}

/**
 * Builds a same-tab move coordinator.
 *
 * @param deps - The seams it drives (see {@link PreviewTabMoveDeps})
 * @returns The coordinator
 *
 * @example Production wiring lives in `mountPreviewLinkRouter`
 * ```ts
 * const tabMove = createPreviewTabMove({ getDockviewApi, navigate, closePanel, isDirty,
 *   hasConflict, save, holdAutosave, prompt: showUnsavedChanges, focusBack, showToast, logger })
 * await tabMove.move({ panelId, origin: 'chrome', action: 'back' })
 * ```
 */
export function createPreviewTabMove(deps: PreviewTabMoveDeps): PreviewTabMove {
  const tabs = deps.tabs ?? TAB_STORE
  const moving = new Set<string>()

  /** `navigate`, with a thrown bridge call read as "not available now". */
  const navigate = async (request: PreviewNavigateRequest): Promise<PreviewNavigateResult> => {
    try {
      return await deps.navigate(request)
    } catch (error) {
      deps.logger.warn('Preview move: the navigate call failed', {
        panelId: stablePathDigest(request.panelId),
        phase: request.phase,
        error: error instanceof Error ? error.name : typeof error
      })
      return { ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }
    }
  }

  /** The prompt, with a rejection or an unknown answer read as Cancel. */
  const ask = async (
    prompt: PreviewMovePrompt,
    request: PreviewMovePromptRequest
  ): Promise<PreviewMovePromptAnswer> => {
    try {
      const answer = await prompt(request)
      return answer === 'save' || answer === 'discard' ? answer : 'cancel'
    } catch {
      return 'cancel'
    }
  }

  /** The `preview:navigate` request for one phase of a move. */
  const requestFor = (
    move: PreviewMoveRequest,
    phase: 'check' | 'commit',
    generation: number,
    target?: PreviewPageTarget
  ): PreviewNavigateRequest =>
    move.action === 'open'
      ? {
          panelId: move.panelId,
          phase,
          action: 'open',
          // The commit carries the target main checked, not the raw request.
          filePath: target?.filePath ?? move.filePath,
          anchor: target ? target.anchor : move.anchor
        }
      : { panelId: move.panelId, phase, action: move.action, generation }

  /** Ends a move main refused: nothing closes; the tab store and a toast say so. */
  const refuse = (
    move: PreviewMoveRequest,
    phase: 'check' | 'commit',
    result: Extract<PreviewNavigateResult, { ok: false }>,
    names: { target: string; current: string },
    prompted: boolean
  ): PreviewMoveOutcome => {
    tabs.setAnnouncement(move.panelId, null)
    // Main dropped a Back or Forward entry whose page is gone (part 3 §3.5).
    if (result.history) tabs.setHistory(move.panelId, result.history)
    deps.logger.info('Preview move refused', {
      panelId: stablePathDigest(move.panelId),
      action: move.action,
      phase,
      errorCode: result.errorCode
    })
    const toast = refusalToast(result.errorCode, move.action, names.target, names.current, prompted)
    if (toast) deps.showToast(toast)
    return { status: 'refused', phase, reason: result.errorCode }
  }

  /** One move; each autosave hold it takes goes into `held`, for `move` to release. */
  const run = async (
    move: PreviewMoveRequest,
    held: Array<() => void>
  ): Promise<PreviewMoveOutcome> => {
    const { panelId } = move
    const api = deps.getDockviewApi()
    if (!api) {
      deps.logger.info('Preview move ignored: no project is open', {
        panelId: stablePathDigest(panelId)
      })
      return { status: 'ignored', reason: 'no-project' }
    }

    const tab = tabs.getTab(panelId)
    const fromPath = pageOf(api.getPanel(panelId))
    const current = nameOf(fromPath)
    const requested =
      move.action === 'open'
        ? move.filePath
        : (move.action === 'back' ? tab.backTarget : tab.forwardTarget)?.filePath

    // 1. Check – before anything happens.
    const checked = await navigate(requestFor(move, 'check', tab.generation))
    if (!checked.ok) {
      return refuse(move, 'check', checked, { target: nameOf(requested), current }, false)
    }
    const { target } = checked
    const targetName = nameOf(target.filePath)

    // 2. Find the other tabs showing the target, in this window only.
    const others = findOtherTabs(api, panelId, target.filePath)
    const closing = [...others.previews, ...others.editors]

    // 3. Ask – only about editors with unsaved edits.
    const dirty = others.editors.filter((id) => deps.isDirty(id))
    let prompted = false
    if (dirty.length > 0) {
      if (!deps.prompt) {
        deps.logger.warn('Preview move refused: unsaved edits and no prompt to ask with', {
          panelId: stablePathDigest(panelId)
        })
        tabs.setAnnouncement(panelId, null)
        return { status: 'refused', phase: 'check', reason: 'no-prompt' }
      }
      const conflict = dirty.some((id) => deps.hasConflict(id))
      // Autosave would write the edits while the dialog is open (Q2).
      for (const id of dirty) held.push(deps.holdAutosave(id))
      const answer = await ask(deps.prompt, {
        fileName: targetName,
        variant: conflict ? 'conflict' : 'save'
      })
      prompted = true
      // Whatever the answer, focus goes to T's Back button once the dialog has
      // closed: a move never moves focus into the page on its own. The keyboard
      // route in (`preview:focusPage`) is the reader's to take (RU6).
      deps.focusBack(panelId)

      // Save is never offered in the conflict variant; an answer of `save`
      // there would overwrite the newer file, so it is read as Cancel.
      if (answer === 'cancel' || (answer === 'save' && conflict)) {
        tabs.setAnnouncement(panelId, null)
        return { status: 'cancelled' }
      }
      if (answer === 'save') {
        for (const id of dirty) {
          if (!(await deps.save(id))) {
            deps.logger.info('Preview move abandoned: the save failed', {
              panelId: stablePathDigest(panelId)
            })
            deps.showToast({
              type: 'error',
              title: `Could not save ${targetName}`,
              message: `This tab stayed on ${current}. Your changes are still in the other tab.`
            })
            tabs.setAnnouncement(panelId, null)
            return { status: 'save-failed' }
          }
        }
      }
      // `discard`: remembered by closing the tab after the commit, not before.
    }

    // 4. Commit. The announcement goes in first, so the `pageChanged` that
    // may race the commit's answer finds it (part 3 §3.8).
    tabs.setAnnouncement(panelId, {
      origin: move.origin,
      closedCount: closing.length,
      target,
      focusMoved: prompted
    })
    const committed = await navigate(requestFor(move, 'commit', checked.generation, target))
    if (!committed.ok) {
      return refuse(move, 'commit', committed, { target: targetName, current }, prompted)
    }
    tabs.setLastMove(panelId, {
      action: move.action,
      from: fromPath ? { filePath: fromPath, anchor: null } : null,
      to: target
    })

    // 5. Close the other tabs – only now, after main accepted the move.
    for (const id of closing) deps.closePanel(id)
    return { status: 'moved', target, closed: closing }
  }

  return {
    async move(move) {
      const { panelId } = move
      if (moving.has(panelId)) {
        deps.logger.info('Preview move ignored: this tab is already moving', {
          panelId: stablePathDigest(panelId),
          action: move.action
        })
        return { status: 'ignored', reason: 'busy' }
      }
      moving.add(panelId)
      const held: Array<() => void> = []
      let status: PreviewMoveOutcome['status'] = 'failed'
      try {
        const outcome = await run(move, held)
        status = outcome.status
        return outcome
      } catch (error) {
        // The name only: an Error's message can carry the page's absolute path.
        deps.logger.error('Preview move failed', undefined, {
          panelId: stablePathDigest(panelId),
          action: move.action,
          error: error instanceof Error ? error.name : typeof error
        })
        tabs.setAnnouncement(panelId, null)
        return { status: 'failed' }
      } finally {
        // Only a move closes the held tabs; every other ending resumes their autosave.
        if (status !== 'moved') for (const release of held) release()
        moving.delete(panelId)
      }
    },

    isMoving: (panelId) => moving.has(panelId)
  }
}

/**
 * Builds the production `focusBack`: one animation frame later – so it wins
 * over `BaseDialog`'s own focus restore on close – focus T's Back button,
 * found inside T's own panel element. A tab with no Back button is left alone.
 *
 * @param getDockviewApi - This window's dockview api, or `null`
 * @param schedule - Frame scheduler; defaults to `requestAnimationFrame`
 * @returns `focusBack(panelId)`
 *
 * @example
 * ```ts
 * const focusBack = createPreviewBackFocuser(() => useProjectStore.getState().dockviewApi)
 * ```
 */
export function createPreviewBackFocuser(
  getDockviewApi: () => Pick<DockviewApi, 'getPanel'> | null,
  schedule: (callback: () => void) => void = (callback) => {
    requestAnimationFrame(() => callback())
  }
): (panelId: string) => void {
  return (panelId) => {
    schedule(() => {
      const root = getDockviewApi()?.getPanel(panelId)?.view.content.element
      root?.querySelector<HTMLElement>(PREVIEW_BACK_BUTTON_SELECTOR)?.focus()
    })
  }
}
