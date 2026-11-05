// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Family heuristic — the window GUESS for a Claude model id the capability
 * registry does not list (#41 §7.2, amended by #383).
 *
 * PURE and data-free: the caller (`modelId.ts`) owns the verified capability
 * data, keeps it module-private, and passes the parsed rows in. This module only
 * states how far a guess reaches:
 *
 *  1. An id NEWER than its family's newest listed model inherits that model's
 *     window, however far ahead it is (#383): `claude-opus-6`, `claude-opus-5-10`
 *     and `claude-opus-9` all take Opus 5.5's window. Before #383 the guess
 *     stopped one major or four minors ahead, so every release past that bound
 *     showed 200k until the session crossed 200k — the bug #383 reported twice.
 *  2. An unlisted point release of an OLDER listed major, at or after that
 *     major's newest entry and within {@link MAX_MINOR_LOOKAHEAD}, takes THAT
 *     major's window: `claude-sonnet-4-7` is 200k even though Sonnet 5.5 is 1M,
 *     because the class boundary can sit inside a major (Opus 4.6 → 4.7).
 *  3. Anything else — an older unlisted id, or an unknown family — has no
 *     opinion, and the detector falls through to observed signals.
 *
 * Every answer is a guess, so callers must surface it as `(inferred)`.
 *
 * @see Issue #383 - context meter shows 200k for newer Claude models
 * @see docs/designs/context-meter/41-model-capability-registry.md §7.2
 */

/** A context-window size the registry may report. */
export type CapabilityWindow = 200000 | 1000000

/** The parts of a parsed model id the heuristic reads. */
export interface ModelGeneration {
  family: string
  major: number
  minor: number
}

/** A listed generation and its window. */
type ListedWindow = { major: number; minor: number; window: CapabilityWindow }

/** Per-family summary of the listed models, built once from the registry. */
export interface FamilyHeuristic {
  /** The family's newest listed model — what any newer id inherits. */
  newest: ListedWindow
  /** Newest listed minor (and its window) per listed major. */
  newestByMajor: ReadonlyMap<number, ListedWindow>
}

/**
 * How many minors past an OLDER major's newest entry a guess still reaches.
 * Without it `claude-opus-4-99` would inherit Opus 4.8's 1M forever. Does not
 * apply to the family's newest major, where rule 1 decides.
 */
export const MAX_MINOR_LOOKAHEAD = 4

/** True iff generation `a` is strictly newer than `b`. */
function isAfter(a: { major: number; minor: number }, b: { major: number; minor: number }): boolean {
  return a.major > b.major || (a.major === b.major && a.minor > b.minor)
}

/** Summarise listed models per family. Order-independent. */
export function buildFamilyHeuristics(
  listed: Iterable<[ModelGeneration, CapabilityWindow]>
): ReadonlyMap<string, FamilyHeuristic> {
  const byFamily = new Map<string, { newest: ListedWindow; newestByMajor: Map<number, ListedWindow> }>()
  for (const [{ family, major, minor }, window] of listed) {
    const row: ListedWindow = { major, minor, window }
    const entry = byFamily.get(family) ?? { newest: row, newestByMajor: new Map() }
    byFamily.set(family, entry)
    const inMajor = entry.newestByMajor.get(major)
    if (inMajor === undefined || minor >= inMajor.minor) entry.newestByMajor.set(major, row)
    if (isAfter(row, entry.newest)) entry.newest = row
  }
  return byFamily
}

/**
 * Guess the window for an id the registry does not list (rules in the module
 * doc). Never throws.
 *
 * @returns The guessed window, or `null` for no opinion.
 */
export function guessWindow(
  heuristics: ReadonlyMap<string, FamilyHeuristic>,
  id: ModelGeneration
): CapabilityWindow | null {
  const family = heuristics.get(id.family)
  if (family === undefined) return null

  if (isAfter(id, family.newest)) return family.newest.window

  const inMajor = family.newestByMajor.get(id.major)
  if (inMajor === undefined) return null
  const withinRange = id.minor >= inMajor.minor && id.minor <= inMajor.minor + MAX_MINOR_LOOKAHEAD
  return withinRange ? inMajor.window : null
}
