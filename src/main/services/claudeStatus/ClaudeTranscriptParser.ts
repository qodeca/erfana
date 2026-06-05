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

/** Latest main-session assistant turn extracted from a transcript. */
export interface ParsedTurn {
  /** Raw Claude model id (e.g. `claude-opus-4-8`). Untrusted; never sanitized here. */
  modelId: string
  /** Context tokens used = input + cache_creation + cache_read (output excluded). */
  usedTokens: number
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
 * Coerce an untrusted usage field to a finite, non-negative integer count.
 * Missing/undefined is treated as 0. Returns `null` for any value that is not a
 * finite, non-negative number (so a malformed turn is rejected, not silently
 * miscounted).
 */
function coerceCount(value: unknown): number | null {
  if (value === undefined || value === null) return 0
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
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

/**
 * Read the relevant portion of the transcript as text, or `null` if unreadable.
 *
 * Small files are read whole. Files larger than {@link TAIL_THRESHOLD_BYTES} are
 * tail-read: only the final {@link TAIL_THRESHOLD_BYTES} are read from an offset
 * and a partial leading line (everything before the first newline in the window)
 * is dropped so we only parse complete lines.
 */
async function readRelevantText(filePath: string, maxBytes: number): Promise<string | null> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(filePath, 'r')
    const { size } = await handle.stat()

    if (size <= maxBytes) {
      const whole = await handle.readFile('utf8')
      return whole
    }

    const start = size - maxBytes
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, start)
    const window = buffer.toString('utf8', 0, bytesRead)

    // Drop a partial leading line: the tail window almost certainly starts in
    // the middle of a line, so discard everything up to and including the first
    // newline. Whole-file reads (start === 0 branch above) never reach here.
    const firstNewline = window.indexOf('\n')
    return firstNewline === -1 ? '' : window.slice(firstNewline + 1)
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

  const text = await readRelevantText(filePath, maxBytes)
  if (text === null) return null

  const lines = text.split('\n')

  // Scan BACKWARD for the most recent usable main assistant turn. A truncated
  // trailing line simply fails JSON.parse and is skipped, so the prior valid
  // turn still wins.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.length === 0) continue

    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    const turn = turnFromRecord(record)
    if (turn) return turn
  }

  return null
}
