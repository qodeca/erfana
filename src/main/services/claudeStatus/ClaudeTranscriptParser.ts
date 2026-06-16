// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Parse a Claude Code transcript JSONL file to extract the latest MAIN-session
 * assistant turn's model id and context-used token count.
 *
 * Transcript format (verified empirically against live macOS files, §2/§10):
 *  - `~/.claude/projects/<ENC>/<sessionUuid>.jsonl`, one JSON object per line,
 *    each with a `type`.
 *  - The latest MAIN-session assistant turn is the last line where
 *    `type === "assistant"` AND `isSidechain === false` (top-level field),
 *    whose `message.model` is a non-empty string and not `"<synthetic>"`.
 *  - Token usage: `message.usage.{input_tokens, cache_creation_input_tokens,
 *    cache_read_input_tokens, output_tokens (read but excluded from usedTokens)}`.
 *    Context used = `input_tokens + cache_creation_input_tokens +
 *    cache_read_input_tokens` (output_tokens EXCLUDED).
 *
 * Defensive contract (§8/§10): ALL parsed values are untrusted data; this
 * function NEVER throws to the caller — every failure path returns `null`.
 * Live sessions may have a partial/truncated final line, so each line is parsed
 * under its own try/catch and unparseable lines are ignored.
 *
 * Performance (§10): large files are NOT read whole. When the file exceeds the
 * read window ({@link TAIL_THRESHOLD_BYTES}, overridable via `opts.maxBytes`)
 * only the final window of bytes is read from an offset, dropping a partial
 * leading line. The latest turn is found by scanning lines BACKWARD, so the tail
 * window reliably contains it.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 */
import { promises as fs } from 'node:fs'
import { logger } from '../LoggingService'

/** Latest main-session assistant turn extracted from a transcript. */
export interface ParsedTurn {
  /** Raw Claude model id (e.g. `claude-opus-4-8`). Untrusted; never sanitized here. */
  modelId: string
  /** Context tokens used = input + cache_creation + cache_read (output excluded). */
  usedTokens: number
  /**
   * True iff a compaction summary is NEWER than this assistant turn — i.e. the
   * session just compacted and no post-compaction assistant turn has been written
   * yet. `usedTokens` is then the PRE-compaction value and the caller MUST treat
   * it as reset (~0); `modelId` is carried from that turn so the bar still shows
   * the model + window.
   */
  justCompacted?: boolean
  /**
   * True iff the displayed model came from a `/model …[1m]` override whose arg
   * carried the 1M-context marker — a hint to force the 1M window instantly,
   * before the next assistant turn or a settings.json read. Absent/false
   * otherwise.
   */
  modelForcedExtended?: boolean
  /**
   * True iff an in-window `/model` override was applied WITHOUT the `[1m]` marker
   * — i.e. the user explicitly selected standard (200k) mode for this model. Lets
   * the caller drop any sticky 1M state authoritatively (vs. "no override seen",
   * where neither flag is set). Mutually exclusive with {@link modelForcedExtended}.
   */
  modelForcedStandard?: boolean
}

/** Sentinel model value Claude writes for synthetic/system turns — never a real model. */
const SYNTHETIC_MODEL = '<synthetic>'

/**
 * Default read window (bytes). When a transcript exceeds this size only the
 * final {@link TAIL_THRESHOLD_BYTES} are read (the tail), instead of the whole
 * file. 256 KB comfortably holds the most recent turns of an active session
 * while bounding read cost on long-running transcripts. Overridable per call via
 * `opts.maxBytes`.
 */
const TAIL_THRESHOLD_BYTES = 256 * 1024

/**
 * Largest plausible token count. Real context windows top out at 1M; a value far
 * above that is malformed/adversarial and is rejected rather than displayed.
 */
const MAX_PLAUSIBLE_TOKENS = 100_000_000

/**
 * Coerce an untrusted usage field to a non-negative integer count within a sane
 * ceiling. Missing/undefined is treated as 0. Returns `null` for anything that is
 * not a non-negative integer ≤ {@link MAX_PLAUSIBLE_TOKENS} — floats, NaN/Infinity,
 * negatives, and absurd magnitudes are rejected (finding #9) so a malformed turn
 * is skipped, not silently miscounted.
 */
function coerceCount(value: unknown): number | null {
  if (value === undefined || value === null) return 0
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > MAX_PLAUSIBLE_TOKENS) return null
  return n
}

