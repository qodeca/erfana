<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Built-in browser: pick highlight latency (025-AC-049)

- **Criterion:** [025-AC-049](../../specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md#025-ac-049-highlight-latency) / 025-NFR-004 – over 200 mouse moves on the React app, each crossing an element boundary, after 20 warm-up moves, the 95th percentile from the input event timestamp to the first frame with the new outline is at most **50 ms**.
- **What is timed:** the live outline is Erfana's band – ink, paper, ink strips on a click-through child window over the page (`src/main/services/browser/pick/pickBand.ts`, ADR 0007 decision 6 as amended 2026-11-05). The bench times pointer move → that band shown at the new element.
- **Result on Linux (Docker, xvfb): pass.** p95 **25.2–25.6 ms** in each of 3 runs (p50 11.0–21.6 ms). No move of 600 took longer than 50 ms (max 38.8 ms).
- **Result on macOS: not yet taken with the band.** The 2026-11-03 macOS record below timed the engine's outline (`Overlay.highlightQuad`), which the band replaced; it is kept as history and does not stand for the band.
- **Date:** 2026-11-05. **Code:** branch `feature/built-in-browser` at `9ce84c01` plus the uncommitted bench rework (the band-draw hook seam and this bench), built in the container with `electron-vite build --mode e2e`.
- **Bench:** [`e2e/browser-pick-highlight.bench.ts`](../../e2e/browser-pick-highlight.bench.ts) (trace reading in [`e2e/utils/chrome-trace.ts`](../../e2e/utils/chrome-trace.ts)). **Raw data:** [`browser-025-highlight-linux.raw.json`](browser-025-highlight-linux.raw.json) – every move of every Linux run, with the input time, the band-draw mark, the band frame's commit and its presentation.

## Machine (Linux)

| | |
|---|---|
| Host | Apple M5 Pro, macOS 27.2, running Docker Desktop |
| Container | `linux-arm64`, kernel 6.8.0-117-generic, 6 cores, 12 GB, the `e2e/docker` image of `scripts/e2e-linux.sh` |
| Display | Xvfb `-screen 0 1920x1080x24`, scale 1; no refresh rate reported (`displayFrequency` 0) – Chromium paces frames on its own 60 Hz timer |
| Electron | 44.9.3 (Chromium 152.0.7977.167) |
| Rendering mode | as `app.getGPUFeatureStatus()` reports it: GPU compositing enabled, Skia Graphite off; under Xvfb there is no hardware GPU, so this is a software GL path (inferred) |
| Tab viewport | 573 × 710 CSS px, device pixel ratio 1; 28 hover targets |
| Load | 1-minute load average 0.7 in the container at the end of each run |

## Results (Linux)

| Run | Moves measured | p50 (ms) | p95 (ms) | Max (ms) | Over 50 ms | Target p95 ≤ 50 ms |
|---|---|---|---|---|---|---|
| 1 | 200 | 11.0 | 25.6 | 27.7 | 0 | Pass |
| 2 | 200 | 19.9 | 25.2 | 26.6 | 0 | Pass |
| 3 | 200 | 21.6 | 25.6 | 38.8 | 0 | Pass |
| All 600 | 600 | 12.2 | 25.6 | 38.8 | 0 | Pass |

No move was missed and every move was paced: in every run each of the 200 measured moves had its input event, a band draw at its element before the next move, a band frame that committed that draw before the band moved on, and that frame's presentation in the trace. In every run all 220 band draws were followed first by a commit of the same browser-process compositor (`layer_tree_host_id` 2), within 0.3–2.7 ms.

Where the time goes (p50 / p95 per run):

| Step | p50 (ms) | p95 (ms) |
|---|---|---|
| Input event → Erfana has set the band's strips (hit test, label, box read, strip bounds) | 3.8–3.9 | 10.1–11.8 |
| Strips set → the band window's frame is presented (wait for the next frame, commit, draw, swap) | 7.1–11.5 | 20.7–20.9 |

## Method

1. A fresh app launch (`appWithTestProject`, the browser fixture servers) opens a browser tab with **New browser tab**, loads the React 18 sample app (`apps/react18`, home page) and turns on **Pick element**.
2. The targets are every visible element of the page whose centre hits that element itself, the header hover menu left out because hovering it changes the layout. Consecutive moves go to different elements, so each move crosses an element boundary.
3. The pick test hook starts recording band draws (`recordBandDraws`, test builds only). One Chromium performance trace (categories `benchmark`, `devtools`, `devtools.timeline`, `disabled-by-default-devtools.timeline.frame`), started over Playwright's CDP session on the tab, covers 20 warm-up moves and 200 measured ones. Each move is a main-side `sendInputEvent` mouse move to the target's centre (S-27).
4. Per move:
   - **start** – the input event's own timestamp from the trace: `InputLatency::MouseMove`, component `COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL`;
   - **band drawn** – the first band draw after it at this move's element (box within 1 CSS px), from the hook's `bandDraws`: main's `process.hrtime` in µs, taken right after the band window's strip views had their bounds, colour and visibility set. On macOS and Linux that clock is the trace's own (`TimeTicks`), so the mark lines up with the trace;
   - **end** – the presentation time of the band window's first frame whose commit came after that mark: the end of that frame's `PipelineReporter` slice, or of the next presented frame of that compositor when that one was not presented.
5. **Why the end is what the user sees.** Setting a view's bounds only marks the band window's layers dirty; nothing is on screen until that window's compositor commits them and its frame is presented – one compositor frame later. The bench measures that frame instead of adding an assumed frame time. The window's compositor runs on the browser process's main thread, the thread that also runs the draw, so no commit can fall between the strips being set and the mark: the first commit after the mark is the first that can hold the new strips, and its presentation is when they are on screen. The band window's compositor is found once per run as the browser-process compositor that commits first after most band draws, and recorded (`environment.bandCompositor`). A frame that committed only after the band had already moved to another element counts as a miss.
6. **Pacing, without sleeps:** the next move goes out once the hook has recorded the band draw at this move's element and the page has then run 3 animation frames (about 50 ms at 60 Hz, past the band frame's presentation, which came 3–23 ms after the draw). The page's frames are not in the measured path – the band is drawn by another compositor. A move whose band was replaced before any frame showed it would count as a miss with an infinite latency, so loose pacing can only make the result worse; there were none.

