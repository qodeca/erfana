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
import { MAX_MODEL_ID_LENGTH } from '../../../shared/ipc/claude-status-schema'
import {
  isExtendedVariant,
  isRecognisedVariant,
  parseModelId,
  stripModelVariants
} from './modelId'
import {
  finalizeFallbackResult,
  getFallbackResult,
  recordFallbackProvisional,
  rollbackFallbackProvisional
} from './fallbackGuard'

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
export const TAIL_THRESHOLD_BYTES = 256 * 1024

/**
 * Upper bound (bytes) on the ONE-SHOT fallback read taken when the 256 KB tail
 * ({@link TAIL_THRESHOLD_BYTES}) yields no usable turn — the compaction-recovery
 * path (#4/#10). ~8× the tail: large enough to recover a turn evicted by a big
 * compaction summary, small enough that it bounds the fallback to a single
 * ~50 ms parse (a 2 MB no-turn scan is a frame drop, not a freeze), taken at most
 * once per file-version. The old {@link Number.MAX_SAFE_INTEGER} read pulled the
 * full ~18.8 MB file EVERY refresh, a sustained stall that froze the UI (#47).
 * Paired with the {@link ./fallbackGuard} cache, which stores the result so a
 * recovered turn is re-served with zero re-reads while the file is stable.
 */
export const FALLBACK_READ_MAX_BYTES = 2 * 1024 * 1024

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

/** Delimiters of the slash-command argument block inside a `user` record. */
const COMMAND_ARGS_OPEN = '<command-args>'
const COMMAND_ARGS_CLOSE = '</command-args>'

/**
 * Upper bound on the `content` we will search for a `<command-args>` block.
 *
 * A `/model` argument is discarded above {@link MAX_MODEL_ID_LENGTH} characters,
 * so a few KB of surrounding markup is already far more than any real command
 * needs. Transcripts record user messages VERBATIM, so `content` is attacker-
 * influenced at the size of whatever text an agent ingested and echoed back —
 * bounded only by the 256 KB tail window, and by nothing at all on the full-read
 * retry path. This gate keeps the scan proportional to a command, not a document.
 */
const MAX_COMMAND_CONTENT_LENGTH = 8 * 1024

/**
 * Extract the text between the first `<command-args>` / `</command-args>` pair,
 * or `null` when the block is absent, unterminated, or the content is too large
 * to be a command.
 *
 * SECURITY: deliberately `indexOf`, not a regex. The previous
 * `/<command-args>([\s\S]*?)<\/command-args>/` used a lazy quantifier, which
 * restarts a full forward scan at EVERY position where the opening literal
 * occurs — quadratic in `content`. Measured on the main-process event loop,
 * which this runs on ~1x/1.25s per terminal: 64 KB took 40 ms, 256 KB took
 * 630 ms and 1 MB took 10 s, i.e. a sustained stall that freezes the editor, the
 * project tree and every IPC handler. Two `indexOf` calls are linear and cannot
 * backtrack at all.
 */
function extractCommandArgs(content: string): string | null {
  if (content.length > MAX_COMMAND_CONTENT_LENGTH) return null

  const start = content.indexOf(COMMAND_ARGS_OPEN)
  if (start === -1) return null

  const from = start + COMMAND_ARGS_OPEN.length
  const end = content.indexOf(COMMAND_ARGS_CLOSE, from)
  if (end === -1) return null

  return content.slice(from, end).trim()
}

/**
 * If `record` is a `/model` slash-command entry, return the selected model id
 * (and whether it carried the `[1m]` 1M-window marker), else undefined.
 *
 * Only an id the SHARED grammar decomposes is accepted (#41) — a typed alias
 * (`opus`, `default`, empty) returns undefined so the caller falls back to the
 * assistant turn's model.
 *
 * An override carrying an UNRECOGNISED bracket variant is ignored entirely
 * (design decision (e)): `/model claude-opus-4-7[thinking]` must keep behaving
 * exactly as it does today, because honouring it would set `modelForcedStandard`
 * and clear the sticky 1M bit — a user-visible 1M→200k downgrade triggered by an
 * unrelated suffix. For a *label* an unrecognised variant is merely ignored, but
 * an override is an ACTION, so it fails closed.
 *
 * Untrusted data: parsed defensively, never executed. The surrounding `content`
 * is size-gated and scanned linearly by {@link extractCommandArgs}, and the arg
 * itself is length-capped BEFORE the parser is called (design §11, F10) — it
 * originates in a `<command-args>` block bounded only by the tail window.
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

  const arg = extractCommandArgs(content)
  if (arg === null || arg === '' || arg.length > MAX_MODEL_ID_LENGTH) return undefined

  const stripped = stripModelVariants(arg)
  if (stripped === null) return undefined
  if (!stripped.variants.every(isRecognisedVariant)) return undefined
  // Accept only a full claude-* model id (reject aliases like `opus`, `default`).
  if (parseModelId(stripped.base) === null) return undefined

  return { modelId: stripped.base, forceExtended: stripped.variants.some(isExtendedVariant) }
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
): Promise<{ text: string; truncated: boolean; size: number; mtimeMs: number } | null> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(filePath, 'r')
    // mtimeMs is on the SAME stat() result the tail read already needs for `size`
    // — surfaced so the version guard needs no extra syscall (design §3.1).
    const { size, mtimeMs } = await handle.stat()

    if (size <= maxBytes) {
      const whole = await handle.readFile('utf8')
      return { text: whole, truncated: false, size, mtimeMs }
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
    return { text, truncated: true, size, mtimeMs }
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
 * @param readFn Bounded-read function used for BOTH the tail read and the fallback
 *   read. Defaults to the real {@link readRelevantText}; injectable so a test can
 *   drive the fallback-failure branch (D) — e.g. a reader that succeeds on the tail
 *   read but returns `null` on the bounded read of a stable version. All production
 *   callers pass nothing and get the real reader.
 * @returns The latest `{ modelId, usedTokens }` or `null`. Never throws.
 */
