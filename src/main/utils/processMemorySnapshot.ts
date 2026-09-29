// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Process memory snapshot for the watcher health line (issue #208).
 *
 * A very large, constantly changing project ran the main process out of heap
 * on Windows and Erfana exited without a trace. The periodic
 * `DirectoryWatcher health` line carries this snapshot so `main.log` shows the
 * heap trend (`heapUsed` against `heapLimit`) and the working set of every
 * Electron process before such an exit.
 *
 * Never throws: each source is read in its own `try`, a failure is reported as
 * `memoryError` (message only) and the other source is still returned. Two
 * synchronous calls, cheap enough for a 120 s interval.
 */
import { app } from 'electron'
import v8 from 'v8'

const BYTES_PER_MB = 1024 * 1024
/** Electron reports `ProcessMetric.memory` in kilobytes. */
const KB_PER_MB = 1024

/** Main-process memory in MB (rounded). */
export interface MainMemoryMb {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  /** V8's heap ceiling – `heapUsed` near it means the process is close to OOM. */
  heapLimit: number
}

/** One Electron process (main, renderer, GPU, utility …) in MB (rounded). */
export interface ProcessMemoryMb {
  type: string
  pid: number
  workingSet: number
  peakWorkingSet: number
}

export interface MemorySnapshot {
  mainMemoryMb?: MainMemoryMb
  processMemoryMb?: ProcessMemoryMb[]
  memoryError?: string
}

const bytesToMb = (bytes: number): number => Math.round(bytes / BYTES_PER_MB)
const kbToMb = (kb: number): number => Math.round(kb / KB_PER_MB)

/** Message only; no `String(value)`, which can itself throw for a hostile value. */
const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unknown error'
}

function readMainMemory(): MainMemoryMb {
  const usage = process.memoryUsage()
  return {
    rss: bytesToMb(usage.rss),
    heapUsed: bytesToMb(usage.heapUsed),
    heapTotal: bytesToMb(usage.heapTotal),
    external: bytesToMb(usage.external),
    heapLimit: bytesToMb(v8.getHeapStatistics().heap_size_limit)
  }
}

function readProcessMemory(): ProcessMemoryMb[] {
  // `app` is read here, inside the caller's `try`, so an environment without
  // it (a test mock, an early start-up call) degrades to `memoryError`.
  return app.getAppMetrics().map((metric) => ({
    type: metric.type,
    pid: metric.pid,
    workingSet: kbToMb(metric.memory.workingSetSize),
    peakWorkingSet: kbToMb(metric.memory.peakWorkingSetSize)
  }))
}

/**
 * Collect main-process memory and per-process working sets.
 *
 * @returns Whatever could be read; `memoryError` names what could not
 */
export function collectMemorySnapshot(): MemorySnapshot {
  const snapshot: MemorySnapshot = {}
  const errors: string[] = []

  try {
    snapshot.mainMemoryMb = readMainMemory()
  } catch (error) {
    errors.push(errorMessage(error))
  }

  try {
    snapshot.processMemoryMb = readProcessMemory()
  } catch (error) {
    errors.push(errorMessage(error))
  }

  if (errors.length > 0) {
    snapshot.memoryError = errors.join('; ')
  }
  return snapshot
}
