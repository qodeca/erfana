// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared Claude model-id parser + context-window capability registry (#41).
 *
 * Before this module three separate regexes each tried to understand a model id
 * (`ClaudeWindowDetector`, `friendlyModelName`, `ClaudeTranscriptParser`), all
 * assuming `claude-opus-4-8`. Current ids look like `claude-opus-5` (no minor),
 * so each failed differently: the meter scaled a 1M model to 200k and the label
 * fell back to the raw id. This module is the single parse and the single
 * window-policy entry point, so for ids the grammar ACCEPTS the label and the
 * window can no longer disagree. Ids it REFUSES still resolve by separate routes
 * and may differ: an over-length id, a bare alias and `claude-mythos-preview`
 * each get their label and their window from different fallbacks.
 *
 * PURE by contract: no fs, no network, no spawn, no logging, no Electron. Every
 * exported function is total — none throws, for any input.
 *
 * The window is NOT a property of the model id (design §5): it is a function of
 * plan x model x environment. This registry states the documented DEFAULT for the
 * Claude Code layer, the layer Erfana meters, so its answer is PROVISIONAL —
 * callers must let observed signals override it, and must never latch a
 * provisional 1M for the session.
 *
 * Policy data (exact-id map, family heuristic, undecomposable-id map, recognised
 * variants) is module-private on purpose (design §6.1): it is exercised through
 * {@link windowForModelId}, so its tests cannot degenerate into a restatement of
 * the data structure.
 *
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §5, §6, §7, §8, §11
 */
import { MAX_MODEL_ID_LENGTH } from '../../../shared/ipc/claude-status-schema'

/** Standard Claude Code context window, in tokens. */
const STANDARD = 200000 as const

/** Extended ("1M") Claude Code context window, in tokens. */
const EXTENDED = 1000000 as const

/** A context-window size this registry is allowed to report. */
type Window = typeof STANDARD | typeof EXTENDED

/**
 * Date the capability data was last checked against primary sources (§2.0). A
 * freshness test fails once it is more than 180 days stale, so a drifting lineup
 * breaks CI instead of quietly mis-metering.
 */
export const CAPABILITIES_VERIFIED_ON = '2026-08-07'

/**
 * Bracketed variant tokens this parser understands. `1m` is the Claude Code
 * selection-time marker for the 1M window; it is stripped before the id reaches
 * the API and occurs ZERO times in the observed corpus (design §2.2). Supported
 * defensively, NOT as the detection mechanism.
 */
const RECOGNISED_VARIANTS: ReadonlySet<string> = new Set(['1m'])

/** The variant token that selects the extended window. */
const EXTENDED_VARIANT = '1m'

/**
 * Hard bound on bracketed variant groups per id (design §11). More than this is
 * malformed/adversarial and is rejected outright, not partially interpreted.
 */
const MAX_VARIANT_TOKENS = 4

/** A single bracketed variant token: lower-case alphanumerics, no separators. */
const VARIANT_TOKEN_RE = /^[a-z0-9]+$/

/** Length of a pinned snapshot-date segment (`20251001`). */
const DATE_SEGMENT_LENGTH = 8

/** A tail segment that is exactly a pinned snapshot date. */
const DATE_SEGMENT_RE = /^\d{8}$/

/**
 * `claude-<family>-<major>[-<minor>][<tail>]`, applied to the trimmed,
 * lower-cased base after variant groups are split off.
 *
 * - The major is REQUIRED, so `claude-opus` / `claude-opus-x-y` stay unparseable.
 * - The minor is OPTIONAL, which is the #41 fix: `claude-opus-5` now parses.
 * - The tail tolerates unknown segments; an 8-digit one is the snapshot date.
 *
 * LINEAR BY CONSTRUCTION (design §11 / F19): the mandatory `-` delimiter is
 * excluded from the tail's `[a-z0-9]` class, so every input admits exactly one
 * segmentation and the group cannot backtrack exponentially. CWE-1333's
 * precondition never holds here. Do NOT add `-` to that class. The length cap in
 * {@link stripModelVariants} is defence-in-depth, not the ReDoS mitigation.
 */
const MODEL_ID_RE = /^claude-([a-z]+)-(\d+)(?:-(\d+))?((?:-[a-z0-9]+)*)$/

/** Frozen empty variant list, shared to avoid per-call allocation. */
const NO_VARIANTS: readonly string[] = Object.freeze([])

