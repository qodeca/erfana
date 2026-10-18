// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * excludeMatcher – the `files.exclude` list (issue #211, design D8/D9).
 *
 * An entry takes a project-relative path out of the tree and the watchers. A
 * **path entry** (no `*` or `?`) names one path and everything under it; a
 * **pattern entry** is matched segment by segment, where `*` is any run of
 * characters except `/`, `?` is one such character and a whole `**` segment is
 * zero or more segments. `[`, `{` and `!` are literal. Matching a path **or any
 * ancestor** excludes it; the tree walk, which never enters an excluded folder,
 * tests only the entry itself ({@link ExcludeMatcher.isEntryExcluded}).
 *
 * A cloned repository's `.erfana/settings.json` is untrusted input, so there is
 * no `RegExp` and no dependency: a segment DP over a two-pointer star matcher,
 * bounded twice. Every call has a budget of {@link EXCLUDE_MATCH_BUDGET}
 * character comparisons – past it the path counts as not excluded (fail open)
 * – and after {@link EXCLUDE_BUDGET_TRIPWIRE} overruns a matcher switches its
 * pattern entries off for good; path entries keep working.
 *
 * `.erfana` at the project root, and everything under it, is never excluded:
 * the file that explains what is hidden stays reachable.
 *
 * Pure: no filesystem, no logging, no platform read – case sensitivity is
 * passed in. `?` matches one UTF-16 code unit, so a character outside the
 * Basic Multilingual Plane needs `??` (or `*`).
 */

/** Entries read from one source; later ones are rejected. */
export const EXCLUDE_MAX_ENTRIES = 256
/** Characters read from one source; an entry ending past this is rejected. */
export const EXCLUDE_MAX_SOURCE_CHARS = 4096
/**
 * Sources merged into the list a matcher compiles: the global file, then the
 * project's (design D7). The compile caps are the per-source caps times this.
 */
export const EXCLUDE_SOURCE_COUNT = 2
/** Longest accepted entry, after normalisation. */
export const EXCLUDE_MAX_ENTRY_LENGTH = 256
/** Wildcards per entry: each `?`, and each run of `*` (a `**` segment is one). */
export const EXCLUDE_MAX_WILDCARDS = 8
/** Whole-segment `**` per entry. */
export const EXCLUDE_MAX_GLOBSTARS = 4
/** Character comparisons one `isExcluded` / `isEntryExcluded` call may spend. */
export const EXCLUDE_MATCH_BUDGET = 20_000
/** Budget overruns after which a matcher switches its pattern entries off. */
export const EXCLUDE_BUDGET_TRIPWIRE = 100

/** The folder that is never excluded (design D8). */
const PROTECTED_DIR = '.erfana'
const GLOBSTAR = '**'
const CURRENT_DIR_SEGMENT = '.'
const STAR = 0x2a // '*'
const QUESTION = 0x3f // '?'
const FORBIDDEN_CHARACTERS = new Set(['<', '>', ':', '"', '|'])
const LAST_CONTROL_CODE = 0x1f

/** Why an entry was rejected. Logged by index with this reason, never with its value. */
export type ExcludeRejectionReason =
  | 'blank'
  | 'drive-or-unc'
  | 'invalid-character'
  | 'parent-segment'
  | 'wildcards-only'
  | 'too-long'
  | 'too-many-wildcards'
  | 'too-many-globstars'
  | 'too-many-entries'
  | 'source-too-long'

export interface ExcludeRejection {
  /** Position in the source list, so the user can find the line. */
  readonly index: number
  readonly reason: ExcludeRejectionReason
}

export interface ExcludeValidation {
  /** Normalised entries, in source order. */
  readonly accepted: string[]
  readonly rejected: ExcludeRejection[]
}

/** What the tripwire reports when it switches pattern entries off – counts only. */
export interface PatternsDisabledInfo {
  readonly budgetExceeded: number
  readonly patternEntryCount: number
}

export interface ExcludeMatcherOptions {
  /** `getPlatformConfig().caseSensitive`: Linux `true`, Windows and macOS `false`. */
  readonly caseSensitive: boolean
  /** Called once, when the tripwire switches pattern entries off. */
  readonly onPatternsDisabled?: (info: PatternsDisabledInfo) => void
}

export interface ExcludeMatcher {
  /** Accepted, de-duplicated entries (path and pattern). */
  readonly size: number
  /**
   * The path entries as written (normalised, de-duplicated), in source order –
   * without any at or under `.erfana`, which can never match.
   */
  readonly pathEntries: readonly string[]
  /** The path, or any ancestor of it, is excluded. `''` (the root) never is. */
  readonly isExcluded: (rel: string) => boolean
  /** The path itself is excluded – for a walk that never enters an excluded folder. */
  readonly isEntryExcluded: (rel: string) => boolean
  /** Calls that ran out of budget and failed open. */
  readonly budgetExceeded: number
  /** The tripwire fired: pattern entries no longer match. */
  readonly patternsDisabled: boolean
}

