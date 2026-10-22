// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeStatusService — cloud-platform and unrecognised model ids (#49).
 *
 * Driven by the SHARED harness, whose `detectWindowSize` fake calls the REAL
 * capability registry, so a provider id here goes through the same parse as in
 * production. Two behaviours:
 *  - A Bedrock or Vertex id produces the same snapshot as its bare equivalent:
 *    window, friendly name and sticky key.
 *  - An id the parser cannot read still gets the safe 200k default, but marked
 *    `(inferred)` instead of presented as fact, and is logged once per id.
 *
 * @see Issue #49 - Model ids from Bedrock, Vertex and Foundry are not recognised
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { logger } from '../LoggingService'
import { makeHarness, flush } from './__fixtures__/claudeStatusHarness'

beforeEach(() => {
  vi.clearAllMocks()
})

/** Register one panel on `modelId` and return the snapshot it emits. */
async function snapshotFor(modelId: string, usedTokens = 12_000) {
  const h = makeHarness()
  h.parseTranscript.mockResolvedValue({ modelId, usedTokens })
  h.service.registerPanel('t1', 4242, '/p', 7)
  await flush()
  return { h, snapshot: h.emitted.at(-1)?.payload.snapshot }
}

/** Metadata of the once-per-id lines at one log level. */
function unrecognisedLogs(level: 'warn' | 'debug' = 'warn'): Array<Record<string, unknown>> {
  return vi
    .mocked(logger[level])
    .mock.calls.filter(([message]) => message === 'claudeStatus.unrecognisedModelId')
    .map(([, meta]) => meta as Record<string, unknown>)
}

describe('provider ids meter like their bare equivalent', () => {
  const cases: ReadonlyArray<[provider: string, bare: string]> = [
    ['us.anthropic.claude-opus-4-8', 'claude-opus-4-8'],
    ['anthropic.claude-sonnet-5', 'claude-sonnet-5'],
    [
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'claude-sonnet-4-5-20250929'
    ],
    ['claude-haiku-4-5@20251001', 'claude-haiku-4-5-20251001']
  ]

  it.each(cases)('%s shows the window, label and marker of %s', async (provider, bare) => {
    const { snapshot: viaProvider } = await snapshotFor(provider)
    const { snapshot: viaBare } = await snapshotFor(bare)

    expect(viaProvider).toBeDefined()
    expect(viaProvider?.windowSize).toBe(viaBare?.windowSize)
    expect(viaProvider?.friendlyName).toBe(viaBare?.friendlyName)
    expect(viaProvider?.tooltip).toBe(viaBare?.tooltip)
    expect(viaProvider?.inferred).toBe(viaBare?.inferred)
    expect(unrecognisedLogs()).toEqual([])
  })

  it('reports the #49 reproduction as 1M with a friendly label', async () => {
    const { snapshot } = await snapshotFor('us.anthropic.claude-opus-4-8')
    expect(snapshot?.windowSize).toBe(1_000_000)
    expect(snapshot?.friendlyName).toBe('Opus 4.8')
  })

  it('keys the sticky state on the bare model, so a prefix change is not a model switch', async () => {
    const h = makeHarness()
    // Usage above 200k latches an observed 1M for claude-sonnet-4-5 (a 200k model).
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 250_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)

    // Same model, now reported in its Bedrock form after a compaction reset.
    h.parseTranscript.mockResolvedValue({ modelId: 'eu.anthropic.claude-sonnet-4-5', usedTokens: 30_000 })
    await h.service.refresh('t1')
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)
  })
})

