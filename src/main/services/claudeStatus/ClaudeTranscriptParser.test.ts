// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptParser tests.
 *
 * Covers the defensive transcript-parsing core: latest main turn selection,
 * sidechain/synthetic/null-model skipping, truncated-line tolerance, the
 * output-excluded token formula, missing/empty/non-assistant files, and the
 * large-file tail read.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { parseTranscript } from './ClaudeTranscriptParser'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-parser-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Write `content` to a temp `.jsonl` file and return its absolute path. */
async function writeTranscript(content: string, name = 'session.jsonl'): Promise<string> {
  const file = path.join(tmpDir, name)
  await fs.writeFile(file, content, 'utf8')
  return file
}

/** Build a JSONL line for an assistant turn with explicit usage fields. */
function assistantLine(opts: {
  model: string | null
  isSidechain?: boolean
  input?: number
  cacheCreation?: number
  cacheRead?: number
  output?: number
}): string {
  const usage: Record<string, number> = {}
  if (opts.input !== undefined) usage.input_tokens = opts.input
  if (opts.cacheCreation !== undefined) usage.cache_creation_input_tokens = opts.cacheCreation
  if (opts.cacheRead !== undefined) usage.cache_read_input_tokens = opts.cacheRead
  if (opts.output !== undefined) usage.output_tokens = opts.output

  return JSON.stringify({
    type: 'assistant',
    isSidechain: opts.isSidechain ?? false,
    message: { model: opts.model, usage }
  })
}

/** Build a JSONL line for a `/model` slash-command entry with the given arg. */
function modelCommandLine(arg: string): string {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: `<command-name>/model</command-name>\n  <command-message>model</command-message>\n  <command-args>${arg}</command-args>`
    }
  })
}

/** Build a JSONL line for a Claude Code compaction-summary boundary marker. */
function compactionLine(): string {
  return JSON.stringify({
    type: 'user',
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: 'summary' }
  })
}

describe('parseTranscript', () => {
  it('parses a single valid main turn', async () => {
    const file = await writeTranscript(
      assistantLine({ model: 'claude-opus-4-8', input: 100, cacheCreation: 50, cacheRead: 25, output: 999 })
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 175 })
  })

  it('excludes output_tokens from the used total (exact)', async () => {
    const file = await writeTranscript(
      assistantLine({ model: 'm', input: 1000, cacheCreation: 200, cacheRead: 3000, output: 500000 })
    )
    const result = await parseTranscript(file)
    expect(result?.usedTokens).toBe(4200)
  })

  it('returns the LAST main turn among several', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-7', input: 10 }),
        assistantLine({ model: 'claude-opus-4-8', input: 20, cacheRead: 5 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 25 })
  })

  it('ignores a sidechain turn and falls back to the earlier main turn', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 42 }),
        assistantLine({ model: 'claude-sonnet-4-6', isSidechain: true, input: 9999 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 42 })
  })

  it('treats a missing isSidechain (not strictly false) as non-main', async () => {
    const noField = JSON.stringify({ type: 'assistant', message: { model: 'm', usage: { input_tokens: 5 } } })
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 7 }), noField].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 7 })
  })

  it('skips a null model and continues backward', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 11 }),
        assistantLine({ model: null, input: 22 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 11 })
  })

  it('skips a "<synthetic>" model and continues backward', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 33 }),
        assistantLine({ model: '<synthetic>', input: 44 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 33 })
  })

  it('tolerates a malformed/truncated trailing line and returns the prior valid turn', async () => {
    const file = await writeTranscript(
      assistantLine({ model: 'claude-opus-4-8', input: 60, cacheRead: 6 }) +
        '\n' +
        '{"type":"assistant","isSidechain":false,"message":{"model":"claude-op'
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 66 })
  })

  it('ignores non-assistant types (user, summary, tool_result, system, etc.)', async () => {
    const file = await writeTranscript(
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        JSON.stringify({ type: 'summary' }),
        JSON.stringify({ type: 'tool_result' }),
        JSON.stringify({ type: 'system' })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toBeNull()
  })

  it('returns null for a missing file', async () => {
    const result = await parseTranscript(path.join(tmpDir, 'does-not-exist.jsonl'))
    expect(result).toBeNull()
  })

  it('returns null for an empty file', async () => {
    const file = await writeTranscript('')
    const result = await parseTranscript(file)
    expect(result).toBeNull()
  })

  it('returns null when every line is malformed JSON', async () => {
    const file = await writeTranscript('not json\n{also not\n}}}}')
    const result = await parseTranscript(file)
    expect(result).toBeNull()
  })

  it('returns null when an assistant turn has no usage fields at all', async () => {
    const file = await writeTranscript(
      JSON.stringify({ type: 'assistant', isSidechain: false, message: { model: 'm', usage: {} } })
    )
    const result = await parseTranscript(file)
    expect(result).toBeNull()
  })

  it('treats missing individual usage fields as 0 when at least one is present', async () => {
    const file = await writeTranscript(assistantLine({ model: 'm', input: 80 }))
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'm', usedTokens: 80 })
  })

  it('rejects a turn with a non-finite/negative usage value', async () => {
    const negative = JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      message: { model: 'm', usage: { input_tokens: -5 } }
    })
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 9 }), negative].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 9 })
  })

  it('finds the latest turn in the tail of a file larger than 256 KB', async () => {
    // Build a padding prefix that exceeds the 256 KB tail threshold, then the
    // real latest turn at the very end. A naive whole-file read would still
    // work, so prove the tail path: set a tiny maxBytes so only the tail of a
    // large file is read and the latest turn must come from within it.
    const padTurn = assistantLine({ model: 'claude-opus-4-7', input: 1 })
    const padLines = new Array(20000).fill(padTurn).join('\n')
    const latest = assistantLine({ model: 'claude-opus-4-8', input: 500, cacheRead: 23 })
    const file = await writeTranscript(padLines + '\n' + latest)

    const stat = await fs.stat(file)
    expect(stat.size).toBeGreaterThan(256 * 1024)

    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 523 })
  })

  it('tail read drops a partial leading line yet finds the trailing turn (small maxBytes)', async () => {
    const earlier = assistantLine({ model: 'claude-opus-4-7', input: 111 })
    const latest = assistantLine({ model: 'claude-opus-4-8', input: 7, cacheCreation: 2 })
    const file = await writeTranscript(earlier + '\n' + latest)

    // Force a tail read whose window starts mid-`earlier` line; the latest line
    // is wholly within the window.
    const result = await parseTranscript(file, { maxBytes: latest.length + 5 })
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 9 })
  })
})

