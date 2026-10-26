// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the "New comment" view of the comment window
 * (docs/designs/html-preview-comments.md §7.4, §7.8, §10.4; R-003, R-007,
 * R-022, R-024; docs/design-system/product/html-comments/window.html).
 *
 * - **Every error keeps the text.** A save is a re-read, a splice and a
 *   verified atomic write, so it can fail for reasons the reviewer did not
 *   cause; the field stays as it was and a banner says what happened.
 * - **Field problems sit under the field** (empty, too long); Save is
 *   `aria-disabled` and says why when pressed.
 * - **Draft restored.** The text is kept in memory per element for the
 *   session, so Esc, an outside click or "Pick again" never loses it.
 * - **Unsaved source** (decision 13): the warning banner with Go to tab and
 *   Save {file} – Go to tab only in the changed-on-disk variant, which is
 *   worded for it – blocks Save, and turns into "Saved. You can add your
 *   comment now." on its own when OUR Save wrote the tab (a neutral line when
 *   the tab became clean some other way, e.g. its changes were discarded).
 *   Go to tab closes the window first (the text stays in the drafts) so the
 *   modal is not left over the editor.
 * - Every refusal, and the unsaved banner clearing, is also spoken from the
 *   window's assertive region (`useCommentAlert`).
 * - Busy is `aria-disabled` "Saving…": focus stays where the user pressed.
 *
 * @module HtmlPreviewPanel/comments/NewCommentView
 */
