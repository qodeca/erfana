<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Built-in browser: send latency (025-AC-050)

- **Criterion:** [025-AC-050](../../specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md#025-ac-050-send-latency) / 025-NFR-005 – over 100 timed picks followed by **Explain** on the React app, the 95th percentile from pick confirmation to the menu appearing is at most **500 ms**, and from selecting **Explain** to the terminal receiving the text at most **2 s**; 20 sends on the worst-case fixture (20,000-character HTML, 1920 × 1080 CSS px at device pixel ratio 2 – S-35) are timed and reported.
- **Result on macOS: pass.** React app: menu p95 **73.3 ms**, Explain → terminal p95 **231.0 ms**. Worst case: menu p95 **148.8 ms**, Explain → terminal p95 **265.8 ms** – also inside both targets.
- **Date:** 2026-11-03. **Code:** branch `feature/built-in-browser` at `9a802d9b` (its app source is that of `b95ca4fc`; the commits after it change documents only), built with `npm run build:e2e`.
- **Bench:** [`e2e/browser-pick-send.bench.ts`](../../e2e/browser-pick-send.bench.ts), the timed stub agent [`e2e/fixtures/browser/stub-agent-timed.cjs`](../../e2e/fixtures/browser/stub-agent-timed.cjs), trace reading in [`e2e/utils/chrome-trace.ts`](../../e2e/utils/chrome-trace.ts). **Raw data:** [`browser-025-send.raw.json`](browser-025-send.raw.json) – every pick, with the menu frame, the page view's removal, the menu bound and the send.

## Machine

| | |
|---|---|
| Model and CPU | Apple M5 Pro (`sysctl -n machdep.cpu.brand_string`), 18 cores |
| GPU | Apple M5 Pro, 20 cores, Metal 4 |
| Memory | 64 GB |
| OS | macOS 27.2, build 26B123 (`sw_vers`) |
| Electron | 44.9.3 (Chromium 152.0.7977.167) |
| Rendering mode | GPU compositing on, Skia Graphite on |
| Display | Dell P3424WE, 3440 × 1440 at 60 Hz, scale 1 (the worst case forces scale 2 with `--force-device-scale-factor=2`). **Asleep during the runs** (remote screen sharing active) – see "Limits" |
| Viewports | React app: 573 × 745 CSS px at ratio 1. Worst case: 1920 × 1080 CSS px at ratio 2 (3840 × 2160 device px) |
| Load | 1-minute load average 3.8–4.0 at the end of each run; other agents' work was running on the machine |

## Results

| Fixture | Picks | Interval | p50 (ms) | p95 (ms) | Max (ms) | Target (p95) | Result |
|---|---|---|---|---|---|---|---|
| React app | 100 | (a) confirm → menu | 71.1 | 73.3 | 76.0 | ≤ 500 ms | Pass |
| React app | 100 | (b) Explain → terminal | 220.9 | 231.0 | 310.4 | ≤ 2,000 ms | Pass |
| Worst case | 20 | (a) confirm → menu | 141.7 | 148.8 | 160.5 | ≤ 500 ms | Pass (reported) |
| Worst case | 20 | (b) Explain → terminal | 260.2 | 265.8 | 266.3 | ≤ 2,000 ms | Pass (reported) |

No pick was missed: every pick had its menu marker, a displayed frame, the Explain marker and the whole prompt at the stub.

How (a) is made up (p50 / p95):

| Fixture | Erfana's frame with the menu displayed | Main removed the page view | (a) as reported |
|---|---|---|---|
| React app | 44.3 / 46.4 ms | 37.8 / 40.0 ms | 71.1 / 73.3 ms |
| Worst case | 130.8 / 147.1 ms | 108.4 / 115.4 ms | 141.7 / 148.8 ms |

The page view has no presentation time of its own, so its removal counts as on screen two display refreshes (33.4 ms) after main removed it. That bound set (a) in all 100 React picks and 16 of the 20 worst-case picks; without it (a) would be the frame column. The worst case is slower, most likely because its capture is a 3840 × 2160 screenshot (inferred, not broken down).

(b) is flat at about 220 ms on the React app. It holds writing the capture files and the bracketed paste; the bench does not break it down further.

## Method

1. A fresh app launch opens a browser tab with **New browser tab**, starts the timed stub agent in Erfana's terminal panel (`node stub-agent-timed.cjs <record>` – a stand-in agent that records every byte and stamps each chunk with `process.hrtime`) and waits until the pick row's target reads "node, target terminal".
2. The worst case loads `long-text.html` (`#exact-20000`, an element whose `outerHTML` is exactly 20,000 characters) with `--force-device-scale-factor=2`; the window is grown, and the editor panel pinned where the screen stops it, until the page reports `innerWidth` 1920, `innerHeight` 1080 and `devicePixelRatio` 2.
3. Per pick: **Pick element** on if it is off; a Chromium trace starts (same categories as the highlight bench); the pointer hovers the target (React app: six elements in turn – a Save label, a card action, an item name, a card title, an item price, the brand link) until main reports its box; **Return** confirms the pick through main-side `sendInputEvent`; Playwright clicks **Explain**; the trace stops once the stub has the whole prompt and Enter.
4. **(a) start:** the Return key's input event timestamp. The trace held no `InputLatency` slice for it in any pick, so the start is main's clock just before `sendInputEvent` – earlier than the event's own timestamp, so it can only lengthen (a).
   **(a) end:** a `console.timeStamp` from a `MutationObserver` in Erfana's window when the prompt-actions panel is inserted; the first frame of that renderer committed after it; its presentation time (`PipelineReporter`). Then the later of that and the page view's removal plus two refreshes (main's `removeChildView`, timed in main).
5. **(b) start:** the Explain click's event timestamp – a capturing click listener in Erfana's window marks the trace with `console.timeStamp` and the delay since `event.timeStamp`, which is subtracted. **(b) end:** the stub's stamp on the chunk that completed the prompt (`ESC[201~` then Enter).
6. The trace clock (Chromium `TimeTicks`) and `process.hrtime` are both `mach_absolute_time` on macOS; the bench rejects a run where any send would land outside 0–60 s of its click.

Re-run (macOS or Linux; the stub agent needs a POSIX shell):

```sh
npm run build:e2e
ERFANA_E2E_BENCH=1 ERFANA_BENCH_LABEL=run1 npx playwright test --project=bench e2e/browser-pick-send.bench.ts
```

The summaries print as `[bench] browser-025-send-{react,worst}-<label> {…}`; full records go to `.local/bench/`.

## Limits

- **macOS only.** The criterion asks for each platform's reference machine; Windows (needs a non-POSIX stand-in agent) and Linux runs are still to be taken.
- **The display was asleep.** Frames were still produced and presented; how a sleeping display changes presentation timing on macOS was not checked, and a run with the display awake is the cleaner record.
- **Confirmation by Return only.** 025-NFR-005 lists click, Return and the second Ctrl/Cmd+E; all three start the same capture, and the bench times Return.
- **Empty-capture retries are not counted.** The intervals include a retry whenever one occurs, but the bench does not record whether one did, so this run does not show its cost.
- **Development build, not packaged**, with tracing running during the measurement; both can only make the numbers higher.
