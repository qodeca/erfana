// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Detect the Claude Code context-window size (200k vs 1M) for the active
 * session via a model-capability registry plus read-only signals.
 *
 * The transcript does NOT record the window size (§2). The only authoritative
 * signal (`context_window_size`) lives in Claude Code's statusLine stdin payload,
 * which would require WRITING the user's config — the explicitly rejected
 * approach. So we use three read-only signals, resolved cheap-first:
 *
 *  1. A model-capability registry ({@link modelNativelySupportsExtended}):
 *     Claude Code AUTO-UPGRADES Opus 4.6+ to the 1M window on Max/Team/Enterprise
 *     with NO on-disk marker, so the model id alone implies 1M for those models.
 *  2. `usedTokens > 200_000` — impossible under a 200k window, so it implies 1M.
 *  3. The user's `~/.claude/settings.json` `model` value: a `[1m]` variant
 *     (string contains `"[1m]"`) implies the 1M window (catches an explicit
 *     `sonnet[1m]` / `opus-4-5[1m]` that the registry would otherwise miss).
 *
 * Any signal → 1M; otherwise the standard 200k. Reading settings.json is a READ
 * (allowed); it is NEVER written. PERF (§10): the cheap in-memory predicates
 * (registry + token threshold) are checked BEFORE the settings.json read, so the
 * file is only touched when the model is not a known-1M model AND usage ≤ 200k.
 *
 * Defensive (§8/§10): settings.json is read size-bounded; `JSON.parse` runs
 * inside try/catch ONLY (never `require`/eval); read/parse failure or a missing
 * `model` is treated as "no `[1m]` signal" and falls through to the token test.
 * This function NEVER throws.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
 * Minor version of the first Opus generation that Claude Code auto-upgrades to
 * the 1M window. Opus 4.6+ → auto-1M; Opus 4.5 and older → 200k.
 */
const OPUS_AUTO_EXTENDED_MAJOR = 4
const OPUS_AUTO_EXTENDED_MINOR = 6

/**
 * Explicit allowlist of non-Opus model ids that are natively 1M (research:
 * 1M-native, no on-disk marker). Stored lowercased for case-insensitive match.
 */
const EXTENDED_NATIVE_ALLOWLIST = new Set<string>(['claude-mythos-preview'])

/** Matches `claude-opus-<maj>-<min>` (with optional trailing `-<date>` etc.). */
const OPUS_VERSION_RE = /^claude-opus-(\d+)-(\d+)(?:-.*)?$/

/**
 * Return true iff `modelId` is a model whose 1M context window is granted
 * NATIVELY (no `[1m]` marker, no settings file) — i.e. Claude Code's automatic
 * Opus upgrade on Max/Team/Enterprise.
 *
 * Rule (verified June 2026 against code.claude.com/model-config and
 * platform.claude.com): the standard window is 200000 and the extended window is
 * 1000000. Claude Code AUTO-UPGRADES Opus to 1M with NO on-disk marker for
 * **Opus 4.6 and later** (claude-opus-4-6, 4-7, 4-8, and future 4-9 / 5-x).
 * Opus 4.5 / 4.1 / older stay 200k. Sonnet (incl. the 1M-CAPABLE sonnet-4-6,
 * which is NOT auto-granted) and all Haiku stay 200k unless an explicit `[1m]`
 * or observed usage > 200k forces 1M elsewhere.
 *
 * Defensive: the id is lowercased and trimmed; an unparseable / unrecognized id
 * returns false (safe 200k default).
 *
 * @param modelId The transcript's model id (e.g. `claude-opus-4-8`).
 * @returns true if the model is natively 1M; false otherwise (never throws).
 */
export function modelNativelySupportsExtended(modelId: string): boolean {
  const id = typeof modelId === 'string' ? modelId.trim().toLowerCase() : ''
  if (id === '') return false

  if (EXTENDED_NATIVE_ALLOWLIST.has(id)) return true

  const match = OPUS_VERSION_RE.exec(id)
  if (match === null) return false

  const major = Number.parseInt(match[1], 10)
  const minor = Number.parseInt(match[2], 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false

  return (
    major > OPUS_AUTO_EXTENDED_MAJOR ||
    (major === OPUS_AUTO_EXTENDED_MAJOR && minor >= OPUS_AUTO_EXTENDED_MINOR)
  )
}

/**
 * Detect the context-window size for the active session.
 *
 * Resolution order (cheap-first, see module doc):
 *  0. `forceExtended` hint (a fresh `/model …[1m]` override) → 1M (in-memory,
 *     no I/O). Highest priority so a `/model` switch reflects near-instantly.
 *  1. {@link modelNativelySupportsExtended}(modelId) → 1M (in-memory, no I/O).
 *  2. `usedTokens > EXTENDED_THRESHOLD` → 1M (in-memory, no I/O).
 *  3. settings.json `model` is a `[1m]` variant → 1M (file read).
 *  4. else → 200k.
 *
 * PERF (§10): steps 0–2 are pure in-memory predicates; when any holds we
 * return 1M WITHOUT reading settings.json. The file is read only when the model
 * is NOT a known-1M model AND usage ≤ 200k AND no force hint — preserving the
 * PERF-2 goal of no file read on the common path while still catching an explicit
 * `sonnet[1m]` / `opus-4-5[1m]`.
 *
 * @param modelId The transcript's model id (e.g. `claude-opus-4-8`).
 * @param usedTokens Context tokens used by the latest main turn.
 * @param forceExtended Highest-priority in-memory hint that the 1M window is
 *   active (a fresh `/model …[1m]` override); short-circuits to 1M with no I/O.
 * @param opts.settingsPath Override the settings.json path (test injection).
 *   Defaults to `~/.claude/settings.json`.
 * @param opts.now Injected clock (defaults to `Date.now`) controlling the
 *   settings-cache TTL; test-only.
 * @returns {@link EXTENDED_WINDOW} if any 1M signal holds; else
 *   {@link STANDARD_WINDOW}. Never throws.
 */
export async function detectWindowSize(
  modelId: string,
  usedTokens: number,
  forceExtended = false,
  opts?: { settingsPath?: string; now?: () => number }
): Promise<200000 | 1000000> {
  // Highest-priority in-memory signal: a fresh `/model …[1m]` override forces the
  // 1M window instantly, before any registry check or settings.json read.
  if (forceExtended) return EXTENDED_WINDOW

  // Cheap in-memory predicates first: a natively-1M model or a token count above
  // the standard window can only be the 1M window — short-circuit WITHOUT
  // touching the filesystem (PERF-2 common path).
  if (modelNativelySupportsExtended(modelId)) return EXTENDED_WINDOW
  if (usedTokens > EXTENDED_THRESHOLD) return EXTENDED_WINDOW

  const settingsPath = opts?.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json')
  const now = opts?.now ?? Date.now

  if (await cachedSettingsSignalsExtended(settingsPath, now)) return EXTENDED_WINDOW

  return STANDARD_WINDOW
}
