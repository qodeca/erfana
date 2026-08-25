// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared test harness for {@link ClaudeStatusService} (#41 §9.6).
 *
 * Extracted so every service test file drives the SAME fake collaborators. The
 * `detectWindowSize` fake deliberately delegates to the REAL
 * {@link windowForModelId}: a hand-rolled copy of the registry rule would let a
 * test file pass while exercising a different system than production. If you
 * change this default, change it here — never by re-implementing it.
 *
 * Not collected by vitest: the filename carries no `.test.` segment.
 *
 * @see docs/designs/41-model-capability-registry.md §9.6
 */
import { vi } from 'vitest'
import { ClaudeStatusService, type ClaudeStatusDeps } from '../ClaudeStatusService'
import { EXTENDED_WINDOW } from '../ClaudeWindowDetector'
import { windowForModelId } from '../modelId'
import type { IClaudeProcessDetector } from '../process/types'
import type { ClaudeStatusChangePayload } from '../../../../shared/ipc/claude-status-schema'

/** Minimal fake watcher implementing the surface ClaudeStatusService uses. */
export function makeFakeWatcher() {
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

export type FakeWatcher = ReturnType<typeof makeFakeWatcher>

export interface Harness {
  service: ClaudeStatusService
  detector: { isClaudeRunning: ReturnType<typeof vi.fn> }
  locateTranscripts: ReturnType<typeof vi.fn>
  parseTranscript: ReturnType<typeof vi.fn>
  detectWindowSize: ReturnType<typeof vi.fn>
  watcher: FakeWatcher
  emit: ReturnType<typeof vi.fn>
  emitted: Array<{ wc: number; payload: ClaudeStatusChangePayload }>
}

export function makeHarness(overrides?: Partial<ClaudeStatusDeps>): Harness {
  const emitted: Array<{ wc: number; payload: ClaudeStatusChangePayload }> = []
  const detector = { isClaudeRunning: vi.fn() }
  const locateTranscripts = vi.fn().mockResolvedValue(['/root/ENC/session.jsonl'])
  const parseTranscript = vi.fn().mockResolvedValue({ modelId: 'claude-opus-4-8', usedTokens: 95329 })
  // Default mirrors the real registry by CALLING it: a registry-1M model (incl.
  // claude-opus-4-8) is 1M even under 200k usage; everything else with low usage
  // is 200k.
  const detectWindowSize = vi
    .fn()
    .mockImplementation(async (modelId: string, used: number, forceExtended?: boolean) =>
      forceExtended || windowForModelId(modelId) === EXTENDED_WINDOW || used > 200000
        ? 1000000
        : 200000
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
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
