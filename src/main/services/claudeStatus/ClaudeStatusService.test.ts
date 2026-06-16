// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { ClaudeStatusService, type ClaudeStatusDeps } from './ClaudeStatusService'
import type { IClaudeProcessDetector } from './process/types'
import type { ClaudeStatusChangePayload } from '../../../shared/ipc/claude-status-schema'
import { modelNativelySupportsExtended } from './ClaudeWindowDetector'

/** Minimal fake watcher implementing the surface ClaudeStatusService uses. */
function makeFakeWatcher() {
  const watchDir = vi.fn()
  const unwatchDir = vi.fn()
  const closeAll = vi.fn().mockResolvedValue(undefined)
  let onChangeCb: ((dir: string) => void) | null = null
  const onChange = vi.fn((cb: (dir: string) => void) => {
    onChangeCb = cb
  })
  return {
    watchDir,
    unwatchDir,
    closeAll,
    onChange,
    /** Drive a transcript-dir change as the real watcher would. */
    fire: (dir: string) => onChangeCb?.(dir)
  }
}

type FakeWatcher = ReturnType<typeof makeFakeWatcher>

interface Harness {
  service: ClaudeStatusService
  detector: { isClaudeRunning: ReturnType<typeof vi.fn> }
  locateTranscripts: ReturnType<typeof vi.fn>
  parseTranscript: ReturnType<typeof vi.fn>
  detectWindowSize: ReturnType<typeof vi.fn>
  watcher: FakeWatcher
  emit: ReturnType<typeof vi.fn>
  emitted: Array<{ wc: number; payload: ClaudeStatusChangePayload }>
}

function makeHarness(overrides?: Partial<ClaudeStatusDeps>): Harness {
  const emitted: Array<{ wc: number; payload: ClaudeStatusChangePayload }> = []
  const detector = { isClaudeRunning: vi.fn() }
  const locateTranscripts = vi.fn().mockResolvedValue(['/root/ENC/session.jsonl'])
  const parseTranscript = vi.fn().mockResolvedValue({ modelId: 'claude-opus-4-8', usedTokens: 95329 })
  // Default mirrors the real registry: Opus 4.6+ (incl. claude-opus-4-8) is
  // auto-1M even under 200k usage; everything else with low usage is 200k.
  const detectWindowSize = vi
    .fn()
    .mockImplementation(async (modelId: string, used: number, forceExtended?: boolean) =>
      forceExtended || modelNativelySupportsExtended(modelId) || used > 200000 ? 1000000 : 200000
    )
  const watcher = makeFakeWatcher()
  const emit = vi.fn((wc: number, payload: ClaudeStatusChangePayload) => {
    emitted.push({ wc, payload })
  })

  detector.isClaudeRunning.mockResolvedValue({ running: true })

  const service = new ClaudeStatusService({
    detector: detector as unknown as IClaudeProcessDetector,
    locateTranscripts,
    parseTranscript,
    detectWindowSize,
    watcher: watcher as never,
    emit,
    ...overrides
  })

  return { service, detector, locateTranscripts, parseTranscript, detectWindowSize, watcher, emit, emitted }
}

