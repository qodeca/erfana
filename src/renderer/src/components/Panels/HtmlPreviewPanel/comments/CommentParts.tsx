// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – small parts the comment window, the identity step
 * and the drawer share (docs/design-system/product/html-comments/window.html).
 *
 * SECURITY (threats S15, S18; SEC-19, SEC-25). Comment text, author names and
 * emails come from an HTML file anyone may have written. They are rendered as
 * React TEXT NODES only – never as HTML – and every invisible bidi or
 * zero-width control in them is drawn as a visible `⟨U+202E⟩` token inside
 * `<bdi>` / `unicode-bidi: isolate`, so a name cannot impersonate another and
 * a message cannot silently reorder itself.
 *
 * @module HtmlPreviewPanel/comments/CommentParts
 */
import { useId, type ReactNode } from 'react'
import { renderIcon } from '../../../../utils/iconRegistry'
import { splitVisibleControls, counterState, COMMENT_MAX_CHARS } from './commentFormat'
import { TEST_IDS } from '../../../../constants/testids'

/** Props for {@link VisibleText}. */
export interface VisibleTextProps {
  /** Untrusted text from a comment block. */
  readonly text: string
}

/**
 * Untrusted text with every invisible control drawn as a token (R-017).
 *
 * @param props - {@link VisibleTextProps}
 * @returns Text nodes and token spans – never HTML.
 *
 * @example
 * ```tsx
 * <p dir="auto"><VisibleText text={message.text} /></p>
 * ```
 */
export function VisibleText({ text }: VisibleTextProps): React.JSX.Element {
  const segments = splitVisibleControls(text)
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <span
            key={index}
            className="erf-comment-bidi"
            title={`Invisible control character ${segment.code}`}
            data-testid={TEST_IDS.COMMENT_CONTROL_TOKEN}
          >
            {`⟨${segment.code}⟩`}
          </span>
        )
      )}
    </>
  )
}

/** The look of a {@link CommentBanner}. */
export type BannerKind = 'warning' | 'error' | 'success' | 'info'

/** Props for {@link CommentBanner}. */
export interface CommentBannerProps {
  readonly kind: BannerKind
  /** Bold first line (the Feedback card's banner title). */
  readonly title?: string
  readonly children: ReactNode
  /** Small actions under the text. */
  readonly actions?: ReactNode
  /** Sits after the field rather than before it. */
  readonly after?: boolean
  readonly testId?: string
}

const BANNER_ICON: Record<BannerKind, ReactNode> = {
  warning: renderIcon('alert-triangle', { size: 16, 'aria-hidden': true }),
  error: renderIcon('circle-x', { size: 16, 'aria-hidden': true }),
  success: renderIcon('check', { size: 16, 'aria-hidden': true }),
  info: renderIcon('info', { size: 16, 'aria-hidden': true })
}

/**
 * A banner inside the window: icon + text, never colour alone.
 *
 * @param props - {@link CommentBannerProps}
 * @returns The banner.
 */
export function CommentBanner({
  kind,
  title,
  children,
  actions,
  after = false,
  testId
}: CommentBannerProps): React.JSX.Element {
  return (
    <div
      className={`erf-comment-banner erf-comment-banner--${kind}${after ? ' erf-comment-banner--after' : ''}`}
      data-testid={testId}
    >
      <span className="erf-comment-banner__icon">{BANNER_ICON[kind]}</span>
      <div className="erf-comment-banner__body">
        {title !== undefined && <p className="erf-comment-banner__title">{title}</p>}
        <p className="erf-comment-banner__text">{children}</p>
        {actions !== undefined && <div className="erf-comment-banner__actions">{actions}</div>}
      </div>
    </div>
  )
}

/** Props for {@link CommentField}. */
export interface CommentFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** Cmd/Ctrl+Enter in the field. */
  readonly onSubmit?: () => void
  readonly hint: string
  readonly error?: string | null
  readonly placeholder?: string
  /** Two lines to start instead of four (reply, edit). */
  readonly compact?: boolean
  /** "Draft restored" under the field. */
  readonly restored?: boolean
  readonly textareaRef?: React.Ref<HTMLTextAreaElement>
  readonly testId?: string
}

/**
 * The comment text field (§10.4; Form card textarea entry): label, hint,
 * always-visible counter that warns from 3,600, error under the field linked
 * by `aria-describedby`, Cmd/Ctrl+Enter to submit.
 *
 * @param props - {@link CommentFieldProps}
 * @returns The field.
 */
