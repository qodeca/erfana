// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeStatusService — sticky-window scenarios introduced by #41.
 *
 * Split out of `ClaudeStatusService.test.ts` (already 619 lines) and driven by
 * the SHARED harness, so these cases exercise exactly the same fakes as the main
 * service suite — in particular the `detectWindowSize` default that delegates to
 * the REAL capability registry.
 *
 * Three behaviours live here:
 *  - AC7 / R0': an explicit `/model <id>` standard selection outranks a registry
 *    that says 1M for that very model.
 *  - The canonical sticky key: `claude-haiku-4-5` and its dated snapshot id are
 *    ONE model for latching purposes (the reachable production case — brackets
 *    are stripped long before the service sees an id).
 *  - Provisional vs corroborated latching: a registry-derived 1M must NOT latch;
 *    an observation-corroborated one must.
 *
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §5.3, §9.6, §13 (decision (b))
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { makeHarness, flush } from './__fixtures__/claudeStatusHarness'
import type { ClaudeStatusSnapshot } from '../../../shared/ipc/claude-status-schema'
import {
  detectWindowDetail,
  detectWindowSize,
  __resetSettingsCacheForTests
} from './ClaudeWindowDetector'

/** A settings.json path that deliberately does not exist (no `[1m]` signal). */
const ABSENT_SETTINGS = path.join(os.tmpdir(), 'erfana-sticky-absent-settings.json')

/**
 * The REAL window detector, pinned to an absent settings file. Used where the
 * point of the test is the detector's own rule order (R0'), which the harness's
 * deliberately-simplified fake does not model.
 */
function realDetectWindowSize(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (
      modelId: string,
      used: number,
      forceExtended?: boolean,
      opts?: { forceStandard?: boolean }
    ) => detectWindowSize(modelId, used, forceExtended, { ...opts, settingsPath: ABSENT_SETTINGS })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSettingsCacheForTests()
})

afterEach(() => {
  __resetSettingsCacheForTests()
})

describe('AC7 - an explicit standard /model selection outranks the registry (R0\')', () => {
  it('AC7: reports 200k for claude-opus-5 when modelForcedStandard is set', async () => {
    const detect = realDetectWindowSize()
    const h = makeHarness({ detectWindowSize: detect as never })
    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-opus-5',
      usedTokens: 12_000,
      modelForcedStandard: true
    })

    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    // R0' rides in `opts` so every other call site keeps its 3-arg shape.
    expect(detect).toHaveBeenCalledWith('claude-opus-5', 12_000, false, { forceStandard: true })
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200_000)
    expect(h.emitted.at(-1)?.payload.snapshot?.tooltip).toBe('12k / 200k')
  })

  it('AC7 control: the SAME model reports 1M without the explicit standard selection', async () => {
    // Proves the 200k above comes from R0' and not from the registry simply
    // failing to recognise `claude-opus-5` — the #41 bug itself.
    const detect = realDetectWindowSize()
    const h = makeHarness({ detectWindowSize: detect as never })
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-opus-5', usedTokens: 12_000 })

    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(detect).toHaveBeenCalledWith('claude-opus-5', 12_000, undefined, {})
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)
  })

  it('AC7: an explicit standard selection also drops an already-latched 1M', async () => {
    const detect = realDetectWindowSize()
    const h = makeHarness({ detectWindowSize: detect as never })
    // Observed >200k usage latches a corroborated 1M for this model…
    h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-opus-5', usedTokens: 250_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)

    // …and an explicit `/model claude-opus-5` (no marker) must still win.
    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-opus-5',
      usedTokens: 30_000,
      modelForcedStandard: true
    })
    await h.service.refresh('t1')
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200_000)
  })
})

