// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The instruction dialog of **Ask…**, **Change…** and **Prompt…** (spec 025,
 * 025-FR-031, 025-FR-050, 025-FR-053, 025-FR-061; design § Instruction dialog
 * and deck *Instruction dialog*; commit 19). It replaces the panel over the
 * still image, anchored to the same outline.
 *
 * - A field of several lines (Enter adds a line); **Send** or Ctrl/Cmd+Enter
 *   submits; an empty or blank instruction keeps the dialog with an inline
 *   error tied to the field.
 * - **← Actions** returns to the panel on the held capture; **Cancel** and
 *   Esc close without sending. While an input method composes, Esc and Enter
 *   are the composition's.
 * - "Sends to" carries the target button (OD-18); the banner slot shows a
 *   guard after a refused send, and "The page reloaded – …" when the page
 *   navigated while the dialog was open – Send then uses the held capture.
 * - The rows above are `inert` meanwhile (the panel does that), but the
 *   dialog traps nothing: the terminal and the rest of Erfana stay reachable,
 *   so it is `aria-modal="false"` – a dialog never claims a modality it does
 *   not enforce (design § Instruction dialog, M-46; Dialog/CLAUDE.md).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, CircleX } from 'lucide-react'
import { formatShortcut } from '../../../utils/shortcutLabel'
import type { SendAction } from './browserSend'
import { BannerSlot, CLOSE_WHILE_SENDING } from './PromptActionsPanel'
import type { TargetBanner } from './pickRow.logic'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** An action with a dialog. */
export type DialogAction = Exclude<SendAction, 'explain'>

/** Each dialog's words (deck *Instruction dialog*). */
export const DIALOG_COPY: Readonly<Record<DialogAction, { title: string; label: string; hint: string; empty: string }>> = Object.freeze({
  ask: {
    title: 'Ask about this element',
    label: 'Your question',
    hint: 'The agent answers in the terminal.',
    empty: 'Type your question before sending.'
  },
  change: {
    title: 'Change this element',
    label: 'What to change',
    hint: 'A fix, a style change or new text.',
    empty: 'Say what to change before sending.'
  },
  prompt: {
    title: 'Prompt about this element',
    label: 'Your prompt',
    hint: 'Sent as you write it, with the screenshot and page details.',
    empty: 'Type your prompt before sending.'
  }
})

/** Props for {@link InstructionDialog}. */
export interface InstructionDialogProps {
  readonly action: DialogAction
  /** The text typed so far (kept across dialog actions, M-25). */
  readonly text: string
  readonly onText: (text: string) => void
  readonly busy: boolean
  readonly banner: TargetBanner | null
  /** The page navigated while the dialog was open (025-FR-053). */
  readonly pageReloaded: boolean
  readonly frozen: boolean
  readonly onSend: () => void
  readonly onCancel: () => void
  readonly onBack: () => void
  readonly onBannerAction: (action: NonNullable<TargetBanner['action']>) => void
  readonly target: React.ReactNode
  readonly style?: React.CSSProperties
  readonly sheet: boolean
  readonly dialogRef?: React.RefObject<HTMLDivElement>
}

/**
 * The dialog.
 *
 * @param props - {@link InstructionDialogProps}
 * @returns The dialog
 */
export function InstructionDialog({
  action,
  text,
  onText,
  busy,
  banner,
  pageReloaded,
  frozen,
  onSend,
  onCancel,
  onBack,
  onBannerAction,
  target,
  style,
  sheet,
  dialogRef
}: InstructionDialogProps): JSX.Element {
  const copy = DIALOG_COPY[action]
  const uid = useId().replace(/[^\w-]/g, '')
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const bannerButtonRef = useRef<HTMLButtonElement>(null)
  const [emptyShown, setEmptyShown] = useState(false)
  const errorId = `erf-brw-dialog-error-${uid}`
  const hintId = `erf-brw-dialog-hint-${uid}`
  const titleId = `erf-brw-dialog-title-${uid}`
  const sendKey = formatShortcut('Enter', { mod: true })

  useEffect(() => {
    fieldRef.current?.focus()
  }, [action])

  useEffect(() => {
    if (banner !== null && banner.kind.startsWith('guard')) bannerButtonRef.current?.focus()
  }, [banner])

  const submit = (): void => {
    if (busy) return
    if (text.trim() === '') {
      setEmptyShown(true)
      fieldRef.current?.focus()
      return
    }
    onSend()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  const invalid = emptyShown && text.trim() === ''
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={`erf-brw-actions erf-brw-dialog erf-picker-owned${sheet ? ' erf-brw-actions--sheet' : ''}`}
      style={style}
      data-testid={BROWSER_TEST_IDS.INSTRUCTION_DIALOG}
      onKeyDown={onKeyDown}
    >
      <div className="erf-brw-dialog__header">
        <button type="button" className="erf-brw-dialog__back" aria-label="Back to actions" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          <span>Actions</span>
        </button>
        <h2 id={titleId} className="erf-brw-dialog__title">
          {copy.title}
        </h2>
        {frozen && <span className="erf-brw-tag">Page paused</span>}
      </div>
      {pageReloaded && (
        <p className="erf-brw-banner erf-brw-banner--info erf-brw-banner__text" role="status">
          <span className="erf-brw-hidden">Note: </span>
          The page reloaded – the capture shows the page as you picked it.
        </p>
      )}
      {banner !== null && <BannerSlot banner={banner} buttonRef={bannerButtonRef} onAction={onBannerAction} />}
      <label className="erf-brw-dialog__label" htmlFor={`erf-brw-dialog-field-${uid}`}>
        {copy.label}
      </label>
      <textarea
        ref={fieldRef}
        id={`erf-brw-dialog-field-${uid}`}
        className="erf-brw-dialog__field"
        rows={4}
        value={text}
        readOnly={busy}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${errorId} ${hintId}` : hintId}
        onChange={event => {
          onText(event.target.value)
          if (event.target.value.trim() !== '') setEmptyShown(false)
        }}
      />
      {invalid && (
        <p id={errorId} className="erf-brw-dialog__error" role="alert">
          <CircleX size={12} strokeWidth={2} aria-hidden="true" />
          <span>{copy.empty}</span>
        </p>
      )}
      <p id={hintId} className="erf-brw-dialog__hint">
        {copy.hint} {sendKey} to send · Enter adds a line
      </p>
      <div className="erf-brw-dialog__target">
        <span>Sends to</span>
        {target}
      </div>
      <div className="erf-brw-dialog__buttons">
        <button
          type="button"
          className="erf-brw-actions__action"
          aria-disabled={busy ? true : undefined}
          title={busy ? CLOSE_WHILE_SENDING : undefined}
          onClick={onCancel}
        >
          <span>Cancel</span>
        </button>
        <button
          type="button"
          className="erf-brw-actions__action erf-brw-actions__action--primary"
          aria-busy={busy ? true : undefined}
          onClick={submit}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
