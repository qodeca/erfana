// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Certificates and HTTP sign-in for every browser tab (spec 025, 025-FR-021,
 * 025-FR-022): the per-project stores and the per-tab handlers, attached by
 * `permissions/BrowserSite.ts` next to the permission broker.
 *
 * - **Stores, per project**: certificate exceptions (`trust.json`) and saved
 *   sign-ins (`credentials.json`), each opened once per canonical project
 *   path and shared by that project's tabs.
 * - **Per tab**: the tab's `certificate-error` goes to its
 *   {@link TabCertificates}, its `login` to its {@link TabAuth}; main-frame
 *   navigation events keep both current. The tab's `destroyed` – or the
 *   link's `detach` – removes every listener.
 */
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { Clock } from '../../../../shared/clock'
import { logger } from '../../LoggingService'
import type { PurposeSigner } from '../browserProfileMarker'
import type { TabStrip } from '../permissions/tabStrip'
import { TabAuth, type AuthChallenge, type AuthDetails, type LoginCallback, type OriginDisplay } from './browserAuth'
import { TabCertificates, type CertificateAnswerResult, type CertificateLike, type TabCertificateState } from './browserCertificates'
import { BrowserCertificateStore } from './certificateStore'
import { BrowserCredentialStore, type CredentialCrypto } from './credentialStore'

/** What the security handlers need of a tab; the optional parts are `BrowserTab`'s. */
export interface SecurityTabRef {
  readonly projectRoot: string
  readonly contents: WebContents
  setCertificateState?(state: TabCertificateState): void
  hasPendingUserNavigation?(): boolean
  reloadAt?(url: string): void
  goBack?(): void
}

export interface SiteSecurityDeps {
  readonly clock: Pick<Clock, 'now'>
  readonly signer: PurposeSigner
  /** The user's home folder, which holds each project's generation record (ADR 0009 decision 6). */
  readonly homeDir: string
  /** `safeStorage`; without it sign-ins are never saved. */
  readonly credentialCrypto?: CredentialCrypto
  /** `safeStorage`'s backend name (`basic_text` = no keyring). */
  readonly storageBackend?: () => string
  readonly display: OriginDisplay
  readonly newId?: () => string
}

/** What the site holds for an attached tab. */
export interface TabSecurityLink {
  /** `browser-tab:certificate`, after the handler checked the sender owns the tab. */
  answerCertificate(decisionId: string, proceed: boolean): CertificateAnswerResult
  requestCompleted(url: string, statusCode: number | null): void
  detach(): void
}

const NO_CRYPTO: CredentialCrypto = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('no key store')
  },
  decryptString: () => {
    throw new Error('no key store')
  }
}

interface NavigationDetails {
  readonly url: string
  readonly isMainFrame: boolean
  readonly isSameDocument?: boolean
}

export class SiteSecurity {
  private readonly certificateStores = new Map<string, Promise<BrowserCertificateStore>>()
  private readonly credentialStores = new Map<string, Promise<BrowserCredentialStore>>()

  constructor(private readonly deps: SiteSecurityDeps) {}

