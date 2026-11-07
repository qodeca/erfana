// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The sign-in box inside a `signIn` strip row (spec 025, 025-FR-022,
 * 025-FR-018; deck *Sign-in box*; Site prompts card `--form`, Form card,
 * decided): Username, Password, **Remember for this project**, the http
 * warning and the rejection line, then Cancel and Sign in.
 *
 * - The password a saved sign-in holds never reaches the renderer: with
 *   `savedPassword` an empty Password field signs in with it (no `password`
 *   field is sent).
 * - Focus goes to the first empty field only when main says the box takes it
 *   (a navigation the user started); otherwise it waits in the strip.
 * - Remember is disabled with its reason without a keyring.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { SignInRow } from '../../../../../shared/ipc/browser-tab-site-schema'
import { signInRejectedText } from './stripRows.logic'

/** What the box sends with **Sign in**. */
export interface SignInFields {
  readonly username: string
  readonly password?: string
  readonly remember: boolean
}

/** Props for {@link SignInBox}. */
export interface SignInBoxProps {
  readonly signIn: SignInRow
  readonly requestId: string
  readonly takesFocus: boolean
  readonly busy: boolean
  readonly guarded: boolean
  readonly onSubmit: (fields: SignInFields) => void
  readonly onCancel: () => void
}

/**
 * The sign-in fields and actions.
 *
 * @param props - {@link SignInBoxProps}
 * @returns The form
 */
export function SignInBox(props: SignInBoxProps): JSX.Element {
  const { signIn, requestId, takesFocus, busy, guarded } = props
  const [username, setUsername] = useState(signIn.username)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const base = `erf-signin-${useId().replace(/[^\w-]/g, '')}`
  const userRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const noKeyring = signIn.remember === 'noKeyring'
  const rejected = signInRejectedText(signIn.rejected)
  // A refused sign-in is a field error (Form card, decided): both fields point at the line;
  // the strip's announcer says it when the row arrives, so the line is no live region.
  const fieldError = rejected === null ? {} : { 'aria-invalid': true, 'aria-describedby': `${base}-rejected` }

  useEffect(() => {
    if (!takesFocus) return
    ;(username === '' ? userRef : passwordRef).current?.focus()
    // On arrival of this request only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, takesFocus])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const keepSaved = signIn.savedPassword && password === ''
    props.onSubmit({ username, ...(keepSaved ? {} : { password }), remember: noKeyring ? false : remember })
  }

  return (
    <form className="erf-site-prompt__signin" onSubmit={submit} aria-busy={busy || undefined}>
      {signIn.insecure && (
        <p className="erf-site-prompt__banner erf-site-prompt__banner--warning">
          <span className="erf-brw-hidden">Warning: </span>
          This connection isn&apos;t encrypted – others on the network could read your password.
        </p>
      )}
      {rejected !== null && (
        <p id={`${base}-rejected`} className="erf-site-prompt__banner erf-site-prompt__banner--error">
          <span className="erf-brw-hidden">Error: </span>
          {rejected}
        </p>
      )}
      <div className="erf-site-prompt__fields">
        <label className="erf-site-prompt__field" htmlFor={`${base}-user`}>
          <span>Username</span>
          <input
            ref={userRef}
            id={`${base}-user`}
            className="erf-site-prompt__input"
            autoComplete="off"
            spellCheck={false}
            {...fieldError}
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
        </label>
        <label className="erf-site-prompt__field" htmlFor={`${base}-password`}>
          <span>Password</span>
          <input
            ref={passwordRef}
            id={`${base}-password`}
            type="password"
            className="erf-site-prompt__input"
            {...fieldError}
            autoComplete="off"
            placeholder={signIn.savedPassword ? 'Saved password' : undefined}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
      </div>
      <label className="erf-site-prompt__check">
        <input
          type="checkbox"
          checked={!noKeyring && remember}
          disabled={noKeyring}
          // Named by the label text alone; the wrapped description stays its description, not part of its name.
          aria-labelledby={`${base}-remember-label`}
          aria-describedby={`${base}-remember`}
          onChange={e => setRemember(e.target.checked)}
        />
        <span id={`${base}-remember-label`}>Remember for this project</span>
        <span id={`${base}-remember`} className="erf-site-prompt__desc">
          {noKeyring ? 'No keyring – cannot store passwords safely' : "Saved encrypted in this project's browser data"}
        </span>
      </label>
      <div className="erf-site-prompt__actions">
        <button
          type="button"
          className="erf-site-prompt__button"
          aria-disabled={guarded ? true : undefined}
          onClick={props.onCancel}
        >
          <span>Cancel</span>
        </button>
        <button type="submit" className="erf-site-prompt__button" aria-disabled={guarded || busy ? true : undefined}>
          <span>{busy ? 'Signing in…' : 'Sign in'}</span>
        </button>
      </div>
    </form>
  )
}
