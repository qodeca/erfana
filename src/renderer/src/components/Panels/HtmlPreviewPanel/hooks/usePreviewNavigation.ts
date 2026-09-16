// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewNavigation hook (issue #124, part 3 §3.5–§3.8).
 *
 * Everything the preview panel's chrome does with the tab's HISTORY, in one
 * place: Back and the link-mode toggle, the Back/Forward keys while focus is in
 * Erfana's chrome, the failed banner's return button, where focus goes after a
 * move the reader started from that banner, and what a landed move says.
 *
 * Moves go through the one link router (`getPreviewLinkRouter()`), whose
 * coordinator runs check → ask → commit → close. This hook never talks to main
 * itself, and a router that is not mounted yet disables Back rather than
 * creating one (RA2-5).
 *
 * KEYS. The panel root's `onKeyDown` fires only for focus inside this panel –
 * its toolbar, find bar or banner – so the active-panel gate (CLAUDE.md) is met
 * by construction: no `window` listener, so Monaco's Cmd+[ and the terminal's
 * Alt+arrows can never reach it. Keys pressed inside the native page arrive
 * forwarded instead (`usePreviewFindShortcuts`), with origin `page`.
 *
 * @module usePreviewNavigation
 * @see docs/design/design-issue-124-part3.md §3.7, §3.8
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview'

import {
  matchPreviewNavKey,
  navKeyFromDomEvent,
  type PreviewNavAction
} from '../../../../../../shared/previewNavKeys'
import type { PreviewPageChangedPayload } from '../../../../../../shared/ipc/preview-navigation-schema'
import { getPreviewLinkRouter } from '../../../../services/preview/PreviewLinkRouter'
import {
  createPreviewBackFocuser,
  type PreviewMoveOutcome
} from '../../../../services/preview/previewTabMove'
import {
  NO_PREVIEW_TAB,
  usePreviewTabStore,
  type PreviewLinkMode,
  type PreviewMoveOrigin,
  type PreviewTabState
} from '../../../../stores/usePreviewTabStore'
import { getBasename } from '../../../../utils/fileUtils'
import { getRendererPlatform } from '../../../../utils/platform'
import type { PreviewBannerReturnAction } from '../components/PreviewBanner'
import type { PreviewNavControlsProps } from '../components/PreviewNavControls'
import type { PreviewPanelView } from '../htmlPreview.logic'
import {
  scheduleNextFrame,
  usePreviewMoveAnnouncer,
  type PreviewFrameScheduler
} from './usePreviewMoveAnnouncer'

/** Inputs to {@link failedBannerNavigation}. */
export interface FailedBannerNavigationInput {
  /** The panel's top-level view; only `failed` gets anything. */
  view: PreviewPanelView
  /** The page the tab shows now (`params.filePath`). */
  filePath: string
  /** The tab's store entry: history state and the last accepted move. */
  tab: PreviewTabState
  /** The page named by the last `pageChanged` that reported `failed`, else `null`. */
  failedPage: string | null
  /** A link router exists to move the tab with. */
  ready: boolean
}

/** What the failed banner adds for navigation (part 3 §3.8). */
export interface FailedBannerNavigation {
  /** The move-caused message, or `null` to keep the banner's own text. */
  message: string | null
  /** The return button: the step it runs, its label, and whether it leads. */
  returnStep: { action: PreviewNavAction; label: string; leads: boolean } | null
}

/**
 * Decides the failed banner's move-caused text and return button (RU5, RU2-2).
 *
 * A MOVE CAUSED THE BANNER when the last `pageChanged` reported the page the
 * tab shows as `failed` and the tab's last accepted move went to that page.
 * Both halves are needed: `lastMove` alone would blame a move for a crash an
 * hour later, and the failed report alone also fires for a first load. Then the
 * banner names the page and offers the way back, first and focused: "Back to
 * overview.html" after an open or a Forward, "Return to pricing.html" (a
 * Forward) after a Back. Otherwise, when the tab has an earlier page, "Back to
 * overview.html" follows Reload, unfocused. A step main's history cannot take,
 * or one with no router to take it, gets no button.
 *
 * @param input - {@link FailedBannerNavigationInput}
 * @returns The message override and the return button, either may be empty
 *
 * @example
 * ```ts
 * failedBannerNavigation({ view: 'failed', filePath: '/p/pricing.html', failedPage: '/p/pricing.html',
 *   ready: true, tab: { ...tab, canGoBack: true, lastMove: { action: 'open',
 *   from: { filePath: '/p/overview.html', anchor: null }, to: { filePath: '/p/pricing.html', anchor: null } } } })
 * // { message: 'pricing.html could not be shown – …', returnStep: { action: 'back',
 * //   label: 'Back to overview.html', leads: true } }
 * ```
 */
