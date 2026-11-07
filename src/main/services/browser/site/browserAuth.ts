// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTTP sign-in of one browser tab (spec 025, 025-FR-022; solution design
 * § 3.5 `browserAuth`, spec change S-16; design `site-prompts.html`).
 *
 * Every `login` event of the tab's page comes here.
 *
 * - **Not ours.** A proxy challenge, and NTLM or Negotiate, keep Electron's
 *   default (no `preventDefault`): the request is cancelled and the proxy's or
 *   the site's own error shows. Proxy sign-in is out of scope; NTLM and
 *   Negotiate follow Chromium and are never saved.
 * - **Saved sign-in, sent without a box** on a first attempt for the same
 *   scheme, host, port and realm: always over `https://`; over `http://` only
 *   to `localhost` or an RFC 1918 address (`addressClass.ts`) **and** when
 *   the top-level page is itself local or private (S-16). To any other
 *   `http://` host the box opens pre-filled with the warning and nothing is
 *   sent until the user signs in.
 * - **The box** is a `signIn` strip row (`TabStrip`, so the input guard and
 *   the queue apply). Its title names the host – "Sign in to {host}" – or,
 *   for a challenge from another origin than the top page, the asker first:
 *   "{frame host}, inside {top host}, asks you to sign in". It takes focus
 *   only for a main-frame challenge of a navigation the user started.
 *   A refused attempt shows the box again with the error line (typed or
 *   saved). **Cancel**, or a withdrawn row, cancels: the site's 401 shows.
 * - **Remember for this project** saves only after the site accepted the
 *   sign-in – a response other than 401 for the same address
 *   ({@link TabAuth.requestCompleted}) – so a wrong password is never saved.
 *   It is offered only when the store keeps sign-ins encrypted (`saved`);
 *   otherwise the row says why (`noKeyring`).
 *
 * The strip answer's user name and password are used once and never logged.
 */
