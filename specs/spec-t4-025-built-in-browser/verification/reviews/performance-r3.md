# Performance review – spec 025 (round 3)

Reviewer: `erfana:performance-reviewer` (independent agent, not an author), 2026-11-05, against `898c9c34` (round 3).


Score: 8/10
Counts: critical 0, high 0, medium 2, low 6

Verdict: ready. No finding is high. Two medium findings remain, both with a clear, local fix.

Reviewer: `erfana:performance-reviewer`, an independent agent that did not write the code. Reviewed 2026-11-05 against `898c9c34`. I ran nothing: no Playwright, no Docker, no build. Only the bench records under `docs/performance/` count as measured. Everything else is suspected, inferred from reading the code.

Assumed load: one window with 1–4 browser tabs, mostly showing a local dev server. Pick mode is used in bursts, with a few Up/Down steps per pick. A coding agent streams output to the terminal the whole time.

## Findings

### [medium] The React 19 source-map lookup reads, decodes and parses up to 8 MiB on main's thread for every pick and every Up/Down step, with no cache
- **Area:** hot-path, memory
- **Location:**
  - `src/main/services/browser/capture/sourceMapLocation.ts:184` – `const scriptText = await fetchPageText(lookup.fetch, script.href, SCRIPT_MAX_BYTES, lookup.signal)`
  - `sourceMapLocation.ts:190` – `const map = parseSourceMap(loaded.text, loaded.mapUrl)`, which does `JSON.parse(json)` and `new AnyMap(...)` at `:137-139`
  - `sourceMapLocation.ts:122` – an inline map is decoded with `Buffer.from(payload, 'base64').toString('utf8')`
  - `:220` – `originalPositionFor` decodes the whole `mappings` string on first use
  - `pageResourceFetch.ts:47-67` – the chunks are collected and then copied into one buffer, so the bytes are briefly held twice before `TextDecoder` makes a third, string copy
- **How often it runs:**
  - Once per confirm: `BrowserTabPick.ts:369`, `capture.hints()`
  - Once per Up/Down step to an element not yet read: `pickMenu.ts:76` → `BrowserCapture.ts:153-160`. The result is kept only per chain index, within one capture.
  - The send waits for it too: `BrowserCapture.ts:171`.
- **The time limit does not stop the CPU work.** The 750 ms budget only aborts the fetch (`sourceHints.ts:199-200`, `budget.abort()`). If the bytes arrived before the limit, the parse and decode still run on main's thread, and the result is thrown away.
- **Status:** suspected. Only the size is measured: about 2.8 MB on the React 19 fixture (`docs/technical-debt.md:1187`). How long main is blocked is not measured.
  - To measure: time `locateInSourceMap` in `pickCaptureReads.ts:152`, split into fetch, base64 and JSON parse, and `originalPositionFor`. Do it on the React 19 fixture and on a large webpack/Next dev bundle near the 8 MiB limit.
  - Also take a main-thread trace during 5 Up/Down steps.
- **Impact:**
  - While the parse runs, main handles nothing else. Terminal output, key and mouse routing for every tab, and band redraws all wait.
  - All elements from one module usually share one script and map, so each refine step reads the same 2.8 MB again.
  - The same steps leave tens of MB of short-lived memory per lookup (inferred: the decoded map plus the segment arrays).
  - Debt entry 71 records the network re-read ("Nothing is cached"). It does not record the main-thread cost or the multiplying by refine steps. Its "revisit when" only fires on a missed 750 ms budget, and this cost can block main without ever missing that budget.
- **Fix:** Keep the parsed map in a small per-tab cache (for example, the last 2–4 script URLs). Clear it on navigation and when pick mode ends.
  - Staleness risk: low. Vite and webpack change the script URL or the bundle on hot reload, and the cache is cleared at navigation. A server that serves a new bundle at the same URL within one pick session would give a stale line.
  - The next step, if measured as slow: parse in the `worker_thread` that debt entry 70 already plans.
