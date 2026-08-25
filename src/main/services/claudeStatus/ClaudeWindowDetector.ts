// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Detect the Claude Code context-window size (200k vs 1M) for the active
 * session via the shared model-capability registry plus read-only signals.
 *
 * Shares one parse with the label renderer, so for ids the shared grammar
 * ACCEPTS the badge and the label cannot disagree. Ids the grammar refuses
 * (over-length, `claude-mythos-preview`, bare aliases) still resolve their label
 * and their window by separate routes.
 *
 * The transcript does NOT record the window size (§2). The only authoritative
 * signal (`context_window_size`) lives in Claude Code's statusLine stdin payload,
 * which would require WRITING the user's config — the explicitly rejected
 * approach. So we resolve read-only signals, cheap-first (#41 §8):
 *
 *  R2.    `usedTokens > 200_000` → 1M. FIRST, because it is not a policy claim
 *         but a physical fact: a 200k window cannot hold 250k tokens. Every rule
 *         below expresses what a plan or a user CONFIGURED; this one reports what
 *         the session has already DONE, so it outranks all of them. Ordering it
 *         lower let an explicit standard selection pin the meter at
 *         "250k / 200k" — 100%, red, and stuck for the session. That is the #41
 *         failure class re-entered by another door.
 *  R0.    A fresh `/model …[1m]` override (`forceExtended`) → 1M.
 *  R0'.   An explicit standard-mode `/model <id>` (`opts.forceStandard`) → 200k.
 *  R1m.   The model id itself carries a recognised `1m` variant → 1M. Explicit
 *         CONFIGURATION, so corroborated like R3, not inferred like R1.
 *  R1.    The shared capability registry ({@link windowForModelId}) says 1M → 1M.
 *  R3.    `~/.claude/settings.json` `model` carries `[1m]` → 1M.
 *  R4.    Otherwise the standard 200k.
 *
 * A registry answer of 200k is the DEFAULT, not a veto: it is a provisional,
 * plan-conditional value (#41 §5.3), so the observed signals R2/R3 must still be
 * able to upgrade it. Only observed signals can corroborate a 1M verdict — see
 * {@link windowIsCorroborated}.
 *
 * Reading settings.json is a READ (allowed); it is NEVER written. PERF (§10):
 * R2 through R1 are pure in-memory predicates, so the file is only touched when
 * the registry does not already say 1M AND usage ≤ 200k.
 *
 * There is deliberately NO deployment-environment rule. One existed briefly and
 * was removed: three of its four signals were unreachable (`cleanEnvironment`
 * strips `CLAUDE_CODE_*` from the spawn env), the survivor `ANTHROPIC_BASE_URL`
 * is a ROUTING fact rather than a capacity one (gateways routinely serve 1M),
 * and it outranked R0/R0'/R1m/R3 — so a bare base-URL defeated the user's own
 * explicit `[1m]`, contradicting the principle that an explicit configuration is
 * not a guess. A narrowed, settings-based replacement is tracked separately.
 *
 * Defensive (§8/§10): settings.json is read size-bounded; `JSON.parse` runs
 * inside try/catch ONLY (never `require`/eval); read/parse failure or a missing
 * `model` is treated as "no `[1m]` signal" and falls through. Never throws.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §5, §8
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isExtendedVariant, parseModelId, windowForModelId } from './modelId'

/**
 * Standard context window (tokens). Window constants reflect Claude Code
 * behaviour observed 2026-06; revisit if the model lineup's window sizes change.
 */
export const STANDARD_WINDOW = 200000 as const

/** Extended ("[1m]") context window (tokens). Observed Claude Code 2026-06. */
export const EXTENDED_WINDOW = 1000000 as const

/**
 * Token count above which the window must be the extended one (a 200k window
 * cannot hold more than 200k of context). Observed Claude Code 2026-06.
 */
export const EXTENDED_THRESHOLD = 200000

/** Substring that marks a 1M model variant in the settings `model` value. */
const EXTENDED_MODEL_MARKER = '[1m]'

/** Max bytes read from settings.json; larger files are ignored (size cap). */
const MAX_SETTINGS_BYTES = 1024 * 1024

/**
 * Short TTL (ms) for the parsed settings `[1m]` signal. `detectWindowSize` runs
 * on every status refresh (~1×/1.25s per running terminal); re-reading and
 * re-parsing settings.json that often is wasteful when the value rarely
 * changes. A few seconds of staleness is harmless (the badge degrades
 * gracefully) and avoids a file read per refresh.
 */
const SETTINGS_TTL_MS = 5000

/** A cached `[1m]` signal with its expiry deadline (ms, on the injected clock). */
interface SettingsCacheEntry {
  value: boolean
  expiresAt: number
}

/**
 * Module-level cache of the settings `[1m]` signal keyed by the resolved
 * settings path (so a test-injected temp path and the real home path cache
 * independently).
 */
const settingsCache = new Map<string, SettingsCacheEntry>()

/** Clear the settings `[1m]` cache. Test-only. */
export function __resetSettingsCacheForTests(): void {
  settingsCache.clear()
}

/**
 * Return the cached `[1m]` signal for `settingsPath` if still within TTL, else
 * read+parse the file, cache the result, and return it.
 */
async function cachedSettingsSignalsExtended(
  settingsPath: string,
  now: () => number
): Promise<boolean> {
  const cached = settingsCache.get(settingsPath)
  if (cached !== undefined && now() < cached.expiresAt) {
    return cached.value
  }

  const value = await settingsSignalsExtended(settingsPath)
  settingsCache.set(settingsPath, { value, expiresAt: now() + SETTINGS_TTL_MS })
  return value
}

/**
 * Return true iff `~/.claude/settings.json` (or `settingsPath`) has a `model`
 * value containing the `[1m]` marker. Any read/parse failure, oversize file, or
 * missing/non-string `model` yields false (no signal).
 */
async function settingsSignalsExtended(settingsPath: string): Promise<boolean> {
  let raw: string
  try {
    const stat = await fs.stat(settingsPath)
    if (stat.size > MAX_SETTINGS_BYTES) return false
    raw = await fs.readFile(settingsPath, 'utf8')
  } catch {
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }

  if (typeof parsed !== 'object' || parsed === null) return false
  const model = (parsed as Record<string, unknown>).model
  if (typeof model !== 'string') return false

  return model.includes(EXTENDED_MODEL_MARKER)
}

/**
 * True iff a 1M verdict for this turn rests on an OBSERVED signal rather than
 * on the capability registry (#41 §5.3).
 *
 * Corroborated 1M may be latched for the session by the caller's sticky bit;
 * PROVISIONAL (registry-derived) 1M must be recomputed every refresh so an
 * explicit standard selection or a model switch takes effect immediately.
 *
 * Scope: IN-MEMORY signals only — R0 (`forceExtended`) and R2 (usage physically
 * above the standard window). A settings.json `[1m]` (R3) is corroborated too
 * but cannot be seen from here without I/O, so callers that care must OR this
 * with {@link WindowDetection.corroborated}.
 *
 * That used to cost nothing: the only consumer was the sticky bit, and R3 is
 * stable across refreshes so it never needed latching. It stopped being free
 * when the `(inferred)` TOOLTIP became a second consumer — a user who writes
 * `"model": "sonnet[1m]"` into their own settings.json would see their explicit
 * configuration labelled a guess. Hence `detectWindowDetail`.
 */
export function windowIsCorroborated(usedTokens: number, forceExtended = false): boolean {
  return forceExtended === true || usedTokens > EXTENDED_THRESHOLD
}

/**
 * Detect the context-window size for the active session. Rules apply in the
 * order R2, R0, R0', R1m, R1, R3, R4 — R2 first because it is a physical fact
 * rather than a policy claim. See the module doc for the full statement of each.
 *
 * PERF (§10): R2 through R1 are pure in-memory predicates; when any resolves we
 * return WITHOUT reading settings.json. The file is read only when the registry
 * does not already say 1M AND usage ≤ 200k AND no force hint — preserving the
 * PERF-2 goal of no file read on the common path while still catching an explicit
 * `sonnet[1m]` / `opus-4-5[1m]`.
 *
 * @param modelId The transcript's model id (e.g. `claude-opus-5`).
 * @param usedTokens Context tokens used by the latest main turn.
 * @param forceExtended Highest-priority in-memory hint that the 1M window is
 *   active (a fresh `/model …[1m]` override); short-circuits to 1M with no I/O.
 * @param opts.settingsPath Override the settings.json path (test injection).
 *   Defaults to `~/.claude/settings.json`.
 * @param opts.now Injected clock (defaults to `Date.now`) controlling the
 *   settings-cache TTL; test-only.
 * @param opts.forceStandard R0' — the user explicitly selected standard mode via
 *   `/model <id>` with no 1M marker, which outranks the registry. Rides in
 *   `opts` so the positional signature stays exactly as callers pin it.
 * @returns {@link EXTENDED_WINDOW} if a 1M signal holds; else
 *   {@link STANDARD_WINDOW}. Never throws.
 */
export async function detectWindowSize(
  modelId: string,
  usedTokens: number,
  forceExtended = false,
  opts?: WindowDetectionOpts
): Promise<200000 | 1000000> {
  return (await detectWindowDetail(modelId, usedTokens, forceExtended, opts)).windowSize
}

/** Options shared by {@link detectWindowSize} and {@link detectWindowDetail}. */
export interface WindowDetectionOpts {
  settingsPath?: string
  now?: () => number
  forceStandard?: boolean
}

/** Which rule in the §8 decision tree produced a window. Diagnostic only. */
export type WindowRule = 'R2' | 'R0' | 'R0prime' | 'R1m' | 'R1' | 'R3' | 'R4'

/** A window verdict together with how it was reached. */
export interface WindowDetection {
  windowSize: 200000 | 1000000
  /**
   * True iff a 1M verdict rests on an OBSERVED or EXPLICIT signal — R2 (usage),
   * R0 (`/model …[1m]`), R1m (a `1m` variant on the id) or R3 (settings.json) —
   * rather than on the capability registry. Unlike {@link windowIsCorroborated}
   * this CAN see the settings.json `[1m]`, because it is produced by the same
   * pass that reads the file.
   */
  corroborated: boolean
  /** The rule that decided, so a mis-sized meter is diagnosable from a log line. */
  rule: WindowRule
}

/**
 * {@link detectWindowSize} plus the provenance of its answer. The size-only form
 * is the wrapper; this is where the rules actually live.
 */
export async function detectWindowDetail(
  modelId: string,
  usedTokens: number,
  forceExtended = false,
  opts?: WindowDetectionOpts
): Promise<WindowDetection> {
  // R2 FIRST: a PHYSICAL FACT, not a policy claim — a 200k window cannot hold
  // more than 200k tokens, so this usage can only have happened under the 1M
  // window. It therefore outranks every rule below, all of which describe what
  // was configured or selected rather than what actually happened. Reporting
  // 200k here would render "250k / 200k" at a pinned 100% red for the session.
  if (usedTokens > EXTENDED_THRESHOLD) {
    return { windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R2' }
  }

  // R0: a fresh `/model …[1m]` override forces the 1M window instantly, before
  // any registry check or settings.json read.
  if (forceExtended) {
    return { windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R0' }
  }

  // R0': the mirror image — an explicit standard-mode selection outranks a
  // registry that would otherwise report 1M for this model.
  if (opts?.forceStandard) {
    return { windowSize: STANDARD_WINDOW, corroborated: false, rule: 'R0prime' }
  }

  // R1m: the id itself carries a recognised `1m` variant. Checked BEFORE R1
  // because `windowForModelId` collapses "the id says 1M" and "the registry says
  // 1M" into one value, and only the first is an explicit CONFIGURATION. The
  // governing principle is that an explicit configuration is not a guess, so this
  // is corroborated exactly like the settings.json `[1m]` at R3 — it must not be
  // labelled `(inferred)` and it must latch. Unreachable in the observed corpus
  // (§2.2 found zero `message.model` values carrying `[1m]`); the `/model …[1m]`
  // path is R0. Kept correct rather than merely untested.
  if (parseModelId(modelId)?.variants.some(isExtendedVariant) === true) {
    return { windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R1m' }
  }

  // R1, a cheap in-memory predicate: a registry-1M model short-circuits WITHOUT
  // touching the filesystem (PERF-2 common path). A registry answer of 200k is
  // the provisional default and deliberately does NOT short-circuit, so R3 can
  // still upgrade it (#41 §5.3).
  if (windowForModelId(modelId) === EXTENDED_WINDOW) {
    return { windowSize: EXTENDED_WINDOW, corroborated: false, rule: 'R1' }
  }

  const settingsPath = opts?.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json')
  const now = opts?.now ?? Date.now

  if (await cachedSettingsSignalsExtended(settingsPath, now)) {
    // Explicit user configuration, so this is corroborated — NOT an inference.
    return { windowSize: EXTENDED_WINDOW, corroborated: true, rule: 'R3' }
  }

  return { windowSize: STANDARD_WINDOW, corroborated: false, rule: 'R4' }
}
