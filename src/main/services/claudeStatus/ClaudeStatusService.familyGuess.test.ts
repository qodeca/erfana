// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeStatusService — a window guessed from the model's family is marked
 * `(inferred)` (#383).
 *
 * Driven through the REAL window detector (pinned to an absent settings file),
 * so the snapshot is what a user would see for a model newer than Erfana's table.
 *
 * @see Issue #383 - context meter shows 200k for newer Claude models
 * @see docs/designs/context-meter/41-model-capability-registry.md §5.4, §7.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { makeHarness, flush } from './__fixtures__/claudeStatusHarness'
import { detectWindowSize, __resetSettingsCacheForTests } from './ClaudeWindowDetector'

const ABSENT_SETTINGS = path.join(os.tmpdir(), 'erfana-family-guess-absent-settings.json')

/** Snapshot the service emits for one model at 12k used tokens. */
async function snapshotFor(modelId: string, modelForcedStandard = false) {
  const detect = vi.fn((id: string, used: number, forceExtended?: boolean, opts?: object) =>
    detectWindowSize(id, used, forceExtended, { ...opts, settingsPath: ABSENT_SETTINGS })
  )
  const h = makeHarness({ detectWindowSize: detect as never })
  h.parseTranscript.mockResolvedValue({
    modelId,
    usedTokens: 12_000,
    ...(modelForcedStandard ? { modelForcedStandard: true } : {})
  })
  h.service.registerPanel('t1', 4242, '/p', 7)
  await flush()
  // A 200k answer reaches the (absent) settings file, which outlasts `flush()`.
  await vi.waitFor(() => expect(h.emitted.at(-1)?.payload.snapshot).toBeDefined())
  return h.emitted.at(-1)?.payload.snapshot
}

beforeEach(() => __resetSettingsCacheForTests())
afterEach(() => __resetSettingsCacheForTests())

describe('#383 - a family-guessed window shows (inferred)', () => {
  it.each(['claude-opus-7', 'claude-opus-5-10', 'claude-haiku-6'])(
    '%s, newer than every listed model, shows 1M (inferred)',
    async (modelId) => {
      const snapshot = await snapshotFor(modelId)
      expect(snapshot?.windowSize).toBe(1_000_000)
      expect(snapshot?.inferred).toBe(true)
      expect(snapshot?.tooltip).toBe('12k / 1M (inferred)')
    }
  )

  it('a guessed 200k is marked too: claude-sonnet-4-7 takes Sonnet 4.6\'s window', async () => {
    const snapshot = await snapshotFor('claude-sonnet-4-7')
    expect(snapshot?.windowSize).toBe(200_000)
    expect(snapshot?.tooltip).toBe('12k / 200k (inferred)')
  })

  it('/model on a guessed 1M-only model keeps 1M (inferred)', async () => {
    const snapshot = await snapshotFor('claude-opus-7', true)
    expect(snapshot?.tooltip).toBe('12k / 1M (inferred)')
  })

  it('control: a listed 200k model is not marked', async () => {
    const snapshot = await snapshotFor('claude-haiku-4-5')
    expect(snapshot?.tooltip).toBe('12k / 200k')
  })
})