/** Decomposed Claude model id. Parsing primitives are public; POLICY DATA IS NOT. */
export interface ParsedModelId {
  /** Lower-cased family token (`opus`, `sonnet`, `haiku`, `fable`, `mythos`). */
  family: string
  /** Major generation. Always present — the grammar requires it. */
  major: number
  /** Minor generation; `0` when the id omits it (`claude-opus-5`). */
  minor: number
  /** True when the id carried no minor segment. Drives "Opus 5" vs "Opus 5.0". */
  minorOmitted: boolean
  /** Trailing 8-digit snapshot date, when the id pins one. */
  date?: string
  /** Lower-cased bracket tokens, in source order (at most {@link MAX_VARIANT_TOKENS}). */
  variants: readonly string[]
  /** `claude-<family>-<major>-<minor>[-<date>]` — the capability-lookup key. */
  canonicalId: string
}

/**
 * Split trailing `[…]` variant groups off an untrusted model id.
 *
 * SECURITY (design §11, F10): the length cap is the FIRST statement, before any
 * scanning. `arg` reaches here from a `<command-args>` block bounded only by the
 * 256 KB tail window, on the main-process event loop ~1x/1.25s per terminal.
 *
 * @param raw Untrusted model id, possibly with `[…]` groups appended.
 * @returns The trimmed, lower-cased base plus its variant tokens, or `null` when
 *   the input is over-long, malformed, or carries more than
 *   {@link MAX_VARIANT_TOKENS} groups. Never throws.
 */
export function stripModelVariants(
  raw: string
): { base: string; variants: readonly string[] } | null {
  if (typeof raw !== 'string' || raw.length > MAX_MODEL_ID_LENGTH) return null

  const value = raw.trim().toLowerCase()
  const firstBracket = value.indexOf('[')
  if (firstBracket === -1) return { base: value, variants: NO_VARIANTS }

  // Trim again after the split: `claude-opus-5\t[1m]` must yield the base
  // `claude-opus-5`, never a control character reaching the snapshot (F21).
  const base = value.slice(0, firstBracket).trim()

  const variants: string[] = []
  for (let i = firstBracket; i < value.length; ) {
    if (value[i] !== '[') return null
    const end = value.indexOf(']', i + 1)
    if (end === -1) return null
    const token = value.slice(i + 1, end)
    if (!VARIANT_TOKEN_RE.test(token)) return null
    if (variants.length >= MAX_VARIANT_TOKENS) return null
    variants.push(token)
    i = end + 1
  }

  return { base, variants }
}

/**
 * Decompose an untrusted model id.
 *
 * @param raw Untrusted model id (may carry `[…]` variants, surrounding
 *   whitespace, and any casing).
 * @returns The decomposed id, or `null` when it does not match the grammar
 *   (bare aliases, foreign vendors, `claude-mythos-preview`, junk). Never throws.
 */
export function parseModelId(raw: string): ParsedModelId | null {
  const stripped = stripModelVariants(raw)
  return stripped === null ? null : parseStrippedId(stripped.base, stripped.variants)
}

/** Decompose an already-stripped base; shared by the public entry points. */
function parseStrippedId(base: string, variants: readonly string[]): ParsedModelId | null {
  const match = MODEL_ID_RE.exec(base)
  if (match === null) return null

  const [, family, majorText, minorText, tail] = match
  const major = Number.parseInt(majorText, 10)
  if (!Number.isSafeInteger(major)) return null

  const segments = tail === '' ? [] : tail.slice(1).split('-')
  const last = segments[segments.length - 1]
  let date = last !== undefined && DATE_SEGMENT_RE.test(last) ? last : undefined

  let minor = 0
  let minorOmitted = true
  if (minorText !== undefined) {
    // A bare 8-digit segment straight after the major is a pinned snapshot date,
    // not a minor: `claude-opus-5-20260101` is dated Opus 5, not Opus 5.20260101.
    if (date === undefined && minorText.length === DATE_SEGMENT_LENGTH) {
      date = minorText
    } else {
      const parsedMinor = Number.parseInt(minorText, 10)
      if (!Number.isSafeInteger(parsedMinor)) return null
      minor = parsedMinor
      minorOmitted = false
    }
  }

  return {
    family,
    major,
    minor,
    minorOmitted,
    ...(date === undefined ? {} : { date }),
    variants,
    canonicalId: `${undatedKey(family, major, minor)}${date === undefined ? '' : `-${date}`}`
  }
}

/** `claude-<family>-<major>-<minor>` — the date-free identity of a model. */
function undatedKey(family: string, major: number, minor: number): string {
  return `claude-${family}-${major}-${minor}`
}

