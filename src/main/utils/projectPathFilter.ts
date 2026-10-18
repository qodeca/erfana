// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * projectPathFilter – one answer to "is this project path dropped?" for the
 * tree walk and both directory-watcher backends (issue #211, design D4/D14).
 *
 * Every test runs on the **project-relative**, `/`-separated path, never on
 * the absolute one: the old watcher ignore check was a substring test on the
 * absolute path, so a project that itself lived under a folder named `build`
 * or `out` was never watched. A watch on a subfolder takes its paths against
 * the same project root, so it applies the same list; a path outside the
 * project has no relative form and is dropped (fail closed).
 *
 * A dropped path is one that is excluded (`files.exclude`, see
 * `excludeMatcher`), hidden (a segment equal to a `tree.hiddenPatterns` name –
 * the tree's exact rule) or ignored (a `watcher.ignoreList` entry, by the
 * existing substring rule on `/` + the relative path). The project root itself
 * is never dropped.
 *
 * The filter also carries the inputs of the Windows watcher's split plan: the
 * path entries of the exclude list and the walk hints the last completed root
 * walk recorded. A new filter is built per project open, so hints and the
 * matcher's budget tripwire start fresh with each project.
 */
import path from 'path'
import { logger } from '../services/LoggingService'
import { isLexicallyInside } from './projectConfinement'
import { compileExcludeMatcher, type ExcludeMatcher } from './excludeMatcher'

/** Path-entry split paths handed to the Windows watcher's plan (design D1). */
export const MAX_SPLIT_PATHS = 64
/** Walk hints kept for the Windows watcher's plan (design D1). */
export const MAX_WALK_HINTS = 64
/** Deepest split path or walk hint, in segments (design D1). */
export const MAX_SPLIT_DEPTH = 16

export interface ProjectPathFilterOptions {
  /** `files.exclude`, merged and validated upstream; compiled again here. */
  readonly exclude?: readonly string[]
  /** `tree.hiddenPatterns`: names matched against every path segment. */
  readonly hiddenPatterns: readonly string[]
  /** `watcher.ignoreList`: matched as a substring of `/` + the relative path. */
  readonly ignorePatterns: readonly string[]
  /** `getPlatformConfig().caseSensitive`; applies to the exclude list only. */
  readonly caseSensitive: boolean
}

/**
 * The project-relative path of `absPath`, with `/` separators: `''` for the
 * root itself, `null` when the path is outside the project. Containment is
 * `isLexicallyInside`, so `C:\proj-x` is not inside `C:\proj`.
 */
export function toRootRelative(root: string, absPath: string): string | null {
  if (!isLexicallyInside(absPath, root)) return null
  const rel = path.relative(path.resolve(root), path.resolve(absPath))
  return path.sep === '/' ? rel : rel.split(path.sep).join('/')
}

export class ProjectPathFilter {
  /** The compiled exclude list; its `size` and `budgetExceeded` feed the log lines. */
  readonly excludeMatcher: ExcludeMatcher
  private readonly hiddenNames: ReadonlySet<string>
  private readonly ignoreNeedles: readonly string[]
  private readonly caseSensitive: boolean
  private walkHints: readonly string[] = []
  private hintsCapped = false

  /**
   * @param root - the project root, as the tree walk and the watcher spell it
   * @param options - the lists to apply and the platform's case sensitivity
   */
  constructor(
    readonly root: string,
    options: ProjectPathFilterOptions
  ) {
    this.caseSensitive = options.caseSensitive
    this.excludeMatcher = compileExcludeMatcher(options.exclude ?? [], {
      caseSensitive: options.caseSensitive,
      onPatternsDisabled: info =>
        logger.warn('Exclude patterns disabled: match budget exceeded', { ...info })
    })
    this.hiddenNames = new Set(options.hiddenPatterns)
    // An empty ignore pattern would match every path and silence the watcher.
    this.ignoreNeedles = options.ignorePatterns
      .filter(pattern => pattern !== '')
      .map(pattern => `/${pattern}`)
  }

  /** The path, or an ancestor, is in the exclude list. */
  readonly isExcluded = (rel: string): boolean => this.excludeMatcher.isExcluded(rel)

  /** The path itself is in the exclude list – for the tree walk. */
  readonly isEntryExcluded = (rel: string): boolean => this.excludeMatcher.isEntryExcluded(rel)

  /** Some segment of the path equals a hidden name (the tree's exact rule). */
  readonly isHidden = (rel: string): boolean => {
    if (rel === '' || this.hiddenNames.size === 0) return false
    return rel.split('/').some(segment => this.hiddenNames.has(segment))
  }

  /** `/` + the path contains `/` + an ignore pattern (the watcher's existing rule). */
  readonly isIgnored = (rel: string): boolean => {
    if (rel === '') return false
    const probe = `/${rel}`
    return this.ignoreNeedles.some(needle => probe.includes(needle))
  }

  /**
   * Whether an event or entry at this project-relative path is dropped.
   * `null` (outside the project) always is; `''` (the root) never is.
   */
  readonly shouldDrop = (rel: string | null): boolean => {
    if (rel === null) return true
    if (rel === '') return false
    return this.isExcluded(rel) || this.isHidden(rel) || this.isIgnored(rel)
  }

  /** The exclude list's path entries the plan may split around, capped. */
  splitPaths(): string[] {
    return capSplitList(this.excludeMatcher.pathEntries, MAX_SPLIT_PATHS, this.caseSensitive).list
  }

  /**
   * Replace the walk hints with the dropped folders the last completed root
   * walk met. Kept to {@link MAX_WALK_HINTS}, each at most
   * {@link MAX_SPLIT_DEPTH} segments deep, de-duplicated.
   */
  replaceWalkHints(hints: readonly string[]): void {
    const capped = capSplitList(hints, MAX_WALK_HINTS, this.caseSensitive)
    this.walkHints = Object.freeze(capped.list)
    this.hintsCapped = capped.capped
  }

  /** The current walk hints (a copy). */
  getWalkHints(): string[] {
    return [...this.walkHints]
  }

  /**
   * Whether the caps above left a path entry or a walk hint out of the plan
   * inputs – the watcher reports it as `planCapped`.
   */
  get splitInputsCapped(): boolean {
    return (
      this.hintsCapped ||
      capSplitList(this.excludeMatcher.pathEntries, MAX_SPLIT_PATHS, this.caseSensitive).capped
    )
  }
}

/**
 * Keep the first `max` distinct (folded when case-insensitive) non-root paths
 * no deeper than {@link MAX_SPLIT_DEPTH}; report whether anything was left out.
 */
function capSplitList(
  paths: readonly string[],
  max: number,
  caseSensitive: boolean
): { list: string[]; capped: boolean } {
  const list: string[] = []
  const seen = new Set<string>()
  let capped = false
  for (const candidate of paths) {
    if (candidate === '') continue
    const key = caseSensitive ? candidate : candidate.toLowerCase()
    if (seen.has(key)) continue
    if (list.length >= max || candidate.split('/').length > MAX_SPLIT_DEPTH) {
      capped = true
      continue
    }
    seen.add(key)
    list.push(candidate)
  }
  return { list, capped }
}