describe('sticky window - canonical model key drops the snapshot date', () => {
  it('keeps the sticky 1M across claude-haiku-4-5 → claude-haiku-4-5-20251001', async () => {
    // The reachable production case (design §9.6): Claude Code writes both the
    // alias and its dated API id for the same model, and a naive raw-id key would
    // treat the second as a model SWITCH and reset the sticky bit mid-session.
    const h = makeHarness()
    h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-haiku-4-5', usedTokens: 250_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)

    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-haiku-4-5-20251001',
      usedTokens: 30_000,
      justCompacted: true
    })
    await h.service.refresh('t1')
    await flush()

    const last = h.emitted.at(-1)?.payload.snapshot
    expect(last?.modelId).toBe('claude-haiku-4-5-20251001')
    expect(last?.friendlyName).toBe('Haiku 4.5')
    expect(last?.windowSize).toBe(1_000_000)
  })

  it('control: a genuine model switch DOES reset the sticky 1M', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-haiku-4-5', usedTokens: 250_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)

    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 30_000 })
    await h.service.refresh('t1')
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200_000)
  })
})

describe('sticky window - provisional vs corroborated latching (§5.3)', () => {
  it('does NOT latch a registry-derived (provisional) 1M', async () => {
    const h = makeHarness()
    // Pass 1: claude-opus-5 at low usage — 1M comes ONLY from the capability
    // registry, so the badge is an inference and must stay recomputable.
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-opus-5', usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)
    expect(h.emitted.at(-1)?.payload.snapshot?.tooltip).toBe('12k / 1M (inferred)')

    // Pass 2: the detector now says 200k for the same model (e.g. a corrected
    // table, or an environment signal). A latched provisional bit would pin the
    // over-statement for the whole session; it must not.
    h.detectWindowSize.mockResolvedValue(200_000)
    await h.service.refresh('t1')
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200_000)
  })

  it('DOES latch an observation-corroborated 1M', async () => {
    const h = makeHarness()
    // >200k used is physically impossible under a 200k window, so this 1M is
    // observed, not inferred — and must survive a post-compaction token reset.
    h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-sonnet-4-5', usedTokens: 250_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)
    expect(h.emitted.at(-1)?.payload.snapshot?.tooltip).toBe('250k / 1M')

    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-sonnet-4-5',
      usedTokens: 30_000,
      justCompacted: true
    })
    h.detectWindowSize.mockResolvedValue(200_000)
    await h.service.refresh('t1')
    await flush()

    const last = h.emitted.at(-1)?.payload.snapshot
    expect(last?.windowSize).toBe(1_000_000)
    expect(last?.usedTokens).toBe(0)
    // Latched from an observation, so the tooltip does not claim an inference.
    expect(last?.tooltip).toBe('0k / 1M')
  })

  it('latches a fresh /model …[1m] selection (corroborated by the user)', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValueOnce({
      modelId: 'claude-sonnet-4-5',
      usedTokens: 12_000,
      modelForcedExtended: true
    })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)

    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 12_000 })
    h.detectWindowSize.mockResolvedValue(200_000)
    await h.service.refresh('t1')
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)
  })
})