/**
 * Extract a {@link ParsedTurn} from one already-parsed JSON line, or `null` if
 * the line is not a usable main-session assistant turn.
 *
 * Requirements: `type === "assistant"`, top-level `isSidechain === false`, a
 * non-empty string `message.model` that is not `"<synthetic>"`, and at least one
 * present usage field (all present fields must coerce to finite non-negative
 * numbers).
 */
function turnFromRecord(record: unknown): ParsedTurn | null {
  if (typeof record !== 'object' || record === null) return null
  const rec = record as Record<string, unknown>

  if (rec.type !== 'assistant') return null
  if (rec.isSidechain !== false) return null

  const message = rec.message
  if (typeof message !== 'object' || message === null) return null
  const msg = message as Record<string, unknown>

  const model = msg.model
  if (typeof model !== 'string' || model.length === 0 || model === SYNTHETIC_MODEL) {
    return null
  }

  const usage = msg.usage
  if (typeof usage !== 'object' || usage === null) return null
  const use = usage as Record<string, unknown>

  // Require at least one usage field to be present; otherwise this is not a
  // real token-bearing turn (e.g. a stub assistant record).
  const hasAnyUsageField =
    'input_tokens' in use ||
    'cache_creation_input_tokens' in use ||
    'cache_read_input_tokens' in use

  if (!hasAnyUsageField) return null

  const input = coerceCount(use.input_tokens)
  const cacheCreation = coerceCount(use.cache_creation_input_tokens)
  const cacheRead = coerceCount(use.cache_read_input_tokens)
  if (input === null || cacheCreation === null || cacheRead === null) return null

  // Context used EXCLUDES output_tokens by design (matches Claude's used_percentage).
  const usedTokens = input + cacheCreation + cacheRead

  return { modelId: model, usedTokens }
}

/** True when a record is a Claude Code compaction-summary boundary marker. */
function isCompactionMarker(record: unknown): boolean {
  if (typeof record !== 'object' || record === null) return false
  return (record as Record<string, unknown>).isCompactSummary === true
}

/** Full `claude-<family>-<maj>-<min>[-<8-digit-date>]` id (rejects typed aliases). */
const MODEL_OVERRIDE_ID_RE = /^claude-[a-z]+-\d+-\d+(-\d{8})?$/i

/**
 * If `record` is a `/model` slash-command entry, return the selected model id
 * (and whether it carried the `[1m]` 1M-window marker), else undefined. Only a
 * full `claude-<family>-<maj>-<min>[-<8-digit-date>]` id is accepted — a typed
 * alias (`opus`, `default`, empty) returns undefined so the caller falls back to
 * the assistant turn's model. Untrusted data: parsed defensively, never executed.
 */
function modelOverrideFromRecord(
  record: unknown
): { modelId: string; forceExtended: boolean } | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const rec = record as Record<string, unknown>
  if (rec.type !== 'user') return undefined
  const message = rec.message
  if (typeof message !== 'object' || message === null) return undefined
  const rawContent = (message as Record<string, unknown>).content
  // content may be a string (slash-command case) or an array of text blocks.
  let content = ''
  if (typeof rawContent === 'string') content = rawContent
  else if (Array.isArray(rawContent)) {
    content = rawContent
      .map((b) =>
        b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string'
          ? ((b as Record<string, unknown>).text as string)
          : ''
      )
      .join(' ')
  }
  if (!content.includes('<command-name>/model</command-name>')) return undefined
  const m = content.match(/<command-args>([\s\S]*?)<\/command-args>/)
  if (!m) return undefined
  let arg = m[1].trim()
  if (arg === '') return undefined
  let forceExtended = false
  if (arg.toLowerCase().endsWith('[1m]')) {
    forceExtended = true
    arg = arg.slice(0, -4).trim()
  }
  // Accept only a full claude-* model id (reject aliases like `opus`, `default`).
  if (!MODEL_OVERRIDE_ID_RE.test(arg)) return undefined
  return { modelId: arg, forceExtended }
}

/**
 * Read the relevant portion of the transcript as text, or `null` if unreadable.
 *
 * Small files are read whole. Files larger than {@link TAIL_THRESHOLD_BYTES} are
 * tail-read: only the final {@link TAIL_THRESHOLD_BYTES} are read from an offset
 * and a partial leading line (everything before the first newline in the window)
 * is dropped so we only parse complete lines.
 */
