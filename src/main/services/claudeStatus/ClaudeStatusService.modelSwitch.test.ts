// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeStatusService — switching away from a 1M-only model with `/model` (#383).
 *
 * A session on Opus 5.5 shows 1M from the table (provisional, `(inferred)`).
 * When the user then runs `/model claude-opus-4-6` – a model that offers a 200k
 * window and reaches 1M only through its `[1m]` variant (design §7.1, AC7) – the
 * meter must drop to 200k: the Opus 5.5 window must not stick across the switch,
 * and a settings.json `[1m]` must not override the explicit standard pick.
 *
 * Driven end-to-end through the REAL transcript parser and the REAL window
 * detector; only liveness, the transcript locator and the emitter are the shared
 * harness fakes. Its own file because `ClaudeStatusService.stickyWindow.test.ts`
 * sits near the 500-line convention.
 *
 * @see Issue #383 - context meter shows 200k for newer Claude models and when /model names a 1M-only model
 * @see docs/designs/context-meter/41-model-capability-registry.md §5.3, §8 (R0'), §9.3 (AC7)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { makeHarness, flush } from './__fixtures__/claudeStatusHarness'
import { parseTranscript } from './ClaudeTranscriptParser'
import { detectWindowDetail, __resetSettingsCacheForTests } from './ClaudeWindowDetector'

let tmpDir: string
let transcript: string

beforeEach(async () => {
  __resetSettingsCacheForTests()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erfana-model-switch-'))
  transcript = path.join(tmpDir, 'session.jsonl')
})

afterEach(async () => {
  __resetSettingsCacheForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** One main-session assistant turn. */
function assistantLine(model: string, input: number): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: { model, usage: { input_tokens: input } }
  })
}

/** A `/model <arg>` slash-command record, as Claude Code writes it. */
function modelCommandLine(arg: string): string {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: `<command-name>/model</command-name>\n  <command-message>model</command-message>\n  <command-args>${arg}</command-args>`
    }
  })
}

/** A service wired to the real parser and the real detector, reading `settingsPath`. */
function realService(settingsPath: string) {
  return makeHarness({
    locateTranscripts: vi.fn().mockResolvedValue([transcript]),
    parseTranscript: (file: string) => parseTranscript(file),
    detectWindowSize: ((id: string, used: number, forceExtended?: boolean, opts?: object) =>
      detectWindowDetail(id, used, forceExtended, { ...opts, settingsPath })) as never
  })
}

/** Run one Opus 5.5 pass at 12k, append `/model claude-opus-4-6`, run a second pass. */
async function switchFromOpus55(settingsPath: string) {
  const h = realService(settingsPath)
  const opusTurn = assistantLine('claude-opus-5-5', 12_000)
  await fs.writeFile(transcript, opusTurn, 'utf8')
  h.service.registerPanel('t1', 4242, '/p', 7)
  await flush()
  await vi.waitFor(() => expect(h.emitted.at(-1)?.payload.snapshot).toBeDefined())
  const before = h.emitted.at(-1)?.payload.snapshot

  await fs.writeFile(transcript, [opusTurn, modelCommandLine('claude-opus-4-6')].join('\n'), 'utf8')
  const emittedBefore = h.emitted.length
  await h.service.refresh('t1')
  // A 200k answer reads settings.json, which outlasts `flush()`.
  await vi.waitFor(() => expect(h.emitted.length).toBeGreaterThan(emittedBefore))
  return { before, after: h.emitted.at(-1)?.payload.snapshot }
}

describe('#383 - /model claude-opus-4-6 after an Opus 5.5 session', () => {
  it('drops the 1M of Opus 5.5 to 200k for the dual-window pick', async () => {
    const { before, after } = await switchFromOpus55(path.join(tmpDir, 'absent.json'))

    expect(before?.modelId).toBe('claude-opus-5-5')
    expect(before?.windowSize).toBe(1_000_000)
    expect(before?.tooltip).toBe('12k / 1M (inferred)')

    expect(after?.modelId).toBe('claude-opus-4-6')
    expect(after?.windowSize).toBe(200_000)
    // A listed 200k row reached by an explicit pick is not a guess.
    expect(after?.tooltip).toBe('12k / 200k')
  })

  it('the explicit pick still wins over a settings.json [1m] (R0\' before R3)', async () => {
    // Without R0' the switched-to Opus 4.6 would be upgraded to 1M by the
    // settings file, so this is the case that makes the rule load-bearing.
    const settingsPath = path.join(tmpDir, 'settings.json')
    await fs.writeFile(settingsPath, JSON.stringify({ model: 'opus[1m]' }), 'utf8')

    const { before, after } = await switchFromOpus55(settingsPath)

    expect(before?.windowSize).toBe(1_000_000)
    expect(after?.modelId).toBe('claude-opus-4-6')
    expect(after?.windowSize).toBe(200_000)
  })
})