/** Matches nothing and never counts anything. */
export const EMPTY_EXCLUDE_MATCHER: ExcludeMatcher = Object.freeze({
  size: 0,
  pathEntries: Object.freeze([]) as readonly string[],
  isExcluded: () => false,
  isEntryExcluded: () => false,
  budgetExceeded: 0,
  patternsDisabled: false
})

/**
 * Normalise one entry: trim, `\` → `/`, then drop every empty and every `.`
 * segment – repeated `/`, a leading `/` (root-anchored, as `.gitignore` users
 * write it), a trailing `/` and `./` anywhere – and a trailing `/**`. A `.`
 * segment never appears in a relative path the matcher is given, so an entry
 * that kept one would be accepted and never match. Drive and UNC paths are
 * rejected by {@link validateExcludeEntries}, which checks them before `//`
 * is lost here.
 */
export function normalizeExcludeEntry(raw: string): string {
  const segments = toSlashes(raw)
    .split('/')
    .filter(segment => segment !== '' && segment !== CURRENT_DIR_SEGMENT)
  while (segments.length > 1 && segments[segments.length - 1] === GLOBSTAR) segments.pop()
  return segments.join('/')
}

/** Entry and character caps for one validated list. */
interface ListCaps {
  readonly maxEntries: number
  readonly maxChars: number
}

const SOURCE_CAPS: ListCaps = {
  maxEntries: EXCLUDE_MAX_ENTRIES,
  maxChars: EXCLUDE_MAX_SOURCE_CHARS
}

/**
 * Caps for the merged list a matcher compiles. Normalisation never lengthens
 * an entry and the merge only de-duplicates, so a merge of lists that each
 * passed {@link SOURCE_CAPS} always fits: no accepted entry is dropped for
 * sitting past the 256th place, or the 4,096th character, of the merged list.
 */
const MERGED_CAPS: ListCaps = {
  maxEntries: EXCLUDE_MAX_ENTRIES * EXCLUDE_SOURCE_COUNT,
  maxChars: EXCLUDE_MAX_SOURCE_CHARS * EXCLUDE_SOURCE_COUNT
}

/**
 * Validate and normalise one source's list. Entry and character caps apply to
 * the source as a whole, so a huge entry is rejected before it is normalised.
 */
export function validateExcludeEntries(entries: readonly string[]): ExcludeValidation {
  return validateWithCaps(entries, SOURCE_CAPS)
}

function validateWithCaps(entries: readonly string[], caps: ListCaps): ExcludeValidation {
  const accepted: string[] = []
  const rejected: ExcludeRejection[] = []
  let sourceChars = 0
  entries.forEach((raw, index) => {
    const length = typeof raw === 'string' ? raw.length : 0
    sourceChars += length
    const result =
      index >= caps.maxEntries
        ? 'too-many-entries'
        : sourceChars > caps.maxChars
          ? 'source-too-long'
          : checkEntry(raw)
    if (typeof result === 'object') accepted.push(result.entry)
    else rejected.push({ index, reason: result })
  })
  return { accepted, rejected }
}

/** One entry: its normalised form, or why it is rejected. */
function checkEntry(raw: unknown): { entry: string } | ExcludeRejectionReason {
  if (typeof raw !== 'string') return 'blank'
  const slashed = toSlashes(raw)
  if (slashed === '') return 'blank'
  if (slashed.startsWith('//') || isDriveLetterPath(slashed)) return 'drive-or-unc'
  if (hasForbiddenCharacter(slashed)) return 'invalid-character'
  const entry = normalizeExcludeEntry(slashed)
  if (entry === '') return 'blank'
  if (entry.length > EXCLUDE_MAX_ENTRY_LENGTH) return 'too-long'
  const segments = entry.split('/')
  if (segments.includes('..')) return 'parent-segment'
  if (isWildcardsOnly(entry)) return 'wildcards-only'
  if (countWildcards(segments) > EXCLUDE_MAX_WILDCARDS) return 'too-many-wildcards'
  if (segments.filter(s => s === GLOBSTAR).length > EXCLUDE_MAX_GLOBSTARS) {
    return 'too-many-globstars'
  }
  return { entry }
}