async function readRelevantText(
  filePath: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean } | null> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(filePath, 'r')
    const { size } = await handle.stat()

    if (size <= maxBytes) {
      const whole = await handle.readFile('utf8')
      return { text: whole, truncated: false }
    }

    const start = size - maxBytes
    // Buffer.alloc (zero-filled) rather than allocUnsafe: a 256 KB allocation per
    // refresh is not perf-sensitive given the caller's caches, and a zero-filled
    // buffer removes any risk of exposing stale heap if a future edit reads past
    // bytesRead.
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, start)
    const window = buffer.toString('utf8', 0, bytesRead)

    // Drop a partial leading line: the tail window almost certainly starts in
    // the middle of a line, so discard everything up to and including the first
    // newline. Whole-file reads (start === 0 branch above) never reach here.
    const firstNewline = window.indexOf('\n')
    const text = firstNewline === -1 ? '' : window.slice(firstNewline + 1)
    return { text, truncated: true }
  } catch {
    return null
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        /* ignore close failure — nothing actionable */
      }
    }
  }
}

/**
 * Parse a Claude Code transcript and return the latest main-session assistant
 * turn, or `null` if no usable turn exists / the file is unreadable / every line
 * is malformed.
 *
 * @param filePath Absolute path to a `<sessionUuid>.jsonl` transcript.
 * @param opts.maxBytes Override the tail/whole-read threshold (default 256 KB).
 * @returns The latest `{ modelId, usedTokens }` or `null`. Never throws.
 */
export async function parseTranscript(
  filePath: string,
  opts?: { maxBytes?: number }
): Promise<ParsedTurn | null> {
  const maxBytes = opts?.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : TAIL_THRESHOLD_BYTES

  const read = await readRelevantText(filePath, maxBytes)
  if (read === null) return null

  let turn = scanForLatestTurn(read.text)

  // Compaction-summary / oversized-line resilience (findings #4/#10): a large
  // compaction summary (the whole conversation condensed) or a single line bigger
  // than the tail window can push the relevant assistant turn OUT of the window,
  // so the tail scan finds nothing. When the read was truncated to a tail, retry
  // ONCE over the whole file before giving up. This both recovers a turn that was
  // merely evicted and keeps `justCompacted` honest — it now degrades only when
  // even the full file genuinely has no post-compaction turn. Without this, an
  // oversized tail silently hides the bar with no signal.
  if (turn === null && read.truncated) {
    logger.debug('ClaudeTranscriptParser: tail window yielded no turn; retrying full read', {
      filePath
    })
    const full = await readRelevantText(filePath, Number.MAX_SAFE_INTEGER)
    if (full !== null) turn = scanForLatestTurn(full.text)
  }

  return turn
}

/**
 * Scan transcript text BACKWARD for the most recent usable main assistant turn,
 * applying compaction-awareness and a pending `/model` override. Pure over the
 * provided text; returns null if no usable turn is present. A truncated trailing
 * line simply fails JSON.parse and is skipped, so the prior valid turn still wins.
 */
function scanForLatestTurn(text: string): ParsedTurn | null {
  const lines = text.split('\n')

  let sawCompactionAfterLastTurn = false
  let modelOverride: { modelId: string; forceExtended: boolean } | undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.length === 0) continue

    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    if (isCompactionMarker(record)) {
      sawCompactionAfterLastTurn = true
      continue
    }

    // Capture only an override NEWER than the latest assistant turn (encountered
    // before that turn in this backward scan) — a genuinely *pending* model
    // switch. An override older than the turn is superseded by the turn's own
    // model and ignored (finding #11; the scan returns at the first turn).
    if (modelOverride === undefined) {
      const ov = modelOverrideFromRecord(record)
      if (ov) {
        modelOverride = ov
        continue
      }
    }

    const turn = turnFromRecord(record)
    if (turn) {
      const base: ParsedTurn = sawCompactionAfterLastTurn
        ? { modelId: turn.modelId, usedTokens: turn.usedTokens, justCompacted: true }
        : { modelId: turn.modelId, usedTokens: turn.usedTokens }
      if (modelOverride) {
        base.modelId = modelOverride.modelId
        // An explicit `/model` override sets the mode authoritatively: `[1m]` →
        // extended, otherwise standard. The caller uses these to update/clear any
        // sticky window state on a mid-session model/mode switch.
        if (modelOverride.forceExtended) base.modelForcedExtended = true
        else base.modelForcedStandard = true
      }
      return base
    }
  }

  return null
}
