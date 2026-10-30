// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CommentsSection – Settings › Comments, for both previews' comments
 * (spec 024 024-FR-022, comments-v2 C-04; HTML Preview:
 * docs/designs/comments/html-preview-comments.md decision 3, §3 "Feature flag",
 * §7.9, §10.7, §10.10 "Settings"; R-014;
 * docs/designs/comments/html-comments/identity.html "Settings › Comments").
 *
 * - **Comments in HTML preview** – the feature flag
 *   (`htmlPreview.comments.enabled`, default on). Off restores today's
 *   preview exactly.
 * - **Comments in Markdown preview** – `markdownPreview.comments.enabled`,
 *   default on (spec 024). The name and email are shared by both previews,
 *   so they take input while EITHER switch is on, and keep their values
 *   but take none when both are off.
 * - **Your name** / **Your email (optional)** – app-level only (a cloned
 *   repository cannot preset who you are, S20), saved on blur, affecting new
 *   comments only. Validated by the comment window's own schema: a bidi or
 *   control character is refused here before main would refuse it (SEC-18),
 *   and a value over the settings schema's cap is refused because it would be
 *   stored and read back as unset.
 * - A refused value, or a settings write that failed, is shown under its
 *   field AND spoken from an always-mounted assertive region: the save runs
 *   on blur, when focus has already moved on and the error is not read with
 *   the field (L12).
 * - The visibility notice: someone who sets their name here first is told
 *   too. The one-time `identityNoticeSeen` is left alone – the comment
 *   window's identity step still shows it once, pre-filled (R-019).
 *
 * Descriptions are --color-text-tertiary, not the shipping
 * --color-text-secondary, which measures under 4.5:1 on this surface.
 *
 * @returns The section.
 *
 * @example
 * ```tsx
 * <CommentsSection />
 * ```
 */
import { useId, useState } from 'react'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { isAnyPreviewCommentsEnabled } from '../../../../../shared/ipc/global-settings-schema'
import { SETTINGS_COPY } from '../../Comments/commentCopy'
import {
  AuthorEmailSchema,
  AuthorNameSchema
} from '../../Comments/commentSchemas'
import { CommentBanner, CommentInput } from '../../Comments/CommentParts'
import { useLiveText } from '../../Comments/commentLive'
import '../../Comments/CommentWindow.css'
import './CommentsSection.css'
import { TEST_IDS } from '../../../constants/testids'

/** The first issue's message, or `null` when the value parses. */
function issueOf(
  schema: typeof AuthorNameSchema | typeof AuthorEmailSchema,
  value: string
): string | null {
  const result = schema.safeParse(value)
  return result.success ? null : (result.error.issues[0]?.message ?? null)
}