describe('#41 resolveWindow - the corroboration state machine in isolation', () => {
  /**
   * `resolveWindow` was extracted from `runRefresh` so the state machine can be
   * driven directly, with no liveness check, transcript locator or emit in the
   * way. It is private, so these tests reach it through an index signature —
   * deliberate: the alternative is re-deriving each case through five collaborators.
   */
  type ResolveResult = { windowSize: 200000 | 1000000; inferred: boolean } | null
  interface Entry {
    observedExtended?: boolean
    windowModelId?: string
  }

  function resolve(
    h: ReturnType<typeof makeHarness>,
    entry: Entry,
    parsed: Record<string, unknown>,
    isStale: () => boolean = () => false
  ): Promise<ResolveResult> {
    const call = (h.service as unknown as Record<string, unknown>).resolveWindow as (
      e: unknown,
      p: unknown,
      s: () => boolean
    ) => Promise<ResolveResult>
    return call.call(h.service, entry, parsed, isStale)
  }

  it('does NOT latch a registry-derived (provisional) 1M, and marks it inferred', async () => {
    const h = makeHarness()
    const entry: Entry = {}

    const result = await resolve(h, entry, { modelId: 'claude-opus-5', usedTokens: 12_000 })

    expect(result).toEqual({ windowSize: 1_000_000, inferred: true })
    // The sticky bit stays clear: a wrong table row must not hold for the session.
    expect(entry.observedExtended).toBe(false)
    expect(entry.windowModelId).toBe('claude-opus-5-0')
  })

  it('latches an observation-corroborated 1M and stops calling it inferred', async () => {
    const h = makeHarness()
    const entry: Entry = {}

    const result = await resolve(h, entry, { modelId: 'claude-sonnet-4-5', usedTokens: 250_000 })

    expect(result).toEqual({ windowSize: 1_000_000, inferred: false })
    expect(entry.observedExtended).toBe(true)
  })

  it('holds a latched 1M once the corroborating usage disappears (compaction)', async () => {
    const h = makeHarness()
    const entry: Entry = { observedExtended: true, windowModelId: 'claude-sonnet-4-5' }
    h.detectWindowSize.mockResolvedValue(200_000)

    const result = await resolve(h, entry, { modelId: 'claude-sonnet-4-5', usedTokens: 30_000 })

    expect(result).toEqual({ windowSize: 1_000_000, inferred: false })
  })

  it("R0': an explicit standard selection clears the sticky bit and passes forceStandard", async () => {
    const h = makeHarness()
    const entry: Entry = { observedExtended: true, windowModelId: 'claude-opus-5-0' }
    h.detectWindowSize.mockResolvedValue(200_000)

    const result = await resolve(h, entry, {
      modelId: 'claude-opus-5',
      usedTokens: 12_000,
      modelForcedStandard: true
    })

    expect(result).toEqual({ windowSize: 200_000, inferred: false })
    expect(entry.observedExtended).toBe(false)
    expect(h.detectWindowSize).toHaveBeenCalledWith('claude-opus-5', 12_000, false, {
      forceStandard: true
    })

    // M1: `opts` is passed UNCONDITIONALLY, so the common path is proved by its
    // CONTENT — an empty options object — not by argument count. This assertion
    // is what keeps the conditional call from creeping back in; it moved here
    // when the deployment-environment rule and its tests were deleted.
    await resolve(h, {}, { modelId: 'claude-opus-5', usedTokens: 12_000 })
    expect(h.detectWindowSize.mock.calls.at(-1)?.[3]).toEqual({})
  })

  it('a model switch clears the sticky bit before the new model is evaluated', async () => {
    const h = makeHarness()
    const entry: Entry = { observedExtended: true, windowModelId: 'claude-sonnet-4-5' }
    h.detectWindowSize.mockResolvedValue(200_000)

    const result = await resolve(h, entry, { modelId: 'claude-sonnet-4-6', usedTokens: 12_000 })

    expect(result).toEqual({ windowSize: 200_000, inferred: false })
    expect(entry.windowModelId).toBe('claude-sonnet-4-6')
  })

  it('aborts without touching the sticky state when the run goes stale', async () => {
    const h = makeHarness()
    const entry: Entry = { observedExtended: true, windowModelId: 'claude-sonnet-4-5' }

    // A different model at 250k would normally rewrite windowModelId and re-latch.
    const result = await resolve(
      h,
      entry,
      { modelId: 'claude-opus-5', usedTokens: 250_000 },
      () => true
    )

    expect(result).toBeNull()
    expect(entry.observedExtended).toBe(true)
    expect(entry.windowModelId).toBe('claude-sonnet-4-5')
  })
})

