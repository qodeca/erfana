// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptParser — `/model` override regressions for the shared grammar.
 *
 * Split out of `ClaudeTranscriptParser.test.ts` (already 534 lines) so #41's
 * override cases live in their own file. Covers the shapes the three old
 * regexes handled inconsistently: a minor-omitted id, the `[1m]` marker, an
 * UNRECOGNISED bracket variant (which must keep behaving exactly as it does
 * today rather than silently forcing standard mode), the interior-control-char
 * trim, and an oversize `<command-args>` payload.
 *
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §9.1, §11, §13 (decision (e))
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-override-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** The assistant turn every case falls back to when an override is ignored. */
const FALLBACK_TURN = { modelId: 'claude-opus-4-8', usedTokens: 42 }

/** Build a JSONL line for one main-session assistant turn. */
function assistantLine(model: string, input = 42): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: { model, usage: { input_tokens: input } }
  })
}

/** Build a JSONL line for a `/model <arg>` slash-command entry. */
function modelCommandLine(arg: string): string {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: `<command-name>/model</command-name>\n  <command-message>model</command-message>\n  <command-args>${arg}</command-args>`
    }
  })
}

/**
 * Write a transcript whose newest record is a `/model` override sitting after a
 * single assistant turn, and parse it.
 */
async function parseWithOverride(arg: string, name = 'session.jsonl'): Promise<unknown> {
  const file = path.join(tmpDir, name)
  await fs.writeFile(file, [assistantLine('claude-opus-4-8'), modelCommandLine(arg)].join('\n'), 'utf8')
  return parseTranscript(file)
}

describe('/model override - accepted selections', () => {
  it('AC2: honours a minor-omitted id with [1m] and flags modelForcedExtended', async () => {
    // The pre-#41 regex set forceExtended, stripped `[1m]`, then REJECTED the
    // bare `claude-opus-5` — silently discarding the user's selection.
    expect(await parseWithOverride('claude-opus-5[1m]')).toEqual({
      modelId: 'claude-opus-5',
      usedTokens: 42,
      modelForcedExtended: true
    })
  })

  it('AC7: honours a bare minor-omitted id as an explicit STANDARD selection (R0\')', async () => {
    // R0': an explicit `/model <id>` with no 1M marker must outrank the registry,
    // which reports 1M for this very model.
    expect(await parseWithOverride('claude-opus-5')).toEqual({
      modelId: 'claude-opus-5',
      usedTokens: 42,
      modelForcedStandard: true
    })
  })

  it('normalises casing and padding on an accepted selection', async () => {
    expect(await parseWithOverride('  CLAUDE-OPUS-5[1M]  ')).toEqual({
      modelId: 'claude-opus-5',
      usedTokens: 42,
      modelForcedExtended: true
    })
  })

  it('F21: trims an interior control character off the selected modelId', async () => {
    // Without the post-split trim the raw tab would ride into `snapshot.modelId`
    // — the control-char class #216 §10 excluded. A trailing `.trim()` on the
    // whole arg cannot fix this one, because the tab is INTERIOR to the arg.
    const result = (await parseWithOverride('claude-opus-5\t[1m]')) as { modelId: string }
    expect(result).toEqual({
      modelId: 'claude-opus-5',
      usedTokens: 42,
      modelForcedExtended: true
    })
    expect(result.modelId).not.toContain('\t')
  })
})

describe('/model override - unrecognised variants are ignored entirely (decision (e))', () => {
  // Honouring these would set modelForcedStandard, clear the sticky 1M bit, and
  // produce a user-visible 1M→200k downgrade triggered by an unrelated suffix.
  // An override is an ACTION, so it fails closed: the parser falls back to the
  // assistant turn's own model with NEITHER force flag — exactly today's
  // behaviour, where the id regex rejected the suffixed form outright.
  const cases: ReadonlyArray<[string]> = [
    ['claude-opus-4-7[thinking]'],
    ['claude-opus-4-7[1m][beta]'],
    ['claude-opus-5[1m][thinking]']
  ]

  it.each(cases)('ignores %s and keeps the assistant turn model', async (arg) => {
    const result = (await parseWithOverride(arg)) as Record<string, unknown>
    expect(result).toEqual(FALLBACK_TURN)
    expect(result.modelForcedExtended).toBeUndefined()
    expect(result.modelForcedStandard).toBeUndefined()
  })

  it('pins the recognised variant set at exactly 1m', async () => {
    // Any other token — alone or alongside `1m` — fails the override closed.
    expect(await parseWithOverride('claude-opus-4-7[1m]')).toEqual({
      modelId: 'claude-opus-4-7',
      usedTokens: 42,
      modelForcedExtended: true
    })
    expect(await parseWithOverride('claude-opus-4-7[beta]', 'b.jsonl')).toEqual(FALLBACK_TURN)
  })
})

