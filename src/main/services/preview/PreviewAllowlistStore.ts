// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview allowlist store (Issue #74, work item 19; design §3.1–§3.3).
 *
 * Independently parses the `htmlPreview` block of `.erfana/settings.json` with
 * its OWN `safeParse`, so a clone-delivered bad block can NEVER throw up to
 * project load (§3.1, X1): a bad block degrades to an empty allowlist with
 * write-back disabled and a badge entry, and the project still opens.
 *
 * The write-back path (§3.3) resolves the project root main-side from an
 * injected `ProjectService` accessor — the root is NEVER a request parameter
 * (NEW-8), so a renderer-supplied path cannot steer an `atomicWriteJSON`. It
 * re-reads and mutates the RAW object (not the parsed one) so unknown keys are
 * preserved (§3.2), writes through the `resolveErfanaDir` symlink gate (item 18,
 * X3), and returns the new host set. It holds no registry and no view.
 */

import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError, ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import {
  MAX_ALLOWLIST_HOSTS,
  PREVIEW_ALLOWLIST_VERSION,
  PreviewAllowlistSchema,
  PreviewHostSchema
} from '../../../shared/ipc/preview-settings-schema'
import { atomicWriteJSON } from '../../utils/atomicWrite'
import { resolveErfanaDir } from './erfanaDirGate'

const ERFANA_DIR_NAME = '.erfana'
const SETTINGS_FILE_NAME = 'settings.json'

/** Result of loading the on-disk allowlist block. */
export interface PreviewAllowlistState {
  /** The approved hosts, sorted; empty on any bad or absent block. */
  readonly hosts: readonly string[]
  /** False when the on-disk block is present but bad/unsupported (§3.2). */
  readonly writeBackEnabled: boolean
}

/** Injected dependencies (design §3.3: root from ProjectService, not the caller). */
export interface PreviewAllowlistStoreDeps {
  /**
   * Resolves the current project root, main-side ONLY (NEW-8). Returning `null`
   * means no project is open and every store operation aborts.
   */
  getProjectRoot: () => string | null
  /**
   * Optional sink for a parse-failure badge. The composition root wires this to
   * the `PreviewFailureLog`; the store itself never depends on the log, the
   * registry or the view.
   */
  onBadge?: (badge: PreviewFailureInput) => void
}

export interface IPreviewAllowlistStore {
  /**
   * Read and parse the on-disk allowlist, updating the in-memory host set.
   * Never throws: a bad block yields an empty set with write-back disabled and
   * a badge. Returns the resolved state.
   */
  load(): Promise<PreviewAllowlistState>
  /**
   * Approve `host` and persist it via atomic write-back through the `.erfana`
   * gate. Resolves the root from the injected accessor — the caller supplies no
   * path. Returns the new sorted host set. Serialised per project.
   */
  approveHost(host: string): Promise<readonly string[]>
  /** The current in-memory approved-host set (from the last successful load/approve). */
  getHosts(): ReadonlySet<string>
  /** True unless the last load found a present-but-bad on-disk block. */
  isWriteBackEnabled(): boolean
}

/** True for a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build a badge for a bad/unsupported allowlist block. */
function makeBadge(
  type: 'allowlist-invalid' | 'allowlist-unsupported-version'
): PreviewFailureInput {
  return {
    type,
    resourceUrlOrHost: `${ERFANA_DIR_NAME}/${SETTINGS_FILE_NAME}`,
    reasonCode: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
  }
}

export class PreviewAllowlistStore implements IPreviewAllowlistStore {
  private readonly getProjectRoot: () => string | null
  private readonly onBadge?: (badge: PreviewFailureInput) => void

  private hosts = new Set<string>()
  private writeBackEnabled = true
  /** Per-project tail-promise serialising write-backs (§3.3). */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(deps: PreviewAllowlistStoreDeps) {
    this.getProjectRoot = deps.getProjectRoot
    this.onBadge = deps.onBadge
  }

  async load(): Promise<PreviewAllowlistState> {
    const projectRoot = this.getProjectRoot()
    if (projectRoot === null) {
      return this.applyState([], true)
    }

    const settingsPath = join(projectRoot, ERFANA_DIR_NAME, SETTINGS_FILE_NAME)

    let content: string
    try {
      content = await readFile(settingsPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No settings file at all: empty allowlist, write-back enabled (§3.2).
        return this.applyState([], true)
      }
      // Unreadable file is a bad block: fail safe, do not throw up to load.
      this.onBadge?.(makeBadge('allowlist-invalid'))
      return this.applyState([], false)
    }

    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch {
      this.onBadge?.(makeBadge('allowlist-invalid'))
      return this.applyState([], false)
    }

    if (!isPlainObject(raw)) {
      this.onBadge?.(makeBadge('allowlist-invalid'))
      return this.applyState([], false)
    }

    const htmlPreview = raw.htmlPreview
    const block = isPlainObject(htmlPreview) ? htmlPreview.allowlist : undefined

    if (block === undefined || block === null) {
      // No allowlist block: empty set, write-back enabled (§3.2).
      return this.applyState([], true)
    }

    // Fail closed on any unexpected version — a future version may narrow.
    if (
      isPlainObject(block) &&
      block.version !== undefined &&
      block.version !== PREVIEW_ALLOWLIST_VERSION
    ) {
      this.onBadge?.(makeBadge('allowlist-unsupported-version'))
      return this.applyState([], false)
    }

    const parsed = PreviewAllowlistSchema.safeParse(block)
    if (!parsed.success) {
      this.onBadge?.(makeBadge('allowlist-invalid'))
      return this.applyState([], false)
    }

    return this.applyState(parsed.data.hosts, true)
  }