describe('#41 snapshot.modelId is sanitized, not merely truncated (security audit INFO-3)', () => {
  it('strips control characters and bidi overrides before the id crosses the bridge', () => {
    // Nothing in src/renderer or src/preload reads `modelId` today, but it is raw
    // transcript text crossing the trust boundary. Truncation alone let C0/C1
    // controls, newlines and bidi overrides through, while `friendlyName` beside
    // it was sanitized — the two fields must agree on what is safe.
    return withSnapshot('claude-opus-\u202E4-\u00088\n', (snapshot) => {
      expect(snapshot?.modelId).toBe('claude-opus-4-8')
      expect(snapshot?.friendlyName).toBe('Opus 4.8')
    })
  })

  it('bounds an oversize model id to the shared length cap', () => {
    return withSnapshot('w'.repeat(4096), (snapshot) => {
      expect(snapshot?.modelId).toHaveLength(64)
    })
  })

  it('leaves an ordinary id byte-identical (decision (b): raw on the wire)', () => {
    return withSnapshot('claude-haiku-4-5-20251001', (snapshot) => {
      expect(snapshot?.modelId).toBe('claude-haiku-4-5-20251001')
    })
  })

  /** Drive one refresh with `modelId` and hand the emitted snapshot to `assert`. */
  async function withSnapshot(
    modelId: string,
    assert: (snapshot: ClaudeStatusSnapshot | null | undefined) => void
  ): Promise<void> {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({ modelId, usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    assert(h.emitted.at(-1)?.payload.snapshot)
  }
})

describe('#41 M4 - an explicitly configured 1M is not labelled an inference', () => {
  it('reports inferred:false when the settings.json [1m] produced the window', async () => {
    // A user who writes `"model": "sonnet[1m]"` into their OWN settings.json has
    // configured 1M explicitly. `windowIsCorroborated` cannot see that signal —
    // it does no I/O — so before this fix the tooltip read `12k / 1M (inferred)`,
    // labelling the user's own configuration a guess. The detection pass reports
    // its own corroboration, which is the only place R3 is visible.
    const h = makeHarness({
      detectWindowSize: vi
        .fn()
        .mockResolvedValue({ windowSize: 1_000_000, corroborated: true, rule: 'R3' })
    })
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-6', usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    const snapshot = h.emitted.at(-1)?.payload.snapshot
    expect(snapshot?.windowSize).toBe(1_000_000)
    expect(snapshot?.tooltip).toBe('12k / 1M')
  })

  it('still labels a REGISTRY-derived 1M as inferred', async () => {
    // The control: same window, same low usage, but the detection pass reports
    // R1 with no corroboration, so the badge must still admit it is an inference.
    const h = makeHarness({
      detectWindowSize: vi
        .fn()
        .mockResolvedValue({ windowSize: 1_000_000, corroborated: false, rule: 'R1' })
    })
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-opus-5', usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.tooltip).toBe('12k / 1M (inferred)')
  })

  it('latches a settings-driven 1M, so a post-compaction reset cannot shrink it', async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce({ windowSize: 1_000_000, corroborated: true, rule: 'R3' })
      .mockResolvedValue({ windowSize: 200_000, corroborated: false, rule: 'R4' })
    const h = makeHarness({ detectWindowSize: detect })
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-6', usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)

    await h.service.refresh('t1')
    await flush()
    expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1_000_000)
  })

  it('a size-only dep contributes no corroboration (every existing mock shape)', async () => {
    // The dep tolerates a plain number; the service then falls back to the
    // in-memory signals, which is exactly today's behaviour for every other test.
    const h = makeHarness({ detectWindowSize: vi.fn().mockResolvedValue(1_000_000) })
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-opus-5', usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted.at(-1)?.payload.snapshot?.tooltip).toBe('12k / 1M (inferred)')
  })

  it('R1m end-to-end: a [1m]-suffixed id is NOT labelled inferred', async () => {
    // Closes the "therefore" in "corroborated, and therefore not inferred": the
    // detector reports corroboration and the service's tooltip must honour it,
    // wired to the REAL detectWindowDetail rather than a mock of my own writing.
    // Sonnet 4.5's exact-map row is 200k, so the 1M can only come from R1m.
    const h = makeHarness({
      detectWindowSize: vi.fn((modelId: string, used: number, forceExtended?: boolean) =>
        detectWindowDetail(modelId, used, forceExtended, { settingsPath: ABSENT_SETTINGS })
      )
    })
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5[1m]', usedTokens: 12_000 })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    const snapshot = h.emitted.at(-1)?.payload.snapshot
    expect(snapshot?.windowSize).toBe(1_000_000)
    expect(snapshot?.tooltip).toBe('12k / 1M')
  })
})