describe('/model override - rejections preserved from before #41', () => {
  const cases: ReadonlyArray<[string]> = [
    ['opus'],
    ['sonnet'],
    ['default'],
    [''],
    ['claude-foo'],
    ['claude-opus'],
    ['claude-opus-x-y'],
    ['gpt-4o'],
    ['claude-opus-5['],
    ['claude-opus-5[1m']
  ]

  it.each(cases)('ignores the arg %j and falls back to the assistant model', async (arg) => {
    expect(await parseWithOverride(arg)).toEqual(FALLBACK_TURN)
  })
})

describe('/model override - oversize argument (F10)', () => {
  it('rejects a 256 KB [a]xN argument in bounded time', async () => {
    // `<command-args>` is bounded only by the 256 KB tail window, and this scan
    // runs synchronously on the main-process event loop ~1x/1.25s per terminal.
    // The arg is length-capped BEFORE the parser is called, so the cost of a
    // hostile payload must not scale with its size.
    const hostile = `claude-opus-5${'[a]'.repeat(90_000)}`
    expect(hostile.length).toBeGreaterThan(256 * 1024)

    const file = path.join(tmpDir, 'hostile.jsonl')
    await fs.writeFile(file, [assistantLine('claude-opus-4-8'), modelCommandLine(hostile)].join('\n'), 'utf8')

    // Behavioural, not timed: falling back to the assistant turn proves the arg
    // was rejected by the length cap ahead of the parser. A wall-clock bound
    // would only add flake surface — the O(1) guarantee is the cap's POSITION.
    expect(await parseTranscript(file)).toEqual(FALLBACK_TURN)
  })

  it('rejects an argument one character over the shared 64-char bound', async () => {
    expect(await parseWithOverride(`claude-opus-4-7-${'a'.repeat(49)}`)).toEqual(FALLBACK_TURN)
  })
})

describe('/model override - linear <command-args> extraction (security audit MEDIUM)', () => {
  /** A `user` record whose content is a raw string, bypassing modelCommandLine. */
  function rawCommandLine(content: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content } })
  }

  it('ignores an UNTERMINATED <command-args> tag instead of scanning for a close', async () => {
    // The old lazy regex `/<command-args>([\s\S]*?)<\/command-args>/` restarted a
    // full forward scan at every occurrence of the opening literal, so repeating
    // it with no close was quadratic: 256 KB measured at 630 ms of BLOCKED main
    // thread, once per ~1.25 s refresh. Two indexOf calls cannot backtrack.
    const content = `<command-name>/model</command-name>${'<command-args>'.repeat(20_000)}`
    expect(content.length).toBeGreaterThan(256 * 1024)

    const file = path.join(tmpDir, 'unterminated.jsonl')
    await fs.writeFile(file, [assistantLine('claude-opus-4-8'), rawCommandLine(content)].join('\n'), 'utf8')

    // Behavioural: no close tag means no argument, so the assistant turn wins.
    expect(await parseTranscript(file)).toEqual(FALLBACK_TURN)
  })

  it('ignores a command whose content is larger than a command could plausibly be', async () => {
    // The size gate fires before any scanning. A real `/model` argument is at
    // most 64 characters, so nothing legitimate is lost.
    const filler = 'A'.repeat(9 * 1024)
    const content = `<command-name>/model</command-name>${filler}<command-args>claude-opus-4-7</command-args>`
    const file = path.join(tmpDir, 'oversize-content.jsonl')
    await fs.writeFile(file, [assistantLine('claude-opus-4-8'), rawCommandLine(content)].join('\n'), 'utf8')

    expect(await parseTranscript(file)).toEqual(FALLBACK_TURN)
  })

  it('still extracts a normal override, and takes the FIRST close tag', async () => {
    const content =
      '<command-name>/model</command-name><command-args>claude-opus-4-7</command-args>' +
      '<command-args>claude-sonnet-4-5</command-args>'
    const file = path.join(tmpDir, 'two-blocks.jsonl')
    await fs.writeFile(file, [assistantLine('claude-opus-4-8'), rawCommandLine(content)].join('\n'), 'utf8')

    // Same selection the lazy regex made, so the switch is behaviour-preserving.
    expect(await parseTranscript(file)).toEqual({
      modelId: 'claude-opus-4-7',
      usedTokens: 42,
      modelForcedStandard: true
    })
  })
})
