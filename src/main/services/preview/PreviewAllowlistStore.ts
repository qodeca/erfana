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
  originFromLegacyHost,
  parsePreviewOrigin
} from '../../../shared/ipc/preview-settings-schema'
import { atomicWriteJSON } from '../../utils/atomicWrite'
import { resolveErfanaDir } from './erfanaDirGate'

const ERFANA_DIR_NAME = '.erfana'
const SETTINGS_FILE_NAME = 'settings.json'

/** Result of loading the on-disk allowlist block. */
export interface PreviewAllowlistState {
  /** The approved ORIGINS, sorted; empty on any bad or absent block. */
  readonly origins: readonly string[]
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
   * Approve `origin` and persist it via atomic write-back through the `.erfana`
   * gate. Resolves the root from the injected accessor — the caller supplies no
   * path. Returns the new sorted origin set. Serialised per project.
   */
  approveOrigin(origin: string): Promise<readonly string[]>
  /**
   * The current in-memory approved-origin set (from the last successful
   * load/approve).
   *
   * THE ONLY ACCESSOR, and that is the point. The CSP used to be built from a
   * `load()` snapshot array while the network filter read this getter — one
   * store, two shapes, read at different times, and nothing forcing them to
   * agree. Both now read this.
   */
  getOrigins(): ReadonlySet<string>
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

  private origins = new Set<string>()
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

