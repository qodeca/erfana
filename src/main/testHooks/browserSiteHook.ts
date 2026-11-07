// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The site-behaviour test hooks of the built-in browser (spec 025 solution
 * design § 3.5 `browserCertificates`, § 12 T3, probe 10c): reached as
 * `globalThis.__erfanaTestHooks.site` by e2e tests through `app.evaluate`.
 * Test builds only – reached through `./index`.
 *
 * - **Test CA (probe 10c).** `trustTestCa` installs a certificate verify
 *   proc on every open browser session that treats the fixtures' test CA as
 *   a trusted root: a leaf it signed is accepted when it is in date and names
 *   the host, and otherwise fails as Chromium would with a trusted root
 *   (`ERR_CERT_DATE_INVALID`, `ERR_CERT_COMMON_NAME_INVALID`). A leaf the CA
 *   did not sign keeps Chromium's own verdict, so the self-signed fixture
 *   still warns. Call it after a tab opened the project's session.
 * - **Fresh handshakes and challenges.** `resetConnections` closes every
 *   open connection and empties Chromium's HTTP auth cache in every open
 *   browser session, so the next load meets the server's current certificate
 *   and challenge instead of a reused socket or a cached sign-in.
 *
 * Never touches a `webContents`' debugger (only `cdp/` may).
 */
import { X509Certificate } from 'node:crypto'
import type { Session } from 'electron'
import type { BrowserRuntime } from '../services/browser/browserAppSetup'

/** Chromium's verify-proc answers: accept, or use Chromium's own verdict. */
const VERIFY_OK = 0
const VERIFY_USE_CHROMIUM = -3
const ERR_CERT_COMMON_NAME_INVALID = -200
const ERR_CERT_DATE_INVALID = -201

export interface BrowserSiteTestHook {
  /** Trust leaves signed by `caPem` in every open browser session; resolves how many sessions it reached. */
  trustTestCa(caPem: string): Promise<number>
  /** Close every connection and clear the HTTP auth cache of every open browser session. */
  resetConnections(): Promise<void>
}

/** The verdict for `leafPem` at `hostname` with `ca` as a trusted root, at `now`. */
export function testCaVerdict(leafPem: string, hostname: string, ca: X509Certificate, now: number): number {
  let leaf: X509Certificate
  try {
    leaf = new X509Certificate(leafPem)
    if (!leaf.checkIssued(ca) || !leaf.verify(ca.publicKey)) return VERIFY_USE_CHROMIUM
  } catch {
    return VERIFY_USE_CHROMIUM
  }
  if (now < Date.parse(leaf.validFrom) || now > Date.parse(leaf.validTo)) return ERR_CERT_DATE_INVALID
  return leaf.checkHost(hostname) === undefined ? ERR_CERT_COMMON_NAME_INVALID : VERIFY_OK
}

/** Build the site hook over the runtime `getRuntime` returns at call time. */
export function createBrowserSiteTestHook(getRuntime: () => BrowserRuntime | null): BrowserSiteTestHook {
  const openSessions = async (): Promise<Session[]> => {
    const runtime = getRuntime()
    if (runtime === null) throw new Error('The browser runtime is not installed')
    return (await runtime.profiles.openSessions()) as Session[]
  }
  return {
    resetConnections: async () => {
      const sessions = await openSessions()
      await Promise.all(sessions.flatMap((ses) => [ses.closeAllConnections(), ses.clearAuthCache()]))
    },
    trustTestCa: async (caPem) => {
      const ca = new X509Certificate(caPem)
      const sessions = await openSessions()
      for (const ses of sessions) {
        ses.setCertificateVerifyProc((request, callback) => {
          // Wall-clock time on purpose: certificate validity is real time, not the test clock.
          callback(testCaVerdict(request.certificate.data, request.hostname, ca, Date.now()))
        })
      }
      return sessions.length
    }
  }
}
