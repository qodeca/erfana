// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One strip row above a browser tab's page (spec 025, 025-FR-054; design
 * README § Site prompts; Site prompts card, proposed): a site prompt, a page
 * dialog, the leave-page prompt, the hung-page notice, a keyring notice or
 * the full-screen notice. Main composed its sentence; this draws it with the
 * deck's buttons.
 *
 * - **Input guard** (OD-6): for {@link STRIP_INPUT_GUARD_MS} after the row
 *   appears or changes – or after focus is restored to it – its buttons are
 *   `aria-disabled` with the blocked look and ignore presses, and a press
 *   that began before then never counts. Main enforces the same on its clock.
 * - **Focus on arrival** only when main says the row takes it (the leave-page
 *   prompt on **Stay**, the sign-in box after a user-started load); never on
 *   a granting button.
 * - **Esc** cancels or dismisses the row when it offers that (025-FR-051).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { X } from 'lucide-react'
import type { StripAnswer, StripFieldsSchema, StripRow as StripRowPayload } from '../../../../../shared/ipc/browser-tab-schema'
import type { z } from 'zod'
import {
  answerLabel,
  dismissDescription,
  dismissIsIcon,
  escapeAnswer,
  HUNG_EXPLANATION,
  isGranting,
  isGuarded,
  originLine,
  queueCount,
  rememberedText,
  rowSentence,
  showsOriginLine,
  STRIP_INPUT_GUARD_MS,
  stripRowRole
} from './stripRows.logic'
import { SignInBox } from './SignInBox'
import { useLatestRef } from '../../../hooks/useLatestRef'

export type StripFields = z.infer<typeof StripFieldsSchema>

/** Props for {@link StripRow}. */
export interface StripRowProps {
  readonly row: StripRowPayload
  /** `performance.now()` when the row appeared or changed; focus restored to the row re-arms the guard. */
  readonly since: number
  /** Send the answer; resolves with whether main took it, never rejects. */
  readonly onAnswer: (answer: StripAnswer, fields?: StripFields) => Promise<boolean>
  /** The row is about to go while it holds focus. */
  readonly onLeavingWithFocus: () => void
}

const ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

/**
 * Re-renders when the guard that started at `since` ends; returns whether it still runs.
 *
 * A timer can fire a fraction of a millisecond before `performance.now()` (coarsened)
 * says the guard is over, so the check repeats until it is – one early timer must
 * never leave the row blocked for good.
 */
function useGuard(since: number): boolean {
  const [now, setNow] = useState(() => performance.now())
  const guarded = isGuarded(since, now)
  useEffect(() => {
    const left = (at: number): number => Math.max(0, since + STRIP_INPUT_GUARD_MS - at)
    let timer: ReturnType<typeof setTimeout>
    const check = (): void => {
      const at = performance.now()
      setNow(at)
      if (isGuarded(since, at)) timer = setTimeout(check, left(at) + 1)
    }
    timer = setTimeout(check, left(performance.now()))
    return () => clearTimeout(timer)
  }, [since])
  return guarded
}

/**
 * Renders one strip row.
 *
 * @param props - {@link StripRowProps}
 * @returns The row
 */
