<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Typing in a large Markdown file: the deferred preview (finding [31])

- **Finding:** [31] "The preview is rebuilt on every keystroke" (lens review of v0.21.0, Wave 4 of v0.22.0). Branch `perf/deferred-preview`.
- **Date:** 2026-10-21. **Host:** Apple M5 Max, 128 GB, macOS 26.6.2, production build (`npx electron-vite build`), Electron 44.9.0. The machine was **not idle** – a VM and other Electron test runs were active, 1-minute load average 12–13 throughout (recorded per run). Before and after were run interleaved (B, A, B, A) so drift hits both.
- **Data:** 6 runs before, 6 after, each a fresh app launch on a fresh project. Raw per-run data: [`2026-10-21-deferred-preview.raw.json`](2026-10-21-deferred-preview.raw.json).

## The answer

- **Typing no longer loses characters.** Before, about **half the keystrokes never reached the document** (23–24 of 50 lost in every run) and the cursor jumped to the end of the file. After: 0 lost in every run.
- **The main thread is free while typing:** 52 → 5 long tasks, total blocking time **1,350 → 75 ms** (−94 %).
- **The preview re-renders 52 → 6 times** for 50 keystrokes; total preview render time 3.8 s → 0.43 s.
- **The first render is not delayed** (104 → 106 ms, within noise), and the document is fully settled **sooner** after opening (308 → 175 ms) because the open no longer renders twice.

## Before and after

Medians of 6 runs, range in brackets.

| Measure | Before | After |
|---|---|---|
| Keystrokes lost (of 50) | 23.5 (23–24) | **0** (0–0) |
| Typed phrase arrived intact | never | every run |
| Per-key input-to-next-paint, p50 (ms) | 40 (40–40) | 24 (16–24) |
| Per-key input-to-next-paint, p95 (ms) | 68 (56–88) | 56 (32–56) |
| Per-key input-to-next-paint, max (ms) | 104 (88–168) | 80 (64–96) |
| Keys slower than 50 ms | 9 (8–14) | 3 (2–3) |
| Long tasks (> 50 ms) | 52 (52–53) | **5** (4–5) |
| Long-task time (ms) | 3,962 (3,914–4,001) | 325 (261–332) |
| Total blocking time (ms) | 1,350 (1,314–1,367) | **75** (61–82) |
| Longest task (ms) | 111 (96–168) | 76 (74–77) |
| Preview renders committed | 52 (52–53) | **6** (4–6) |
| Preview render time, total (ms) | 3,828 (3,785–3,867) | 432 (279–462) |
| Preview render time, median per render (ms) | 72 (70–72) | 70 (67–74) |
| Typing wall time for 50 keys at 80 ms (ms) | 5,649 (5,592–5,727) | 4,408 (4,336–4,415) |
| Last key → preview shows it (ms) | 314 (305–356) | 223 (77–300) |
| First render, duration (ms) | 104 (103–114) | 106 (105–116) |
| First render, after the click (ms) | 166 (162–183) | 175 (172–186) |
| Renders while opening | 2 | 1 |
| Opening settled, after the click (ms) | 308 (286–313) | 175 (172–186) |

How to read it:

- **One render still costs ~70 ms** for this document – the fix makes the preview render far less often and out of the way of typing; it does not make one render cheaper. The 4–6 renders that remain are the ones released by a pause or by the 1 s maximum wait.
- **"Last key → preview"** went down even though the preview now waits for a pause: before, the preview was always busy with a stale render when the last key landed.
- **Typing wall time** is the time Playwright needed to deliver 50 keys at an 80 ms cadence; 4.0 s is the floor. Before, each key waited for the previous render.
- **First render after the click** is 9 ms higher at the median with overlapping ranges; the render itself is unchanged. Treated as noise on a loaded machine, not as a regression – worth re-checking on an idle machine.

## What changed