export async function parseTranscript(
  filePath: string,
  opts?: { maxBytes?: number },
  readFn: typeof readRelevantText = readRelevantText
): Promise<ParsedTurn | null> {
  const maxBytes = opts?.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : TAIL_THRESHOLD_BYTES

  const read = await readFn(filePath, maxBytes)
  if (read === null) return null

  let turn = scanForLatestTurn(read.text)

  // Compaction-summary / oversized-line resilience (findings #4/#10): a large
  // compaction summary or a single line bigger than the tail window can push the
  // relevant assistant turn OUT of the window, so the tail scan finds nothing.
  // When the read was truncated to a tail, retry ONCE over a bounded window
  // ({@link FALLBACK_READ_MAX_BYTES}) to recover an evicted turn and keep
  // `justCompacted` honest. Version-guarded + result-cached (below) so the read
  // runs at most once per file-version and never re-freezes the UI (#47).
  if (turn === null && read.truncated) {
    const versionKey = `${read.size}:${read.mtimeMs}`

    // (A) Cache HIT — re-serve the previously scanned result for this exact
    //     file-version without any read. A turn recovered on refresh #1 is
    //     returned again on #2, #3, …; a genuine no-turn returns null (freeze
    //     fixed, meter not blanked after a one-shot recovery).
    const cached = getFallbackResult(filePath, versionKey)
    if (cached !== undefined) {
      return cached.turn
    }

    // (B) Cache MISS — insert a PROVISIONAL entry to dedup any concurrent
    //     refreshes for the same version, THEN do the bounded read. No `await`
    //     sits between the get above and this set, so on the single-threaded event
    //     loop at most one bounded read is issued per version.
    //
    //     The whole recovery block is wrapped: if ANYTHING between the provisional
    //     insert and the finalize/rollback throws (scanForLatestTurn, logger.debug,
    //     an unexpected reader error), the catch rolls the provisional entry back
    //     so it can neither poison the cache as a permanent `null` HIT nor let the
    //     throw escape and break this function's never-throws / fail-closed-to-null
    //     contract. `turn` stays null on the throw path — the same fail-closed
    //     result as a transient read failure (D), retried on the next refresh.
    try {
      recordFallbackProvisional(filePath, versionKey)

      logger.debug('ClaudeTranscriptParser: tail window yielded no turn; retrying bounded read', {
        filePath
      })
      const full = await readFn(filePath, FALLBACK_READ_MAX_BYTES)

      if (full !== null) {
        // (C) Read COMPLETED — finalise the cache with the scanned turn (a real
        //     turn OR null; both are legitimate cached results for this version).
        const scanned = scanForLatestTurn(full.text)
        finalizeFallbackResult(filePath, versionKey, scanned)
        turn = scanned
      } else {
        // (D) Read FAILED transiently (readFn returned null). Do NOT cache a
        //     failure: roll back the provisional entry — but only if it is still
        //     OURS (same version, still provisional), so a concurrent completed
        //     read that finalised a real result is never clobbered. The next
        //     refresh then retries instead of staying suppressed.
        rollbackFallbackProvisional(filePath, versionKey)
        // turn stays null → parseTranscript returns null this refresh; retried next.
      }
    } catch {
      // (E) Unexpected throw anywhere in the recovery block. Roll back the
      //     provisional entry (no-op if a concurrent read already finalised a real
      //     result for this version) so no poisoned `null` HIT lingers, and fall
      //     through with `turn` still null — fail-closed, per the contract.
      rollbackFallbackProvisional(filePath, versionKey)
    }
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
