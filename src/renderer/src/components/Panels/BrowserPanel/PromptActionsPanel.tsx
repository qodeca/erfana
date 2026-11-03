// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The prompt-actions panel – the picked-element card (spec 025, 025-FR-027,
 * 025-FR-030, 025-FR-061; design § Prompt-actions panel and deck
 * *Prompt-actions panel*; commit 19). Drawn over the page's still image,
 * next to the outline.
 *
 * - **Header**: **Parent element** and **Child element** (pointer controls,
 *   `aria-disabled` at the ends of the range), the ancestor path cut from its
 *   start, the element chip ("{tag} · {size}", marked as changed for 1 s
 *   after a move) and × (*Close – nothing is sent*).
 * - **Banner slot**: the pre-warning on open, a guard after a refused send,
 *   or "Sends to …" after another terminal was chosen.
 * - **Actions**: **Explain** (sends at once), **Ask…**, **Change…**,
 *   **Prompt…**; then the target button and the key hint.
 *
 * Keys (025-FR-027, 025-FR-030): ↑ ↓ (and Alt+↑ ↓) refine, Esc closes, Tab
 * cycles actions → banner button → target → × and wraps. Enter and Space act
 * only on a fresh press, and a pointer press counts only when it began after
 * the panel opened (Z2), so the click that confirmed the pick cannot also
 * press an action.
 *
 * What main sends of the element is its name, size, ancestor path and box:
 * the panel shows those. The text and the resolved source (025-FR-037) stay
 * in the context file – the summary event does not carry them.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useLatestRef } from '../../../hooks/useLatestRef'
import type { RefineMoveRequest } from '../../../../../shared/ipc/browser-tab-pick-schema'
import type { HeldCapture } from '../../../stores/useBrowserPickStore'
import { ACTION_NAMES, type SendAction } from './browserSend'
import { cutPath } from './pickPanel.logic'
import type { TargetBanner } from './pickRow.logic'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** How long the element chip shows as changed after a move. */
export const CHANGED_MARK_MS = 1000
/** Crumbs of the ancestor path shown before it is cut from its start. */
export const PATH_CRUMBS = 4

/** Props for {@link PromptActionsPanel}. */
export interface PromptActionsPanelProps {
  readonly capture: HeldCapture
  readonly frozen: boolean
  /** The status note to show in the header (a refinement end, "element gone"), or `null`. */
  readonly note: string | null
  readonly banner: TargetBanner | null
  /** The action being sent, or `null`. */
  readonly busy: SendAction | null
  /** The action to focus on open (the one a dialog came back from), or Explain. */
  readonly focusAction?: SendAction
  readonly onAction: (action: SendAction) => void
  readonly onRefine: (move: RefineMoveRequest) => void
  readonly onClose: () => void
  readonly onBannerAction: (action: NonNullable<TargetBanner['action']>) => void
  /** The target button (`TargetChooser`, panel variant). */
  readonly target: React.ReactNode
  readonly style?: React.CSSProperties
  readonly sheet: boolean
  readonly panelRef?: React.RefObject<HTMLDivElement>
}

const ACTIONS: readonly SendAction[] = ['explain', 'ask', 'change', 'prompt']
const ACTION_LABEL: Readonly<Record<SendAction, string>> = { explain: 'Explain', ask: 'Ask…', change: 'Change…', prompt: 'Prompt…' }
const ACTION_DESC: Readonly<Record<SendAction, string>> = {
  explain: 'Sends now – asks the agent to explain this element',
  ask: 'Ask the agent a question about this element',
  change: 'Ask the agent to change the code behind this element',
  prompt: 'Write your own prompt about this element'
}

/** The Tab cycle's groups, in order (025-FR-030): actions, banner button, target, ×. */
const TAB_GROUPS = ['.erf-brw-actions__buttons button', '.erf-brw-banner__button', '.erf-brw-actions__footer button', '.erf-brw-actions__close']

