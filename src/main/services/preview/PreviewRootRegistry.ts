// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview root registry (Issue #74, work item 14; design §1.1, §2.2, §2.5).
 *
 * OWNS the opaque per-project token AND the CSP that travels with it. No
 * filesystem path ever enters a preview URL — the token is the URL host, and
 * mapping it back to a real root happens ONLY here (design §0 choice 1).
 *
 * The CSP is a field of the entry the protocol handler already resolves per
 * request, so `previewCsp → registry → protocol handler` is a real dependency
 * edge with a single producer (NEW-3): there is no way for an empty or unwired
 * CSP to reach `buildResponseHeaders`, because the registry is the only site
 * that ever calls `buildPreviewCsp`.
 *
 * The token is also the ONLY source the entry's `frame-src` names (issue #124
 * WI-13, design part 2 §2.1): `issue` mints it before building the policy and
 * `rebuildCsp` passes the same one back, so a preview page can frame pages of
 * its own root and nothing else.
 *
 * The token is NOT a secret — a previewed page can read its own `location`. It
 * keeps the project's absolute path out of the URL and scopes `frame-src`;
 * neither needs secrecy. It is minted lazily on first open and revoked on
 * project switch; a revoked token resolves to `undefined`, which the protocol
 * handler turns into a 404 (not a 403).
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { logger } from '../LoggingService'
import { buildPreviewCsp, type PreviewCspRejection } from './previewCsp'

/**
 * A resolved preview root. Immutable from the caller's perspective; the registry
 * replaces the whole entry (never mutates a field) when the CSP is rebuilt.
 */
export interface PreviewRootEntry {
  /** `fsPromises.realpath` of the project root — the confinement anchor. */
  readonly realRoot: string
  /** The project path as opened (pre-realpath), for diagnostics and reverse lookup. */
  readonly projectPath: string
  /** The CSP built by `buildPreviewCsp` from the loaded allowlist (design §2.5). */
  readonly csp: string
}

export interface IPreviewRootRegistry {
  /**
   * Mint a token for `projectPath`, realpath-resolving the root and building the
   * CSP from `hosts`, with that token as its only `frame-src`. Returns the
   * 32-char lowercase-hex token used as the URL host.
   */
  issue(projectPath: string, hosts: readonly string[]): Promise<string>
  /** Resolve a token to its entry, or `undefined` if unknown or revoked (⇒ 404). */
  resolve(token: string): PreviewRootEntry | undefined
  /** Revoke a token so it can never resolve again (project switch, app quit). */
  revoke(token: string): void
  /** Rebuild the CSP on an existing entry from a new host set (approve path); the token stays. */
  rebuildCsp(token: string, hosts: readonly string[]): void
  /** Drop every entry (app quit / global disable). */
  clear(): void
}

/**
 * Generate the opaque token: `randomUUID()` with dashes removed, yielding 32
 * lowercase hex characters. Hex round-trips through Chromium's lowercase host
 * canonicalisation and is itself a valid hostname (design §2.2).
 */
function mintToken(): string {
  return randomUUID().replaceAll('-', '')
}

/** Which registry operation built the policy, for the log line. */
type CspBuildSite = 'issue' | 'rebuildCsp'

/**
 * The registry's sink for what `buildPreviewCsp` left out.
 *
 * An unusable own token is a wiring fault – the registry minted it – and the
 * builder has already failed closed (`frame-src 'none'`: this root's pages get
 * no frames), so it is logged as an error. The token is not logged; the builder
 * does not even pass it on. A skipped host is not logged here, as before: the
 * allowlist store raises its own `allowlist-invalid` badges, which the session
 * factory drains onto the panel (#115).
 */
function reportCspRejection(site: CspBuildSite): (rejection: PreviewCspRejection) => void {
  return rejection => {
    if (rejection.kind === 'own-token') {
      logger.error(
        "Preview CSP: the root token is not 32 lowercase hex; its pages get frame-src 'none'",
        undefined,
        { site }
      )
    }
  }
}

export class PreviewRootRegistry implements IPreviewRootRegistry {
  private readonly entries = new Map<string, PreviewRootEntry>()

  async issue(projectPath: string, hosts: readonly string[]): Promise<string> {
    const realRoot = await realpath(projectPath)
    // Mint first: the policy's `frame-src` names this very token (#124).
    const token = mintToken()
    const csp = buildPreviewCsp(hosts, { ownToken: token }, reportCspRejection('issue'))
    this.entries.set(token, { realRoot, projectPath, csp })
    return token
  }

  resolve(token: string): PreviewRootEntry | undefined {
    return this.entries.get(token)
  }

  revoke(token: string): void {
    this.entries.delete(token)
  }

  rebuildCsp(token: string, hosts: readonly string[]): void {
    const entry = this.entries.get(token)
    if (entry === undefined) {
      return
    }
    // Replace the whole entry so `csp` stays effectively readonly per resolve.
    // The SAME token goes back into the policy: an approval changes the hosts,
    // never which pages this root's pages may frame.
    this.entries.set(token, {
      realRoot: entry.realRoot,
      projectPath: entry.projectPath,
      csp: buildPreviewCsp(hosts, { ownToken: token }, reportCspRejection('rebuildCsp'))
    })
  }

  clear(): void {
    this.entries.clear()
  }
}

/** Factory mirroring the project's interface + class + factory + singleton shape. */
export function createPreviewRootRegistry(): IPreviewRootRegistry {
  return new PreviewRootRegistry()
}
