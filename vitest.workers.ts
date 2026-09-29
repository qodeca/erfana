// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// Worker cap shared by every vitest entry point (issue #171).
//
// vitest's default is one worker per core minus one, per invocation. Several
// agents (and the gate) each starting a run on one machine therefore stacked
// 7-10 workers apiece and drove a 10-core Mac to a load of 120-166. The cap is a
// percentage of the cores, never a fixed number: a worker ceiling is a property
// of a machine, not of the project.
//
// vitest 3 reads `maxWorkers` from the ROOT config only (the one the run was
// started with), so this value is set in `vitest.config.ts` (bare `vitest` and
// `--workspace` runs) and in each `vitest.<project>.ts` (`--config` runs).
// A per-project value under the workspace is ignored.
//
// Override per machine or per run with VITEST_MAX_WORKERS: a positive integer
// ("8") or a percentage of the cores ("75%"). vitest's own VITEST_MAX_FORKS also
// still wins over this value for the forks pool.
import os from 'node:os'

/** Default share of the cores a single vitest run may use. */
export const DEFAULT_WORKER_PERCENT = 50

/**
 * Lowest default worker count. A 4-core CI runner would otherwise drop to 2 by
 * percentage anyway; the floor keeps a 2- or 3-core machine from dropping to 1.
 */
export const MIN_DEFAULT_WORKERS = 2

function cpuCount(): number {
  return Math.max(1, os.availableParallelism?.() ?? os.cpus().length)
}

function percentOf(percent: number, cpus: number): number {
  return Math.max(1, Math.min(cpus, Math.round((percent / 100) * cpus)))
}

/**
 * Resolve the worker cap from the environment and the core count.
 * An override that is not a positive integer or a 1-100 percentage is ignored
 * with a warning, so a typo cannot silently uncap a run.
 */
export function resolveMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
  cpus: number = cpuCount()
): number {
  const raw = env.VITEST_MAX_WORKERS?.trim()
  if (raw) {
    const percent = /^(\d{1,3})%$/.exec(raw)
    if (percent && Number(percent[1]) >= 1 && Number(percent[1]) <= 100) {
      return percentOf(Number(percent[1]), cpus)
    }
    if (/^\d{1,4}$/.test(raw) && Number(raw) >= 1) return Number(raw)
    console.warn(
      `[vitest.workers] ignoring VITEST_MAX_WORKERS=${JSON.stringify(raw)}: expected a positive integer or a 1-100 percentage`
    )
  }
  return Math.min(cpus, Math.max(MIN_DEFAULT_WORKERS, percentOf(DEFAULT_WORKER_PERCENT, cpus)))
}

/** The cap for this process, resolved once when a config loads. */
export const maxWorkers = resolveMaxWorkers()