    return this.applyState(resolveOrigins(parsed.data), true)
  }

  approveOrigin(origin: string): Promise<readonly string[]> {
    // Serialise behind the per-project tail-promise chain (§3.3).
    const next = this.writeChain.then(
      () => this.approveOriginInner(origin),
      () => this.approveOriginInner(origin)
    )
    // Keep the chain alive regardless of this call's outcome.
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async approveOriginInner(origin: string): Promise<readonly string[]> {
    const projectRoot = this.getProjectRoot()
    if (projectRoot === null) {
      throw new AppError('No project is open', ErrorCode.PROJECT_NOT_FOUND)
    }

    // Step 0: canonicalise, or refuse. `parsePreviewOrigin` is the single
    // definition of both, so what is written here is byte-identical to what the
    // CSP builder emits and what the network filter compares.
    const canonicalOrigin = this.normaliseAndValidateOrigin(origin)

    // Step 1–3: realpath the root, resolve the gated .erfana, build the path.
    const realRoot = await realpath(projectRoot)
    const erfanaDir = await resolveErfanaDir(realRoot)
    const settingsPath = join(erfanaDir, SETTINGS_FILE_NAME)

    // Step 4: read+parse the RAW object (unknown keys preserved), abort on bad JSON.
    const raw = await this.readRawSettings(settingsPath)

    // Step 5: resolve what is already on disk, through the SAME ladder `load()`
    // uses. See `resolveExistingOrigins` for why reading raw here was wrong.
    const htmlPreview = isPlainObject(raw.htmlPreview) ? raw.htmlPreview : undefined
    const block = htmlPreview !== undefined ? htmlPreview.allowlist : undefined
    const existingOrigins = this.resolveExistingOrigins(block)

    // Step 6: add the new grant and enforce the cap. The cap is on the resolved
    // set, not on each key: `resolveOrigins` picks ONE key, so `hosts` cannot
    // add to what `origins` already carries.
    const originSet = new Set<string>([...existingOrigins, canonicalOrigin])
    if (originSet.size > MAX_ALLOWLIST_HOSTS) {
      throw new AppError('The preview host allowlist is full', ErrorCode.PREVIEW_ALLOWLIST_FULL)
    }
    const sortedOrigins = [...originSet].sort()

    // Step 6b: VALIDATE BEFORE WRITING. This used to happen only in step 9, so a
    // single bad entry already on disk made every approval throw AFTER the write
    // had landed — the file mutated, the user told "Not saved", and the same
    // failure on every retry. Refusing to write is fail-closed; writing and then
    // refusing is neither.
    if (!PreviewAllowlistSchema.safeParse({
      version: PREVIEW_ALLOWLIST_VERSION,
      hosts: sortedOrigins.map(hostOfOrigin).filter((h): h is string => h !== null),
      origins: sortedOrigins
    }).success) {
      throw new AppError(
        'Refusing to write an allowlist that would not parse back',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }

    // Step 6c: refuse to write over a `htmlPreview` that is not an object.
    //
    // Overwriting it is DATA LOSS: a string, array or number there would be
    // replaced wholesale by the object built below, and the user would never be
    // told. There is no third option — this key cannot hold both their value and
    // an allowlist — so the choice is destroy or refuse, and refusing is the
    // same answer step 5 gives to a block that does not parse. A malformed
    // settings file is fixable by hand; a silently deleted value is not.
    if (raw.htmlPreview !== undefined && htmlPreview === undefined) {
      throw new AppError(
        'Refusing to write over a malformed htmlPreview settings block',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }

    // Step 7: mutate the raw object, preserving every unknown key.
    //
    // DUAL-WRITE, and `origins` is the truth. `hosts` is a projection carrying
    // only the default-port https origins, which is exactly what a host entry
    // could ever express — so an older build reads a file it fully understands
    // and simply cannot see the rest. The version is deliberately not bumped;
    // see PreviewAllowlistSchema.
    //
    // SPREAD THE BLOCK, not just its parent. The file header promises unknown
    // keys survive a round trip, and until now that held only for keys ABOVE
    // `allowlist` — the block itself was replaced wholesale, so anything inside
    // it was dropped. That is also the trap waiting for the next field added
    // here: this schema deliberately does not bump its version, so a build that
    // does not know a key must preserve it rather than delete it.
    raw.htmlPreview = {
      ...(htmlPreview ?? {}),
      allowlist: {
        ...(isPlainObject(block) ? block : {}),
        version: PREVIEW_ALLOWLIST_VERSION,
        hosts: sortedOrigins.map(hostOfOrigin).filter((h): h is string => h !== null),
        origins: sortedOrigins
      }
    }

    // Step 8: atomic, pretty (2-space + trailing newline) write-back.
    await atomicWriteJSON(settingsPath, raw, 2)

    // Step 9: re-read + re-validate; swap the in-memory set; return it. Now a
    // confirmation that the bytes landed, rather than the first time anything
    // was checked.
    const verified = await this.verifyWrittenOrigins(settingsPath)
    this.origins = new Set(verified)
    this.writeBackEnabled = true
    return verified
  }

  getOrigins(): ReadonlySet<string> {
    return this.origins
  }

  isWriteBackEnabled(): boolean {
    return this.writeBackEnabled
  }

  /**
   * The grants already on disk, resolved through the same three steps `load()`
   * applies — and the reason this method exists rather than a pair of raw reads.
   *
   * The write path used to read `origins` and `hosts` straight off the raw
   * object, so it inherited NONE of the guarantees the read path establishes.
   * Three defects came out of that one shortcut:
   *
   *   - A block with no `version` key is refused by `load()` (the schema
   *     requires the literal) but sailed past the version guard, which only
   *     fires when the key is PRESENT and wrong. Approving one host then adopted
   *     every origin in the file and stamped `version: 1` on it — so a
   *     clone-delivered block the badge had already rejected went live on the
   *     user's next click, and stayed live on every load afterwards.
   *   - `resolveOrigins`' key-presence precedence was bypassed by an
   *     unconditional union of both keys, so deleting an entry from `origins` by
   *     hand was undone by the next approval. Hand-editing is currently the only
   *     revocation there is (#86).
   *   - `hostOfOrigin` ran `new URL()` over those raw strings from inside the
   *     ARGUMENT to the step 6b guard, so one malformed entry threw `TypeError`
   *     before the guard written to refuse it — and every approval in that
   *     project failed from then on, reading only "Not saved".
   *
   * Reading `this.origins` instead would be shorter and wrong: it is a cache
   * from the last `load()`, so it would silently drop a grant another window or
   * a hand edit added since. This re-reads and re-validates disk every call.
   *
   * ABSENT BLOCK MEANS EMPTY AND CONTINUE, which is not a formality. A project
   * with no settings file reaches here with `block === undefined`, and
   * `PreviewAllowlistSchema.safeParse(undefined)` fails — so throwing on it
   * would make the FIRST approval in every new project impossible.
   */
  private resolveExistingOrigins(block: unknown): readonly string[] {
    if (block === undefined || block === null) {
      return []
    }

    // Fail closed on any unexpected version — a future version may narrow.
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

    const parsed = PreviewAllowlistSchema.safeParse(block)
    if (!parsed.success) {
      throw new AppError(
        'Refusing to write over an allowlist block that does not parse',
        ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
      )
    }

    return resolveOrigins(parsed.data)
  }

  /** Update in-memory state and return the resolved load result. */
  private applyState(
    origins: readonly string[],
    writeBackEnabled: boolean
  ): PreviewAllowlistState {
    this.origins = new Set(origins)
    this.writeBackEnabled = writeBackEnabled
    return { origins: [...this.origins], writeBackEnabled }
  }

  /**
   * Canonicalise an origin, or refuse it.
   *
   * One call, because `parsePreviewOrigin` is both the canonicaliser and the
   * definition of validity. The old pair — `new URL('https://' + host).hostname`
   * then a schema check — silently DROPPED a port and mangled a scheme, so an
   * origin arriving here would have been quietly narrowed to something the
   * caller never asked for.
   */
  private normaliseAndValidateOrigin(origin: string): string {
    const canonical = parsePreviewOrigin(origin)
    if (canonical === null) {
      throw new AppError('This host cannot be approved', ErrorCode.PREVIEW_HOST_NOT_APPROVABLE)
    }
    return canonical
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

  /** Re-read the written file and re-validate the persisted set (§3.3 step 9). */
  private async verifyWrittenOrigins(settingsPath: string): Promise<readonly string[]> {
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
    return resolveOrigins(parsed.data)
  }
}

/**
 * The ONE place `origins` and `hosts` become a single list.
 *
 * Precedence is KEY PRESENT, not array non-empty: a file saying
 * `origins: []` has deliberately approved nothing, and falling back to `hosts`
 * there would resurrect grants the writer removed. A file with no `origins` key
 * at all was written before origins existed, and its hosts mean what they always
 * meant.
 */
function resolveOrigins(block: {
  hosts: readonly string[]
  origins?: readonly string[]
}): readonly string[] {
  const resolved =
    block.origins !== undefined
      ? [...block.origins]
      : block.hosts.map(originFromLegacyHost).filter((o): o is string => o !== null)
  // Dedupe AFTER canonicalisation: `https://x` and `https://x:443` are one origin
  // and would otherwise occupy two slots and two CSP host-sources.
  return [...new Set(resolved)].sort()
}

/**
 * The `hosts` projection of an origin, or `null` when it has none.
 *
 * Only a default-port https origin can be written back as a bare host, because
 * that is the only thing a host entry could ever have meant. Everything else is
 * invisible to an older build — which loses grants rather than inventing them,
 * the safe direction for a one-way door.
 */
function hostOfOrigin(origin: string): string | null {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.port !== '') return null
  return url.hostname
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewAllowlistStore(
  deps: PreviewAllowlistStoreDeps
): IPreviewAllowlistStore {
  return new PreviewAllowlistStore(deps)
}

// Re-exported for callers that key off the on-disk layout.
export { ERFANA_DIR_NAME, SETTINGS_FILE_NAME }
