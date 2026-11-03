// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Chromium performance traces for the `bench` project (spec 025 benches,
 * 025-AC-049 and 025-AC-050): record a trace over Playwright's CDP session,
 * then read when an input event happened and when the first frame that
 * contains a given main-thread change was displayed.
 *
 * Timestamps are Chromium's `TimeTicks` in microseconds. On macOS that is
 * `mach_absolute_time`, the same clock as Node's `process.hrtime` in Electron's
 * main process and in the bench's own Node programs, so a timestamp taken
 * there (in µs) lines up with the trace.
 *
 * "Displayed" is the end of the frame's `PipelineReporter` slice, which
 * Chromium closes at the presentation timestamp the display compositor
 * reports for a presented frame.
 */
import type { CDPSession } from '@playwright/test'

/** The categories the benches read; kept small so the trace stays cheap. */
export const BENCH_TRACE_CATEGORIES: readonly string[] = [
  'benchmark', // InputLatency::* (input event timestamps), PipelineReporter
  'devtools', // DevToolsSession::HandleCommand in Browser (the CDP method)
  'devtools.timeline', // Paint, TimeStamp (console.timeStamp markers)
  'disabled-by-default-devtools.timeline.frame' // PipelineReporter stages
]

export interface TraceEvent {
  name: string
  cat: string
  ph: string
  pid: number
  tid: number
  ts: number
  dur?: number
  id2?: { local?: string; global?: string }
  args?: Record<string, unknown>
}

const PRESENTED_STATES = new Set(['STATE_PRESENTED_ALL', 'STATE_PRESENTED_PARTIAL'])

/** A recording started by {@link startTrace}; `stop` ends it and resolves every event. */
export interface TraceRecording {
  stop(): Promise<TraceEvent[]>
}

async function readStream(cdp: CDPSession, handle: string): Promise<string> {
  const parts: string[] = []
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle })
    parts.push(chunk.base64Encoded === true ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data)
    if (chunk.eof) break
  }
  await cdp.send('IO.close', { handle })
  return parts.join('')
}

/**
 * Start a trace on `cdp` (any page session: Chromium traces every process).
 * `stop` rejects when the trace buffer overflowed, because a bench must not
 * report from a trace with holes in it.
 */
export async function startTrace(cdp: CDPSession, categories: readonly string[] = BENCH_TRACE_CATEGORIES): Promise<TraceRecording> {
  const complete = new Promise<{ stream?: string; dataLossOccurred: boolean }>((resolve) => {
    cdp.once('Tracing.tracingComplete', (event) => resolve(event as { stream?: string; dataLossOccurred: boolean }))
  })
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: { recordMode: 'recordUntilFull', includedCategories: [...categories] }
  })
  return {
    stop: async () => {
      await cdp.send('Tracing.end')
      const done = await complete
      if (done.dataLossOccurred) throw new Error('The trace buffer overflowed: events were lost')
      if (done.stream === undefined) throw new Error('The trace returned no stream')
      const parsed = JSON.parse(await readStream(cdp, done.stream)) as { traceEvents?: TraceEvent[] } | TraceEvent[]
      return Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? [])
    }
  }
}

/** The thread id of a renderer's main thread (`CrRendererMain`), or null when the trace names none. */
export function rendererMainThread(events: readonly TraceEvent[], pid: number): number | null {
  const named = events.find((e) => e.pid === pid && e.name === 'thread_name' && (e.args as { name?: string } | undefined)?.name === 'CrRendererMain')
  return named?.tid ?? null
}

/**
 * The timestamps of the input events the browser process forwarded in
 * [`from`, `to`] (µs): each `InputLatency::<type>` slice's original event
 * timestamp (`COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL`), in order.
 */
export function inputEventTimes(events: readonly TraceEvent[], from: number, to: number, type?: string): number[] {
  const times: number[] = []
  for (const e of events) {
    if (e.ph !== 'b' || !e.name.startsWith('InputLatency::')) continue
    if (type !== undefined && e.name !== `InputLatency::${type}`) continue
    const info = (e.args as { chrome_latency_info?: { component_info?: Array<{ component_type: string; time_us: number }> } } | undefined)
      ?.chrome_latency_info?.component_info
    const original = info?.find((c) => c.component_type === 'COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL')?.time_us
    if (original !== undefined && original >= from && original <= to) times.push(original)
  }
  return times.sort((a, b) => a - b)
}

/** One frame of a renderer as its `PipelineReporter` slice describes it. */
export interface FrameRecord {
  sequence: number
  state: string
  /** The frame's main-thread commit (end of `SendBeginMainFrameToCommit`), or null for a compositor-only frame. */
  commitAt: number | null
  /** When the frame was displayed (the slice's end), for a presented frame. */
  presentedAt: number | null
}

/** Every frame `pid` reported, ordered by frame sequence. */
export function rendererFrames(events: readonly TraceEvent[], pid: number): FrameRecord[] {
  const ordered = events
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.pid === pid && e.id2?.local !== undefined && (e.ph === 'b' || e.ph === 'e'))
    .sort((a, b) => a.e.ts - b.e.ts || a.index - b.index)
  const open = new Map<string, { sequence: number; state: string; commitAt: number | null }>()
  const frames: FrameRecord[] = []
  for (const { e } of ordered) {
    const key = `${e.tid}|${e.id2!.local}`
    if (e.name === 'PipelineReporter' && e.ph === 'b') {
      const reporter = (e.args as { frame_reporter?: { frame_sequence: number; state: string } } | undefined)?.frame_reporter
      if (reporter !== undefined) open.set(key, { sequence: reporter.frame_sequence, state: reporter.state, commitAt: null })
    } else if (e.name === 'SendBeginMainFrameToCommit' && e.ph === 'e') {
      const frame = open.get(key)
      if (frame !== undefined) frame.commitAt = e.ts
    } else if (e.name === 'PipelineReporter' && e.ph === 'e') {
      const frame = open.get(key)
      if (frame === undefined) continue
      open.delete(key)
      frames.push({ ...frame, presentedAt: PRESENTED_STATES.has(frame.state) ? e.ts : null })
    }
  }
  return frames.sort((a, b) => a.sequence - b.sequence)
}

/**
 * When the first frame holding a main-thread change made at `at` (µs) was
 * displayed: the first frame whose main-thread commit comes after `at`, or,
 * when that frame was not presented, the next presented frame after it.
 * Null when the trace holds no such frame.
 */
export function displayedAfter(frames: readonly FrameRecord[], at: number): { sequence: number; presentedAt: number } | null {
  const committed = frames.find((f) => f.commitAt !== null && f.commitAt >= at)
  if (committed === undefined) return null
  const shown = frames.find((f) => f.sequence >= committed.sequence && f.presentedAt !== null)
  return shown === undefined ? null : { sequence: shown.sequence, presentedAt: shown.presentedAt! }
}

/** `console.timeStamp(label)` markers of `pid` whose message starts with `prefix`, in order. */
export function timeStamps(events: readonly TraceEvent[], pid: number, prefix: string): Array<{ ts: number; message: string }> {
  return events
    .filter((e) => e.pid === pid && e.name === 'TimeStamp')
    .map((e) => ({ ts: e.ts, message: String((e.args as { data?: { message?: unknown } } | undefined)?.data?.message ?? '') }))
    .filter((m) => m.message.startsWith(prefix))
    .sort((a, b) => a.ts - b.ts)
}