/**
 * Stable per-model key for STICKY window state. Deliberately DROPS the snapshot
 * date (design decision (b)) so `claude-haiku-4-5` and its dated form are ONE
 * model for latching, while {@link ParsedModelId.canonicalId} RETAINS it for
 * capability lookup. NOT named `canonical*`: both normalisations were once
 * called that, giving two answers to "what is the canonical form?" one name.
 * Total — an unparseable id keys on its own normalised text.
 */
export function stickyModelKey(raw: string): string {
  const stripped = stripModelVariants(raw)
  // Truncate BEFORE normalising: `stripModelVariants` returned null precisely
  // because the input was over-long, and the caller retains this key for the life
  // of the terminal. Every parseable id is already within the bound, so comparison
  // semantics are unchanged.
  if (stripped === null) {
    return typeof raw === 'string' ? raw.slice(0, MAX_MODEL_ID_LENGTH).trim().toLowerCase() : ''
  }
  const parsed = parseStrippedId(stripped.base, stripped.variants)
  return parsed === null ? stripped.base : undatedKey(parsed.family, parsed.major, parsed.minor)
}

/** True iff `token` is a bracket variant this parser understands (`1m`). */
export function isRecognisedVariant(token: string): boolean {
  return typeof token === 'string' && RECOGNISED_VARIANTS.has(token.trim().toLowerCase())
}

/** True iff `token` is the bracket variant that selects the extended window. */
export function isExtendedVariant(token: string): boolean {
  return typeof token === 'string' && token.trim().toLowerCase() === EXTENDED_VARIANT
}

/**
 * Resolve a BARE family alias (`opus`, `sonnet`) to its lower-cased family name.
 *
 * Claude Code occasionally persists an alias instead of a full id. An alias is
 * enough to render a label but NOT to size a window — we know the family, not
 * the generation — so {@link windowForModelId} still declines (design §6.3).
 *
 * @returns The family name, or `null` when `raw` is not a bare alias of a family
 *   this registry knows about.
 */
export function familyAlias(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_MODEL_ID_LENGTH) return null
  const value = raw.trim().toLowerCase()
  return FAMILY_HEURISTICS.has(value) ? value : null
}

/**
 * Exact-id capability map — the primary lookup, keyed on canonical id.
 *
 * Every value is VERIFIED against primary sources fetched on
 * {@link CAPABILITIES_VERIFIED_ON} (no page renders a publication stamp, so that
 * is a fetch date). Erfana meters the CLAUDE CODE layer, so where the API and CLI
 * docs disagree the CLI value governs — hence Opus 4.6 and Sonnet 4.6 at 200000
 * despite the API listing them at 1M. Keys are written in their published form
 * and canonicalised on load, so `claude-opus-5` and `claude-opus-5-0` agree.
 */
const EXACT_WINDOWS: Readonly<Record<string, Window>> = {
  /** @see https://platform.claude.com/docs/en/about-claude/models/overview — legacy table, 200k. */
  'claude-opus-4-5': STANDARD,
  /**
   * PLAN-CONDITIONAL DEFAULT, not a model property: Max/Team/Enterprise
   * auto-upgrade Opus to 1M, and the API layer lists 4.6 at 1M. The metered CLI
   * default is 200K, and an entitled session self-corrects once usage exceeds
   * the standard window.
   * @see https://code.claude.com/docs/en/context-window — "Sonnet 4.6 and Opus 4.6 without extended context compact at the 200K boundary"
   * @see https://code.claude.com/docs/en/model-config — "Opus 4.7 and later always run with the 1M window" (4.6 excluded)
   */
  'claude-opus-4-6': STANDARD,
  /** @see https://code.claude.com/docs/en/model-config — "Opus 4.7 and later always run with the 1M window". */
  'claude-opus-4-7': EXTENDED,
  /** @see https://platform.claude.com/docs/en/about-claude/models/overview — legacy table, 1M; covered by "Opus 4.7 and later". */
  'claude-opus-4-8': EXTENDED,
  /**
   * The #41 acceptance case.
   * @see https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5 — "1M tokens is both the default and the maximum"
   */
  'claude-opus-5': EXTENDED,
  /** @see https://platform.claude.com/docs/en/build-with-claude/context-windows — "Claude Sonnet 4.5 … 200k-token context window". */
  'claude-sonnet-4-5': STANDARD,
  /**
   * 1M at the API layer, but NOT on the metered CLI layer: it is excluded from
   * the automatic upgrade and needs usage credits on every plan, including Max.
   * @see https://code.claude.com/docs/en/context-window — "Sonnet 4.6 and Opus 4.6 without extended context compact at the 200K boundary"
   * @see https://code.claude.com/docs/en/model-config — "not part of the automatic upgrade and requires usage credits on every subscription plan"
   */
  'claude-sonnet-4-6': STANDARD,
  /** @see https://code.claude.com/docs/en/model-config — "no 200K variant, no `[1m]` suffix to select, and no usage credits required on any plan". */
  'claude-sonnet-5': EXTENDED,
  /** @see https://platform.claude.com/docs/en/about-claude/models/overview — current comparison table, 200k. */
  'claude-haiku-4-5': STANDARD,
  /** @see https://platform.claude.com/docs/en/about-claude/models/overview — the API ID Haiku 4.5 ships under. */
  'claude-haiku-4-5-20251001': STANDARD,
  /** @see https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5 — "a 1M token context window by default". */
  'claude-fable-5': EXTENDED,
  /** @see https://platform.claude.com/docs/en/build-with-claude/context-windows — "claude-fable-5 and claude-mythos-5 also have a 1M-token context window". */
  'claude-mythos-5': EXTENDED
}

