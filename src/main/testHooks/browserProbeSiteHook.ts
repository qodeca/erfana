// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The site-behaviour engine probes of the built-in browser (spec 025 solution
 * design § 13 commit 8, T25), merged into `browserProbeHook.ts`'s object:
 *
 * - **`erfana-local` fetch metadata** (ADR 0012 decision 1). A test-only
 *   handler on the probe session serves a fixture folder and records the
 *   `Sec-Fetch-*` and `Origin` headers each request carries. The production
 *   handler arrives with commit 11; this one never runs outside test builds.
 * - **Certificates** on a real tab: certificate errors and load failures,
 *   recorded without `preventDefault`, so Electron's default decision stands.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import { createHash, X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { Session } from 'electron'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import type { BROWSER_LOCAL_SCHEME } from '../services/browser/browserLocalScheme'
import type { BrowserTab } from '../services/browser/BrowserTab'

/**
 * The scheme as a same-file literal, so `previewSchemeScope.test.ts` can resolve
 * this handler's scheme; the type keeps it equal to the real constant.
 */
const LOCAL_SCHEME: typeof BROWSER_LOCAL_SCHEME = 'erfana-local'

/** Records kept per list; a probe that floods them is broken. */
const RECORD_CAP = 2_000

export interface ProbeLocalRequest {
  readonly url: string
  readonly dest: string | null
  readonly site: string | null
  readonly mode: string | null
  readonly origin: string | null
}

export interface ProbeCertificateEvent {
  readonly error: string
  readonly url: string
  readonly spkiSha256: string | null
  readonly issuer: string
}

export interface ProbeLoadFailure {
  readonly code: number
  readonly description: string
  readonly url: string
  readonly isMainFrame: boolean
}

export interface BrowserProbeSiteHook {
  /** Serve `rootDir` as `erfana-local://<any host>/` in the probe session, recording fetch metadata. */
  probeServeLocalScheme(rootDir: string): void
  probeLocalRequests(): ProbeLocalRequest[]
  /** Record certificate errors and load failures on a real tab (no `preventDefault`: the default stands). */
  watchCertificates(tabId: string): void
  certificateEvents(tabId: string): { errors: ProbeCertificateEvent[]; failures: ProbeLoadFailure[] }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain'
}

function push<T>(list: T[], item: T): void {
  if (list.length < RECORD_CAP) list.push(item)
}

/** Base64 SHA-256 of a PEM certificate's public key (the form `--ignore-certificate-errors-spki-list` takes). */
function spkiOf(pem: string): string | null {
  try {
    const der = new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('base64')
  } catch {
    return null
  }
}

/**
 * Build the site probes. `sessionForProbes` is the probe views' own session
 * (`browserProbeHook.ts`); `getRuntime` finds the real tabs.
 */
export function createBrowserProbeSiteHook(
  getRuntime: () => BrowserRuntime | null,
  sessionForProbes: () => Session
): BrowserProbeSiteHook {
  const localRequests: ProbeLocalRequest[] = []
  const certificates = new Map<string, { errors: ProbeCertificateEvent[]; failures: ProbeLoadFailure[] }>()

  const runtime = (): BrowserRuntime => {
    const found = getRuntime()
    if (found === null) throw new Error('The browser runtime is not installed')
    return found
  }

  return {
    probeServeLocalScheme: (rootDir) => {
      const root = normalize(rootDir)
      const ses = sessionForProbes()
      if (ses.protocol.isProtocolHandled(LOCAL_SCHEME)) ses.protocol.unhandle(LOCAL_SCHEME)
      ses.protocol.handle(LOCAL_SCHEME, async (request) => {
        const header = (name: string): string | null => request.headers.get(name)
        push(localRequests, {
          url: request.url,
          dest: header('sec-fetch-dest'),
          site: header('sec-fetch-site'),
          mode: header('sec-fetch-mode'),
          origin: header('origin')
        })
        const pathname = decodeURIComponent(new URL(request.url).pathname)
        const file = normalize(join(root, pathname))
        if (!file.startsWith(root + sep)) return new Response(null, { status: 403 })
        try {
          const body = await readFile(file)
          return new Response(body, {
            headers: { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' }
          })
        } catch {
          return new Response(null, { status: 404 })
        }
      })
    },
    probeLocalRequests: () => [...localRequests],
    watchCertificates: (tabId) => {
      const tab: BrowserTab | undefined = runtime()
        .tabs.list()
        .find((t) => t.id === tabId)
      if (tab === undefined) throw new Error(`No browser tab ${tabId}`)
      const record = { errors: [] as ProbeCertificateEvent[], failures: [] as ProbeLoadFailure[] }
      certificates.set(tabId, record)
      tab.contents.on('certificate-error', (_event, url, error, certificate) =>
        push(record.errors, { error, url, spkiSha256: spkiOf(certificate.data), issuer: certificate.issuerName })
      )
      tab.contents.on('did-fail-load', (_event, code, description, url, isMainFrame) =>
        push(record.failures, { code, description, url, isMainFrame })
      )
    },
    certificateEvents: (tabId) => {
      const record = certificates.get(tabId)
      if (record === undefined) throw new Error(`No certificate watch on ${tabId}`)
      return { errors: [...record.errors], failures: [...record.failures] }
    }
  }
}
