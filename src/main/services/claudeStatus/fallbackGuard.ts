// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File-version result cache for the transcript bounded-fallback read (SD-047, #47).
 *
 * Owns ONLY the caching concern extracted from {@link parseTranscript}: a
 * per-transcript record of the bounded-fallback RESULT, keyed by absolute
 * transcript filePath. The parser stays responsible for reading and scanning; this
 * module decides what is re-served vs. re-read so a recovered turn stays populated
 * with zero re-reads while the file is stable (the freeze #47 is gone), and a
 * transient read failure never permanently suppresses the bar.
 *
 * Contract summary (see the parser's fallback control flow for the call sites):
 *  - {@link getFallbackResult} — cache HIT re-serve for an exact file-version.
 *  - {@link recordFallbackProvisional} — insert a `provisional` placeholder to dedup
 *    concurrent reads before the bounded read's `await`.
 *  - {@link finalizeFallbackResult} — overwrite the placeholder with a completed
 *    scan result (a real turn OR a genuine no-turn `null`; both are cached), clearing
 *    the provisional flag.
 *  - {@link rollbackFallbackProvisional} — on read failure/throw, delete the
 *    placeholder ONLY if it is still provisional for this version, so neither a
 *    concurrent finalized result nor a finalized no-turn negative is ever clobbered.
 *
 * @see docs/designs/47-context-meter-freeze.md §3.2, §4
 */
// Type-only import — erased at compile time, so no runtime cycle with the parser
// (the parser imports this module's functions at runtime; this module imports only
// the ParsedTurn type from it).
import type { ParsedTurn } from './ClaudeTranscriptParser'

/**
 * Max distinct transcript files tracked by the guard. Transcripts rotate over a
 * long session; without a cap the guard Map would grow unbounded. 256 mirrors the
 * process-detector cache cap (AbstractClaudeProcessDetector) and far exceeds any
 * realistic number of concurrently-live transcripts.
 */
export const MAX_FALLBACK_GUARD_ENTRIES = 256

/**
 * A cached bounded-fallback result: the file-version it was scanned for plus the
 * scanned turn (a real {@link ParsedTurn} recovered inside the bounded read, or
 * `null` for a genuine no-turn version), and a `provisional` flag.
 *
 * `provisional` distinguishes the placeholder inserted BEFORE the bounded read
 * (`turn: null, provisional: true`) from a FINALIZED no-turn negative
 * (`turn: null, provisional: false`). Both re-serve `null` on a HIT, but only a
 * still-provisional entry may be rolled back — a finalized negative is a real
 * result and {@link rollbackFallbackProvisional} must never delete it (else a
 * concurrent-re-miss + read-failure interleaving could force a redundant 2 MB
 * re-read, breaking the at-most-once invariant).
 */
export interface FallbackResult {
  version: string
  turn: ParsedTurn | null
  provisional: boolean
}

/**
 * Per-transcript cache of the bounded-fallback RESULT, keyed by absolute
 * transcript filePath. The cached turn is RE-SERVED on every later refresh of the
 * same version, so a recovered bar stays populated with zero re-reads. Only
 * COMPLETED reads are cached; a transient read failure is rolled back (see
 * {@link rollbackFallbackProvisional}), so one EMFILE/EBUSY cannot permanently hide
 * the bar. Bounded to {@link MAX_FALLBACK_GUARD_ENTRIES} (FIFO eviction). Reset for
 * tests via {@link __resetFallbackGuardForTests}.
 */
const fallbackGuard = new Map<string, FallbackResult>()

/** Record/overwrite the fallback result for `filePath`, evicting oldest at cap. */
function record(filePath: string, entry: FallbackResult): void {
  // Evict oldest-by-insertion (FIFO) only when adding a genuinely NEW filePath key.
  if (!fallbackGuard.has(filePath) && fallbackGuard.size >= MAX_FALLBACK_GUARD_ENTRIES) {
    const oldest = fallbackGuard.keys().next().value
    if (oldest !== undefined) fallbackGuard.delete(oldest)
  }
  fallbackGuard.set(filePath, entry)
}

/**
 * Cache HIT lookup: return the cached result for `filePath` when it was scanned for
 * this exact `version`, else `undefined` (a miss — the caller must do the read).
 */
export function getFallbackResult(filePath: string, version: string): FallbackResult | undefined {
  const cached = fallbackGuard.get(filePath)
  return cached !== undefined && cached.version === version ? cached : undefined
}

/**
 * Insert a PROVISIONAL entry (`turn: null, provisional: true`) for `version` to
 * dedup concurrent refreshes before the bounded read's `await`. Applies FIFO
 * eviction-at-cap when this is a genuinely new filePath key.
 */
export function recordFallbackProvisional(filePath: string, version: string): void {
  record(filePath, { version, turn: null, provisional: true })
}

/**
 * Finalise the cache for `version` with a completed scan `turn` (a real turn OR a
 * genuine no-turn `null`), overwriting the provisional entry in place and clearing
 * the provisional flag so a later rollback can no longer delete it.
 */
export function finalizeFallbackResult(
  filePath: string,
  version: string,
  turn: ParsedTurn | null
): void {
  record(filePath, { version, turn, provisional: false })
}

/**
 * Roll back the provisional entry for `version` after a failed/throwing read — but
 * ONLY if it is still provisional for this version, so neither a concurrent
 * completed read that finalised a real result NOR a finalized no-turn negative is
 * ever clobbered. The next refresh then retries instead of staying permanently
 * suppressed.
 */
export function rollbackFallbackProvisional(filePath: string, version: string): void {
  const current = fallbackGuard.get(filePath)
  if (current !== undefined && current.version === version && current.provisional) {
    fallbackGuard.delete(filePath)
  }
}

/** Clear the fallback-result cache. Test-only (mirrors __resetRootCacheForTests). */
export function __resetFallbackGuardForTests(): void {
  fallbackGuard.clear()
}

/** Current fallback-cache size. Test-only — asserts the eviction cap (AC6). */
export function __fallbackGuardSizeForTests(): number {
  return fallbackGuard.size
}
