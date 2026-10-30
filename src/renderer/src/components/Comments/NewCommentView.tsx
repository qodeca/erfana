// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the "New comment" view of the comment window
 * (docs/designs/comments/html-preview-comments.md §7.4, §7.8, §10.4; R-003, R-007,
 * R-022, R-024; docs/designs/comments/html-comments/window.html).
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
 * - **Still saving** (`COMMENT_SAVE_PENDING`): the info banner, the field
 *   read-only and no Save while a write for this element is outstanding
 *   (`commentPendingWrites`) – in this window or one closed earlier. Main says
 *   how it ended: landed, the panel announces it and closes the window; refused,
 *   the banner turns into the refusal and Save comes back, text kept. The
 *   editor's autosave stays held until then, not just until the answer.
 * - **Words** (spec 024 024-FR-004, C-07): when the preview sends the
 *   target's text, `CommentWordsPicker` shows the selected words and the
 *   Narrow to words field; the choice is derived from the range, and Save
 *   waits while only spaces are chosen or the words cannot be found again.
 *
 * @module HtmlPreviewPanel/comments/NewCommentView
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { AnchorSelection } from '../../../../shared/comments/anchorSel'
import { chooseWords, type WordsChoice } from '../../../../shared/comments/selectionWords'
import type { CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import { ErrorCode } from '../../../../shared/errors'
import { commentDrafts } from '../../stores/usePreviewCommentStore'
import { useLatestRef } from '../../hooks/useLatestRef'
import { useCommentDirtyGuard } from '../../hooks/useCommentDirtyGuard'
import {
  COPY,
  IDENTITY_COPY,
  fieldHint,
  saveFailureCopy,
  saveShortcutAria,
  saveShortcutLabel,
  tooLongText,
  unsavedConflictText,
  unsavedSourceText
} from './commentCopy'
import { counterState, countCharacters, visibleString } from './commentFormat'
import { validateCommentText, type IdentityFormData } from './commentSchemas'
import {
  CommentBanner,
  CommentField,
  DialogButton,
  VisibleText
} from './CommentParts'
import { IdentityEditor } from './IdentityStep'
import { useCommentAlert, useInnerStep } from './commentLive'
import { onCommentWriteSettled, trackCommentWrite, useCommentWritePending } from './commentPendingWrites'
import { draftKeyOf, type CommentWindowRequest } from './commentWindowTypes'
import { useCommentWords } from './commentWords'
import { CommentWordsPicker, type WordsSpan } from './CommentWordsPicker'
import { SELECTION_COPY } from './commentCopyWords'
import { carriedDrafts } from './commentCarriedDrafts'
import { WINDOW_COPY, saveBlockedReason, windowRefusal, type RefusalCopy } from './commentWindowCopy'
import { TEST_IDS } from '../../constants/testids'

/** Props for {@link NewCommentView}. */
export interface NewCommentViewProps {
  readonly request: Extract<CommentWindowRequest, { kind: 'new' }>
  readonly authorName: string
  readonly authorEmail: string
  /** Save the text; `sel` is the chosen words, absent for a comment on the whole target. */
  readonly onSave: (text: string, sel?: AnchorSelection) => Promise<CommentSaveResult>
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
  /**
   * "Comment on the whole {parent}" after a render-check refusal (C-19.3,
   * W-07): the text is carried, and the caller opens the window on the parent.
   */
  readonly onRetarget?: () => void
  /** The write landed but the window stays open to say so (words dropped): read the list again. */
  readonly onRefresh?: () => void
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
  textareaRef,
  onRetarget,
  onRefresh
}: NewCommentViewProps): React.JSX.Element {
  const key = draftKeyOf(request)
  // Every sentence naming the file shows its bidi and invisible characters as tokens (S-L-B).
  const file = visibleString(request.file.displayPath)
  // W-02: a window with no text of its own takes the panel's carried draft (C-14.1).
  const [carried] = useState(() => (commentDrafts.get(key) === '' ? carriedDrafts.peek(request.panelId) : null))
  const [text, setText] = useState(() => carried ?? commentDrafts.get(key))
  const [restored] = useState(() => commentDrafts.get(key) !== '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [failure, setFailure] = useState<RefusalCopy | null>(null)
  // 024-FR-004: main did not keep the words – saved on the whole target; the window says so before it closes.
  const [dropped, setDropped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changingIdentity, setChangingIdentity] = useState(false)
  const [refusedUnsaved, setRefusedUnsaved] = useState(false)
  const guard = useCommentDirtyGuard(request.file.filePath)
  const alert = useCommentAlert()
  const words = useCommentWords()
  const changeRef = useRef<HTMLButtonElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const quoteId = useId()
  const fieldId = useId()
  const [span, setSpan] = useState<WordsSpan>(() => ({ start: request.words?.start ?? 0, end: request.words?.end ?? 0 }))
  const [untouched, setUntouched] = useState(true)
  const choice: WordsChoice = request.words === undefined ? { kind: 'whole' } : chooseWords({ text: request.words.text, ...span })
  const focusChange = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )
  // The next new-comment window spends the slot (C-14.1): the carried text is this window's now,
  // kept under its own key – or, when it has text of its own, the slot is simply dropped.
  const { panelId } = request
  useEffect(() => {
    carriedDrafts.clear(panelId)
    if (carried !== null) commentDrafts.set(key, carried)
  }, [carried, panelId, key])
  // Saved on the whole target (words dropped): Close takes focus, the way out.
  useEffect(() => {
    if (dropped) doneRef.current?.focus()
  }, [dropped])

  // Main refused for unsaved changes: blocked until the guard sees the tab
  // saved (by the button, Cmd+S or autosave).
  const unsaved = guard.state !== 'clean' || (refusedUnsaved && !guard.justSaved)
  const count = countCharacters(text)
  const fieldBlocked =
    text.trim() === '' || counterState(count) === 'over' || choice.kind === 'blank' || choice.kind === 'tie'
  // A write for this element is still being written – this window's own, or
  // one sent from a window closed meanwhile (same session draft): no second.
  const pending = useCommentWritePending(request.panelId, key) && !saving
  // No second Save once the draft is spent.
  const closedOff = failure?.action === 'close' || failure?.action === 'pick-again'
  // W-08: the pick already knows this part is generated – refused before anything is typed.
  const generated = request.refused === 'generated-region' ? words.saveFailure(ErrorCode.COMMENT_TARGET_MOVED, file, request.target.tag, 'generated-region').text : null
  // C-21: what a blocked Save is waiting for, read with the button.
  const blockedReason = saveBlockedReason({
    generated,
    unsaved,
    file,
    text,
    over: counterState(count) === 'over',
    choice: choice.kind,
    noun: words.noun(request.target.tag)
  })
  const fieldShowsError = fieldError !== null || counterState(count) === 'over'
  const saveBlocked = saving || pending || unsaved || fieldBlocked || closedOff || generated !== null
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

  /** A refused save – answered, or settled after a pending answer: say why, keep the text. */
  const refused = (code: string, reason?: string): void => {
    const copy = windowRefusal(words, code, file, request.target.tag, reason, request.parentTag)
    if (copy.action === 'identity') {
      onIdentityRequired()
      return
    }
    if (copy.action === 'unsaved') {
      setRefusedUnsaved(true)
      alert(unsavedSourceText(file))
      return
    }
    setFailure(copy)
    alert(copy.text)
  }
  const refusedRef = useLatestRef(refused)

  // A pending write for this element settled. Landed: the panel announces it
  // and closes the window that sent it; an earlier window's text is spent.
  // Refused: the refusal replaces "Still saving…", and Save is back.
  const { draftToken } = request
  useEffect(
    () =>
      onCommentWriteSettled(settled => {
        if (settled.draftKey !== key || !mounted.current) return
        if (!settled.event.ok) refusedRef.current(settled.event.code ?? ErrorCode.COMMENT_WRITE_FAILED)
        else if (settled.request.op === 'add' && settled.request.draftToken !== draftToken) setText('')
      }),
    [key, draftToken, refusedRef]
  )

  const save = async (): Promise<void> => {
    if (saving || pending || closedOff || dropped) return
    if (generated !== null) {
      alert(generated)
      return
    }
    const result = validateCommentText(text)
    if (!result.ok) {
      setFieldError(result.error)
      textareaRef.current?.focus()
      return
    }
    if (unsaved) return
    // Words that cannot be stored: the notice above the field says why, and the window says it aloud.
    if (choice.kind === 'blank' || choice.kind === 'tie') {
      const noun = words.noun(request.target.tag)
      alert(choice.kind === 'blank' ? SELECTION_COPY.blank(noun) : SELECTION_COPY.tie(noun))
      return
    }
    setSaving(true)
    setFailure(null)
    // Autosave held for the write, so a keystroke-triggered save of the same
    // file cannot land between main's re-read and its rename (§7.8) – until
    // the write settles, which for a pending answer is after the answer.
    const write = trackCommentWrite(
      { panelId: request.panelId, op: 'add', draftToken, text: result.text },
      { file, draftKey: key, release: guard.holdForWrite() }
    )
    let answer: CommentSaveResult
    try {
      answer = await onSave(result.text, choice.kind === 'words' ? choice.sel : undefined)
    } catch {
      // The gateway never rejects; a caller that does still ends the write.
      answer = { ok: false, code: ErrorCode.UNKNOWN_ERROR }
    }
    write.answered(answer)
    // Spent even if the window closed meanwhile (L1).
    if (answer.ok) commentDrafts.clear(key)
    if (!mounted.current) return
    setSaving(false)
    if (answer.ok && answer.wordsDropped === true) {
      // Saved on the whole target: the window says so (024-FR-004), and closes on Close.
      setDropped(true)
      alert(SELECTION_COPY.wordsDropped(words.noun(request.target.tag), file))
      onRefresh?.()
    } else if (answer.ok) onSaved()
    else if (answer.code === ErrorCode.COMMENT_SAVE_PENDING) alert(saveFailureCopy(answer.code, file).text)
    else refused(answer.code, answer.reason)
  }

  const unsavedBanner = unsaved ? (
    <CommentBanner
      kind="warning"
      title={COPY.unsavedTitle}
      testId={TEST_IDS.COMMENT_UNSAVED_BANNER}
      actions={
        <>
          <DialogButton
            variant="secondary"
            testId={TEST_IDS.COMMENT_UNSAVED_GO_TO_TAB}
            onClick={() => {
              // Close first (the text is in the drafts): a modal left open
              // would sit over the editor and trap focus away from it.
              onLeave()
              guard.goToTab()
            }}
          >
            {COPY.goToTab}
          </DialogButton>
          {guard.state !== 'conflict' && (
            <DialogButton
              variant="secondary"
              onClick={() => void guard.save()}
              testId={TEST_IDS.COMMENT_UNSAVED_SAVE}
            >
              {`Save ${file}`}
            </DialogButton>
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
        {request.wordsMissing === true && (
          <CommentBanner kind="info" testId={TEST_IDS.COMMENT_WORDS_MISSING}>{SELECTION_COPY.wordsNotInFile(file)}</CommentBanner>
        )}
        {generated !== null && (
          <CommentBanner kind="error" testId={TEST_IDS.COMMENT_SAVE_ERROR}>
            {generated}
          </CommentBanner>
        )}
        {request.words !== undefined && (
          <CommentWordsPicker
            words={request.words}
            span={span}
            choice={choice}
            untouched={untouched}
            noun={words.noun(request.target.tag)}
            line={request.target.line}
            quoteId={quoteId}
            onSpan={next => {
              setSpan(next)
              setUntouched(false)
            }}
          />
        )}
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
          readOnly={pending}
          textareaRef={textareaRef}
          fieldId={fieldId}
          testId={TEST_IDS.COMMENT_NEW_FIELD}
        />
        {carried !== null && (
          <p className="erf-comment-note" data-testid={TEST_IDS.COMMENT_CARRIED}>
            {WINDOW_COPY.carried}
          </p>
        )}
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
        {dropped ? (
          <CommentBanner kind="success" after testId={TEST_IDS.COMMENT_WORDS_DROPPED}>
            {SELECTION_COPY.wordsDropped(words.noun(request.target.tag), file)}
          </CommentBanner>
        ) : pending ? (
          <CommentBanner kind="info" after testId={TEST_IDS.COMMENT_SAVE_ERROR}>
            {saveFailureCopy(ErrorCode.COMMENT_SAVE_PENDING, file).text}
          </CommentBanner>
        ) : (
          failure !== null && (
            <CommentBanner
              kind="error"
              after
              testId={TEST_IDS.COMMENT_SAVE_ERROR}
              actions={
                failure.retarget === true && request.parentTag !== undefined && onRetarget !== undefined ? (
                  <DialogButton
                    variant="secondary"
                    testId={TEST_IDS.COMMENT_RETARGET}
                    onClick={() => {
                      carriedDrafts.put(request.panelId, text)
                      onRetarget()
                    }}
                  >
                    {WINDOW_COPY.commentOnWhole(words.noun(request.parentTag))}
                  </DialogButton>
                ) : undefined
              }
            >
              {failure.text}
            </CommentBanner>
          )
        )}
      </div>
      <div className="erf-comment-window__foot">
        {dropped ? (
          <DialogButton variant="primary" buttonRef={doneRef} onClick={onSaved} testId={TEST_IDS.COMMENT_CLOSE}>
            {COPY.close}
          </DialogButton>
        ) : failure?.action === 'pick-again' && !pending ? (
          <>
            <DialogButton variant="secondary" onClick={onCancel} testId={TEST_IDS.COMMENT_CANCEL}>
              {COPY.cancel}
            </DialogButton>
            {/* C-14.1: Pick again is the way on – the text travels to the next window (W-01, W-02). */}
            <DialogButton
              variant="primary"
              testId={TEST_IDS.COMMENT_PICK_AGAIN}
              onClick={() => {
                carriedDrafts.put(request.panelId, text)
                onPickAgain()
              }}
            >
              {COPY.pickAgain}
            </DialogButton>
          </>
        ) : pending || failure?.action === 'close' ? (
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
                busy={saving || pending}
                blocked={saveBlocked ? (blockedReason ?? WINDOW_COPY.writeCommentFirst) : null}
                // The field's own error already says it: that line describes Save, not a second copy.
                blockedBy={saveBlocked && fieldShowsError ? `${fieldId}-e` : null}
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
