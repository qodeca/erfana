// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Certificate errors of one browser tab (spec 025, 025-FR-021; solution
 * design § 3.5 `browserCertificates`; design `page-states.html`).
 *
 * Every `certificate-error` of the tab's page comes here; the handler always
 * takes the decision (`preventDefault`) and answers once:
 *
 * - **Excepted** – the project's {@link BrowserCertificateStore} holds an
 *   unexpired exception for this host and this certificate's SHA-256
 *   fingerprint: trusted. A main-frame load on such a host marks the tab
 *   `proceeded` (the address bar's warning sign).
 * - **Main frame, not excepted** – refused, so the load stops, and the tab
 *   shows Erfana's warning page (`state.certificate`) naming the host and the
 *   error code. **Proceed anyway** (`browser-tab:certificate`, `proceed`)
 *   saves the exception for 7 days and loads the address again as a
 *   user-started reload; **Back to safety** goes back when the failed load
 *   left a history entry and there is one before it, otherwise it shows the
 *   page the tab was on, or the empty tab.
 * - **Subresource or frame, not excepted** – refused; the page stays, and the
 *   tab is marked `subresourceFailed` until the next document commits.
 *
 * **Input guard, in main.** A **Proceed anyway** within
 * {@link CERTIFICATE_INPUT_GUARD_MS} of the page appearing (main's clock) is
 * ignored and the page stays; the renderer shows the blocked look and ignores
 * a press that began before the page appeared, which main cannot see.
 *
 * Proceed anyway is offered on every host, HSTS and preloaded hosts included
 * (owner decision OD-5).
 */
import { createHash, X509Certificate } from 'node:crypto'
import type { Clock } from '../../../../shared/clock'
import { netErrorCodes, netErrorEntry } from '../../../../shared/browser/netErrorMessages'
import type { CertificateWarning } from '../../../../shared/ipc/browser-tab-site-schema'
import { logger } from '../../LoggingService'
import type { BrowserCertificateStore } from './certificateStore'

/** **Proceed anyway** ignores presses for this long after the page appears (025-FR-021). */
export const CERTIFICATE_INPUT_GUARD_MS = 500
/** `ERR_CERT_INVALID`: the code shown for a certificate error the table does not name. */
const ERR_CERT_INVALID = -207

/** The certificate state the tab shows (`BrowserTab.setCertificateState`). */
export interface TabCertificateState {
  readonly warning: CertificateWarning | null
  /** The address bar's warning sign: the page's host was proceeded, or a subresource failed. */
  readonly sign: 'proceeded' | 'subresourceFailed' | null
  /**
   * The address whose load failed, while the warning page is up. Main-side
   * only: the tab shows it as the address and names the tab after its host,
   * because a refused load commits nothing (025-FR-021).
   */
  readonly failedUrl?: string
}

/** What the handler needs of the tab. */
export interface CertificateTab {
  readonly contents: {
    getURL(): string
    readonly navigationHistory: { canGoBack(): boolean }
  }
  /** Load `url` as a user-started reload (the pending address shows). */
  reloadAt(url: string): void
  goBack(): void
  setCertificateState(state: TabCertificateState): void
}

export interface TabCertificatesDeps {
  readonly tab: CertificateTab
  readonly store: Promise<BrowserCertificateStore>
  readonly clock: Pick<Clock, 'now'>
  readonly newId: () => string
  /** The host as the origin formatter shows it. */
  readonly displayHost: (url: string) => string
  /** {@link certificateFingerprint} by default. */
  readonly fingerprint?: (certificate: CertificateLike) => string | null
}

/** The part of an Electron `Certificate` used here. */
export interface CertificateLike {
  readonly data: string
}

/** What `answer` did. */
export type CertificateAnswerResult = 'accepted' | 'guarded' | 'unknown'

interface ShownWarning {
  readonly decisionId: string
  readonly url: string
  readonly host: string
  /** `null` when the certificate did not parse: the page warns, and Proceed anyway cannot save. */
  readonly fingerprint: string | null
  readonly code: number
  readonly shownAt: number
}

/** SHA-256 of the certificate's DER bytes, lower-case hex; `null` when the PEM does not parse. */
export function certificateFingerprint(certificate: CertificateLike): string | null {
  try {
    return createHash('sha256').update(new X509Certificate(certificate.data).raw).digest('hex')
  } catch {
    return null
  }
}

/** The net error code for Electron's error text (`net::ERR_CERT_DATE_INVALID` → -201). */
export function certificateErrorCode(error: string): number {
  const name = error.replace(/^net::/, '').replace(/^ERR_/, '')
  const code = netErrorCodes().find((c) => netErrorEntry(c)?.name === name)
  return code ?? ERR_CERT_INVALID
}

function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === '' ? null : host
  } catch {
    return null
  }
}