/**
 * Capability map for ids the grammar CANNOT decompose (no numeric generation);
 * checked before parsing, so these never fall through to the unknown path.
 *
 * A `Map`, not an object literal: the key is untrusted transcript text, and an
 * object literal answers `constructor` / `__proto__` / `toString` from
 * `Object.prototype` — returning a function where the signature promises
 * `200000 | 1000000 | null`, which TypeScript cannot catch here.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/context-windows — "Claude Mythos Preview also has a 1M-token context window"
 */
const UNDECOMPOSABLE_WINDOWS: ReadonlyMap<string, Window> = new Map([
  ['claude-mythos-preview', EXTENDED as Window]
])

/**
 * Every id the registry holds an entry for — the exact-id map's keys plus the
 * undecomposable map's. TEST-ONLY; frozen.
 *
 * IDS ONLY, never windows (design §9.4.2): **coverage may be derived from the
 * implementation; expectations may not.** A test may ask the code WHICH ids
 * exist, so a row added here without a design row and an oracle row fails the
 * build; it must never ask what a row's window should be, or the oracle stops
 * being able to detect an implementation bug. Typed rather than a regex over
 * this file: a regex that stops matching yields an empty set and a passing test.
 */
export const REGISTRY_IDS_FOR_TESTS: readonly string[] = Object.freeze([
  ...Object.keys(EXACT_WINDOWS),
  ...UNDECOMPOSABLE_WINDOWS.keys()
])

/**
 * HEURISTIC — extrapolation for UNKNOWN ids only, never published capability.
 * The class boundary sits INSIDE a major (`claude-opus-4-6` is 200k, `4-7` is
 * 1M), so no per-family scalar can express the lineup; this states in one place
 * how far we will guess. Derived from {@link EXACT_WINDOWS} at load, so the two
 * cannot drift.
 */
interface FamilyHeuristic {
  /** Newest major present in the exact map for this family. */
  newestKnownMajor: number
  /** Window of that family's newest known entry — what an unknown newer id inherits. */
  newestKnownWindow: Window
  /** Newest known minor (and its window) per major present in the exact map. */
  newestByMajor: ReadonlyMap<number, { minor: number; window: Window }>
}

/** Refuse to extrapolate more than this many majors past the newest known one. */
const MAX_MAJOR_LOOKAHEAD = 1

/**
 * Refuse to extrapolate more than this many MINORS past a known major's newest
 * entry — without it `claude-opus-4-99` would inherit 1M forever. The error is
 * ASYMMETRIC (§5.1): observation can only upgrade a window, so a wrong 1M
 * persists while a wrong 200k self-corrects once usage crosses 200k.
 */
const MAX_MINOR_LOOKAHEAD = 4

/**
 * {@link EXACT_WINDOWS} re-keyed on canonical id, so a published key written
 * without a minor (`claude-opus-5`) and the equivalent explicit form
 * (`claude-opus-5-0`) resolve to the same entry.
 */
function buildExactLookup(): ReadonlyMap<string, Window> {
  const lookup = new Map<string, Window>()
  for (const [id, window] of Object.entries(EXACT_WINDOWS)) {
    const parsed = parseModelId(id)
    if (parsed !== null) lookup.set(parsed.canonicalId, window)
  }
  return lookup
}

const EXACT_LOOKUP = buildExactLookup()

/** Mutable accumulator shape used only while building {@link FAMILY_HEURISTICS}. */
interface MutableFamilyHeuristic {
  newestKnownMajor: number
  newestKnownWindow: Window
  newestByMajor: Map<number, { minor: number; window: Window }>
}

/**
 * Build the per-family heuristic table from the exact map (single source of
 * truth). Accumulates into a mutable shape and widens to the readonly interface
 * on return, so no cast has to contradict the published type.
 */