| Layer | Before | After |
|---|---|---|
| When the body re-parses | Every keystroke, synchronously | Live while a re-render fits a frame (≤ 16 ms) or the document is under 2,000 characters; otherwise after a 150 ms pause in typing, at most 1 s behind |
| Priority | Same as the keystroke | `useDeferredValue` – a keystroke arriving mid-render is handled first |
| Link checks | Re-run on every keystroke (1–3 `file.exists` calls per link), then a second full render | Re-run only when the set of links changes; stale results are discarded; an equal result causes no render |
| Renderer map | Rebuilt whenever link state changed – React then **remounted the whole preview**, Mermaid diagrams included | Stable for the life of the panel; link state reaches links through context |
| Heading ids | Counter kept in the renderer map, so a re-render with the same map renumbered them (`#example` → `#example-2`); hidden only because the map was rebuilt after every link check | Assigned in the parse (`rehypeHeadingIds`), the same every time |
| Front-matter line offset | Baked into the renderer map | Applied in the parse (`rehypeShiftLines`) |
| Mermaid | Redrawn on every change to its source | Redrawn 300 ms after its source stops changing; first draw immediate |
| Scroll sync | Rebuilt its map on content change | Also rebuilds when the preview raises `preview:rendered`, i.e. when the DOM actually changed |

### Why keystrokes were lost (inferred)

The cursor jumping to the end of the file plus dropped characters matches `@monaco-editor/react`'s controlled-value effect: when the `value` prop differs from the editor's buffer it replaces the **whole** buffer (`executeEdits` over the full range with `forceMoveMarkers`). With ~75 ms renders per keystroke, keystrokes landed between a render and that effect, so the effect "restored" an older buffer. Making the keystroke render cheap closes the window in this benchmark; the race itself is still in the editor wrapper and could reappear under other heavy work. That is a separate defect worth its own issue.

## Method

The benchmark is [`e2e/preview-typing.bench.ts`](../../e2e/preview-typing.bench.ts), run by the env-gated `bench` Playwright project:

1. A deterministic ~3,000-line document ([`e2e/fixtures/previewBenchDocument.ts`](../../e2e/fixtures/previewBenchDocument.ts)): front matter, 52 sections (3,023 lines) each with headings, prose, internal links (to a real file and to missing ones), an external link, a TypeScript block, a 6-row GFM table, a task list, a quote, an inline `data:` image, an ordered list, a `<details>` block; a Mermaid flowchart every tenth section (5 in total). 80,036 characters.
2. Open it, switch to split view, wait for all 5 diagrams and then for 1.5 s without a long task.
3. Click the end of line 8 in Monaco, type one space (and wait for it to reach the document), then start recording.
4. Type `the quick brown fox jumps over the lazy dog abcdef` (50 characters) with `page.keyboard.type(…, { delay: 80 })` – real key events, about 12 characters a second.
5. Wait until the preview shows the first typed character, then for 1.5 s without a long task; read the results.

What is recorded, in the renderer:

- **Per-key input-to-next-paint:** the Event Timing API (`PerformanceObserver` type `event`, `durationThreshold: 16`, the lowest allowed), longest entry per `interactionId`. A key with no entry was faster than 16 ms and counts as 0.
- **Long tasks:** `PerformanceObserver` type `longtask`; total blocking time is the sum of each task's time past 50 ms.
- **Preview renders:** start and commit of each body render, from opt-in timing in the app ([`utils/previewRenderTiming.ts`](../../src/renderer/src/utils/previewRenderTiming.ts)): off unless the benchmark installs `window.__erfanaPreviewRenderTiming`. React's `<Profiler>` does not report in production builds. Under concurrent rendering the span is wall time, so a render React paused for a keystroke reads longer than its CPU cost.
- **Keystrokes lost:** 50 minus the growth of the document length (the stats bar's character count, which reads the same state the preview renders).

The "before" numbers come from commit `372ae6fc` (the harness alone, on top of `develop` at `caf59f4d`), the "after" numbers from the fix commit; both used the same benchmark file.

## Reproduce

```sh
npm ci
# one round: before (3 runs), then after (3 runs); needs a clean working tree
sh docs/performance/2026-10-21-deferred-preview.ab.sh r1 3
sh docs/performance/2026-10-21-deferred-preview.ab.sh r2 3
node docs/performance/2026-10-21-deferred-preview.aggregate.mjs .local/bench
```

Or only the current code: `npx electron-vite build && ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=after npx playwright test --project=bench --workers=1`. Knobs: `ERFANA_BENCH_RUNS` (default 3), `ERFANA_BENCH_LINES` (default 3000), `ERFANA_BENCH_OUT` (default `.local/bench`). Keep the machine as idle as you can and interleave before/after rounds; absolute numbers move with load, the before/after ratio much less.

## Not measured

- Windows and slower machines. The live/debounced switch is driven by the measured render cost, so a slower machine debounces smaller documents – by design, but not observed here.
- Typing inside a Mermaid block (the 300 ms redraw delay) and pasting large blocks.
- Memory.
