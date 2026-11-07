// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Summaries and output for the `bench` project's spec 025 benches: nearest-rank
 * percentiles, the machine the run was taken on, and one JSON record per run
 * under `$ERFANA_BENCH_OUT` (default `.local/bench/`).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export const BENCH_OUT_DIR = process.env.ERFANA_BENCH_OUT ?? path.join(__dirname, '..', '..', '.local', 'bench')

/** Nearest-rank percentile `p` (0–100) of `values`; NaN for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)))
  return sorted[rank - 1]
}

export interface LatencySummary {
  count: number
  p50: number
  p95: number
  max: number
  min: number
}

const round = (n: number): number => Math.round(n * 10) / 10

/** p50, p95, min and max of `ms`, rounded to 0.1 ms. */
export function summarise(ms: readonly number[]): LatencySummary {
  return {
    count: ms.length,
    p50: round(percentile(ms, 50)),
    p95: round(percentile(ms, 95)),
    max: round(Math.max(...ms)),
    min: round(Math.min(...ms))
  }
}

/** Where the run was taken: OS, CPU, memory and the 1-minute load average at the end. */
export function machine(): Record<string, string | number> {
  return {
    platform: `${process.platform}-${process.arch}`,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    loadAvg1m: round(os.loadavg()[0])
  }
}

/** Write `record` to `<BENCH_OUT_DIR>/<name>.json` and print its summary line. */
export async function writeBenchRecord(name: string, record: { summary: unknown } & Record<string, unknown>): Promise<string> {
  await fs.promises.mkdir(BENCH_OUT_DIR, { recursive: true })
  const file = path.join(BENCH_OUT_DIR, `${name}.json`)
  await fs.promises.writeFile(file, JSON.stringify(record, null, 2), 'utf-8')
  console.log(`[bench] ${name} ${JSON.stringify(record.summary)}`)
  return file
}