function buildFamilyHeuristics(): ReadonlyMap<string, FamilyHeuristic> {
  const byFamily = new Map<string, MutableFamilyHeuristic>()

  for (const [id, window] of Object.entries(EXACT_WINDOWS)) {
    const parsed = parseModelId(id)
    if (parsed === null) continue

    let entry = byFamily.get(parsed.family)
    if (entry === undefined) {
      entry = {
        newestKnownMajor: parsed.major,
        newestKnownWindow: window,
        newestByMajor: new Map()
      }
      byFamily.set(parsed.family, entry)
    }

    // Compute what this major should hold, then write it — so the value is in
    // hand without a read-back, and without an `undefined` branch that can never
    // be taken standing in the code as if it were a real case.
    const inMajor = entry.newestByMajor.get(parsed.major)
    const newestInMajor =
      inMajor === undefined || parsed.minor >= inMajor.minor
        ? { minor: parsed.minor, window }
        : inMajor
    entry.newestByMajor.set(parsed.major, newestInMajor)
    if (parsed.major >= entry.newestKnownMajor) {
      entry.newestKnownMajor = parsed.major
      entry.newestKnownWindow = newestInMajor.window
    }
  }

  return byFamily
}

const FAMILY_HEURISTICS = buildFamilyHeuristics()

/**
 * Look the parsed id up in the exact map, dated canonical id first, then its
 * undated identity. Anthropic publishes against both a pinned snapshot and its
 * undated alias, and only verified snapshots get a row, so an unpinned dated id
 * still resolves through its alias.
 */
function exactWindowFor(parsed: ParsedModelId): Window | undefined {
  const dated = EXACT_LOOKUP.get(parsed.canonicalId)
  if (dated !== undefined) return dated
  return EXACT_LOOKUP.get(undatedKey(parsed.family, parsed.major, parsed.minor))
}

/**
 * Bounded extrapolation for an id the exact map does not list.
 *
 *  - Unknown point release of a KNOWN major, at or after that major's newest
 *    entry and within {@link MAX_MINOR_LOOKAHEAD} → inherit THAT MAJOR's window
 *    (`claude-opus-4-9` → 1M; `claude-opus-4-99` → no opinion).
 *  - Older unlisted id → no opinion; a legacy id is more likely 200k and "no
 *    opinion" already defaults safely.
 *  - UNKNOWN major within {@link MAX_MAJOR_LOOKAHEAD} → inherit the family's
 *    newest known window (`claude-opus-6`). This branch, and only this branch,
 *    consults the family-wide value; a known major is decided above.
 *  - Further out, or an unknown family → no opinion: two generations on the
 *    lineup may have restructured, and a table that extrapolates forever is how
 *    this bug's mirror image arises.
 */
function heuristicWindowFor(parsed: ParsedModelId): Window | null {
  const heuristic = FAMILY_HEURISTICS.get(parsed.family)
  if (heuristic === undefined) return null

  const inMajor = heuristic.newestByMajor.get(parsed.major)
  if (inMajor !== undefined) {
    const withinRange =
      parsed.minor >= inMajor.minor && parsed.minor <= inMajor.minor + MAX_MINOR_LOOKAHEAD
    return withinRange ? inMajor.window : null
  }

  const isWithinLookahead =
    parsed.major > heuristic.newestKnownMajor &&
    parsed.major <= heuristic.newestKnownMajor + MAX_MAJOR_LOOKAHEAD
  return isWithinLookahead ? heuristic.newestKnownWindow : null
}

/**
 * THE single window-policy entry point (design §8, rules R1a–R1g). Resolution
 * order: length/shape guard → undecomposable-id map → grammar → recognised `1m`
 * variant → exact-id map → bounded family heuristic.
 *
 * @param raw Untrusted model id from a transcript or a `/model` selection.
 * @returns The window this id implies, or `null` for "no opinion" — the caller
 *   then falls through to observed signals (usage above the standard window, a
 *   settings.json `[1m]`) and finally to the safe 200k default. Never throws.
 */
export function windowForModelId(raw: string): 200000 | 1000000 | null {
  const stripped = stripModelVariants(raw)
  if (stripped === null || stripped.base === '') return null

  const undecomposable = UNDECOMPOSABLE_WINDOWS.get(stripped.base)
  if (undecomposable !== undefined) return undecomposable

  const parsed = parseStrippedId(stripped.base, stripped.variants)
  if (parsed === null) return null

  if (parsed.variants.includes(EXTENDED_VARIANT)) return EXTENDED

  return exactWindowFor(parsed) ?? heuristicWindowFor(parsed)
}
