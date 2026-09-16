// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Back and the link-mode toggle: the two controls that lead the HTML preview
 * toolbar (issue #124, part 3 §3.8; UX spec §1.1–§1.3).
 *
 * They act on THIS TAB – where its history goes, and what a plain link does in
 * it – so they come before Find, which acts on the page. Back leads because
 * every browser, Finder and Explorer put it at the leading edge. There is no
 * Forward button (settled): Back's tooltip names the Forward key instead, and
 * Back's `aria-keyshortcuts` carries the Back key.
 *
 * - **Back is `aria-disabled`, never `disabled`.** Pressing Back onto the first
 *   page is exactly when it turns disabled, and Chromium drops focus from a
 *   control the moment it gets `disabled`. It also stays disabled while no link
 *   router exists, since there is nothing to move the tab with.
 * - **The toggle's name never changes** ("Open links in this tab"); its state is
 *   `aria-pressed` (APG toggle button). Off is new-tab mode, the default.
 *
 * Presentational: the panel's navigation hook supplies the tab's state and the
 * callbacks, so the design card and the tests can render every state directly.
 *
 * @module HtmlPreviewPanel/components/PreviewNavControls
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import './PreviewNavControls.css'

import { previewNavKeyFor } from '../../../../../../shared/previewNavKeys'
import type { PreviewPageTarget } from '../../../../../../shared/ipc/preview-types'
import type { PreviewLinkMode } from '../../../../stores/usePreviewTabStore'
import { getBasename } from '../../../../utils/fileUtils'
import { renderIcon } from '../../../../utils/iconRegistry'

/** The toolbar's glyph size: lucide at 16px, stroke 2, like every band tool. */
const TOOL_ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const

/** Props for {@link PreviewNavControls}. */
export interface PreviewNavControlsProps {
  /** Main's history has an earlier page for this tab. */
  readonly canGoBack: boolean
  /** The page Back would show; its file name goes into the tooltip. */
  readonly backTarget: PreviewPageTarget | null
  /** What a plain link does in this tab; `same-tab` is the toggle's pressed state. */
  readonly linkMode: PreviewLinkMode
  /** A link router exists to move the tab with; without one Back is disabled. */
  readonly ready: boolean
  /** Picks the shortcut the tooltip and `aria-keyshortcuts` name. */
  readonly platform: NodeJS.Platform
  /** Step this tab back. Not called while Back is disabled. */
  readonly onBack: () => void
  /** Set the tab's link mode; called with the mode the press switches TO. */
  readonly onLinkModeChange: (mode: PreviewLinkMode) => void
}

/**
 * Back's two-line tooltip: line 1 names the page Back goes to, line 2 the
 * Forward key – Forward can exist while Back is disabled (UX spec §1.2).
 *
 * @param canGoBack - Whether the tab has an earlier page
 * @param backTarget - That page, when main named it
 * @param platform - Picks the shortcut labels
 * @returns The `title` text, lines joined with `\n`
 *
 * @example
 * ```ts
 * backTooltip(true, { filePath: '/p/overview.html', anchor: null }, 'darwin')
 * // 'Back to overview.html (Cmd+[)\nForward: Cmd+]'
 * ```
 */
export function backTooltip(
  canGoBack: boolean,
  backTarget: PreviewPageTarget | null,
  platform: NodeJS.Platform
): string {
  const back = previewNavKeyFor('back', platform).label
  const forward = `Forward: ${previewNavKeyFor('forward', platform).label}`
  if (!canGoBack) return `Back (${back}) – no earlier page in this tab\n${forward}`
  const name = backTarget ? getBasename(backTarget.filePath) : ''
  return `${name ? `Back to ${name}` : 'Back'} (${back})\n${forward}`
}

/**
 * The toggle's tooltip for a mode (UX spec §1.3). It says what a plain link
 * does now; the accessible name stays fixed.
 *
 * @param linkMode - The tab's current mode
 * @returns The `title` text
 */
export function linkModeTooltip(linkMode: PreviewLinkMode): string {
  return linkMode === 'same-tab'
    ? 'Open links in this tab – on: links replace this page'
    : 'Open links in this tab – off: links open a new tab'
}

/**
 * Renders Back and the link-mode toggle, as two `.erf-band__tool` buttons for
 * the band's leading slot.
 *
 * Back carries `data-preview-nav="back"`: the move coordinator and the panel
 * put focus on it after a prompt, a banner-started move or a find bar that
 * closed under the reader (`PREVIEW_BACK_BUTTON_SELECTOR`).
 *
 * @param props - {@link PreviewNavControlsProps}
 * @returns The two buttons, as a fragment
 *
 * @example
 * ```tsx
 * <PreviewChromeBand
 *   leadingTools={<><PreviewNavControls {...navigation.controls} /><PreviewFindTool onFind={openSearch} /></>}
 *   …
 * />
 * ```
 */
export function PreviewNavControls({
  canGoBack,
  backTarget,
  linkMode,
  ready,
  platform,
  onBack,
  onLinkModeChange
}: PreviewNavControlsProps): React.JSX.Element {
  const backDisabled = !canGoBack || !ready
  const sameTab = linkMode === 'same-tab'
  return (
    <>
      <button
        type="button"
        className="erf-band__tool"
        aria-label="Back"
        title={backTooltip(canGoBack, backTarget, platform)}
        aria-keyshortcuts={previewNavKeyFor('back', platform).ariaKeyShortcuts}
        aria-disabled={backDisabled ? 'true' : undefined}
        data-preview-nav="back"
        data-testid="preview-band-back"
        onClick={() => {
          // `aria-disabled` alone stops nothing; nowhere to go is silent (UX §3).
          if (!backDisabled) onBack()
        }}
      >
        {renderIcon('arrow-left', TOOL_ICON)}
      </button>
      <button
        type="button"
        className="erf-band__tool erf-band__tool--toggle"
        aria-label="Open links in this tab"
        aria-pressed={sameTab}
        title={linkModeTooltip(linkMode)}
        data-testid="preview-band-link-mode"
        onClick={() => onLinkModeChange(sameTab ? 'new-tab' : 'same-tab')}
      >
        {/* Placeholder glyph per UX spec §1.3 – "what a click does"; the final one is the ui-designer's call. */}
        {renderIcon('mouse-pointer-click', TOOL_ICON)}
      </button>
    </>
  )
}