/**
 * Compile a list into a matcher. It validates the list itself, so an entry
 * that was never validated cannot reach the matcher; rejected entries are
 * skipped here (the caller that reports them runs {@link validateExcludeEntries}
 * per source). The input is the merged list – global, then project – so the
 * entry and character caps here are the per-source caps times
 * {@link EXCLUDE_SOURCE_COUNT}; every other rule is the per-entry one.
 */
export function compileExcludeMatcher(
  entries: readonly string[],
  options: ExcludeMatcherOptions
): ExcludeMatcher {
  return new CompiledExcludeMatcher(validateWithCaps(entries, MERGED_CAPS).accepted, options)
}

/** A pattern entry, split into segments with runs of `*` collapsed. */
interface CompiledPattern {
  readonly segments: readonly string[]
  /** Per segment: no wildcard, so a plain string comparison decides it. */
  readonly literal: readonly boolean[]
  readonly hasGlobstar: boolean
}

/** Comparisons left in the current call; below zero means the budget ran out. */
interface Meter {
  remaining: number
}

class CompiledExcludeMatcher implements ExcludeMatcher {
  readonly pathEntries: readonly string[]
  private readonly pathKeys = new Set<string>()
  /** Longest path key: no ancestor longer than this can be one. */
  private maxPathKeyLength = 0
  private readonly patterns: CompiledPattern[] = []
  private overruns = 0
  private disabled = false

  constructor(
    accepted: readonly string[],
    private readonly options: ExcludeMatcherOptions
  ) {
    const pathEntries: string[] = []
    const patternKeys = new Set<string>()
    for (const entry of accepted) {
      const key = this.fold(entry)
      if (!isPatternEntry(entry)) {
        if (this.pathKeys.has(key)) continue
        this.pathKeys.add(key)
        this.maxPathKeyLength = Math.max(this.maxPathKeyLength, key.length)
        // Inert, so never offered to the watcher's split plan either.
        if (!isProtected(key)) pathEntries.push(entry)
      } else if (!patternKeys.has(key)) {
        patternKeys.add(key)
        this.patterns.push(compilePattern(key))
      }
    }
    this.pathEntries = Object.freeze(pathEntries)
  }

  get size(): number {
    return this.pathKeys.size + this.patterns.length
  }

  get budgetExceeded(): number {
    return this.overruns
  }

  get patternsDisabled(): boolean {
    return this.disabled
  }

  readonly isExcluded = (rel: string): boolean => this.test(rel, false)

  readonly isEntryExcluded = (rel: string): boolean => this.test(rel, true)

  private test(rel: string, entryOnly: boolean): boolean {
    if (rel === '') return false
    const key = this.fold(rel)
    if (isProtected(key)) return false
    if (entryOnly ? this.pathKeys.has(key) : this.hasPathEntryAncestor(key)) return true
    if (this.disabled || this.patterns.length === 0) return false
    return this.matchPatterns(key.split('/'), entryOnly)
  }

  /**
   * The path or an ancestor is a path entry. Only prefixes that end at a
   * segment boundary and are no longer than the longest entry are looked up.
   */
  private hasPathEntryAncestor(key: string): boolean {
    if (this.pathKeys.size === 0) return false
    let end = key.indexOf('/')
    while (end !== -1 && end <= this.maxPathKeyLength) {
      if (this.pathKeys.has(key.slice(0, end))) return true
      end = key.indexOf('/', end + 1)
    }
    return key.length <= this.maxPathKeyLength && this.pathKeys.has(key)
  }

  private matchPatterns(segments: readonly string[], entryOnly: boolean): boolean {
    const meter: Meter = { remaining: EXCLUDE_MATCH_BUDGET }
    for (const pattern of this.patterns) {
      if (matchPattern(pattern, segments, entryOnly, meter)) return true
      if (meter.remaining < 0) {
        this.recordOverrun()
        return false
      }
    }
    return false
  }

  private recordOverrun(): void {
    this.overruns++
    if (this.disabled || this.overruns < EXCLUDE_BUDGET_TRIPWIRE) return
    this.disabled = true
    this.options.onPatternsDisabled?.({
      budgetExceeded: this.overruns,
      patternEntryCount: this.patterns.length
    })
  }

  private fold(value: string): string {
    return this.options.caseSensitive ? value : value.toLowerCase()
  }
}

function compilePattern(entry: string): CompiledPattern {
  const segments = entry.split('/').map(s => (s === GLOBSTAR ? s : collapseStars(s)))
  return {
    segments,
    literal: segments.map(s => !isPatternEntry(s)),
    hasGlobstar: segments.includes(GLOBSTAR)
  }
}

/**
 * Whether the pattern matches the path (`entryOnly`) or any of its prefixes
 * that end at a segment boundary (the ancestor rule, in one pass).
 */