export function failedBannerNavigation({
  view,
  filePath,
  tab,
  failedPage,
  ready
}: FailedBannerNavigationInput): FailedBannerNavigation {
  if (view !== 'failed') return { message: null, returnStep: null }
  const { lastMove } = tab
  const moveCaused =
    lastMove !== null && failedPage === filePath && lastMove.to.filePath === filePath
  if (moveCaused) {
    // A Back is undone by a Forward; an open or a Forward by a Back.
    const action: PreviewNavAction = lastMove.action === 'back' ? 'forward' : 'back'
    const possible = ready && (action === 'back' ? tab.canGoBack : tab.canGoForward)
    const to = lastMove.from ?? (action === 'back' ? tab.backTarget : tab.forwardTarget)
    const toName = to ? getBasename(to.filePath) : ''
    return {
      message: `${getBasename(filePath) || 'The page'} could not be shown – it may have been moved or deleted.`,
      returnStep:
        possible && toName
          ? { action, label: `${action === 'back' ? 'Back to' : 'Return to'} ${toName}`, leads: true }
          : null
    }
  }
  const backName = tab.backTarget ? getBasename(tab.backTarget.filePath) : ''
  if (ready && tab.canGoBack && backName) {
    return { message: null, returnStep: { action: 'back', label: `Back to ${backName}`, leads: false } }
  }
  return { message: null, returnStep: null }
}

/** Options for {@link usePreviewNavigation}. */
export interface UsePreviewNavigationOptions {
  /** The tab; its store entry holds the history state and the announcement. */
  panelId: string
  /** The page the tab shows now (`params.filePath`). */
  filePath: string
  /** The panel's top-level view; the band (and Back) exist only in `normal`. */
  view: PreviewPanelView
  /** The panel's dockview container; Back is found inside this tab's element. */
  containerApi: Pick<DockviewApi, 'getPanel'>
  /** Frame scheduler for focus and announcements; tests step it by hand. */
  schedule?: PreviewFrameScheduler
}

/** Result of {@link usePreviewNavigation}. */
export interface PreviewNavigation {
  /** Props for `PreviewNavControls` (Back and the link-mode toggle). */
  controls: PreviewNavControlsProps
  /**
   * Steps the tab's history through the router. Resolves `null`, without asking
   * main, when there is nowhere to go or no router; never rejects.
   */
  step: (action: PreviewNavAction, origin: PreviewMoveOrigin) => Promise<PreviewMoveOutcome | null>
  /** The panel root's `onKeyDown`: Back and Forward with focus in Erfana's chrome. */
  onRootKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  /** Puts focus on Back one frame later; the announcement waits for it. */
  focusBack: () => void
  /** Handles a `pageChanged` for this tab (wired through `usePreviewEvents`). */
  onPageChanged: (payload: PreviewPageChangedPayload) => void
  /** The failed banner's move-caused message and return button. */
  failedBanner: { message: string | null; returnAction?: PreviewBannerReturnAction }
  /** The panel-root polite region's text. */
  announcement: string
}

/**
 * Wires the preview panel's chrome to the tab's history.
 *
 * @param options - {@link UsePreviewNavigationOptions}
 * @returns {@link PreviewNavigation}
 *
 * @example
 * ```tsx
 * const navigation = usePreviewNavigation({ panelId, filePath, view, containerApi })
 * <div className="html-preview-panel" onKeyDown={navigation.onRootKeyDown}>
 *   <div className="erf-band__announce" role="status" aria-live="polite">{navigation.announcement}</div>
 *   <PreviewChromeBand leadingTools={<PreviewNavControls {...navigation.controls} />} … />
 * </div>
 * ```
 */