export function StripRow({ row, since: shownSince, onAnswer, onLeavingWithFocus }: StripRowProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const firstSafeRef = useRef<HTMLButtonElement>(null)
  const pressStartRef = useRef(0)
  const [busy, setBusy] = useState(false)
  // Focus given to the row as a group (restoration after another row went, H-10) re-arms the guard.
  const [restoredAt, setRestoredAt] = useState(0)
  const since = Math.max(shownSince, restoredAt)
  const guarded = useGuard(since)
  const textId = `erf-sp-${useId().replace(/[^\w-]/g, '')}`
  const leaving = useLatestRef(onLeavingWithFocus)

  // A row that goes while it holds focus hands focus on (H-10); seen before it leaves the DOM.
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      // The newest callback is wanted here, at unmount – that is what the latest-ref is for.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (root !== null && document.activeElement !== null && root.contains(document.activeElement)) leaving.current()
    }
  }, [leaving])

  // Focus on arrival, only where main allows it; never on a granting button.
  useEffect(() => {
    if (!row.takesFocus || row.kind === 'signIn') return
    firstSafeRef.current?.focus()
    // Only on arrival of this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.requestId])

  const answer = (given: StripAnswer, fields?: StripFields): void => {
    // A press that began before the row appeared or changed never counts (OD-6).
    if (guarded || busy || pressStartRef.current < since) return
    if (row.kind !== 'signIn' || given !== 'signIn') {
      void onAnswer(given, fields)
      return
    }
    // "Signing in…" until main's answer: a refused or failed one gives the box back (an accepted one replaces the row).
    setBusy(true)
    void onAnswer(given, fields).then((accepted) => {
      if (!accepted) setBusy(false)
    })
  }
  const onPointerDown = (event: PointerEvent): void => {
    pressStartRef.current = event.timeStamp
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') pressStartRef.current = event.timeStamp
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
    const meant = escapeAnswer(row)
    if (meant === null) return
    event.preventDefault()
    event.stopPropagation()
    pressStartRef.current = event.timeStamp
    answer(meant)
  }

  const queue = queueCount(row.kind, row.waiting)
  const remembered = rememberedText(row)
  const iconDismiss = dismissIsIcon(row.kind) && row.answers.includes('dismiss')
  const buttons = row.answers.filter(a => !(iconDismiss && a === 'dismiss'))
  const firstSafe = buttons.find(a => !isGranting(a))
  const dialog = row.kind === 'pageDialog'

  return (
    <div
      ref={rootRef}
      className={`erf-site-prompt${dialog ? ' erf-site-prompt--dialog' : ''}${row.kind === 'signIn' ? ' erf-site-prompt--form' : ''}`}
      role={stripRowRole(row.kind)}
      aria-labelledby={textId}
      tabIndex={-1}
      data-strip-kind={row.kind}
      data-request-id={row.requestId}
      onFocus={event => {
        if (event.target === event.currentTarget) setRestoredAt(performance.now())
      }}
      onPointerDownCapture={onPointerDown}
      onKeyDownCapture={onKeyDown}
    >
      <div className="erf-site-prompt__body">
        {showsOriginLine(row) && row.requester !== undefined && (
          <span className="erf-site-prompt__line erf-site-prompt__origin">{originLine(row.requester.origin)}</span>
        )}
        {row.kind === 'hung' ? (
          <>
            <span id={textId} className="erf-site-prompt__title">
              {row.text}
            </span>
            <span className="erf-site-prompt__desc">{HUNG_EXPLANATION}</span>
          </>
        ) : dialog ? (
          <>
            <span id={textId} className="erf-site-prompt__title">
              {row.requester === undefined ? 'The page says' : `${originLine(row.requester.origin)} says`}
            </span>
            <span className="erf-site-prompt__label">Message from the page</span>
            <p className="erf-site-prompt__quote">{row.text}</p>
          </>
        ) : (
          <span id={textId} className={row.kind === 'leavePage' ? 'erf-site-prompt__title' : 'erf-site-prompt__request'}>
            {rowSentence(row)}
          </span>
        )}
        {remembered !== null && <span className="erf-site-prompt__desc">{remembered}</span>}
        {row.kind === 'signIn' && row.signIn !== undefined && (
          <SignInBox
            signIn={row.signIn}
            requestId={row.requestId}
            takesFocus={row.takesFocus}
            busy={busy}
            guarded={guarded}
            onSubmit={fields => answer('signIn', fields)}
            onCancel={() => answer('cancel')}
          />
        )}
      </div>
      {row.kind !== 'signIn' && buttons.length > 0 && (
        <div className="erf-site-prompt__actions">
          {buttons.map(given => (
            <button
              key={given}
              ref={given === firstSafe ? firstSafeRef : undefined}
              type="button"
              className="erf-site-prompt__button"
              aria-disabled={guarded ? true : undefined}
              onClick={() => answer(given)}
            >
              {/* An element, so the blocked look can dim it (Buttons card). */}
              <span>{answerLabel(row, given)}</span>
            </button>
          ))}
        </div>
      )}
      {queue !== null && (
        <span className="erf-site-prompt__queue" aria-label={queue.name}>
          {queue.text}
        </span>
      )}
      {iconDismiss && (
        <button
          type="button"
          className="erf-site-prompt__close"
          aria-label="Dismiss"
          aria-description={dismissDescription(row.kind)}
          title={dismissDescription(row.kind)}
          aria-disabled={guarded ? true : undefined}
          onClick={() => answer('dismiss')}
        >
          <X {...ICON} />
        </button>
      )}
    </div>
  )
}