function matchPattern(
  pattern: CompiledPattern,
  path: readonly string[],
  entryOnly: boolean,
  meter: Meter
): boolean {
  if (pattern.hasGlobstar) return matchWithGlobstar(pattern, path, entryOnly, meter)
  const count = pattern.segments.length
  if (entryOnly ? path.length !== count : path.length < count) return false
  for (let i = 0; i < count; i++) {
    if (!matchSegment(pattern, i, path[i], meter)) return false
  }
  return true
}

/**
 * Segment DP: `reach[j]` = pattern segments before `j` matched the path
 * segments consumed so far. A `**` either consumes the segment and stays, or
 * (closure) is skipped. Every live state is charged, so the budget bounds the
 * DP itself and not only the character loop.
 */
function matchWithGlobstar(
  pattern: CompiledPattern,
  path: readonly string[],
  entryOnly: boolean,
  meter: Meter
): boolean {
  const { segments } = pattern
  let reach = new Uint8Array(segments.length + 1)
  reach[0] = 1
  closeOverGlobstars(segments, reach)
  for (let i = 0; i < path.length; i++) {
    const next = new Uint8Array(segments.length + 1)
    let alive = false
    for (let j = 0; j < segments.length; j++) {
      if (reach[j] === 0) continue
      if (--meter.remaining < 0) return false
      if (segments[j] === GLOBSTAR) {
        next[j] = 1
        alive = true
      } else if (matchSegment(pattern, j, path[i], meter)) {
        next[j + 1] = 1
        alive = true
      } else if (meter.remaining < 0) {
        return false
      }
    }
    if (!alive) return false
    closeOverGlobstars(segments, next)
    reach = next
    if (reach[segments.length] === 1 && (!entryOnly || i === path.length - 1)) return true
  }
  return false
}

function closeOverGlobstars(segments: readonly string[], reach: Uint8Array): void {
  for (let j = 0; j < segments.length; j++) {
    if (reach[j] === 1 && segments[j] === GLOBSTAR) reach[j + 1] = 1
  }
}

/**
 * One segment against one path segment: the two-pointer star matcher, which
 * backtracks only to the last `*`. Worst case is O(pattern × text), hence the
 * meter; returns `false` once the budget is spent.
 */
function matchSegment(
  pattern: CompiledPattern,
  index: number,
  text: string,
  meter: Meter
): boolean {
  const glob = pattern.segments[index]
  if (pattern.literal[index]) {
    meter.remaining--
    return meter.remaining >= 0 && glob === text
  }
  let p = 0
  let t = 0
  let starP = -1
  let starT = 0
  while (t < text.length) {
    if (--meter.remaining < 0) return false
    const code = p < glob.length ? glob.charCodeAt(p) : -1
    if (code === STAR) {
      starP = p++
      starT = t
    } else if (code === QUESTION || (code !== -1 && code === text.charCodeAt(t))) {
      p++
      t++
    } else if (starP !== -1) {
      p = starP + 1
      t = ++starT
    } else {
      return false
    }
  }
  while (p < glob.length && glob.charCodeAt(p) === STAR) p++
  return p === glob.length
}

function toSlashes(raw: string): string {
  return raw.trim().replaceAll('\\', '/')
}

function collapseStars(segment: string): string {
  let out = ''
  for (const char of segment) {
    if (char !== '*' || !out.endsWith('*')) out += char
  }
  return out
}

/** `.erfana` or a path under it, given a key folded like the matcher's. */
function isProtected(key: string): boolean {
  return key === PROTECTED_DIR || key.startsWith(`${PROTECTED_DIR}/`)
}

function isPatternEntry(entry: string): boolean {
  return entry.includes('*') || entry.includes('?')
}

function isDriveLetterPath(value: string): boolean {
  const first = value.charCodeAt(0) | 0x20 // ASCII lower case
  return value.length >= 2 && value[1] === ':' && first >= 0x61 && first <= 0x7a
}

function hasForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) <= LAST_CONTROL_CODE || FORBIDDEN_CHARACTERS.has(char)) return true
  }
  return false
}

function isWildcardsOnly(entry: string): boolean {
  for (const char of entry) {
    if (char !== '*' && char !== '?' && char !== '/') return false
  }
  return true
}

/** Each `?` counts one, each run of `*` counts one – so a `**` segment is one. */
function countWildcards(segments: readonly string[]): number {
  let count = 0
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i++) {
      const code = segment.charCodeAt(i)
      if (code === QUESTION || (code === STAR && segment.charCodeAt(i - 1) !== STAR)) count++
    }
  }
  return count
}