describe('an unrecognised id is a guess, and says so', () => {
  const APP_PROFILE_ARN =
    'arn:aws:bedrock:us-east-2:123456789012:application-inference-profile/opus-47-prod'

  it('marks the 200k default inferred for an id the parser cannot read', async () => {
    const { snapshot } = await snapshotFor('team-opus-prod')
    expect(snapshot?.windowSize).toBe(200_000)
    expect(snapshot?.inferred).toBe(true)
    expect(snapshot?.tooltip).toBe('12k / 200k (inferred)')
  })

  it('does NOT mark a recognised 200k model inferred', async () => {
    // The pre-#49 behaviour for a known model is unchanged: its 200k is a fact.
    const { snapshot } = await snapshotFor('claude-sonnet-4-5')
    expect(snapshot?.windowSize).toBe(200_000)
    expect(snapshot?.inferred).toBe(false)
    expect(snapshot?.tooltip).toBe('12k / 200k')
  })

  it('drops the marker once usage proves the 1M window', async () => {
    const { snapshot } = await snapshotFor('team-opus-prod', 250_000)
    expect(snapshot?.windowSize).toBe(1_000_000)
    expect(snapshot?.inferred).toBe(false)
  })

  it.each([
    // Intended (#49 criterion 3): the marker follows PARSE FAILURE, so plain ids
    // the grammar cannot read are now an honest guess too.
    ['an old-style family-last id', 'claude-3-7-sonnet-20250219'],
    ['a bare alias', 'opus']
  ])('marks %s inferred (%s)', async (_label, modelId) => {
    const { snapshot } = await snapshotFor(modelId)
    expect(snapshot?.windowSize).toBe(200_000)
    expect(snapshot?.inferred).toBe(true)
    expect(snapshot?.tooltip).toBe('12k / 200k (inferred)')
  })

  it('logs each unrecognised id once, not on every refresh', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({ modelId: APP_PROFILE_ARN, usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    await h.service.refresh('t1')
    await flush()
    await h.service.refresh('t1')
    await flush()
    expect(unrecognisedLogs()).toHaveLength(1)

    // A second distinct id is its own line.
    h.parseTranscript.mockResolvedValue({ modelId: 'team-sonnet-prod', usedTokens: 12_000 })
    await h.service.refresh('t1')
    await flush()
    expect(unrecognisedLogs()).toHaveLength(2)
  })

  it('at warn, logs only the shape and length — never the user-chosen name', async () => {
    const ids = [APP_PROFILE_ARN, 'arn:aws:s3:::bucket/team-model', 'team-opus-prod']
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    for (const modelId of ids) {
      h.parseTranscript.mockResolvedValue({ modelId, usedTokens: 12_000 })
      await h.service.refresh('t1')
      await flush()
    }

    expect(unrecognisedLogs('warn')).toEqual([
      { shape: 'arn:application-inference-profile', length: APP_PROFILE_ARN.length },
      { shape: 'arn:other', length: ids[1].length },
      { shape: 'custom', length: ids[2].length }
    ])
    const warnText = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(warnText).not.toContain('opus-47-prod')
    expect(warnText).not.toContain('team-')
    expect(warnText).not.toContain('123456789012')
  })

  it('at debug, logs the masked id and its normalised form', async () => {
    await snapshotFor(APP_PROFILE_ARN)
    const [line] = unrecognisedLogs('debug')
    // Sanitized to the 64-char wire bound first, then masked.
    expect(line.modelId).toBe('arn:aws:bedrock:us-east-2:[redacted-account]:application-inference-pro')
    expect(line.normalisedModelId).toBe(
      'arn:aws:bedrock:us-east-2:[redacted-account]:application-inference-profile/opus-47-prod'
    )
  })

  it('dedupes on the normalised id, so two profiles with a shared 64-char prefix are both logged', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    for (const name of ['opus-47-prod', 'opus-47-staging']) {
      const modelId = `arn:aws:bedrock:us-east-2:123456789012:application-inference-profile/${name}`
      h.parseTranscript.mockResolvedValue({ modelId, usedTokens: 12_000 })
      await h.service.refresh('t1')
      await flush()
    }
    expect(unrecognisedLogs('debug').map((m) => m.normalisedModelId)).toEqual([
      'arn:aws:bedrock:us-east-2:[redacted-account]:application-inference-profile/opus-47-prod',
      'arn:aws:bedrock:us-east-2:[redacted-account]:application-inference-profile/opus-47-staging'
    ])
  })

  it('stops logging new ids past the cap, so hostile ids cannot grow the set', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    vi.mocked(logger.warn).mockClear()

    for (let i = 0; i < 100; i++) {
      h.parseTranscript.mockResolvedValue({ modelId: `custom-deployment-${i}`, usedTokens: 12_000 })
      await h.service.refresh('t1')
      await flush()
    }

    expect(unrecognisedLogs()).toHaveLength(32)
  })
})