Re-run on macOS (or any desktop):

```sh
npm run build:e2e
ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=run1 npx playwright test --project=bench e2e/browser-pick-highlight.bench.ts
```

On Linux in Docker: `scripts/e2e-linux.sh` builds and runs the suite in the container but does not pass `ERFANA_E2E_BENCH` into it, so `bash scripts/e2e-linux.sh --project=bench …` alone runs no test. The Linux runs above used the script's own `docker run`, with `-e ERFANA_E2E_BENCH=1 -e ERFANA_BENCH_LABEL=linux<n>` added.

The summary prints as `[bench] browser-025-highlight-<label> {…}`; the full record goes to `.local/bench/browser-025-highlight-<label>.json`. Record format: `summary` (`latencyMs`, `inputToDrawMs`, `drawToPresentedMs` as p50/p95/min/max, `misses`, `unpaced`, `pass`), `environment` (`browserPid`, `tabPid`, versions, GPU status, display, viewport, machine, `bandCompositor` with its votes) and one `samples` entry per measured move (`inputAt`, `drawAt`, `commitAt`, `presentedAt` in trace µs; `frame`; `inputToDrawMs`, `latencyMs`; `miss`).

## Limits

- **Linux in a container only.** The criterion asks for each platform's reference machine: the macOS run with the band is still to be taken, and so is Windows. Xvfb has no real display or vsync, so presentation here is Chromium's own timing on a virtual screen, not a monitor's.
- **Development build, not packaged.** The e2e build is unpackaged and carries the test hooks; the pick path measured is the product code. The hook's seam is one null check on each draw (`BrowserPicks.bandDrawn`), set only by the test hook.
- **Tracing has a cost.** The trace runs during the measurement, as 025-NFR-004 prescribes; it can only make the numbers higher.

## History: macOS, engine outline (2026-11-03, superseded)

Before ADR 0007's 2026-11-05 amendment the live outline was the engine's `Overlay.highlightQuad`, and the bench timed input → that command → the engine overlay's paint in the page → the page frame that showed it. On the macOS reference machine (Apple M5 Pro, 18 cores, 64 GB, macOS 27.2, Electron 44.9.3, display asleep under remote screen sharing, load average 4.1–4.7) at `9a802d9b`, 3 runs of 200 moves gave p95 41.2–41.9 ms and p50 33.8–34.7 ms, with 1 move of 600 over 50 ms (55.6 ms); about 23 ms of each move was the page's paint-to-presentation. Raw data: [`browser-025-highlight.raw.json`](browser-025-highlight.raw.json). That record measures an outline the product no longer draws on macOS; it does not stand for the band.