/** The Tab stops inside `root`, in cycle order – not DOM order, where × comes first. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return TAB_GROUPS.flatMap(selector => [...root.querySelectorAll<HTMLElement>(selector)]).filter(el => !el.hasAttribute('disabled'))
}

/**
 * The panel.
 *
 * @param props - {@link PromptActionsPanelProps}
 * @returns The panel
 */
export function PromptActionsPanel(props: PromptActionsPanelProps): JSX.Element {
  const { capture, banner, busy, onAction, onRefine, onClose, onBannerAction } = props
  const { summary } = capture
  const ownRef = useRef<HTMLDivElement>(null)
  const rootRef = props.panelRef ?? ownRef
  const [openedAt] = useState(() => performance.now())
  const pressRef = useRef(-1)
  const freshKeyRef = useRef(false)
  const bannerButtonRef = useRef<HTMLButtonElement>(null)
  /** The refinement whose 1 s changed mark has run out. */
  const [markedOut, setMarkedOut] = useState<number | null>(null)
  const changed = capture.changedAt !== null && markedOut !== capture.changedAt

  // Explain (or the action a dialog came back from) has focus as the panel opens –
  // once per capture: a refinement must not move focus.
  const focusActionRef = useLatestRef(props.focusAction)
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>(`[data-action="${focusActionRef.current ?? 'explain'}"]`)?.focus()
  }, [capture.captureId, rootRef, focusActionRef])

  // A guard's banner takes focus to its button (R2-M14); a pre-warning on open does not.
  useEffect(() => {
    if (banner !== null && banner.kind.startsWith('guard')) bannerButtonRef.current?.focus()
  }, [banner])

  useEffect(() => {
    const at = capture.changedAt
    if (at === null) return
    const timer = setTimeout(() => setMarkedOut(at), CHANGED_MARK_MS)
    return () => clearTimeout(timer)
  }, [capture.changedAt])

  const pressCounts = (): boolean => pressRef.current >= openedAt
  const act = (action: SendAction): void => {
    if (busy === null) onAction(action)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onRefine(event.key === 'ArrowUp' ? 'parent' : 'child')
      return
    }
    if (event.key === 'Tab' && rootRef.current !== null) {
      const stops = tabStops(rootRef.current)
      const at = stops.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      // Only a press that began in the panel acts; auto-repeat never does (025-FR-030).
      freshKeyRef.current = !event.repeat
      if (event.repeat) event.preventDefault()
    }
  }
  const onClickAction = (event: React.MouseEvent, action: SendAction): void => {
    // A keyboard click (detail 0) needs a fresh keydown; a pointer click a press after the panel opened.
    const ok = event.detail === 0 ? freshKeyRef.current : pressCounts()
    freshKeyRef.current = false
    if (ok) act(action)
  }

  const crumbs = summary.ancestors.slice(0, -1)
  const path = cutPath(crumbs, PATH_CRUMBS)
  const titleId = `erf-brw-actions-${capture.captureId}`
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={`erf-brw-actions erf-picker-owned${props.sheet ? ' erf-brw-actions--sheet' : ''}`}
      style={props.style}
      data-testid={BROWSER_TEST_IDS.PROMPT_ACTIONS}
      onKeyDown={onKeyDown}
      onPointerDownCapture={event => {
        pressRef.current = event.timeStamp
      }}
    >
      <div className="erf-brw-actions__header">
        <button
          type="button"
          tabIndex={-1}
          className="erf-brw-actions__step"
          aria-label="Parent element"
          title="Parent element (↑)"
          aria-disabled={summary.atTop ? true : undefined}
          onClick={() => onRefine('parent')}
        >
          <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="erf-brw-actions__step"
          aria-label="Child element"
          title="Child element (↓)"
          aria-disabled={summary.atStart ? true : undefined}
          onClick={() => onRefine('child')}
        >
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <nav className="erf-brw-actions__path" aria-label="Element path">
          <ol>
            {path.cut && (
              <li aria-hidden="true" className="erf-brw-actions__sep">
                …
              </li>
            )}
            {path.crumbs.map(crumb => (
              <li key={crumb.index}>
                <button
                  type="button"
                  tabIndex={-1}
                  className="erf-brw-actions__crumb"
                  title="Moves the pick here"
                  onClick={() => onRefine({ ancestor: crumb.index })}
                >
                  {crumb.name}
                </button>
                <span aria-hidden="true" className="erf-brw-actions__sep">
                  ›
                </span>
              </li>
            ))}
            <li>
              <span
                id={titleId}
                aria-current="true"
                className={`erf-brw-actions__chip${changed ? ' erf-brw-actions__chip--changed' : ''}`}
              >
                {summary.name} · {summary.size}
              </span>
            </li>
          </ol>
        </nav>
        <button
          type="button"
          data-tab-stop=""
          className="erf-brw-actions__close"
          aria-label="Close – nothing is sent"
          title="Close – nothing is sent"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {props.note !== null && (
        <p className="erf-brw-actions__note" role="status">
          {props.note}
        </p>
      )}
      {(summary.changedAfterPick || props.frozen) && (
        <p className="erf-brw-actions__chips">
          {props.frozen && <span className="erf-brw-chip">Page paused</span>}
          {summary.changedAfterPick && <span className="erf-brw-chip">The page changed after the pick</span>}
        </p>
      )}
      {banner !== null && (
        <BannerSlot banner={banner} buttonRef={bannerButtonRef} onAction={onBannerAction} />
      )}
      <div className="erf-brw-actions__buttons" role="group" aria-label="Actions">
        {ACTIONS.map(action => (
          <button
            key={action}
            type="button"
            data-tab-stop=""
            data-action={action}
            className={`erf-brw-actions__action${action === 'explain' ? ' erf-brw-actions__action--primary' : ''}`}
            aria-label={ACTION_NAMES[action]}
            aria-description={ACTION_DESC[action]}
            aria-disabled={busy !== null && busy !== action ? true : undefined}
            aria-busy={busy === action ? true : undefined}
            onClick={event => onClickAction(event, action)}
          >
            {busy === action ? 'Sending…' : ACTION_LABEL[action]}
          </button>
        ))}
      </div>
      <div className="erf-brw-actions__footer">
        {props.target}
        <span className="erf-brw-actions__hint">↑ ↓ parent and child · Tab next action · Esc closes the panel</span>
      </div>
    </div>
  )
}