  /** Attach the handlers of a new tab, before its first page loads. */
  attachTab(ref: SecurityTabRef, strip: Pick<TabStrip, 'ask'>): TabSecurityLink {
    const contents = ref.contents
    const certificates = new TabCertificates({
      tab: {
        contents,
        reloadAt: (url) => ref.reloadAt?.(url),
        goBack: () => ref.goBack?.(),
        setCertificateState: (state) => ref.setCertificateState?.(state)
      },
      store: this.certificateStore(ref.projectRoot),
      clock: this.deps.clock,
      newId: this.deps.newId ?? (() => randomUUID().replaceAll('-', '')),
      displayHost: (url) => this.displayHost(url)
    })
    const auth = new TabAuth({
      tab: { contents, hasPendingUserNavigation: () => ref.hasPendingUserNavigation?.() ?? false },
      strip,
      store: this.credentialStore(ref.projectRoot),
      display: this.deps.display
    })
    const onCertificate = (
      event: { preventDefault(): void },
      url: string,
      error: string,
      certificate: CertificateLike,
      callback: (trusted: boolean) => void,
      isMainFrame: boolean
    ): void => certificates.certificateError(event, url, error, certificate, callback, isMainFrame)
    const onLogin = (event: { preventDefault(): void }, details: AuthDetails, challenge: AuthChallenge, callback: LoginCallback): void =>
      auth.login(event, details, challenge, callback)
    const onStart = (details: NavigationDetails): void => {
      if (!details.isMainFrame || details.isSameDocument === true) return
      auth.mainNavigation(details.url)
      certificates.navigationStarted()
    }
    const onRedirect = (details: NavigationDetails): void => {
      if (details.isMainFrame) auth.mainNavigation(details.url)
    }
    const onCommit = (_event: unknown, url: string): void => certificates.committed(url)
    const events: Array<[string, (...args: never[]) => void]> = [
      ['certificate-error', onCertificate],
      ['login', onLogin],
      ['did-start-navigation', onStart],
      ['did-redirect-navigation', onRedirect],
      ['did-navigate', onCommit]
    ]
    const emitter = contents as unknown as {
      on(name: string, listener: (...args: never[]) => void): void
      off(name: string, listener: (...args: never[]) => void): void
      once(name: string, listener: () => void): void
    }
    for (const [name, listener] of events) emitter.on(name, listener)
    let attached = true
    const detach = (): void => {
      if (!attached) return
      attached = false
      certificates.detach()
      auth.detach()
      if (contents.isDestroyed()) return
      for (const [name, listener] of events) emitter.off(name, listener)
      emitter.off('destroyed', detach)
    }
    emitter.once('destroyed', detach)
    return {
      answerCertificate: (decisionId, proceed) => (attached ? certificates.answer(decisionId, proceed) : 'unknown'),
      requestCompleted: (url, statusCode) => auth.requestCompleted(url, statusCode),
      detach
    }
  }

  /** Forget the certificate exceptions of the project at `projectRoot` (025-FR-023). Never rejects. */
  async clearCertificates(projectRoot: string): Promise<void> {
    const store = this.certificateStores.get(projectRoot)
    if (store !== undefined) await (await store).clear()
  }

  /** Forget the saved sign-ins of the project at `projectRoot` (025-FR-023). Never rejects. */
  async clearCredentials(projectRoot: string): Promise<void> {
    const store = this.credentialStores.get(projectRoot)
    if (store !== undefined) await (await store).clear()
  }

  private certificateStore(projectRoot: string): Promise<BrowserCertificateStore> {
    let store = this.certificateStores.get(projectRoot)
    if (store === undefined) {
      store = BrowserCertificateStore.open(projectRoot, this.deps.homeDir, this.deps.signer, this.deps.clock)
      this.certificateStores.set(projectRoot, store)
    }
    return store
  }

  private credentialStore(projectRoot: string): Promise<BrowserCredentialStore> {
    let store = this.credentialStores.get(projectRoot)
    if (store === undefined) {
      let backend = 'unknown'
      try {
        backend = this.deps.storageBackend?.() ?? 'unknown'
      } catch (error) {
        // Unknown means no keyring can be assumed: sign-ins stay in memory.
        backend = 'basic_text'
        logger.warn('Browser sign-ins: the key store backend could not be read', { error: String(error) })
      }
      store = BrowserCredentialStore.open(projectRoot, {
        homeDir: this.deps.homeDir,
        signer: this.deps.signer,
        crypto: this.deps.credentialCrypto ?? NO_CRYPTO,
        backend
      })
      this.credentialStores.set(projectRoot, store)
    }
    return store
  }

  private displayHost(url: string): string {
    try {
      const parsed = new URL(url)
      return this.deps.display.text(parsed.origin)
    } catch {
      return url
    }
  }
}
