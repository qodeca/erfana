<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# A program floods the terminal: output batching and flow control (finding [30])

- **Finding:** [30] "Terminal output has no batching or flow control" (lens review of v0.21.0). Branch `fix/terminal-output-batching`.
- **Date:** 2026-10-22. **Host:** Apple M5 Max, 128 GB, macOS 26.6.2, production build (`npx electron-vite build`), Electron 44.9.0. 1-minute load average 4–7 during the runs (other agents were active). Before and after were run interleaved (B, A, B, A) so drift hits both.
- **Data:** 6 runs before, 6 after, each a fresh app launch with the fast e2e shell (`/bin/sh`). Raw per-run data: [`terminal-output-batching.raw.json`](terminal-output-batching.raw.json). Driver: [`terminal-output-batching.ab.sh`](terminal-output-batching.ab.sh); benchmark: [`e2e/terminal-output.bench.ts`](../../e2e/terminal-output.bench.ts).

## The answer

- **The window gets about 380 times fewer IPC messages** for the same output: 560,250 → 1,461 (median) for a 50 MB flood. A message now carries about 51,000 characters instead of ~134.
- **The flood finishes about 7 % sooner**: 12.7 s → 11.8 s from Enter until the last line is in xterm's buffer. The time is set mostly by how fast the shell and the PTY produce output, so the gain is modest; the large saving is in per-message overhead in both processes.
- **The renderer kept up in both versions on this machine**: no long tasks (> 50 ms) were recorded and the renderer heap peaked at 48–61 MB either way. Flow control is the safety net for slower machines and heavier output (colour-heavy TUI redraws, a busy window); it did not have to engage here.

## Before and after

Medians of 6 runs, range in brackets. Command: `yes | head -c 50000000; echo DONE_$((1+1))`. The PTY turns every `\n` into `\r\n`, so 50 MB of input arrives as 75,000,000 characters.

| Measure | Before | After |
|---|---|---|
| `terminal:data` messages to the window | 560,250 (551,407–568,645) | **1,461** (1,423–1,497) |
| Characters per message, mean | 134 (132–136) | 51,353 (50,100–52,706) |
| Enter → end marker received over IPC (ms) | 12,619 (12,287–13,249) | 11,687 (11,386–11,977) |
| Enter → end marker in xterm's buffer (ms) | 12,686 (12,368–13,337) | **11,756** (11,453–11,981) |
| Renderer long tasks (> 50 ms) | 0 | 0 |
| Renderer heap, peak (MB) | 60 (54–61) | 58 (48–58) |

How to read it:

- **"In xterm's buffer"** is polled every 100 ms through the e2e test hook, so it has 100 ms resolution; the IPC timestamp is exact.
- **Characters per message** after the fix sits below the 64 KiB cap because a batch is also sent every 8 ms when the cap is not reached.
- Windows was not measured: the benchmark drives `/bin/sh`, and Windows terminals are batched but never paused (see below).

## What changed

| Layer | Before | After |
|---|---|---|
| Main → renderer | One `terminal:data` message per node-pty chunk | Output is collected per terminal (`src/main/services/terminalOutputFlow.ts`) and sent every 8 ms, or at once at 64 KiB. Order is kept; queued output is always sent before the exit event |
| Back-pressure | None: a slow renderer queued output without bound | The renderer reports parsed output (`terminal:ackOutput`, strict `{ terminalId, chars }` – a count of UTF-16 code units, as `string.length` counts them – owner-checked) once per 32 KiB, using `xterm.write(data, callback)`. Above 512 KiB unacknowledged the PTY is paused (`pty.pause()`), below 128 KiB it resumes – the [xterm.js flow-control guide](https://xtermjs.org/docs/guides/flowcontrol/) |
| Stuck-pause guards | – | A pause is lifted before every kill, window close and quit; after 5 s with no ack; and within 50 ms of the shell dying (node-pty destroys the socket 200 ms after exit, so a still-paused socket would lose its rest) |
| Windows | – | Batched only. node-pty 1.1.0 pauses the socket fed from the ConPTY output pipe, and its clean-up is driven by that socket's data events: after the shell exits the socket is destroyed a fixed time after the last data event (output a pause still holds would be lost), and the conpty.dll kill path disposes the pipe reader only on the next data event |
| Per-chunk work | A debug string built per chunk; a new `activityById` Map and a store notification per chunk | Steady-state output skips the handshake logging; `markActivity` records at most one timestamp per 250 ms per terminal |
| Routing | Already owner-only (`sendToOwner`) | Unchanged: events go to the window that created the terminal |

## Reproduce

```sh
sh docs/performance/terminal-output-batching.ab.sh r1 3
sh docs/performance/terminal-output-batching.ab.sh r2 3
```

`ERFANA_BENCH_BYTES` changes the flood size (default 50,000,000); `ERFANA_BENCH_BASE` the "before" commit (default `origin/develop`). The script swaps only the source files the fix modified, builds, runs, and restores HEAD's files on exit.