import { useEffect, useRef, useState } from 'react'
import type { CommentSaveResult } from '../../../../../../shared/ipc/preview-comment-schema'
import { ErrorCode } from '../../../../../../shared/errors'
import { commentDrafts } from '../../../../stores/usePreviewCommentStore'
import { useCommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'
import {
  COPY,
  IDENTITY_COPY,
  fieldHint,
  saveFailureCopy,
  saveShortcutAria,
  saveShortcutLabel,
  tooLongText,
  unsavedConflictText,
  unsavedSourceText,
  type SaveFailureCopy
} from './commentCopy'
import { counterState, countCharacters } from './commentFormat'
import { validateCommentText, type IdentityFormData } from './commentSchemas'
import {
  ActionButton,
  CommentBanner,
  CommentField,
  DialogButton,
  VisibleText
} from './CommentParts'
import { IdentityEditor } from './IdentityStep'
import { useCommentAlert, useInnerStep } from './commentLive'
import { draftKeyOf, type CommentWindowRequest } from './commentWindowTypes'
import { TEST_IDS } from '../../../../constants/testids'

/** Props for {@link NewCommentView}. */
export interface NewCommentViewProps {
  readonly request: Extract<CommentWindowRequest, { kind: 'new' }>
  readonly authorName: string
  readonly authorEmail: string
  readonly onSave: (text: string) => Promise<CommentSaveResult>
  readonly onSaveIdentity: (identity: IdentityFormData) => Promise<boolean>
  /** Main asked for a name after all: back to the identity step. */
  readonly onIdentityRequired: () => void
  /** Saved: the window closes. */
  readonly onSaved: () => void
  readonly onCancel: () => void
  /** Close WITHOUT returning focus: "Go to tab" focuses the editor instead. */
  readonly onLeave: () => void
  /** "Pick again": close, keep the text, comment mode on. */
  readonly onPickAgain: () => void
  readonly textareaRef: React.RefObject<HTMLTextAreaElement>
}

/**
 * The body and foot of a new comment.
 *
 * @param props - {@link NewCommentViewProps}
 * @returns The field, the identity line, banners and the actions.
 */
export function NewCommentView({
  request,
  authorName,
  authorEmail,
  onSave,
  onSaveIdentity,
  onIdentityRequired,
  onSaved,
  onCancel,
  onLeave,
  onPickAgain,
  textareaRef
}: NewCommentViewProps): React.JSX.Element {
  const key = draftKeyOf(request)
  const file = request.file.displayPath
  const [text, setText] = useState(() => commentDrafts.get(key))
  const [restored] = useState(() => commentDrafts.get(key) !== '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [failure, setFailure] = useState<SaveFailureCopy | null>(null)
  const [saving, setSaving] = useState(false)
  const [changingIdentity, setChangingIdentity] = useState(false)
  const [refusedUnsaved, setRefusedUnsaved] = useState(false)
  const guard = useCommentDirtyGuard(request.file.filePath)
  const alert = useCommentAlert()
  const changeRef = useRef<HTMLButtonElement>(null)
  const focusChange = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )

  // Main refused for unsaved changes: blocked until the guard sees the tab
  // saved (by the button, Cmd+S or autosave).
  const unsaved = guard.state !== 'clean' || (refusedUnsaved && !guard.justSaved)
  const count = countCharacters(text)
  const fieldBlocked = text.trim() === '' || counterState(count) === 'over'
  // No second Save once the draft is spent – or still being written (pending).
  const closedOff =
    failure?.action === 'close' || failure?.action === 'pick-again' || failure?.action === 'pending'
  const saveBlocked = saving || unsaved || fieldBlocked || closedOff
  const clearedText =
    guard.cleared === 'saved' ? COPY.unsavedCleared : guard.cleared === 'clean' ? COPY.unsavedGone : null

  // The banner turning into its success line is news a screen reader is told.
  useEffect(() => {
    if (clearedText !== null && !unsaved) alert(clearedText)
  }, [clearedText, unsaved, alert])

  // Esc backs out of the identity editor before it closes the window.
  const cancelIdentity = (): void => {
    focusChange.current = true
    setChangingIdentity(false)
  }
  useInnerStep(changingIdentity, cancelIdentity)
  useEffect(() => {
    if (!changingIdentity && focusChange.current) {
      focusChange.current = false
      changeRef.current?.focus()
    }
  }, [changingIdentity])

  const save = async (): Promise<void> => {
    if (saving || closedOff) return
    const result = validateCommentText(text)
    if (!result.ok) {
      setFieldError(result.error)
      textareaRef.current?.focus()
      return
    }
    if (unsaved) return
    setSaving(true)
    setFailure(null)
    // Autosave held for the write, so a keystroke-triggered save of the same
    // file cannot land between main's re-read and its rename (§7.8).
    const release = guard.holdForWrite()
    let answer: CommentSaveResult
    try {
      answer = await onSave(result.text)
    } finally {
      release()
    }
    if (!mounted.current) return
    setSaving(false)
    if (answer.ok) {
      commentDrafts.clear(key)
      onSaved()
      return
    }
    const copy = saveFailureCopy(answer.code, file)
    if (copy.action === 'identity') {
      onIdentityRequired()
      return
    }
    if (copy.action === 'unsaved' || answer.code === ErrorCode.COMMENT_UNSAVED_SOURCE) {
      setRefusedUnsaved(true)
      alert(unsavedSourceText(file))
      return
    }
    setFailure(copy)
    alert(copy.text)
  }

  const unsavedBanner = unsaved ? (
    <CommentBanner
      kind="warning"
      title={COPY.unsavedTitle}
      testId={TEST_IDS.COMMENT_UNSAVED_BANNER}
      actions={
        <>
          <ActionButton
            testId={TEST_IDS.COMMENT_UNSAVED_GO_TO_TAB}
            onClick={() => {
              // Close first (the text is in the drafts): a modal left open
              // would sit over the editor and trap focus away from it.
              onLeave()
              guard.goToTab()
            }}
          >
            {COPY.goToTab}
          </ActionButton>
          {guard.state !== 'conflict' && (
            <ActionButton onClick={() => void guard.save()} testId={TEST_IDS.COMMENT_UNSAVED_SAVE}>
              {`Save ${file}`}
            </ActionButton>
          )}
        </>
      }
    >
      {guard.state === 'conflict' ? unsavedConflictText(file) : unsavedSourceText(file)}
    </CommentBanner>
  ) : clearedText !== null ? (
    <CommentBanner kind="success" testId={TEST_IDS.COMMENT_UNSAVED_CLEARED}>
      {clearedText}
    </CommentBanner>
  ) : null

  return (
    <>
      <div className="erf-comment-window__body">
        {unsavedBanner}
        <CommentField
          label={COPY.fieldLabel}
          value={text}
          onChange={value => {
            setText(value)
            commentDrafts.set(key, value)
            setFieldError(null)
          }}
          onSubmit={() => void save()}
          hint={fieldHint(file)}
          error={fieldError ?? (counterState(count) === 'over' ? tooLongText(count) : null)}
          placeholder={COPY.placeholder}
          restored={restored}
          textareaRef={textareaRef}
          testId={TEST_IDS.COMMENT_NEW_FIELD}
        />
        {changingIdentity ? (
          <IdentityEditor
            initialName={authorName}
            initialEmail={authorEmail}
            onCancel={cancelIdentity}
            onSubmit={async identity => {
              const ok = await onSaveIdentity(identity)
              if (ok) {
                setChangingIdentity(false)
                textareaRef.current?.focus()
              }
              return ok
            }}
          />
        ) : (
          <p className="erf-comment-identity" data-testid={TEST_IDS.COMMENT_IDENTITY_LINE}>
            {`${IDENTITY_COPY.commentingAs} `}
            <bdi>
              <VisibleText text={authorName} />
            </bdi>{' '}
            <button
              ref={changeRef}
              type="button"
              className="erf-comment-link"
              data-testid={TEST_IDS.COMMENT_IDENTITY_CHANGE}
              onClick={() => setChangingIdentity(true)}
            >
              {COPY.change}
            </button>
          </p>
        )}
        {failure !== null && (
          <CommentBanner
            kind={failure.action === 'pending' ? 'info' : 'error'}
            after
            testId={TEST_IDS.COMMENT_SAVE_ERROR}
            actions={
              failure.action === 'pick-again' ? (
                <ActionButton onClick={onPickAgain}>{COPY.pickAgain}</ActionButton>
              ) : undefined
            }
          >
            {failure.text}
          </CommentBanner>
        )}
      </div>
      <div className="erf-comment-window__foot">
        {closedOff && (failure?.action === 'close' || failure?.action === 'pending') ? (
          <DialogButton variant="secondary" onClick={onCancel} testId={TEST_IDS.COMMENT_CLOSE}>
            {COPY.close}
          </DialogButton>
        ) : (
          <>
            <DialogButton variant="secondary" onClick={onCancel} testId={TEST_IDS.COMMENT_CANCEL}>
              {COPY.cancel}
            </DialogButton>
            {!closedOff && (
              <DialogButton
                variant="primary"
                busy={saveBlocked}
                title={`${COPY.save} (${saveShortcutLabel()})`}
                keyShortcut={saveShortcutAria()}
                onClick={() => void save()}
                testId={TEST_IDS.COMMENT_SAVE}
              >
                {saving ? COPY.saving : COPY.save}
              </DialogButton>
            )}
          </>
        )}
      </div>
    </>
  )
}