- **Confidence:** medium.

### [medium] The 025-AC-050 send record no longer matches the code: three costs added since it was measured sit on its measured path
- **Area:** hot-path (evidence)
- **Location:** `docs/performance/browser-025-send.md:10` – "branch `feature/built-in-browser` at `9a802d9b`"; `specs/spec-t4-025-built-in-browser/verification/manual-evidence.md:19`
- **What is now on the path (each verified in code):**
  - **Paint wait before every capture.** It sits inside (a), confirm → menu: `BrowserTabPick.ts:149-151` → `pickPainted.ts:42-55`. It costs two frames, and up to 250 ms on a page that is busy or throttled.
  - **React 19 source-map hints.** The send waits for them (`BrowserCapture.ts:171`). They are capped at 750 ms (`sourceHints.ts:39`) and land inside (b), Explain → terminal, when Explain is clicked before they finish. The bench uses the React 18 app (`browser-025-highlight.md:47`, same fixture servers), so it never runs this path.
  - **Settle-based Enter (#449).** The bench's end mark is the chunk that ends in `` `${PASTE_END}\r` `` (`e2e/browser-pick-send.bench.ts:72`), so it includes Enter. With the echoing stub (`stub-agent-timed.cjs:46`), Enter now waits at least 200 ms plus 400 ms of quiet (`terminalInputSettle.ts:24-26,72`). Before, it was a fixed 200 ms.
  - **The queue.** A second prompt to the same terminal now waits for the first one's Enter (`useTerminalStore.ts:198-206`). With a busy agent that never goes quiet, that wait can reach 8 s (`terminalInputSettle.ts:36`).
- **Status:**
  - Measured at `9a802d9b`: (a) p95 73.3 ms, (b) p95 231.0 ms.
  - Not measured at HEAD. Inferred: (b) is now about 0.8–1.6 s in the worst React 19 case. That still passes the 2 s target, but the margin drops from about 9× to about 1.3×.
- **Impact:** The pass recorded for an acceptance criterion rests on code that has changed in the measured interval. This was round 2's low finding; for the send bench it has become larger, because the new costs sit directly on the measured path.
- **Fix:** Re-run `e2e/browser-pick-send.bench.ts` at HEAD, and add a React 19 fixture run. Record whether Enter's wait ended as "settled", "no-output" or "cap".
  - Trade-off: about 15 minutes of machine time. It can be folded into owner item 52's macOS session.
- **Confidence:** high that the record is stale; medium on the inferred numbers.

### [low] The paint wait runs on every capture, including when Erfana's band drew the outline (the band never appears in the screenshot)
- **Location:**
  - `src/main/services/browser/pick/BrowserTabPick.ts:150` – `await pagePainted(deps.contents, deps.clock)`
  - `pickPainted.ts:8-10` – its own comment says the band "is never in the page's image"
  - `pickHighlight.ts:121-123` – only the engine fallback (`shownOn !== null`) leaves an outline in the page
- **Status:** suspected. To measure: the split of (a) at HEAD, from the re-run above.
- **Impact:**
  - About 2 frames (around 33 ms at 60 Hz) per confirm, out of a 500 ms target.
  - Up to 250 ms when the page's main thread is busy or the page is throttled.
  - The empty-capture retry (`pickCaptureReads.ts:88-95`) waits a second time.
- **Fix:** Wait only when the engine's outline was showing before `hide()`.
  - Trade-off: the module comment also cites "any other change just made to the page". If such a change exists, name it, or keep the wait and accept the cost.
- **Confidence:** medium.

### [low] Each tab keeps its band window and six listeners on its parent window for the tab's whole life, not just while picking
- **Location:**
  - `pickBandWindow.ts:84-89` – `for (const [name, listener] of listeners) parent.on(name as 'move', listener)`
  - `pickBand.ts:202-205` – `hide()` only hides; the window is destroyed only in `dispose()` at tab close (`BrowserTabPick.ts:266`)
- **Status:** suspected.
  - To measure: open 12 tabs, pick once in each, then watch for `MaxListenersExceededWarning` on the window's `closed` and `move` events (inferred limit: Node's default of 10, shared with other listeners).
  - Also check the native memory of the hidden windows.