describe('compaction awareness', () => {
  it('flags justCompacted when a compaction is newer than the last assistant turn', async () => {
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 95329 }), compactionLine()].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 95329, justCompacted: true })
  })

  it('does NOT flag when a post-compaction assistant turn exists', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-7', input: 95329 }),
        compactionLine(),
        assistantLine({ model: 'claude-opus-4-8', input: 1200 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 1200 })
    expect(result?.justCompacted).toBeUndefined()
  })

  it('returns the second assistant turn flagged for assistant/compaction/assistant/compaction', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-7', input: 10 }),
        compactionLine(),
        assistantLine({ model: 'claude-opus-4-8', input: 7777 }),
        compactionLine()
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 7777, justCompacted: true })
  })

  it('does NOT flag when the latest turn follows back-to-back compactions', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-7', input: 10 }),
        compactionLine(),
        compactionLine(),
        assistantLine({ model: 'claude-opus-4-8', input: 333 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 333 })
    expect(result?.justCompacted).toBeUndefined()
  })

  it('returns null for a compaction with no prior assistant turn', async () => {
    const aloneFile = await writeTranscript(compactionLine())
    expect(await parseTranscript(aloneFile)).toBeNull()

    const withUserFile = await writeTranscript(
      [JSON.stringify({ type: 'user' }), compactionLine()].join('\n'),
      'with-user.jsonl'
    )
    expect(await parseTranscript(withUserFile)).toBeNull()
  })

  it('keeps the flag past intervening non-assistant lines after the compaction', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 5000 }),
        compactionLine(),
        JSON.stringify({ type: 'user' }),
        JSON.stringify({ type: 'system' })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 5000, justCompacted: true })
  })

  it('does NOT treat a string/number isCompactSummary as a compaction marker', async () => {
    const stringMarker = JSON.stringify({ type: 'user', isCompactSummary: 'true' })
    const stringFile = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 9 }), stringMarker].join('\n')
    )
    const stringResult = await parseTranscript(stringFile)
    expect(stringResult).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 9 })
    expect(stringResult?.justCompacted).toBeUndefined()

    const numberMarker = JSON.stringify({ type: 'user', isCompactSummary: 1 })
    const numberFile = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 9 }), numberMarker].join('\n'),
      'number-marker.jsonl'
    )
    const numberResult = await parseTranscript(numberFile)
    expect(numberResult).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 9 })
    expect(numberResult?.justCompacted).toBeUndefined()
  })
})