import type { StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import type { PromptOutcome, PromptSpec, TabStrip } from '../permissions/tabStrip'
import { hostAddressClass, isLocalOrPrivate, urlAddressClass } from './addressClass'
import type { BrowserCredentialStore, CredentialKey, Credentials } from './credentialStore'

/** Remembered sign-ins waiting for the site's answer, and typed user names kept, per tab. */
const MAX_PENDING = 20

/** Electron's `AuthenticationResponseDetails`, as far as used here. */
export interface AuthDetails {
  readonly url: string
  readonly isRequestForNavigation?: boolean
  readonly firstAuthAttempt?: boolean
}

/** Electron's `AuthInfo`. */
export interface AuthChallenge {
  readonly isProxy: boolean
  readonly scheme: string
  readonly host: string
  readonly port: number
  readonly realm: string
}

export type LoginCallback = (username?: string, password?: string) => void

export interface AuthTab {
  readonly contents: { getURL(): string }
  /** A navigation the user started is pending (025-FR-002). */
  hasPendingUserNavigation(): boolean
}

export interface OriginDisplay {
  text(origin: string): string
  parts(origin: string): NonNullable<StripRow['requester']>['origin'] | null
}

export interface TabAuthDeps {
  readonly tab: AuthTab
  readonly strip: Pick<TabStrip, 'ask'>
  readonly store: Promise<BrowserCredentialStore>
  readonly display: OriginDisplay
}

interface PendingRemember {
  readonly key: CredentialKey
  readonly credentials: Credentials
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

function keyId(key: CredentialKey): string {
  return JSON.stringify([key.scheme, key.host.toLowerCase(), key.port, key.realm])
}

export class TabAuth {
  /** The address of the main-frame navigation in flight, to tell its challenge from a frame's. */
  private mainNavigationUrl: string | null = null
  /** Keys whose saved sign-in was sent without a box, so a refusal says "saved". */
  private readonly autoSent = new Set<string>()
  /** The user name typed last per key, to pre-fill the box after a refusal. */
  private readonly lastUsername = new Map<string, string>()
  private readonly pending = new Map<string, PendingRemember>()
  private open = true

  constructor(private readonly deps: TabAuthDeps) {}

  /** The tab's `login` event. */
  login(event: { preventDefault(): void }, details: AuthDetails, challenge: AuthChallenge, callback: LoginCallback): void {
    const authScheme = challenge.scheme.toLowerCase()
    if (challenge.isProxy || (authScheme !== 'basic' && authScheme !== 'digest')) return
    const origin = originOf(details.url)
    if (origin === null) return
    event.preventDefault()
    const key: CredentialKey = {
      scheme: origin.startsWith('https:') ? 'https' : 'http',
      host: challenge.host.toLowerCase(),
      port: challenge.port,
      realm: challenge.realm
    }
    const isMain = details.isRequestForNavigation === true && details.url === this.mainNavigationUrl
    const topUrl = isMain ? details.url : this.deps.tab.contents.getURL()
    const first = details.firstAuthAttempt !== false
    this.pending.delete(details.url)
    this.deps.store.then(
      (store) => this.decide({ store, key, details, origin, topUrl, isMain, first, callback }),
      () => callback()
    )
  }

  /** A main-frame navigation started, or was redirected, to `url`. */
  mainNavigation(url: string): void {
    this.mainNavigationUrl = url
  }

  /** A request of this tab finished with `statusCode`: a remembered sign-in is saved once accepted. */
  requestCompleted(url: string, statusCode: number | null): void {
    const remembered = this.pending.get(url)
    if (remembered === undefined) return
    this.pending.delete(url)
    if (statusCode === null || statusCode === 401 || !this.open) return
    void this.deps.store.then((store) => store.set(remembered.key, remembered.credentials))
  }

  /** The tab closed. */
  detach(): void {
    this.open = false
    this.pending.clear()
  }

  private decide(input: {
    store: BrowserCredentialStore
    key: CredentialKey
    details: AuthDetails
    origin: string
    topUrl: string
    isMain: boolean
    first: boolean
    callback: LoginCallback
  }): void {
    const { store, key, details, origin, topUrl, isMain, first, callback } = input
    if (!this.open) {
      callback()
      return
    }
    const id = keyId(key)
    const saved = store.get(key)
    const localTarget = isLocalOrPrivate(hostAddressClass(key.host))
    const topClass = urlAddressClass(topUrl)
    const localTop = topClass !== null && isLocalOrPrivate(topClass)
    if (first && saved !== undefined && (key.scheme === 'https' || (localTarget && localTop))) {
      this.autoSent.add(id)
      callback(saved.username, saved.password)
      return
    }
    let rejected: 'typed' | 'saved' | null = null
    if (!first) rejected = this.autoSent.has(id) ? 'saved' : 'typed'
    this.autoSent.delete(id)
    const offerSaved = saved !== undefined && rejected !== 'saved'
    const spec = this.boxSpec(origin, topUrl, isMain, {
      username: this.lastUsername.get(id) ?? saved?.username ?? '',
      savedPassword: offerSaved,
      insecure: key.scheme === 'http' && !localTarget,
      rejected,
      remember: store.persistence === 'saved' ? 'available' : 'noKeyring'
    })
    spec.remembered = store.persistence
    this.deps.strip.ask(spec, (outcome) =>
      this.answered(outcome, { key, id, url: details.url, saved: offerSaved ? saved : undefined, store, callback })
    )
  }

  private boxSpec(origin: string, topUrl: string, isMain: boolean, signIn: NonNullable<StripRow['signIn']>): PromptSpec {
    const display = this.deps.display
    const topOrigin = originOf(topUrl)
    const fromElsewhere = !isMain && topOrigin !== null && topOrigin !== origin
    const askerParts = display.parts(origin)
    const insideParts = fromElsewhere && topOrigin !== null ? display.parts(topOrigin) : null
    const text =
      fromElsewhere && topOrigin !== null
        ? `${display.text(origin)}, inside ${display.text(topOrigin)}, asks you to sign in`
        : `Sign in to ${display.text(origin)}`
    const spec: PromptSpec = {
      kind: 'signIn',
      text,
      answers: ['signIn', 'cancel'],
      takesFocus: isMain && this.deps.tab.hasPendingUserNavigation(),
      signIn
    }
    if (askerParts !== null) spec.requester = { origin: askerParts, inside: insideParts }
    return spec
  }

  private answered(
    outcome: PromptOutcome,
    ctx: {
      key: CredentialKey
      id: string
      url: string
      saved: Credentials | undefined
      store: BrowserCredentialStore
      callback: LoginCallback
    }
  ): void {
    if ('withdrawn' in outcome || outcome.answer !== 'signIn' || !this.open) {
      ctx.callback()
      return
    }
    const fields = outcome.fields ?? {}
    const username = fields.username ?? ctx.saved?.username ?? ''
    const password = fields.password ?? ctx.saved?.password ?? ''
    this.lastUsername.delete(ctx.id)
    this.lastUsername.set(ctx.id, username)
    if (this.lastUsername.size > MAX_PENDING) this.lastUsername.delete(this.lastUsername.keys().next().value as string)
    if (fields.remember === true && ctx.store.persistence === 'saved') {
      if (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string)
      this.pending.set(ctx.url, { key: ctx.key, credentials: { username, password } })
    }
    logger.debug('Browser sign-in answered', { remember: fields.remember === true })
    ctx.callback(username, password)
  }
}