- **Impact:**
  - One hidden borderless window with no renderer per tab that ever picked.
  - Each `move` event of the window runs every band's `redraw()`. That call returns early when nothing is outlined (`pickBand.ts:176`), so the CPU cost is tiny. The main risk is warning noise, with small native memory at 1–4 tabs.
- **Fix:** Destroy the surface when pick mode ends (`stop()`). The next pick re-opens it lazily at its first draw (`pickBand.ts:221-231`).
  - Trade-off: one window creation on the first hover of each pick session. Its latency is not measured.
- **Confidence:** medium.

### [low] Handles for the ancestor chain still pile up for every element the pointer rests on (unchanged from round 2)
- **Location:**
  - `pickHover.ts:179` – `if (this.hovered === hovered) void this.chainOf(hovered).catch(() => undefined)`
  - They are released only when pick mode ends (`pickModeSwitch.ts`, `releaseAll`)
- **Status:** suspected. To measure: rest on 50 elements of a 20-deep tree, then count the page's remote objects.
- **Impact:** Memory in the page's renderer, not in Erfana. It is freed when pick mode ends or the page navigates.
- **Fix:** Release the frame's object group when the hovered element changes and its chain was never used.
- **Confidence:** medium.

### [low] The bounds loop still runs on every frame while a tab is visible (unchanged from round 2)
- **Location:** `src/renderer/src/components/Panels/BrowserPanel/useBrowserBounds.ts:136-139` – `const tick = (): void => { if (!running) return; sync(false); frame = requestAnimationFrame(tick) }`
- **Status:** suspected. It sends nothing over IPC when the bounds have not changed.
- **Impact:** Steady style and layout reads while the app is idle with a browser tab shown.
- **Fix:** Run the loop only for the first few frames after a show or re-parent, then rely on `ResizeObserver` and dockview's layout events.
- **Confidence:** medium.

### [low] 025-AC-082 (cold start with the cookie-encryption fuse) has no record, no evidence row and no owner-queue item
- **Location:**
  - `specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md:108` (⬜)
  - No match for `025-AC-082` in `verification/manual-evidence.md`
  - No `docs/performance/browser-025-*` file for it
  - Only `.local/autopilot.md:73` says "AC-082 cold start needs packaged builds – open". The current Owner queue (`:96-131`) does not list it.
- **Status:** not measured.
- **Impact:** A release-gate bench (`architecture/001-solution-design.md:335`) could be forgotten. The start-up cost itself is expected to be small (ADR 0010 item 5, inferred there).
- **Fix:** Add an owner-queue item, or an evidence row marked "pending packaged builds".
- **Confidence:** high.

### [low] The highlight record names code that is not a commit
- **Location:** `docs/performance/browser-025-highlight.md:12` – "at `9ce84c01` plus the uncommitted bench rework"
- **Status:** measured (the Linux runs), but against a working tree that cannot be checked out again.
- **Impact:** Weak traceability only. The doc says the product pick path did not change in the rework, and the hook adds one null check per draw (`:71`).
- **Fix:** Change the code line to name `9a9cbfbd` or later when the macOS run (owner item 52) is added.
- **Confidence:** high.

## What is strong

- **The band's latency is measured, with a careful method.**
  - Linux results: p95 25.2 / 25.6 / 25.6 ms against the 50 ms target, with 0 misses and 0 unpaced moves in each run (`browser-025-highlight-linux.raw.json:10-34`, `:2496-2520`, `:4982-5006`). That matches the doc's table.
  - The end mark is the band compositor's presented frame, not an assumed frame time (`browser-025-highlight.md:52-55`). Loose pacing can only count against the result (`:55`).
  - Main's share is small: input → strips set has p95 10.1–11.8 ms (`:42`).