export function CommentField({
  label,
  value,
  onChange,
  onSubmit,
  hint,
  error = null,
  placeholder,
  compact = false,
  restored = false,
  textareaRef,
  testId
}: CommentFieldProps): React.JSX.Element {
  const id = useId()
  const count = [...value].length
  const state = counterState(count)
  const describedBy = [error ? `${id}-e` : null, `${id}-h`, `${id}-c`].filter(Boolean).join(' ')
  return (
    <div className="erf-comment-field">
      <label className="erf-comment-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        ref={textareaRef}
        id={id}
        className={`erf-comment-textarea${compact ? ' erf-comment-textarea--reply' : ''}`}
        value={value}
        placeholder={placeholder}
        dir="auto"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        data-testid={testId}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && onSubmit) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      {error && (
        <p className="erf-comment-error" id={`${id}-e`}>
          {renderIcon('circle-x', { size: 14, 'aria-hidden': true })}
          <span>{error}</span>
        </p>
      )}
      <div className="erf-comment-field__foot">
        <p className="erf-comment-field__hint" id={`${id}-h`}>
          {hint}
        </p>
        <span
          className={`erf-comment-counter${state === 'ok' ? '' : ` erf-comment-counter--${state}`}`}
          id={`${id}-c`}
        >
          {state === 'over' && renderIcon('circle-x', { size: 12, 'aria-hidden': true })}
          {state === 'near' && renderIcon('alert-triangle', { size: 12, 'aria-hidden': true })}
          {`${count} / ${COMMENT_MAX_CHARS}`}
        </span>
      </div>
      {restored && <p className="erf-comment-note">Draft restored</p>}
    </div>
  )
}

/** Props for {@link CommentInput}. */
export interface CommentInputProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onBlur?: () => void
  readonly hint: string
  readonly error?: string | null
  readonly type?: 'text' | 'email'
  readonly autoComplete: string
  readonly required?: boolean
  readonly disabled?: boolean
  readonly inputRef?: React.Ref<HTMLInputElement>
  readonly testId?: string
}

/**
 * A one-line field of the identity step (Form card): label, hint, error.
 *
 * @param props - {@link CommentInputProps}
 * @returns The field.
 */
export function CommentInput({
  label,
  value,
  onChange,
  onBlur,
  hint,
  error = null,
  type = 'text',
  autoComplete,
  required = false,
  disabled = false,
  inputRef,
  testId
}: CommentInputProps): React.JSX.Element {
  const id = useId()
  return (
    // The class, not `:has(:disabled)`, dims the label and hint with the
    // field (the Form card's disabled state).
    <div className={`erf-comment-field${disabled ? ' erf-comment-field--disabled' : ''}`}>
      <label className="erf-comment-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="erf-comment-input"
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-required={required ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={`${error ? `${id}-e ` : ''}${id}-h`}
        disabled={disabled}
        data-testid={testId}
        onChange={event => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error && (
        <p className="erf-comment-error" id={`${id}-e`}>
          {renderIcon('circle-x', { size: 14, 'aria-hidden': true })}
          <span>{error}</span>
        </p>
      )}
      <p className="erf-comment-note" id={`${id}-h`}>
        {hint}
      </p>
    </div>
  )
}

/** Props for {@link DialogButton}. */
export interface DialogButtonProps {
  readonly variant: 'primary' | 'secondary' | 'danger'
  readonly children: string
  readonly onClick: () => void
  /** `aria-disabled`, never `disabled`: focus stays, the press is ignored. */
  readonly busy?: boolean
  readonly title?: string
  readonly keyShortcut?: string
  readonly buttonRef?: React.Ref<HTMLButtonElement>
  readonly testId?: string
}

/**
 * A Dialog.css button (`.dialog-btn` variants – the Dialog framework's
 * mandatory buttons). Busy or blocked is `aria-disabled`: Chromium blurs a
 * control the moment it gets `disabled`, which would drop a keyboard reader's
 * focus on `<body>` mid-save.
 *
 * @param props - {@link DialogButtonProps}
 * @returns The button.
 */
export function DialogButton({
  variant,
  children,
  onClick,
  busy = false,
  title,
  keyShortcut,
  buttonRef,
  testId
}: DialogButtonProps): React.JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`dialog-btn dialog-btn-${variant}`}
      aria-disabled={busy ? 'true' : undefined}
      title={title}
      aria-keyshortcuts={keyShortcut}
      data-testid={testId}
      onClick={onClick}
    >
      <span>{children}</span>
    </button>
  )
}

/** Props for {@link ActionButton}. */
export interface ActionButtonProps {
  readonly children: string
  readonly onClick: () => void
  readonly ariaLabel?: string
  readonly testId?: string
  readonly buttonRef?: React.Ref<HTMLButtonElement>
}

/**
 * A small action inside a banner, a folded row or a drawer row.
 *
 * @param props - {@link ActionButtonProps}
 * @returns The button.
 */
export function ActionButton({
  children,
  onClick,
  ariaLabel,
  testId,
  buttonRef
}: ActionButtonProps): React.JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="erf-comment-action"
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
