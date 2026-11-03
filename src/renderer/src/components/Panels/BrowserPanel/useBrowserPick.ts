// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick and send for one browser panel (spec 025, 025-FR-025, 025-FR-030 to
 * 025-FR-032, 025-FR-046, 025-FR-053, 025-FR-060, 025-FR-061; solution design
 * § 9.1 `useBrowserSend`; commit 19). Main runs pick mode and holds the
 * capture; this hook runs what the reviewer sees of it:
 *
 * - **Pick element** toggles pick mode (`pickMode`); refused on an empty tab
 *   or an Erfana page with "Load a page to pick an element" (025-FR-025).
 * - **The panel** opens on a capture (the pick store's `capture`); the
 *   pre-warning is computed as it opens. **The dialog** replaces it for Ask…,
 *   Change… and Prompt… (main hears `pickSurface`, so a navigation keeps the
 *   dialog's capture); the typed text is kept per tab across dialog actions.
 * - **Close** (`closePick` with its reason) drops the capture and lets the
 *   still image go; pick mode stays on.
 * - **Send** (`browserSend.ts`): a guard swaps its banner in place; a failure
 *   is a toast and the panel or dialog stays for a retry; success shows the
 *   send notice for 5 s and, once per project and session, how to keep the
 *   agent out of the browser profile (S-21).
 * - **A page change** with the panel open closes it with "The page changed –
 *   pick the element again."; with the dialog open, the dialog stays and says
 *   the page reloaded (025-FR-053).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DockviewApi } from 'dockview'
import type { ClosePickReason, RefineMoveRequest } from '../../../../../shared/ipc/browser-tab-pick-schema'
import { IDLE_PICK, useBrowserPickStore, type BrowserPickTab } from '../../../stores/useBrowserPickStore'
import { useActivityBarStore } from '../../../stores/useActivityBarStore'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { browserStill, PICK_STILL_HOLDER } from '../../../services/browser/browserStill'
import { executePromptTemplate } from '../../../utils/panelUtils'
import { openFileInPanel } from '../../../utils/openFileInPanel'
import { showErrorToast, showInfoToast } from '../../../utils/toastHelpers'
import { logger } from '../../../utils/logger'
import { ACTION_NAMES, sendCapture, type SendAction } from './browserSend'
import { guardBanner, preWarning, targetChosen, type TargetBanner } from './pickRow.logic'
import type { DialogAction } from './InstructionDialog'
import type { BrowserTarget } from './useBrowserTarget'

/** Projects whose first send already offered the agent deny rule this session (S-21). */
const denyRuleOffered = new Set<string>()

/** The notice after a successful send. */
export interface SendNotice {
  readonly text: string
  readonly contextPath: string
}

/** Options for {@link useBrowserPick}. */
export interface UseBrowserPickOptions {
  readonly tabId: string | null
  /** A web page is shown (not an empty tab or an Erfana page). */
  readonly live: boolean
  readonly target: BrowserTarget
  readonly containerApi: DockviewApi
  readonly projectPath: string | null
  /** Return keyboard focus to the page. */
  readonly focusPage: () => void
}

/** What the panel draws and wires. */
export interface BrowserPick {
  readonly tab: BrowserPickTab
  /** `panel` or `dialog` while a capture is held, else `none`. */
  readonly surface: 'none' | 'panel' | 'dialog'
  readonly dialogAction: DialogAction | null
  /** The action the panel focuses as it opens (the one a dialog came back from). */
  readonly returnAction: SendAction | undefined
  readonly draft: string
  readonly busy: SendAction | null
  readonly banner: TargetBanner | null
  readonly notice: SendNotice | null
  readonly lastCapture: string | null
  readonly togglePick: () => void
  readonly close: (reason: ClosePickReason) => void
  readonly refine: (move: RefineMoveRequest) => void
  readonly openDialog: (action: DialogAction) => void
  readonly back: () => void
  readonly setDraft: (text: string) => void
  readonly send: (action: SendAction) => void
  readonly bannerAction: (action: NonNullable<TargetBanner['action']>) => void
  readonly targetChosenAgain: () => void
  readonly showTerminal: () => void
  readonly openCapture: (contextPath: string) => void
  readonly dismissNotice: () => void
}

function warn(what: string): (error: unknown) => void {
  return error => logger.warn(what, { error: error instanceof Error ? error.message : String(error) })
}

/** `relative` under `root`, with `root`'s own separator (main answers project-relative paths). */
function underProject(root: string, relative: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${relative.replace(/[\\/]/g, sep)}`
}

function showTerminalPanel(): void {
  // Never moves keyboard focus: the browser tab keeps it (025-FR-060).
  useActivityBarStore.getState().setActivePanel('terminal', 'right')
}

/**
 * Runs pick and send for one panel.
 *
 * @param options - {@link UseBrowserPickOptions}
 * @returns {@link BrowserPick}
 */
export function useBrowserPick(options: UseBrowserPickOptions): BrowserPick {
  const { tabId, live, target, containerApi, projectPath, focusPage } = options
  const tab = useBrowserPickStore(s => (tabId === null ? IDLE_PICK : (s.byTab.get(tabId) ?? IDLE_PICK)))
  const capture = tab.capture
  const captureId = capture?.captureId ?? null
  const [dialog, setDialog] = useState<{ captureId: string; action: DialogAction } | null>(null)
  const [returnAction, setReturnAction] = useState<SendAction | undefined>(undefined)
  // One instruction for the tab: it follows the reviewer from Change… to Ask… or Prompt… (M-25, 025-AC-064).
  const [draft, setDraftText] = useState('')
  const [busy, setBusy] = useState<SendAction | null>(null)
  const [banner, setBanner] = useState<{ captureId: string; banner: TargetBanner | null } | null>(null)
  const [notice, setNotice] = useState<SendNotice | null>(null)
  const [lastCapture, setLastCapture] = useState<string | null>(null)

  const dialogAction = dialog !== null && dialog.captureId === captureId ? dialog.action : null
  const afterNavigation = capture?.afterNavigation === true
  // After a page change only the dialog may stay; the panel is closing (025-FR-053).
  const surface = captureId === null ? 'none' : dialogAction !== null ? 'dialog' : afterNavigation ? 'none' : 'panel'
  // The pre-warning shows as the panel opens, until a send or a choice rewrites the slot (M-28).
  const shownBanner =
    captureId === null ? null : banner?.captureId === captureId ? banner.banner : preWarning(target.terminalName, target.status)

  const drop = useCallback(
    (id: string) => {
      if (tabId === null) return
      useBrowserPickStore.getState().dropCapture(tabId, id)
      browserStill.release(tabId, PICK_STILL_HOLDER)
      setDialog(null)
      setBusy(null)
    },
    [tabId]
  )

  const close = useCallback(
    (reason: ClosePickReason) => {
      if (tabId === null || captureId === null) return
      browserTabGateway.closePick({ tabId, captureId, reason }).catch(warn('Browser closePick failed'))
      drop(captureId)
      // A hidden tab keeps the typed text for its next dialog (025-FR-052); every other close ends it.
      if (reason !== 'tabHidden') setDraftText('')
      if (reason === 'esc' || reason === 'cancel' || reason === 'clickOutside') focusPage()
    },
    [tabId, captureId, drop, focusPage]
  )

  // A page change: the panel closes with a note and main lets the capture go; the dialog stays (025-FR-053).
  useEffect(() => {
    if (!afterNavigation || dialogAction !== null || tabId === null || captureId === null) return
    browserTabGateway.closePick({ tabId, captureId, reason: 'cancel' }).catch(warn('Browser closePick failed'))
    const store = useBrowserPickStore.getState()
    store.dropCapture(tabId, captureId)
    store.showNote(tabId, 'pageChanged')
    browserStill.release(tabId, PICK_STILL_HOLDER)
  }, [afterNavigation, dialogAction, tabId, captureId])

  // A capture main ended (navigation, crash, hidden tab) takes the still image with it.
  useEffect(() => {
    if (captureId === null && tabId !== null) browserStill.release(tabId, PICK_STILL_HOLDER)
  }, [captureId, tabId])

  // The panel opens on a current status, so its pre-warning is right.
  const { refresh } = target
  useEffect(() => {
    if (captureId !== null) refresh()
  }, [captureId, refresh])

  const togglePick = useCallback(() => {
    if (tabId === null) return
    if (!live) {
      useBrowserPickStore.getState().showNote(tabId, 'loadAPage')
      return
    }
    if (captureId !== null) {
      close('toolbar')
      return
    }
    browserTabGateway.pickMode(tabId, !tab.on).catch(warn('Browser pickMode failed'))
  }, [tabId, live, captureId, close, tab.on])

  const refine = useCallback(
    (move: RefineMoveRequest) => {
      if (tabId !== null && captureId !== null) browserTabGateway.refine({ tabId, captureId, move }).catch(warn('Browser refine failed'))
    },
    [tabId, captureId]
  )

  const openDialog = useCallback(
    (action: DialogAction) => {
      if (tabId === null || captureId === null) return
      browserTabGateway.pickSurface(tabId, captureId, 'dialog').catch(warn('Browser pickSurface failed'))
      setDialog({ captureId, action })
      setReturnAction(action)
    },
    [tabId, captureId]
  )

  const back = useCallback(() => {
    if (tabId === null || captureId === null) return
    browserTabGateway.pickSurface(tabId, captureId, 'menu').catch(warn('Browser pickSurface failed'))
    setDialog(null)
  }, [tabId, captureId])

  const setDraft = useCallback(
    (text: string) => {
      if (dialogAction !== null) setDraftText(text)
    },
    [dialogAction]
  )

  const sendWith = useCallback(
    (action: SendAction, sendAnyway: boolean) => {
      if (tabId === null || captureId === null || busy !== null) return
      const id = captureId
      const name = target.terminalName ?? 'the terminal'
      setBusy(action)
      void sendCapture(
        {
          writeCapture: request => browserTabGateway.writeCapture({ ...request, tabId }),
          discardCaptureFiles: (t, c) => browserTabGateway.discardCaptureFiles(t, c),
          closeSent: (t, c) => browserTabGateway.closePick({ tabId: t, captureId: c, reason: 'sent' }),
          executePrompt: (promptId, variables, terminalId) =>
            executePromptTemplate(promptId, variables, { terminalId, openPanel: false, reveal: 'withoutFocus', showToast: false })
        },
        {
          tabId,
          captureId: id,
          terminalId: target.terminalId,
          terminalName: name,
          action,
          instruction: action === 'explain' ? '' : draft,
          sendAnyway
        }
      ).then(outcome => {
        setBusy(null)
        if (outcome.kind === 'guard') {
          setBanner({ captureId: id, banner: guardBanner(outcome.guard.kind, target.terminalName, outcome.guard.process) })
          return
        }
        if (outcome.kind === 'failed') {
          const rest = action === 'explain' ? 'Nothing was sent – choose Explain to try again.' : 'Nothing was sent, and your text is still in the dialog – press Send to try again.'
          showErrorToast("Couldn't send to your agent", `${outcome.reason}. ${rest}`)
          return
        }
        drop(id)
        setDraftText('')
        setLastCapture(outcome.contextPath)
        setNotice({ text: `Sent ${ACTION_NAMES[action]} to ${name}`, contextPath: outcome.contextPath })
        focusPage()
        if (projectPath !== null && !denyRuleOffered.has(projectPath)) {
          denyRuleOffered.add(projectPath)
          showInfoToast(
            "Keep your agent out of the browser profile",
            "The browser profile holds this project's cookies and saved sign-ins. Add a deny rule for .erfana/browser/profile/ to your agent's settings – for Claude Code, Read(./.erfana/browser/profile/**) under permissions.deny."
          )
        }
      })
    },
    [tabId, captureId, busy, target.terminalId, target.terminalName, draft, drop, focusPage, projectPath]
  )

  const send = useCallback((action: SendAction) => sendWith(action, false), [sendWith])

  const targetChosenAgain = useCallback(() => {
    refresh()
    if (captureId === null) return
    const next = target.status?.kind === 'shell' ? guardBanner('shell', target.terminalName, target.status.process) : targetChosen(target.view)
    setBanner({ captureId, banner: next })
  }, [refresh, captureId, target.status, target.terminalName, target.view])

  const bannerAction = useCallback(
    (action: NonNullable<TargetBanner['action']>) => {
      if (action === 'openTerminal') {
        // Opens the terminal panel, which starts a terminal; the panel or dialog stays (025-FR-061).
        showTerminalPanel()
        return
      }
      if (action === 'chooseTerminal') {
        targetChosenAgain()
        return
      }
      sendWith(dialogAction ?? 'explain', true)
    },
    [targetChosenAgain, sendWith, dialogAction]
  )

  const openCapture = useCallback(
    (contextPath: string) => {
      if (projectPath === null) return
      if (openFileInPanel(containerApi, underProject(projectPath, contextPath)) === undefined) {
        showErrorToast("Couldn't open the capture", 'The editor is not ready.')
      }
    },
    [containerApi, projectPath]
  )

  const dismissNotice = useCallback(() => setNotice(null), [])

  return useMemo(
    () => ({
      tab,
      surface,
      dialogAction,
      returnAction,
      draft: dialogAction === null ? '' : draft,
      busy,
      banner: shownBanner,
      notice,
      lastCapture,
      togglePick,
      close,
      refine,
      openDialog,
      back,
      setDraft,
      send,
      bannerAction,
      targetChosenAgain,
      showTerminal: showTerminalPanel,
      openCapture,
      dismissNotice
    }),
    [tab, surface, dialogAction, returnAction, draft, busy, shownBanner, notice, lastCapture, togglePick, close, refine, openDialog, back, setDraft, send, bannerAction, targetChosenAgain, openCapture, dismissNotice]
  )
}