- **The band adds little per hover.**
  - The surface is a `BaseWindow` with plain `View`s: no `webContents`, so no renderer process (`pickBandWindow.ts:58-83`).
  - It is opened lazily at the first draw (`pickBand.ts:221-231`).
  - The window's bounds are set only when they change (`pickBandWindow.ts:101-104`).
  - A placement push does nothing when nothing is outlined (`pickBand.ts:176`).
- **Scroll handling is cheap.** Each wheel event costs one `suspend()`, which does nothing after the first, plus a timer reset. There is one box read after 150 ms of quiet (`pickHighlight.ts:141-152`), and a newer hover cancels it through the generation check (`:189-191`).
- **The comment echo filter is cheaper than the brief says.** It does not hash on every watch event. It reads and hashes once, and only for the first event after Erfana's own write; every other event is sent at once with no read (`fileCommentEchoes.ts:68-80`).
- **The source-map read is bounded.**
  - A declared `Content-Length` over the limit is refused before the body is read (`pageResourceFetch.ts:42-45`).
  - A body that grows past the limit is cancelled mid-stream (`:55-58`).
  - The stack text is cut to 8 KiB (`sourceMapLocation.ts:81`).
  - It is skipped while the page is frozen (`pickCaptureReads.ts:127`).
- **The queued send is bounded.** Every wait has a limit (`terminalInputSettle.ts:31-38`), and a send cannot reject and jam the queue (`useTerminalStore.ts:219-256`).
- **Round-2 findings fixed or recorded:**
  - The `data:` URL counting is fixed (`cdpFloodBudget.ts:75-78`).
  - The `useNavFold` canvas is now reused (`useNavFold.ts:92`).
  - The PNG encode on main's thread is recorded as debt with a fix (`docs/technical-debt.md:1171-1179`).

## Owner-pending items seen (not scored)

- **Item 52:** the macOS run of the band bench and the full macOS e2e at `898c9c34`. Until it runs, AC-049 has no macOS record of the drawn band, and the 41 ms macOS record timed the engine outline (`browser-025-highlight.md:11`, `:76`).
- **Item 27:** the live outline on Retina (2×) screens needs a manual check at UAT.
- **Item 51:** the Linux container re-downloads Electron on every start. This affects bench reproducibility, not the product.
- **The Windows and Linux runs of the AC-050 send bench** are still to be taken (`browser-025-send.md:70`).

## Score rationale

- **No critical or high finding.** The new outline band is measured on Linux at about half the 50 ms target, and its code adds very little per hover.
- **Two medium findings:**
  - The React 19 source-map parse on main's thread, repeated with no cache. It is local to one module, and the fix is a small cache.
  - The AC-050 record is stale. The fix is to re-run the bench.
- **The anchor.** Both mediums are local with a clear fix, which matches anchor 8: "No critical or high finding; medium findings are few, local and have a clear fix."
- **What would make it a 9:** fix the cache, or measure the parse as small. Re-run the send bench at HEAD with a React 19 fixture. Take the macOS band run (item 52).

## Not verified

- **How long main is blocked** by `JSON.parse` and `originalPositionFor` on a 2.8–8 MB map: not measured anywhere.
- **The cost of the band window on macOS:** WindowServer blending of a transparent window over the page area, and the time to create the window on the first hover. The Linux run is xvfb with software rendering only (`browser-025-highlight.md:23`).
- **A tab moved to another window** while its band is open: the band is bound to the host captured at attach (`BrowserPicks.ts:120`, `:133`). I did not trace whether re-parenting re-creates it. This is mainly a correctness question for the code lens.
- **AC-050 numbers at HEAD:** the figures above are inferred from the code paths, not measured.
