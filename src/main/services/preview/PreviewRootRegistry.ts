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
 * The token is NOT a secret — a previewed page can read its own `location`. Its
 * only job is to keep the project's absolute path out of the URL. It is minted
 * lazily on first open and revoked on project switch; a revoked token resolves
 * to `undefined`, which the protocol handler turns into a 404 (not a 403).
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { buildPreviewCsp } from './previewCsp'

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
   * CSP from `hosts`. Returns the 32-char lowercase-hex token used as the URL host.
   */
  issue(projectPath: string, hosts: readonly string[]): Promise<string>
  /** Resolve a token to its entry, or `undefined` if unknown or revoked (⇒ 404). */
  resolve(token: string): PreviewRootEntry | undefined
  /** Revoke a token so it can never resolve again (project switch, app quit). */
  revoke(token: string): void
  /** Rebuild the CSP on an existing entry from a new host set (approve path). */
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

export class PreviewRootRegistry implements IPreviewRootRegistry {
  private readonly entries = new Map<string, PreviewRootEntry>()

  async issue(projectPath: string, hosts: readonly string[]): Promise<string> {
    const realRoot = await realpath(projectPath)
    const csp = buildPreviewCsp(hosts)
    const token = mintToken()
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
    this.entries.set(token, {
      realRoot: entry.realRoot,
      projectPath: entry.projectPath,
      csp: buildPreviewCsp(hosts)
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