describe('model-switch awareness', () => {
  it('applies a newer /model …[1m] override and flags modelForcedExtended', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 42 }),
        modelCommandLine('claude-opus-4-7[1m]')
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({
      modelId: 'claude-opus-4-7',
      usedTokens: 42,
      modelForcedExtended: true
    })
  })

  it('applies a newer /model override without [1m] (no force flag)', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 42 }),
        modelCommandLine('claude-sonnet-4-6')
      ].join('\n')
    )
    const result = await parseTranscript(file)
    // A non-[1m] override authoritatively selects standard mode for the new model.
    expect(result).toEqual({
      modelId: 'claude-sonnet-4-6',
      usedTokens: 42,
      modelForcedStandard: true
    })
    expect(result?.modelForcedExtended).toBeUndefined()
  })

  it('ignores a /model override OLDER than the latest assistant turn', async () => {
    const file = await writeTranscript(
      [
        modelCommandLine('claude-opus-4-7'),
        assistantLine({ model: 'claude-opus-4-8', input: 42 })
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 42 })
  })

  it('ignores an alias arg (`opus`) and falls back to the assistant model', async () => {
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 42 }), modelCommandLine('opus')].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 42 })
  })

  it('ignores an empty arg and falls back to the assistant model', async () => {
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 42 }), modelCommandLine('')].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 42 })
  })

  it('returns null for a /model override with no assistant turn at all', async () => {
    const file = await writeTranscript(modelCommandLine('claude-opus-4-7'))
    const result = await parseTranscript(file)
    expect(result).toBeNull()
  })

  it('combines justCompacted with a newer /model …[1m] override', async () => {
    const file = await writeTranscript(
      [
        assistantLine({ model: 'claude-opus-4-8', input: 7777 }),
        compactionLine(),
        modelCommandLine('claude-opus-4-7[1m]')
      ].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({
      modelId: 'claude-opus-4-7',
      usedTokens: 7777,
      justCompacted: true,
      modelForcedExtended: true
    })
  })

  it('detects the command when content is an ARRAY of text blocks', async () => {
    const arrayLine = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<command-name>/model</command-name> <command-args>claude-sonnet-4-6</command-args>'
          }
        ]
      }
    })
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 42 }), arrayLine].join('\n')
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({
      modelId: 'claude-sonnet-4-6',
      usedTokens: 42,
      modelForcedStandard: true
    })
  })

  it('ignores a junk arg that is not a full model id', async () => {
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 42 }), modelCommandLine('claude-foo')].join(
        '\n'
      )
    )
    const result = await parseTranscript(file)
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 42 })
  })
})

describe('usage coercion hardening (finding #9)', () => {
  /** Build an assistant turn with a raw (possibly non-integer) usage value. */
  function rawUsageLine(inputTokens: unknown): string {
    return JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      message: { model: 'm', usage: { input_tokens: inputTokens } }
    })
  }

  it('rejects a fractional token count and falls back to the prior valid turn', async () => {
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 9 }), rawUsageLine(1.5)].join('\n')
    )
    expect(await parseTranscript(file)).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 9 })
  })

  it('rejects an absurdly large token count (> 100M)', async () => {
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 9 }), rawUsageLine(1_000_000_000)].join('\n')
    )
    expect(await parseTranscript(file)).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 9 })
  })

  it('still accepts a large-but-plausible count at the ceiling', async () => {
    const file = await writeTranscript(rawUsageLine(100_000_000))
    expect(await parseTranscript(file)).toEqual({ modelId: 'm', usedTokens: 100_000_000 })
  })
})

describe('tail-window resilience (findings #4/#10/#19)', () => {
  /** A compaction-summary line whose content padding inflates its byte size. */
  function bigCompactionLine(padBytes: number): string {
    return JSON.stringify({
      type: 'user',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: { role: 'user', content: 'x'.repeat(padBytes) }
    })
  }

  it('keeps justCompacted across a truncated trailing line after the compaction (#19)', async () => {
    // The real live-session race: a compaction summary is written, then the next
    // turn is mid-flush (a partial JSON line). The truncated line is skipped, so
    // the flagged pre-compaction turn must still win.
    const file = await writeTranscript(
      [assistantLine({ model: 'claude-opus-4-8', input: 5000 }), compactionLine()].join('\n') +
        '\n' +
        '{"type":"assistant","isSidechain":fal'
    )
    expect(await parseTranscript(file)).toEqual({
      modelId: 'claude-opus-4-8',
      usedTokens: 5000,
      justCompacted: true
    })
  })

  it('recovers a turn evicted from the tail window by a large compaction summary via a full-read retry (#4/#10)', async () => {
    const turn = assistantLine({ model: 'claude-opus-4-8', input: 7000 })
    const file = await writeTranscript([turn, bigCompactionLine(2000)].join('\n'))

    // maxBytes is far smaller than the summary, so the tail window holds only part
    // of the summary (no newline) → the tail scan finds nothing → the full-read
    // retry must recover the turn AND still flag justCompacted.
    const result = await parseTranscript(file, { maxBytes: 500 })
    expect(result).toEqual({ modelId: 'claude-opus-4-8', usedTokens: 7000, justCompacted: true })
  })

  it('returns null (no hang) when even a full read has no usable turn', async () => {
    const file = await writeTranscript('x'.repeat(2000)) // one giant non-JSON line
    expect(await parseTranscript(file, { maxBytes: 100 })).toBeNull()
  })
})
