// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – who is commenting
 * (docs/designs/html-preview-comments.md decision 3, §7.9, §10.7; R-008,
 * R-019; docs/design-system/product/html-comments/identity.html).
 *
 * Two shapes of one form:
 *
 * - {@link IdentityStep} – step 1 INSIDE the comment window on the first
 *   comment (not a second dialog: nothing typed is lost and there is one focus
 *   trap). It carries the privacy notice, word for word from §10.7, and is
 *   shown once to everyone – also when the name was already set in Settings,
 *   then pre-filled, because the notice is the point.
 * - {@link IdentityEditor} – the inline "Change" form under "Commenting as …".
 *
 * Name required, email optional; both validated by `IdentityFormSchema`
 * (bidi and control characters refused, SEC-18).
 *
 * @module HtmlPreviewPanel/comments/IdentityStep
 */
import { useEffect, useRef, useState } from 'react'
import { IDENTITY_COPY, COPY } from './commentCopy'
import { validateIdentity, type IdentityFormData, type IdentityFormErrors } from './commentSchemas'
import { CommentInput, DialogButton } from './CommentParts'
import { TEST_IDS } from '../../../../constants/testids'

/** Props shared by both identity forms. */
interface IdentityFormProps {
  /** The values already in Settings, to pre-fill. */
  readonly initialName: string
  readonly initialEmail: string
  /** Store the identity; resolves `false` when the settings write failed. */
  readonly onSubmit: (identity: IdentityFormData) => Promise<boolean>
  readonly onCancel: () => void
}

/** The form state both shapes share. */
function useIdentityForm({ initialName, initialEmail, onSubmit }: IdentityFormProps) {
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [errors, setErrors] = useState<IdentityFormErrors>({})
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  const submit = async (): Promise<void> => {
    if (busy) return
    const result = validateIdentity({ name, email })
    if (!result.ok) {
      setErrors(result.errors)
      // Focus the first field that is wrong, so its error is read with it.
      ;(result.errors.name ? nameRef : emailRef).current?.focus()
      return
    }
    setErrors({})
    setBusy(true)
    const ok = await onSubmit(result.data)
    setBusy(false)
    setFailed(!ok)
  }

  return { name, setName, email, setEmail, errors, busy, failed, submit, nameRef, emailRef }
}

/** Props for {@link IdentityStep}. */
export interface IdentityStepProps extends IdentityFormProps {
  /** Ids the window's `aria-describedby` points at (the notice). */
  readonly noticeId: string
}

/**
 * The identity step's BODY and FOOT (the window draws the head).
 *
 * @param props - {@link IdentityStepProps}
 * @returns The notice, the two fields and Cancel / Continue.
 *
 * @example
 * ```tsx
 * <IdentityStep initialName="" initialEmail="" noticeId={id}
 *   onSubmit={saveIdentity} onCancel={close} />
 * ```
 */
export function IdentityStep(props: IdentityStepProps): React.JSX.Element {
  const form = useIdentityForm(props)
  // The name field takes focus when it is empty (§10.7 card: "focus in Name").
  useEffect(() => {
    const timer = setTimeout(() => form.nameRef.current?.focus(), 20)
    return () => clearTimeout(timer)
    // Once, on open.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="erf-comment-window__body">
        <p className="erf-comment-notice" id={props.noticeId}>
          {IDENTITY_COPY.notice}
        </p>
        <CommentInput
          label={IDENTITY_COPY.nameLabel}
          value={form.name}
          onChange={form.setName}
          hint={IDENTITY_COPY.nameHint}
          error={form.errors.name}
          autoComplete="name"
          required
          inputRef={form.nameRef}
          testId={TEST_IDS.COMMENT_IDENTITY_NAME}
        />
        <CommentInput
          label={IDENTITY_COPY.emailLabel}
          value={form.email}
          onChange={form.setEmail}
          hint={IDENTITY_COPY.emailHint}
          error={form.errors.email}
          type="email"
          autoComplete="email"
          inputRef={form.emailRef}
          testId={TEST_IDS.COMMENT_IDENTITY_EMAIL}
        />
        {/* Always mounted, empty until there is news (Feedback card,
            "telling a screen reader"): a role="alert" box that appears with
            its text is announced unreliably. */}
        <p className="erf-comment-error" aria-live="assertive" data-testid={TEST_IDS.COMMENT_IDENTITY_ERROR}>
          {form.failed && <span>Couldn&apos;t save your name. Try again.</span>}
        </p>
      </div>
      <div className="erf-comment-window__foot">
        <DialogButton variant="secondary" onClick={props.onCancel} testId={TEST_IDS.COMMENT_IDENTITY_CANCEL}>
          {COPY.cancel}
        </DialogButton>
        <DialogButton
          variant="primary"
          busy={form.busy}
          onClick={() => void form.submit()}
          testId={TEST_IDS.COMMENT_IDENTITY_CONTINUE}
        >
          {IDENTITY_COPY.continue}
        </DialogButton>
      </div>
    </>
  )
}

/**
 * The inline "Change" form under "Commenting as …" – the same fields, no
 * notice (it was seen), Cancel / Save changes.
 *
 * @param props - {@link IdentityFormProps}
 * @returns The inline form.
 */
export function IdentityEditor(props: IdentityFormProps): React.JSX.Element {
  const form = useIdentityForm(props)
  useEffect(() => {
    form.nameRef.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="erf-comment-identity-edit" role="group" aria-label="Change who is commenting">
      <CommentInput
        label={IDENTITY_COPY.nameLabel}
        value={form.name}
        onChange={form.setName}
        hint={IDENTITY_COPY.nameHint}
        error={form.errors.name}
        autoComplete="name"
        required
        inputRef={form.nameRef}
        testId={TEST_IDS.COMMENT_IDENTITY_EDIT_NAME}
      />
      <CommentInput
        label={IDENTITY_COPY.emailLabel}
        value={form.email}
        onChange={form.setEmail}
        hint={IDENTITY_COPY.emailHint}
        error={form.errors.email}
        type="email"
        autoComplete="email"
        inputRef={form.emailRef}
        testId={TEST_IDS.COMMENT_IDENTITY_EDIT_EMAIL}
      />
      <div className="erf-comment-thread__actions">
        <DialogButton variant="secondary" onClick={props.onCancel}>
          {COPY.cancel}
        </DialogButton>
        <DialogButton variant="primary" busy={form.busy} onClick={() => void form.submit()}>
          {COPY.saveChanges}
        </DialogButton>
      </div>
    </div>
  )
}