export function CommentsSection(): React.JSX.Element {
  const settings = useGlobalSettingsStore(s => s.settings)
  const updateCommentIdentity = useGlobalSettingsStore(s => s.updateCommentIdentity)
  const updateEnabled = useGlobalSettingsStore(s => s.updateHtmlPreviewCommentsEnabled)
  const updateMarkdownEnabled = useGlobalSettingsStore(s => s.updateMarkdownPreviewCommentsEnabled)
  const titleId = useId()
  const flagId = useId()
  const markdownFlagId = useId()
  const identity = settings?.comments
  // Not `isHtmlPreviewCommentsEnabled`: a partial settings object (an older
  // file, a test fixture) may lack `htmlPreview` and must read as on.
  const enabled = settings !== null && settings.htmlPreview?.comments?.enabled !== false
  const markdownEnabled = settings !== null && settings.markdownPreview?.comments?.enabled !== false
  // The identity is shared: usable while either preview's comments are on (024-FR-022).
  const identityUsable = settings !== null && isAnyPreviewCommentsEnabled(settings)
  const [name, setName] = useState(identity?.authorName ?? '')
  const [email, setEmail] = useState(identity?.authorEmail ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [alertText, alert] = useLiveText()

  // Follow a change made elsewhere (the comment window's identity step),
  // adjusted while rendering rather than in an effect.
  const [shown, setShown] = useState({ name: identity?.authorName, email: identity?.authorEmail })
  if (shown.name !== identity?.authorName || shown.email !== identity?.authorEmail) {
    setShown({ name: identity?.authorName, email: identity?.authorEmail })
    setName(identity?.authorName ?? '')
    setEmail(identity?.authorEmail ?? '')
  }

  const save = (
    next: { authorName?: string; authorEmail?: string },
    setError: (error: string | null) => void
  ): void => {
    if (!identity) return
    void updateCommentIdentity({ ...identity, ...next }).then(ok => {
      if (ok) return
      setError(SETTINGS_COPY.saveFailed)
      alert(SETTINGS_COPY.saveFailed)
    })
  }

  const saveName = (): void => {
    const trimmed = name.trim()
    if (trimmed === (identity?.authorName ?? '')) return
    // An empty name is allowed here: it means "ask me again" (the note says so).
    if (trimmed === '') {
      setNameError(null)
      save({ authorName: undefined }, setNameError)
      return
    }
    const error = issueOf(AuthorNameSchema, trimmed)
    setNameError(error)
    if (error === null) save({ authorName: trimmed }, setNameError)
    else alert(error)
  }

  const saveEmail = (): void => {
    const trimmed = email.trim()
    if (trimmed === (identity?.authorEmail ?? '')) return
    const error = issueOf(AuthorEmailSchema, trimmed)
    setEmailError(error)
    if (error === null) save({ authorEmail: trimmed === '' ? undefined : trimmed }, setEmailError)
    else alert(error)
  }

  return (
    <section
      className="settings-section erf-comment-settings"
      aria-labelledby={titleId}
      data-testid={TEST_IDS.COMMENT_SETTINGS_SECTION}
    >
      <h2 className="settings-section-title" id={titleId}>
        {SETTINGS_COPY.title}
      </h2>
      <div className="settings-row">
        <div className="settings-field">
          <label htmlFor={flagId} className="settings-label">
            {SETTINGS_COPY.flagLabel}
          </label>
          <p id={`${flagId}-d`} className="erf-comment-settings__desc">
            {SETTINGS_COPY.flagHint}
          </p>
        </div>
        <input
          type="checkbox"
          id={flagId}
          className="settings-checkbox"
          checked={enabled}
          disabled={!settings}
          aria-describedby={`${flagId}-d`}
          data-testid={TEST_IDS.COMMENT_SETTINGS_TOGGLE}
          onChange={event => void updateEnabled(event.target.checked)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-field">
          <label htmlFor={markdownFlagId} className="settings-label">
            {SETTINGS_COPY.markdownFlagLabel}
          </label>
          <p id={`${markdownFlagId}-d`} className="erf-comment-settings__desc">
            {SETTINGS_COPY.markdownFlagHint}
          </p>
        </div>
        <input
          type="checkbox"
          id={markdownFlagId}
          className="settings-checkbox"
          checked={markdownEnabled}
          disabled={!settings}
          aria-describedby={`${markdownFlagId}-d`}
          data-testid={TEST_IDS.COMMENT_SETTINGS_MD_TOGGLE}
          onChange={event => void updateMarkdownEnabled(event.target.checked)}
        />
      </div>
      <div className="erf-comment-settings__fields">
        <CommentInput
          label={SETTINGS_COPY.nameLabel}
          value={name}
          onChange={value => {
            setName(value)
            setNameError(null)
          }}
          onBlur={saveName}
          hint={SETTINGS_COPY.nameHint}
          error={nameError}
          autoComplete="name"
          disabled={!identityUsable}
          testId={TEST_IDS.COMMENT_SETTINGS_NAME}
        />
        {name.trim() === '' && <p className="erf-comment-note">{SETTINGS_COPY.nameEmpty}</p>}
        <CommentInput
          label={SETTINGS_COPY.emailLabel}
          value={email}
          onChange={value => {
            setEmail(value)
            setEmailError(null)
          }}
          onBlur={saveEmail}
          hint={SETTINGS_COPY.emailHint}
          error={emailError}
          type="email"
          autoComplete="email"
          disabled={!identityUsable}
          testId={TEST_IDS.COMMENT_SETTINGS_EMAIL}
        />
      </div>
      <CommentBanner kind="info" after testId={TEST_IDS.COMMENT_SETTINGS_NOTICE}>
        {SETTINGS_COPY.notice}
      </CommentBanner>
      <p className="erf-comment-sr" aria-live="assertive" data-testid={TEST_IDS.COMMENT_SETTINGS_ALERT}>
        {alertText}
      </p>
    </section>
  )
}