export function usePreviewNavigation({
  panelId,
  filePath,
  view,
  containerApi,
  schedule = scheduleNextFrame
}: UsePreviewNavigationOptions): PreviewNavigation {
  const tab = usePreviewTabStore((s) => s.tabs.get(panelId)) ?? NO_PREVIEW_TAB
  const [platform] = useState(getRendererPlatform)
  // Read at render: the router mounts once with the editor area, before any
  // move can exist, so no subscription is needed for it to appear.
  const ready = getPreviewLinkRouter() !== null
  const announcer = usePreviewMoveAnnouncer(panelId, schedule)
  const { expectFocus, focusSettled } = announcer

  const containerApiRef = useRef(containerApi)
  containerApiRef.current = containerApi

  const step = useCallback(
    async (action: PreviewNavAction, origin: PreviewMoveOrigin) => {
      const current = usePreviewTabStore.getState().getTab(panelId)
      // Nowhere to go: nothing happens, no sound (UX spec §3).
      if (action === 'back' ? !current.canGoBack : !current.canGoForward) return null
      const router = getPreviewLinkRouter()
      if (router === null) return null
      return router.move({ panelId, origin, action })
    },
    [panelId]
  )

  const focusBack = useCallback(() => {
    expectFocus()
    createPreviewBackFocuser(
      () => containerApiRef.current,
      (callback) => {
        schedule(() => {
          callback()
          focusSettled()
        })
      }
    )(panelId)
  }, [panelId, schedule, expectFocus, focusSettled])

  // The failed banner's return button (RU2-2). Its move unmounts the banner –
  // with focus on the pressed button – and mounts the band in one render, so
  // focus goes to Back once the band is there, not to the page body.
  const [failedPage, setFailedPage] = useState<string | null>(null)
  const [returnBusy, setReturnBusy] = useState(false)
  const returnBusyRef = useRef(false)
  const focusIntentRef = useRef(false)

  const runReturn = useCallback(
    (action: PreviewNavAction) => {
      if (returnBusyRef.current) return
      returnBusyRef.current = true
      setReturnBusy(true)
      focusIntentRef.current = true
      expectFocus()
      void step(action, 'chrome').then((outcome) => {
        returnBusyRef.current = false
        setReturnBusy(false)
        if (outcome?.status !== 'moved') {
          focusIntentRef.current = false
          focusSettled()
        }
      })
    },
    [step, expectFocus, focusSettled]
  )

  const onRootKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented) return
      const action = matchPreviewNavKey(navKeyFromDomEvent(event), platform)
      if (action === null) return
      // Ours even with nowhere to go: on Windows a stray Alt+arrow would
      // otherwise reach the auto-hidden menu bar.
      event.preventDefault()
      // Outside the normal view focus sits on the failed banner, which a landed
      // move unmounts – so take the return button's route, which lands focus on
      // Back instead of letting it drop to <body> (Q24).
      if (view !== 'normal') runReturn(action)
      else void step(action, 'chrome')
    },
    [platform, step, view, runReturn]
  )

  useEffect(() => {
    if (view !== 'normal' || !focusIntentRef.current) return
    focusIntentRef.current = false
    focusBack()
  }, [view, focusBack])

  const announcerOnPageChanged = announcer.onPageChanged
  const onPageChanged = useCallback(
    (payload: PreviewPageChangedPayload) => {
      setFailedPage(payload.failed ? payload.filePath : null)
      // The move landed: a failure from here on is not the move's to explain.
      if (!payload.failed) usePreviewTabStore.getState().setLastMove(panelId, null)
      announcerOnPageChanged(payload)
      if (payload.failed && focusIntentRef.current) {
        // The way back is broken too: the banner stays, and focus with it.
        focusIntentRef.current = false
        focusSettled()
      }
    },
    [panelId, announcerOnPageChanged, focusSettled]
  )

  const onBack = useCallback(() => void step('back', 'chrome'), [step])
  const onLinkModeChange = useCallback(
    (mode: PreviewLinkMode) => usePreviewTabStore.getState().setLinkMode(panelId, mode),
    [panelId]
  )

  const banner = failedBannerNavigation({ view, filePath, tab, failedPage, ready })
  const returnStep = banner.returnStep

  return {
    controls: {
      canGoBack: tab.canGoBack,
      backTarget: tab.backTarget,
      linkMode: tab.linkMode,
      ready,
      platform,
      onBack,
      onLinkModeChange
    },
    step,
    onRootKeyDown,
    focusBack,
    onPageChanged,
    failedBanner: {
      message: banner.message,
      returnAction: returnStep
        ? {
            label: returnStep.label,
            leads: returnStep.leads,
            isBusy: returnBusy,
            onAction: () => runReturn(returnStep.action)
          }
        : undefined
    },
    announcement: announcer.text
  }
}