/** Props for {@link BannerSlot}. */
interface BannerSlotProps {
  readonly banner: TargetBanner
  readonly buttonRef: React.RefObject<HTMLButtonElement>
  readonly onAction: (action: NonNullable<TargetBanner['action']>) => void
}

const BANNER_BUTTON: Readonly<Record<NonNullable<TargetBanner['action']>, string>> = {
  chooseTerminal: 'Choose terminal',
  openTerminal: 'Open terminal',
  sendAnyway: 'Send anyway'
}

/**
 * The banner slot shared by the panel and the dialog: a warning or an error
 * with its one button (025-FR-061), or the note after a terminal was chosen.
 *
 * @param props - {@link BannerSlotProps}
 * @returns The banner
 */
export function BannerSlot({ banner, buttonRef, onAction }: BannerSlotProps): JSX.Element {
  const error = banner.kind.startsWith('guard')
  const tone = error ? 'error' : banner.kind === 'targetChosen' ? 'info' : 'warning'
  return (
    <div className={`erf-brw-banner erf-brw-banner--${tone}`} role={error ? 'alert' : 'status'}>
      <p className="erf-brw-banner__text">{banner.text}</p>
      {banner.action !== null && (
        <button
          ref={buttonRef}
          type="button"
          data-tab-stop=""
          className="erf-brw-banner__button"
          onClick={() => onAction(banner.action as NonNullable<TargetBanner['action']>)}
        >
          {BANNER_BUTTON[banner.action]}
        </button>
      )}
    </div>
  )
}