  approveHost(host: string): Promise<readonly string[]> {
    // Serialise behind the per-project tail-promise chain (§3.3).
    const next = this.writeChain.then(
      () => this.approveHostInner(host),
      () => this.approveHostInner(host)
    )
    // Keep the chain alive regardless of this call's outcome.
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async approveHostInner(host: string): Promise<readonly string[]> {
    const projectRoot = this.getProjectRoot()
    if (projectRoot === null) {
      throw new AppError('No project is open', ErrorCode.PROJECT_NOT_FOUND)
    }

    // Step 0: normalise (ASCII/punycode) then validate — includes isApprovableHost.
    const normalisedHost = this.normaliseAndValidateHost(host)

    // Step 1–3: realpath the root, resolve the gated .erfana, build the path.
    const realRoot = await realpath(projectRoot)
    const erfanaDir = await resolveErfanaDir(realRoot)
    const settingsPath = join(erfanaDir, SETTINGS_FILE_NAME)

    // Step 4: read+parse the RAW object (unknown keys preserved), abort on bad JSON.
    const raw = await this.readRawSettings(settingsPath)

    // Step 5: fail closed if an existing block carries an unsupported version.
    const htmlPreview = isPlainObject(raw.htmlPreview) ? raw.htmlPreview : undefined
    const block = htmlPreview !== undefined ? htmlPreview.allowlist : undefined
    if (
      isPlainObject(block) &&
      block.version !== undefined &&
      block.version !== PREVIEW_ALLOWLIST_VERSION
    ) {
      throw new AppError(
        'Refusing to write over an unsupported allowlist version',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }

    // Step 6: merge, enforce the cap.
    const existing = isPlainObject(block) && Array.isArray(block.hosts) ? block.hosts : []
    const hostSet = new Set<string>(existing.filter((h): h is string => typeof h === 'string'))
    hostSet.add(normalisedHost)
    if (hostSet.size > MAX_ALLOWLIST_HOSTS) {
      throw new AppError('The preview host allowlist is full', ErrorCode.PREVIEW_ALLOWLIST_FULL)
    }
    const sortedHosts = [...hostSet].sort()

    // Step 7: mutate the raw object, preserving every unknown key.
    raw.htmlPreview = {
      ...(htmlPreview ?? {}),
      allowlist: { version: PREVIEW_ALLOWLIST_VERSION, hosts: sortedHosts }
    }

    // Step 8: atomic, pretty (2-space + trailing newline) write-back.
    await atomicWriteJSON(settingsPath, raw, 2)

    // Step 9: re-read + re-validate; swap the in-memory set; return it.
    const verified = await this.verifyWrittenHosts(settingsPath)
    this.hosts = new Set(verified)
    this.writeBackEnabled = true
    return verified
  }

  getHosts(): ReadonlySet<string> {
    return this.hosts
  }

  isWriteBackEnabled(): boolean {
    return this.writeBackEnabled
  }

  /** Update in-memory state and return the resolved load result. */
  private applyState(hosts: readonly string[], writeBackEnabled: boolean): PreviewAllowlistState {
    this.hosts = new Set(hosts)
    this.writeBackEnabled = writeBackEnabled
    return { hosts: [...this.hosts], writeBackEnabled }
  }

  /** Normalise a host through the URL parser then validate via the schema. */
  private normaliseAndValidateHost(host: string): string {
    let normalised: string
    try {
      normalised = new URL(`https://${host}`).hostname
    } catch {
      throw new AppError('This host cannot be approved', ErrorCode.PREVIEW_HOST_NOT_APPROVABLE)
    }
    // Strip any bracketing the URL parser adds to IPv6 literals before schema check.
    const result = PreviewHostSchema.safeParse(normalised)
    if (!result.success) {
      throw new AppError('This host cannot be approved', ErrorCode.PREVIEW_HOST_NOT_APPROVABLE)
    }
    return result.data
  }

  /** Read and JSON-parse the settings file, returning a fresh object if absent. */
  private async readRawSettings(settingsPath: string): Promise<Record<string, unknown>> {
    let content: string
    try {
      content = await readFile(settingsPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      // Do NOT overwrite a file we cannot parse (§3.3 step 4).
      throw new AppError(
        'Refusing to overwrite an unparseable settings file',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }
    if (!isPlainObject(parsed)) {
      throw new AppError(
        'Refusing to overwrite a non-object settings file',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }
    return parsed
  }

  /** Re-read the written file and re-validate the persisted host set (§3.3 step 9). */
  private async verifyWrittenHosts(settingsPath: string): Promise<readonly string[]> {
    const content = await readFile(settingsPath, 'utf8')
    const raw: unknown = JSON.parse(content)
    const block = isPlainObject(raw) && isPlainObject(raw.htmlPreview)
      ? raw.htmlPreview.allowlist
      : undefined
    const parsed = PreviewAllowlistSchema.safeParse(block)
    if (!parsed.success) {
      // The write produced an unreadable block: surface it rather than trusting memory.
      throw new AppError(
        'Written allowlist failed re-validation',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }
    return parsed.data.hosts
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewAllowlistStore(
  deps: PreviewAllowlistStoreDeps
): IPreviewAllowlistStore {
  return new PreviewAllowlistStore(deps)
}

// Re-exported for callers that key off the on-disk layout.
export { ERFANA_DIR_NAME, SETTINGS_FILE_NAME }
