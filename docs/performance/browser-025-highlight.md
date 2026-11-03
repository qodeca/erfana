<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Built-in browser: pick highlight latency (025-AC-049)

- **Criterion:** [025-AC-049](../../specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md#025-ac-049-highlight-latency) / 025-NFR-004 – over 200 mouse moves on the React app, each crossing an element boundary, after 20 warm-up moves, the 95th percentile from the input event timestamp to the first frame with the new outline is at most **50 ms**.
- **Result on macOS: pass.** p95 **41.2–41.9 ms** in each of 3 runs (p50 33.8–34.7 ms). 1 move of 600 took longer than 50 ms (55.6 ms).
- **Date:** 2026-11-03. **Code:** branch `feature/built-in-browser` at `9a802d9b` (its app source is that of `b95ca4fc`; the commits after it change documents only), built with `npm run build:e2e`.
- **Bench:** [`e2e/browser-pick-highlight.bench.ts`](../../e2e/browser-pick-highlight.bench.ts) (trace reading in [`e2e/utils/chrome-trace.ts`](../../e2e/utils/chrome-trace.ts)). **Raw data:** [`browser-025-highlight.raw.json`](browser-025-highlight.raw.json) – every move of every run, with the time to the command, the paint and the displayed frame.

## Machine

| | |
|---|---|
| Model and CPU | Apple M5 Pro (`sysctl -n machdep.cpu.brand_string`), 18 cores |
| GPU | Apple M5 Pro, 20 cores, Metal 4 |
| Memory | 64 GB |
| OS | macOS 27.2, build 26B123 (`sw_vers`) |
| Electron | 44.9.3 (Chromium 152.0.7977.167) |
| Rendering mode | GPU compositing on, Skia Graphite on (`app.getGPUFeatureStatus()`) |
| Display | Dell P3424WE, 3440 × 1440 at 60 Hz, scale 1. **Asleep during the runs** (remote screen sharing active); the display link still ticked at 60 Hz – see "Limits" |
| Tab viewport | 573 × 745 CSS px, device pixel ratio 1 |
| Load | 1-minute load average 4.1–4.7 at the end of each run; other agents' work was running on the machine |

## Results

| Run | Moves measured | p50 (ms) | p95 (ms) | Max (ms) | Over 50 ms | Target p95 ≤ 50 ms |
|---|---|---|---|---|---|---|
| 1 | 200 | 33.8 | 41.3 | 55.6 | 1 | Pass |
| 2 | 200 | 33.8 | 41.2 | 43.4 | 0 | Pass |
| 3 | 200 | 34.7 | 41.9 | 43.5 | 0 | Pass |
| All 600 | 600 | 34.0 | 41.4 | 55.6 | 1 | Pass |

No move was missed: in every run each of the 200 measured moves had its input event, its `Overlay.highlightQuad`, an overlay paint before the next move's command and a displayed frame in the trace.

Where the time goes (p50 / p95 over each run):

| Step | p50 (ms) | p95 (ms) |
|---|---|---|
| Input event → Erfana sends `Overlay.highlightQuad` (hit test, label, quad) | 1.2–2.1 | 3.0–3.4 |
| Command → the engine paints the outline (waits for the page's next frame) | 7.8–8.3 | 15.3–16.1 |
| Paint → the frame is displayed (commit, draw, swap, presentation) | 22.8–23.8 | 24.6–35.1 |

Erfana's own share is the first row – a few milliseconds. The rest is Chromium's frame pipeline: waiting for the next frame (up to one 16.7 ms refresh) and about 23 ms from paint to presentation on macOS.

## Method

1. A fresh app launch (`appWithTestProject`, the browser fixture servers) opens a browser tab with **New browser tab**, loads the React 18 sample app (`apps/react18`, home page) and turns on **Pick element**.
2. The targets are every visible element of the page whose centre hits that element itself (33 on this viewport), the header hover menu left out because hovering it changes the layout. Consecutive moves go to different elements, so each move crosses an element boundary.
3. One Chromium performance trace (categories `benchmark`, `devtools`, `devtools.timeline`, `disabled-by-default-devtools.timeline.frame`), started over Playwright's CDP session on the tab, covers 20 warm-up moves and 200 measured ones. Each move is a main-side `sendInputEvent` mouse move to the target's centre (S-27).
4. Per move the trace gives:
   - **start** – the input event's own timestamp: `InputLatency::MouseMove`, component `COMPONENT_INPUT_EVENT_LATENCY_ORIGINAL`;
   - the first `Overlay.highlightQuad` the browser process handled after it, then the engine overlay's first paint after that command (a `Paint` of the overlay page's canvas in the tab's renderer);
   - **end** – the presentation time of the first frame that committed that paint: the end of that frame's `PipelineReporter` slice.
5. **Pacing, without sleeps:** the next move goes out once main's pick hook reports the new element's box and the page's Event Timing observer has received this move's `pointerover` entry, which the engine delivers only after the frame following the move was presented. Neither condition asks the page to render. A move whose outline was replaced by the next one before any frame showed it would count as a miss with an infinite latency; there were none.

Re-run:

```sh
npm run build:e2e
ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=run1 npx playwright test --project=bench e2e/browser-pick-highlight.bench.ts
```

The summary prints as `[bench] browser-025-highlight-<label> {…}`; the full record goes to `.local/bench/browser-025-highlight-<label>.json`.

## Limits

- **macOS only.** The criterion asks for each platform's reference machine; Windows and Linux runs are still to be taken (the bench runs there unchanged).
- **The display was asleep.** Chromium's begin-frame source still ran at 60 Hz (`ExternalBeginFrameSourceMac::OnDisplayLinkCallback` every 16.7 ms in the trace) and every measured move reached a presented frame, so the frame pipeline ran; how a sleeping display changes presentation timing on macOS was not checked; a run with the display awake is still the cleaner record.
- **Development build, not packaged.** The e2e build is unpackaged and carries the test hooks; the pick path measured is the product code.
- **Tracing has a cost.** The trace runs during the measurement, as 025-NFR-004 prescribes; it can only make the numbers higher.