export class TabCertificates {
  private warning: ShownWarning | null = null
  private subresourceFailed = false
  private committedHost: string | null = null
  /** Hosts whose exception let a main-frame load through in this tab. */
  private readonly proceededHosts = new Set<string>()
  private resolvedStore: BrowserCertificateStore | null = null
  private open = true

  constructor(private readonly deps: TabCertificatesDeps) {}

  /** The tab's `certificate-error` event. */
  certificateError(
    event: { preventDefault(): void },
    url: string,
    error: string,
    certificate: CertificateLike,
    callback: (isTrusted: boolean) => void,
    isMainFrame: boolean
  ): void {
    event.preventDefault()
    const host = hostOf(url)
    const fingerprint = (this.deps.fingerprint ?? certificateFingerprint)(certificate)
    this.deps.store.then(
      (store) => {
        this.resolvedStore = store
        const trusted = this.open && host !== null && fingerprint !== null && store.isExcepted(host, fingerprint)
        callback(trusted)
        if (!this.open || host === null) return
        if (trusted) {
          if (isMainFrame) this.proceededHosts.add(host)
          return
        }
        logger.info('Refused a browser certificate', { isMainFrame, code: certificateErrorCode(error) })
        if (isMainFrame) this.showWarning(url, host, fingerprint, certificateErrorCode(error))
        else this.markSubresourceFailed()
      },
      () => callback(false)
    )
  }

  /** A new main-frame document navigation started: the warning page goes. */
  navigationStarted(): void {
    if (this.warning === null) return
    this.warning = null
    this.emit()
  }

  /** A main-frame document committed at `url`. */
  committed(url: string): void {
    this.committedHost = hostOf(url)
    this.warning = null
    this.subresourceFailed = false
    this.emit()
  }

  /** **Proceed anyway** (`proceed`) or **Back to safety** for `decisionId`. */
  answer(decisionId: string, proceed: boolean): CertificateAnswerResult {
    const shown = this.warning
    if (!this.open || shown === null || shown.decisionId !== decisionId) return 'unknown'
    if (proceed) {
      if (this.deps.clock.now() - shown.shownAt < CERTIFICATE_INPUT_GUARD_MS) {
        logger.debug('Ignored Proceed anyway inside the input guard')
        return 'guarded'
      }
      if (shown.fingerprint === null) {
        logger.warn('Proceed anyway refused: the certificate could not be read')
        return 'unknown'
      }
      void this.resolvedStore?.add(shown.host, shown.fingerprint)
      this.warning = null
      this.emit()
      this.deps.tab.reloadAt(shown.url)
      return 'accepted'
    }
    this.warning = null
    this.emit()
    const contents = this.deps.tab.contents
    // The failed load left its own history entry: step back over it.
    if (contents.getURL() === shown.url && contents.navigationHistory.canGoBack()) this.deps.tab.goBack()
    return 'accepted'
  }

  /** What the tab shows now. */
  state(): TabCertificateState {
    const w = this.warning
    const warning: CertificateWarning | null =
      w === null ? null : { decisionId: w.decisionId, host: this.deps.displayHost(w.url), code: w.code, shownAt: w.shownAt }
    let sign: TabCertificateState['sign'] = null
    if (this.subresourceFailed) sign = 'subresourceFailed'
    else if (this.committedHost !== null && this.proceededHosts.has(this.committedHost)) sign = 'proceeded'
    return w === null ? { warning, sign } : { warning, sign, failedUrl: w.url }
  }

  /** The tab closed: later errors are refused, nothing more is shown. */
  detach(): void {
    this.open = false
    this.warning = null
  }

  private showWarning(url: string, host: string, fingerprint: string | null, code: number): void {
    this.warning = { decisionId: this.deps.newId(), url, host, fingerprint, code, shownAt: this.deps.clock.now() }
    this.emit()
  }

  private markSubresourceFailed(): void {
    if (this.subresourceFailed) return
    this.subresourceFailed = true
    this.emit()
  }

  private emit(): void {
    if (!this.open) return
    try {
      this.deps.tab.setCertificateState(this.state())
    } catch (error) {
      logger.warn('The browser certificate state could not be shown', { error: String(error) })
    }
  }
}
