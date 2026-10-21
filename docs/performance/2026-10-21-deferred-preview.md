<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Typing in a large Markdown file: the deferred preview (finding [31])

- **Finding:** [31] "The preview is rebuilt on every keystroke" (lens review of v0.21.0, Wave 4 of v0.22.0). Branch `perf/deferred-preview`, PR #290.
- **Date:** 2026-10-21. **Host:** Apple M5 Max, 128 GB, macOS 26.6.2, production build (`npx electron-vite build`), Electron 44.9.0. The machine was **heavily loaded** – a VM and other agents' Electron test runs were active, 1-minute load average 24–41 (recorded per run). Before and after were run interleaved (B, A, B, A) so drift hits both; absolute numbers are inflated, the before/after gap is the signal.
- **Data:** 6 runs before, 6 after, each a fresh app launch on a fresh project. Raw per-run data: [`2026-10-21-deferred-preview.raw.json`](2026-10-21-deferred-preview.raw.json). These numbers are for the code after the PR #290 review fixes; a first round on the pre-review code (load 12–13) gave the same picture: 23.5 → 0 lost keystrokes, total blocking time 1,350 → 75 ms, 52 → 6 renders.

## The answer

- **No keystrokes were lost in the benchmark** (was 22–24 of 50 in every run, with the cursor jumping to the end of the file). This is a symptom of a separate editor-wrapper race that the old slow renders kept triggering; the race itself is still there and is tracked separately – see "Why keystrokes were lost".
- **The main thread is free while typing:** 52 → 5 long tasks, total blocking time **2,214 → 132 ms** (−94 %).
- **The preview re-renders 52 → 6 times** for 50 keystrokes; total preview render time 4.7 s → 0.49 s.
- **The first render is not delayed** (139 → 123 ms, within noise), and the document is fully settled **sooner** after opening (395 → 198 ms) because the open no longer renders twice.

## Before and after

Medians of 6 runs, range in brackets.

| Measure | Before | After |
|---|---|---|
| Keystrokes lost (of 50) | 24 (22–24) | **0** (0–0) |
| Typed phrase arrived intact | never | every run |
| Per-key input-to-next-paint, p50 (ms) | 64 (56–88) | 24 (16–24) |
| Per-key input-to-next-paint, p95 (ms) – indicative | 120 (72–128) | 88 (32–104) |
| Per-key input-to-next-paint, max (ms) – indicative | 144 (88–168) | 100 (88–120) |
| Keys slower than 50 ms | 44 (33–50) | 3 (1–4) |
| Long tasks (> 50 ms) | 52 (52–53) | **5** (5–6) |
| Long-task time (ms) | 4,839 (4,363–5,513) | 382 (348–499) |
| Total blocking time (ms) | 2,214 (1,763–2,863) | **132** (98–199) |
| Longest task (ms) | 165 (108–184) | 90 (80–105) |
| Preview renders committed | 52 (52–53) | **6** (5–7) |
| Preview render time, total (ms) | 4,708 (4,213–5,347) | 495 (383–619) |
| Preview render time, median per render (ms) | 86 (80–100) | 73 (68–87) |
| Typing wall time for 50 keys at 80 ms (ms) | 7,012 (6,187–7,947) | 4,456 (4,278–4,637) |
| Last key → preview shows it (ms) | 346 (311–468) | 194 (152–246) |
| First render, duration (ms) | 139 (114–159) | 123 (107–170) |
| First render, after the click (ms) | 227 (179–261) | 198 (175–245) |
| Renders while opening | 2 | 1 |
| Opening settled, after the click (ms) | 395 (340–434) | 198 (175–245) |

How to read it:

- **One render still costs ~70–90 ms** for this document – the fix makes the preview render far less often and out of the way of typing; it does not make one render cheaper. The 5–7 renders that remain are the first two edits (measured to decide the mode), the releases after a pause, and the release forced by the 1 s maximum wait.
- **p95 and max per key are indicative only:** 50 keys per run, Event Timing rounds to 8 ms and ignores anything under 16 ms, and on this loaded machine a single scheduler hiccup moves them. The robust measures are long tasks, total blocking time and keys slower than 50 ms.
- **"Last key → preview"** went down even though the preview now waits for a pause: before, the preview was always busy with a stale render when the last key landed.
- **Typing wall time** is the time Playwright needed to deliver 50 keys at an 80 ms cadence; 4.0 s is the floor. Before, each key waited for the previous render.

## What changed

| Layer | Before | After |
|---|---|---|
| When the body re-parses | Every keystroke, synchronously | Live while re-renders fit a frame (≤ 16 ms) or the document is under 2,000 characters. After **two slow re-renders in a row** it waits for a 150 ms pause in typing, at most 1 s; two fast ones in a row switch it back |
| Priority | Same as the keystroke | `useDeferredValue` – a keystroke arriving mid-render is handled first. A release forced by the 1 s maximum wait (or by `flush()`) renders at **normal priority**, so the preview is never more than about 1 s plus one render behind |
| Export (PDF / DOCX) | Read whatever the preview showed | Calls the preview's `flush()` first: releases any held-back render, waits for it to commit and for Mermaid diagrams to finish drawing (each wait capped at 5 s) |
| Link checks | Re-run on every keystroke (1–3 `file.exists` calls per link), then a second full render | Re-run only when the set of links changes; stale results are discarded; an equal result causes no render |
| Renderer map | Rebuilt whenever link state changed – React then **remounted the whole preview**, Mermaid diagrams included | Stable for the life of the panel; link state reaches links through context |
| Heading ids | Counter kept in the renderer map, so a re-render with the same map renumbered them (`#example` → `#example-2`); hidden only because the map was rebuilt after every link check | Assigned in the parse (`rehypeHeadingIds`), the same every time; an id a heading earned by its own text is never handed out twice (`Example`, `Example`, `Example 2` → `example`, `example-2`, `example-2-2`) |
| Front-matter line offset | Baked into the renderer map | Applied in the parse (`rehypeShiftLines`) |
| Mermaid | Redrawn on every change to its source | Redrawn 300 ms after its source stops changing (code and line range debounced together); first draw immediate; an older, slower draw can never overwrite a newer one |
| Scroll sync | Rebuilt its map on every editor content change, listening for diagrams on the preview element it first saw | Rebuilds only when the preview reports its DOM changed (`onRendered`), measuring the root it reports – so it keeps working after `split` ↔ `split-horizontal` remounts the preview |

### Why keystrokes were lost (inferred)

The cursor jumping to the end of the file plus dropped characters matches `@monaco-editor/react`'s controlled-value effect: when the `value` prop differs from the editor's buffer it replaces the **whole** buffer (`executeEdits` over the full range with `forceMoveMarkers`). With ~75 ms renders per keystroke, keystrokes landed between a render and that effect, so the effect "restored" an older buffer. Making the keystroke render cheap closes the window in this benchmark (80 ms between keys). The race itself is **still in the editor wrapper** and is tracked separately: an unpaced burst of programmatic edits (Playwright `insertText` back to back) still trips it in about half the runs, on this branch before and after the preview change alike, which is why `e2e/preview-deferred.e2e.ts` paces its edits.

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

The "before" numbers come from commit `372ae6fc` (the harness alone, on top of `develop` at `caf59f4d`): every source file the fix modified is reverted to that commit, files it added stay unused. The "after" numbers come from the review-fix commit. Both used the same benchmark file.

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
