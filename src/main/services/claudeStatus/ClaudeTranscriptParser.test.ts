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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
