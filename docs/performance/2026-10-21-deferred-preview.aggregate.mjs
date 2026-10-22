// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Aggregates e2e/preview-typing.bench.ts output into the before/after table of
// docs/performance/2026-10-21-deferred-preview.md.
// Usage: node docs/performance/2026-10-21-deferred-preview.aggregate.mjs .local/bench
/* global process, console -- a Node script; docs/ has no Node globals in the lint config */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] ?? '.local/bench'
const rows = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).summary)
const groups = {
  before: rows.filter((r) => r.label.startsWith('before')),
  after: rows.filter((r) => r.label.startsWith('after'))
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const r1 = (x) => Math.round(x * 10) / 10

const metrics = {
  'keystrokes lost (of 50)': (r) => r.keystrokesLost,
  'typed phrase intact (1 = yes)': (r) => (r.typedIntact ? 1 : 0),
  'per-key INP p50 (ms)': (r) => r.inp.p50,
  'per-key INP p95 (ms)': (r) => r.inp.p95,
  'per-key INP max (ms)': (r) => r.inp.max,
  'keys over 50 ms': (r) => r.inp.over50,
  'long tasks': (r) => r.longTasks.count,
  'long-task time (ms)': (r) => r.longTasks.totalMs,
  'total blocking time (ms)': (r) => r.longTasks.tbtMs,
  'longest task (ms)': (r) => r.longTasks.maxMs,
  'preview renders committed': (r) => r.previewRenders.committed,
  'preview render time, total (ms)': (r) => r.previewRenders.totalMs,
  'preview render time, median (ms)': (r) => r.previewRenders.medianMs,
  'typing wall time (ms)': (r) => r.typingWallMs,
  'settle after last key (ms)': (r) => r.settleMs,
  'first render duration (ms)': (r) => r.firstRender.durationMs,
  'first render, after click (ms)': (r) => r.firstRender.afterClickMs,
  'renders while opening': (r) => r.openRenders,
  'opening settled, after click (ms)': (r) => r.openSettledAfterClickMs,
  'load average, 1 min': (r) => r.loadAvg1m
}

console.log(`runs: before ${groups.before.length}, after ${groups.after.length}`)
console.log('| Measure | Before: median (range) | After: median (range) |')
console.log('|---|---|---|')
for (const [name, pick] of Object.entries(metrics)) {
  const cell = (g) => {
    const v = g.map(pick)
    return `${r1(median(v))} (${r1(Math.min(...v))}–${r1(Math.max(...v))})`
  }
  console.log(`| ${name} | ${cell(groups.before)} | ${cell(groups.after)} |`)
}