/** Flush all pending microtasks (lets serialized refresh chains settle). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('ClaudeStatusService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits a correct snapshot for a running session with a valid transcript', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/Users/x/proj', 7)
    await flush()

    expect(h.emitted).toHaveLength(1)
    const { wc, payload } = h.emitted[0]
    expect(wc).toBe(7)
    expect(payload.terminalId).toBe('t1')
    expect(payload.snapshot).not.toBeNull()
    expect(payload.snapshot).toMatchObject({
      terminalId: 't1',
      modelId: 'claude-opus-4-8',
      friendlyName: 'Opus 4.8',
      // claude-opus-4-8 is auto-upgraded to 1M (registry), so an under-200k turn
      // now correctly reports the 1M window — the #216 UAT fix.
      windowSize: 1000000,
      usedTokens: 95329,
      // 95329 / 1000000 = 9.53 → floored to 9 (clampPercent uses Math.floor so
      // the display never enters a band before the colour does — CORRECTNESS-1).
      percent: 9,
      level: 'green',
      tooltip: '95k / 1M'
    })
  })

  it('resets to ~0% after a compaction while keeping model + window', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-opus-4-8',
      usedTokens: 95329,
      justCompacted: true
    })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].payload.snapshot).not.toBeNull()
    expect(h.emitted[0].payload.snapshot).toMatchObject({
      modelId: 'claude-opus-4-8',
      friendlyName: 'Opus 4.8',
      windowSize: 1000000,
      usedTokens: 0,
      percent: 0,
      level: 'green',
      tooltip: '0k / 1M'
    })
  })

  it('detects the window on the REAL pre-compaction tokens so the badge stays stable', async () => {
    const h = makeHarness()
    // A 200k-family model (Sonnet 4.5) whose pre-compaction usage exceeded 200k,
    // which is the only signal keeping it at the 1M window. detectWindowSize MUST
    // see 250000 (not the reset 0) or the badge would flicker back to 200k.
    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-sonnet-4-5',
      usedTokens: 250000,
      justCompacted: true
    })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.detectWindowSize).toHaveBeenCalledWith('claude-sonnet-4-5', 250000, undefined)
    expect(h.emitted[0].payload.snapshot?.windowSize).toBe(1000000)
    expect(h.emitted[0].payload.snapshot?.usedTokens).toBe(0)
    expect(h.emitted[0].payload.snapshot?.percent).toBe(0)
  })

  it('passes usedTokens through unchanged when not compacted', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-opus-4-8',
      usedTokens: 95329,
      justCompacted: false
    })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted[0].payload.snapshot?.usedTokens).toBe(95329)
    expect(h.emitted[0].payload.snapshot?.tooltip).toBe('95k / 1M')
  })

  it('formats the 1M tooltip and badge for an extended window', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-opus-4-8', usedTokens: 250000 })
    h.detectWindowSize.mockResolvedValue(1000000)
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted[0].payload.snapshot?.tooltip).toBe('250k / 1M')
    expect(h.emitted[0].payload.snapshot?.windowSize).toBe(1000000)
  })

  it('snapshot percent (floored) and level (raw) agree at a band boundary', async () => {
    // 119200 / 200000 = 59.6 → display floors to 59; the colour reads the raw
    // 59.6 and stays amber. Floored display must not read "60" (red). Uses a
    // 200k model (Sonnet 4.5) so the window is genuinely 200k.
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 119200 })
    h.detectWindowSize.mockResolvedValue(200000)
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted[0].payload.snapshot?.percent).toBe(59)
    expect(h.emitted[0].payload.snapshot?.level).toBe('amber')
  })

  it('forces the 1M window from a /model …[1m] override (modelForcedExtended)', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({
      modelId: 'claude-sonnet-4-6',
      usedTokens: 50000,
      modelForcedExtended: true
    })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    // The forceExtended hint is forwarded as the third arg and forces 1M even for
    // a 200k-family model (Sonnet 4.6) under 200k usage.
    expect(h.detectWindowSize).toHaveBeenCalledWith('claude-sonnet-4-6', 50000, true)
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].payload.snapshot).toMatchObject({
      modelId: 'claude-sonnet-4-6',
      friendlyName: 'Sonnet 4.6',
      windowSize: 1000000,
      usedTokens: 50000,
      // 50000 / 1000000 = 5 → 5%.
      percent: 5
    })
  })

  it('passes a falsy forceExtended for a normal turn (no override) and behaves as before', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 50000 })
    h.detectWindowSize.mockResolvedValue(200000)
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    const thirdArg = h.detectWindowSize.mock.calls[0][2]
    expect(thirdArg).toBeFalsy()
    expect(h.emitted[0].payload.snapshot?.windowSize).toBe(200000)
    expect(h.emitted[0].payload.snapshot?.usedTokens).toBe(50000)
  })

  it('emits {snapshot:null} when claude is not running', async () => {
    const h = makeHarness()
    h.detector.isClaudeRunning.mockResolvedValue({ running: false })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].payload.snapshot).toBeNull()
  })

  it('emits null when pid is undefined (fail-closed)', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', undefined, '/p', 7)
    await flush()

    expect(h.detector.isClaudeRunning).not.toHaveBeenCalled()
    expect(h.emitted[0].payload.snapshot).toBeNull()
  })

  it('emits null when the transcript cannot be located', async () => {
    const h = makeHarness()
    h.locateTranscripts.mockResolvedValue([])
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted[0].payload.snapshot).toBeNull()
  })

  it('emits null when the transcript cannot be parsed', async () => {
    const h = makeHarness()
    h.parseTranscript.mockResolvedValue(null)
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.emitted[0].payload.snapshot).toBeNull()
  })

  it('uses the live process cwd (not spawn cwd) to locate the transcript', async () => {
    const h = makeHarness()
    h.detector.isClaudeRunning.mockResolvedValue({ running: true, cwd: '/live/cwd' })
    h.service.registerPanel('t1', 4242, '/spawn/cwd', 7)
    await flush()

    // No startedAtMs from the detector → no floor (undefined) is passed.
    expect(h.locateTranscripts).toHaveBeenCalledWith('/live/cwd', undefined)
  })

  it('falls back to spawn cwd when the process has no live cwd', async () => {
    const h = makeHarness()
    h.detector.isClaudeRunning.mockResolvedValue({ running: true })
    h.service.registerPanel('t1', 4242, '/spawn/cwd', 7)
    await flush()

    expect(h.locateTranscripts).toHaveBeenCalledWith('/spawn/cwd', undefined)
  })

  it("forwards the running claude's start time as the transcript-selection floor (#216)", async () => {
    const h = makeHarness()
    h.detector.isClaudeRunning.mockResolvedValue({
      running: true,
      cwd: '/live/cwd',
      startedAtMs: 1_700_000_000_000
    })
    h.service.registerPanel('t1', 4242, '/spawn/cwd', 7)
    await flush()

    expect(h.locateTranscripts).toHaveBeenCalledWith('/live/cwd', 1_700_000_000_000)
  })

  it('hides the bar on a fresh launch when the floor excludes every prior transcript (#216)', async () => {
    const h = makeHarness()
    // Detector reports a running claude with a start time; the floored locator
    // finds no transcript newer than the launch (the new session has no turn yet).
    h.detector.isClaudeRunning.mockResolvedValue({
      running: true,
      cwd: '/live/cwd',
      startedAtMs: 1_700_000_000_000
    })
    h.locateTranscripts.mockResolvedValue([])
    h.service.registerPanel('t1', 4242, '/spawn/cwd', 7)
    await flush()

    // Self-sufficient: prove BOTH that the floor was forwarded AND that a null
    // locate result hides the bar — not split across two separate tests.
    expect(h.locateTranscripts).toHaveBeenCalledWith('/live/cwd', 1_700_000_000_000)
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].payload.snapshot).toBeNull()
  })

  it('generation guard: a slow refresh resolving after a re-register does not emit its own (stale) result', async () => {
    const h = makeHarness()

    // First detection resolves LATE and reports a STALE model so we could tell
    // its emit apart; it must be dropped by the generation guard.
    let resolveFirst!: (v: { running: boolean }) => void
    const firstDetect = new Promise<{ running: boolean }>((r) => {
      resolveFirst = r
    })
    h.detector.isClaudeRunning.mockReturnValueOnce(firstDetect)

    h.service.registerPanel('t1', 4242, '/p', 7) // run A — parked on firstDetect
    await flush()
    expect(h.emitted).toHaveLength(0)

    // Re-register bumps generation while A is parked. Its refresh is queued behind
    // the in-flight A (serialized), and the default detector/parser apply to it.
    h.detector.isClaudeRunning.mockResolvedValue({ running: true })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    // Now release A. Its captured generation is stale → A aborts WITHOUT emitting
    // (right after its detector resolves); the queued run B then runs exactly once
    // and emits the single current snapshot. No duplicate/stale emit from A.
    resolveFirst({ running: true })
    await flush()

    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].payload.snapshot?.modelId).toBe('claude-opus-4-8')
  })

  it('emits null and never locates a transcript for a cwd with a control char', async () => {
    const h = makeHarness()
    // Live cwd carrying a newline (control char) — must be rejected fail-closed
    // BEFORE transcript location (§10 cwd sanitization).
    h.detector.isClaudeRunning.mockResolvedValue({ running: true, cwd: '/evil\ncwd' })
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()

    expect(h.locateTranscripts).not.toHaveBeenCalled()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].payload.snapshot).toBeNull()
  })

  it('serializes overlapping refreshes and runs queue-latest once more', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    const baseline = h.detector.isClaudeRunning.mock.calls.length

    // Make the detector slow so the first refresh stays in-flight.
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => {
      resolveGate = r
    })
    h.detector.isClaudeRunning.mockImplementation(async () => {
      await gate
      return { running: true }
    })

    const r1 = h.service.refresh('t1') // starts, parks on gate
    const r2 = h.service.refresh('t1') // in-flight → queued
    const r3 = h.service.refresh('t1') // in-flight → queued (latest)

    resolveGate()
    await Promise.all([r1, r2, r3])
    await flush()

    // One run for r1, then exactly one more for the queued-latest = 2 extra calls.
    const extra = h.detector.isClaudeRunning.mock.calls.length - baseline
    expect(extra).toBe(2)
  })

  it('unregisterPanel is idempotent and unwatches the dir', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await flush()
    expect(h.watcher.watchDir).toHaveBeenCalled()

    h.service.unregisterPanel('t1')
    expect(h.watcher.unwatchDir).toHaveBeenCalledWith(expect.any(String), 't1')

    // Second call + unknown id are safe.
    expect(() => h.service.unregisterPanel('t1')).not.toThrow()
    expect(() => h.service.unregisterPanel('unknown')).not.toThrow()
  })

  it('cleanupForWebContentsId removes all terminals for that webContents', async () => {
    const h = makeHarness()
    h.service.registerPanel('t1', 1, '/p', 7)
    h.service.registerPanel('t2', 2, '/p', 7)
    h.service.registerPanel('t3', 3, '/p', 99)
    await flush()

    h.service.cleanupForWebContentsId(7)

    // t1 + t2 removed → re-refresh is a no-op (emits nothing new).
    const before = h.emitted.length
    void h.service.refresh('t1')
    void h.service.refresh('t2')
    await flush()
    expect(h.emitted.length).toBe(before)

    // t3 still tracked.
    const beforeT3 = h.emitted.length
    void h.service.refresh('t3')
    await flush()
    expect(h.emitted.length).toBeGreaterThan(beforeT3)
  })

  it('nudge is gated to one refresh per second', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await vi.advanceTimersByTimeAsync(0)
    const baseline = h.detector.isClaudeRunning.mock.calls.length

    h.service.nudge('t1')
    h.service.nudge('t1') // within 1s → ignored
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(0)

    const extra = h.detector.isClaudeRunning.mock.calls.length - baseline
    expect(extra).toBe(1)
  })

  it('dispose closes the watcher and clears pending timers', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    h.service.registerPanel('t1', 4242, '/p', 7)
    await vi.advanceTimersByTimeAsync(0)

    await h.service.dispose()
    expect(h.watcher.closeAll).toHaveBeenCalledTimes(1)

    // After dispose, a refresh on the cleared entry is a no-op.
    const before = h.emitted.length
    void h.service.refresh('t1')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.emitted.length).toBe(before)
  })

  it('two terminals in the same folder each watch the dir and emit to their own webContents', async () => {
    const h = makeHarness()
    h.detector.isClaudeRunning.mockResolvedValue({ running: true, cwd: '/shared/folder' })
    h.service.registerPanel('t1', 11, '/shared/folder', 7)
    h.service.registerPanel('t2', 22, '/shared/folder', 9)
    await flush()

    // Same dir watched once per terminal (refcount lives in the watcher).
    const watchedDirs = h.watcher.watchDir.mock.calls.map((c) => c[1])
    expect(watchedDirs).toContain('t1')
    expect(watchedDirs).toContain('t2')
    const dirA = h.watcher.watchDir.mock.calls.find((c) => c[1] === 't1')?.[0]
    const dirB = h.watcher.watchDir.mock.calls.find((c) => c[1] === 't2')?.[0]
    expect(dirA).toBe(dirB)

    // Each terminal emitted to its own webContents.
    const wcsByTerminal = new Map<string, number>()
    for (const { payload, wc } of h.emitted) wcsByTerminal.set(payload.terminalId, wc)
    expect(wcsByTerminal.get('t1')).toBe(7)
    expect(wcsByTerminal.get('t2')).toBe(9)
  })

  it('a watcher onChange for a dir refreshes only terminals watching that dir', async () => {
    const h = makeHarness()
    h.detector.isClaudeRunning.mockResolvedValue({ running: true, cwd: '/folder/a' })
    h.service.registerPanel('t1', 11, '/folder/a', 7)
    await flush()
    const watchedDir = h.watcher.watchDir.mock.calls[0][0]

    const before = h.emitted.length
    h.watcher.fire(watchedDir)
    await flush()
    expect(h.emitted.length).toBeGreaterThan(before)

    // An unrelated dir change triggers nothing.
    const before2 = h.emitted.length
    h.watcher.fire('/some/other/dir')
    await flush()
    expect(h.emitted.length).toBe(before2)
  })

  describe('sticky 1M window + cache eviction (hardening)', () => {
    it('keeps the 1M window after a post-compaction reset shrinks the detected window (finding #5)', async () => {
      const h = makeHarness()
      // Pass 1: a 200k-family model (Sonnet 4.5) whose >200k usage is the ONLY 1M
      // signal → detected window is 1M, so the sticky bit is set.
      h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-sonnet-4-5', usedTokens: 250000 })
      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1000000)

      // Pass 2: post-compaction reset to a small count. detectWindowSize would now
      // return 200k, but the sticky bit must keep the badge at 1M (no visible snap-back).
      h.parseTranscript.mockResolvedValue({
        modelId: 'claude-sonnet-4-5',
        usedTokens: 30000,
        justCompacted: true
      })
      await h.service.refresh('t1')
      await flush()

      expect(h.detectWindowSize).toHaveBeenLastCalledWith('claude-sonnet-4-5', 30000, undefined)
      const last = h.emitted.at(-1)?.payload.snapshot
      expect(last?.windowSize).toBe(1000000) // stayed 1M despite detection → 200k
      expect(last?.usedTokens).toBe(0)
    })

    it('drops the sticky 1M window when the pid changes (new session) (finding #5)', async () => {
      const h = makeHarness()
      h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 250000 })
      h.service.registerPanel('t1', 100, '/p', 7)
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1000000)

      // New session under the same terminalId but a different pid → sticky resets,
      // so a low-usage Sonnet turn must re-resolve to the 200k window.
      h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 30000 })
      h.service.registerPanel('t1', 200, '/p', 7)
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200000)
    })

    it('forgets the detector cache entry for the pid on unregister (finding #2)', async () => {
      const forget = vi.fn()
      const detector = {
        isClaudeRunning: vi.fn().mockResolvedValue({ running: true }),
        forget
      }
      const h = makeHarness({ detector: detector as unknown as IClaudeProcessDetector })
      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()

      h.service.unregisterPanel('t1')
      expect(forget).toHaveBeenCalledWith(4242)
    })
  })

  describe('turn-aware transcript selection (bar-never-shows bug)', () => {
    it('skips a metadata-only sidecar and uses the next candidate that parses', async () => {
      const h = makeHarness()
      // Newest candidate is a metadata sidecar (ai-title/last-prompt/mode → no
      // usable turn → parse null); the second is the real conversation transcript.
      h.locateTranscripts.mockResolvedValue(['/enc/sidecar.jsonl', '/enc/real.jsonl'])
      h.parseTranscript
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ modelId: 'claude-opus-4-8', usedTokens: 95329 })

      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()

      expect(h.parseTranscript).toHaveBeenNthCalledWith(1, '/enc/sidecar.jsonl')
      expect(h.parseTranscript).toHaveBeenNthCalledWith(2, '/enc/real.jsonl')
      const snap = h.emitted.at(-1)?.payload.snapshot
      expect(snap).not.toBeNull()
      expect(snap?.modelId).toBe('claude-opus-4-8')
    })

    it('hides the bar when every candidate parses to no usable turn', async () => {
      const h = makeHarness()
      h.locateTranscripts.mockResolvedValue(['/enc/a.jsonl', '/enc/b.jsonl'])
      h.parseTranscript.mockResolvedValue(null)

      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()

      expect(h.parseTranscript).toHaveBeenCalledTimes(2)
      expect(h.emitted.at(-1)?.payload.snapshot).toBeNull()
    })

    it('hides the bar when there are no candidate transcripts', async () => {
      const h = makeHarness()
      h.locateTranscripts.mockResolvedValue([])

      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()

      expect(h.parseTranscript).not.toHaveBeenCalled()
      expect(h.emitted.at(-1)?.payload.snapshot).toBeNull()
    })

    it('stops at MAX_PARSE_ATTEMPTS (6) and does not parse every candidate', async () => {
      const h = makeHarness()
      h.locateTranscripts.mockResolvedValue([
        'a.jsonl',
        'b.jsonl',
        'c.jsonl',
        'd.jsonl',
        'e.jsonl',
        'f.jsonl',
        'g.jsonl'
      ])
      h.parseTranscript.mockResolvedValue(null)

      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()

      expect(h.parseTranscript).toHaveBeenCalledTimes(6)
      expect(h.emitted.at(-1)?.payload.snapshot).toBeNull()
    })
  })

  describe('context-window changes mid-session (per-model window)', () => {
    it('downgrades 1M→200k when the model switches (Opus → Sonnet)', async () => {
      const h = makeHarness()
      h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-opus-4-8', usedTokens: 95329 })
      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1000000)

      // Same session (pid), user switches to Sonnet with low usage.
      h.parseTranscript.mockResolvedValue({ modelId: 'claude-sonnet-4-5', usedTokens: 30000 })
      await h.service.refresh('t1')
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200000)
      expect(h.emitted.at(-1)?.payload.snapshot?.modelId).toBe('claude-sonnet-4-5')
    })

    it('upgrades 200k→1M when the model switches (Sonnet → Opus)', async () => {
      const h = makeHarness()
      h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-sonnet-4-5', usedTokens: 30000 })
      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200000)

      h.parseTranscript.mockResolvedValue({ modelId: 'claude-opus-4-8', usedTokens: 50000 })
      await h.service.refresh('t1')
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1000000)
    })

    it('downgrades 1M→200k when [1m] is dropped on the SAME model (modelForcedStandard)', async () => {
      const h = makeHarness()
      // Sonnet observed at 1M (e.g. earlier usage > 200k).
      h.parseTranscript.mockResolvedValueOnce({ modelId: 'claude-sonnet-4-5', usedTokens: 250000 })
      h.service.registerPanel('t1', 4242, '/p', 7)
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(1000000)

      // Same model, low usage, explicit standard override → must drop the sticky.
      h.parseTranscript.mockResolvedValue({
        modelId: 'claude-sonnet-4-5',
        usedTokens: 30000,
        modelForcedStandard: true
      })
      await h.service.refresh('t1')
      await flush()
      expect(h.emitted.at(-1)?.payload.snapshot?.windowSize).toBe(200000)
    })
  })
})
