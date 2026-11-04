# Performance review – spec 025

Reviewer: `erfana:performance-reviewer` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).

Score: 8/10
Counts: critical 0, high 0, medium 1, low 5

Verdict: ready (no high finding)

Assumed load: one window with 1–4 browser tabs, mostly on a local dev server, with pick mode used in bursts and the terminal streaming agent output the whole time. I ran nothing, because I had no shell. Only the two benches count as `measured`. Every other finding is `suspected` until someone measures it.

## Findings

### [medium] Turning each send's screenshot into a PNG still runs on main's thread, at full device resolution, with no size cap
- **Area:** concurrency
- **Location:**
  - `src/main/services/browser/pick/pickAppSetup.ts:44`: `return new Uint8Array(nativeImage.createFromBitmap(buffer, { width: bitmap.width, height: bitmap.height }).toPNG())`
  - `src/main/services/browser/capture/captureRender.ts:178`: `screenshot: { name: names.screenshot, png: options.encodePng(screenshotBitmap(moment, element, options.outline)) },`
  - `captureRender.ts:134` first makes a full copy (`const shot = copyBitmap(moment.image)`).
  - The stored image is not reduced in size: `pickCaptureReads.ts:84`, `const bitmap = toBitmap(await this.deps.capturePage())`. Only the still shown in the renderer is capped at 4096 px.
- **Status:**
  - Measured: Explain → terminal p95 is 265.8 ms on the 3840 × 2160 worst case (`docs/performance/browser-025-send.md:9`). That puts an upper limit on how long main is blocked at that size.
  - Suspected: the share spent in `toPNG`, and the cost on larger screens. A full-width tab on a 5K or 6K Retina display can go past the bench fixture's size. To measure, time `encodePng` in `BrowserPicks.write` on the worst-case fixture and on a 5K window.
- **Impact:**
  - It runs once per send, a user action.
  - While it runs, main handles no IPC: terminal output, every window's events, and every tab's `before-input-event` / `before-mouse-event` routing all wait.
  - The cost grows with screen size. It is not in `docs/technical-debt.md` (I grepped for PNG, encode and worker: no browser entry) and not in the owner queue, so nothing tracks it.
- **Fix:** Encode in a `worker_thread`, as the project already does for git status and the preview link scan (`technical-debt.md:1072`, `:1077`). Send the bitmap's buffer across without copying it.
- **Trade-off:** One small encoder module to maintain. If the owner prefers to defer it, record it as a technical-debt entry instead.
- **Confidence:** medium.

### [low] The network byte limit counts the full `data:` URL, while the collector keeps only its media type
- **Area:** data-access
- **Location:**
  - `src/main/services/browser/cdp/cdpFloodBudget.ts:86`: `return isRecord(params.request) ? len(params.request.url) : 0`
  - `cdpFloodBudget.ts:88`: `return isRecord(params.response) ? len(params.response.url) : 0`
  - What the collector actually keeps, `browserLogBuffer.ts:70-72`: `if (/^data:/i.test(raw)) { … text = \`${comma === -1 ? raw : raw.slice(0, comma)},…\``, then cut to 2,048 characters.
  - The file header (`cdpFloodBudget.ts:20`) says "The payload counted is the text the collector keeps", which this does not match.
- **Status:** suspected. A test pins the behaviour as intended (`cdpFloodBudget.test.ts:139`, an 8 MB `data:` URL trips the budget). To measure, take a page that sets `<img src>` to a `canvas.toDataURL()` result of about 1 MB several times a second, then check `logSnapshot().truncated`.
- **Impact:**
  - Each `data:` load counts its URL twice (`requestWillBeSent` and `responseReceived`). Five 1 MB data URLs a second is enough to pass 8 MB, and log capture then stops until the next navigation.
  - This is rare on typical dev apps, which load files, not large inline data. It is the same kind of failure as the round-1 high finding, on a much narrower path.
- **Fix:** Count `min(len(url), LOG_URL_MAX_CODE_UNITS)`, and count a `data:` URL as its prefix up to the comma.
- **Trade-off:** None; the limit then matches its own documentation.
- **Confidence:** medium.

### [low] The navigation row re-measures its layout on the next frame after every render, and builds a new canvas each time
- **Area:** frontend
- **Location:**
  - `src/renderer/src/components/Panels/BrowserPanel/useNavFold.ts:168-172`: an effect with no dependency list, `const frame = requestAnimationFrame(remeasure)`
  - `useNavFold.ts:89`: `const ctx = document.createElement('canvas').getContext('2d')`, inside `textWidth`, which runs on every `decideFold`
  - `decideFold` (`:100-114`) calls `getComputedStyle` and `getBoundingClientRect` on every item in the row and the field, plus every `[data-fold-step]` part.
- **Status:** suspected. To measure, record a renderer trace during a page load and during a panel resize drag, and count `decideFold` calls and forced layouts.
- **Impact:**
  - `NavigationRow` (`NavigationRow.tsx:100`) is not memoised, so it renders with every `BrowserPanel` render. Each tab-state event during a load therefore costs one forced style and layout read plus a new canvas.
  - `ResizeObserver` adds one per resize callback while a panel is dragged.
  - I traced the paths: an unchanged count makes React skip the update, so the per-render effect does not loop.
  - It is cheap per call, but it is the newest per-render cost added in this round.
- **Fix:** Keep one canvas context at module level and remember the measured width per font and text.
- **Trade-off:** Very little: a few cached values.
- **Confidence:** medium.

### [low] Ancestor-chain handles still pile up for every element the pointer rests on, until pick mode ends
- **Area:** memory
- **Location:**
  - `src/main/services/browser/pick/pickHover.ts:151-154`: the 150 ms rest timer calls `this.chainOf(hovered)`
  - Handles are released only at `pickModeSwitch.ts:65`: `await this.reader.releaseAll()`
- **Status:** suspected. To measure, rest on 50 elements of a 20-deep tree in one pick session, then count the page's remote objects.
- **Impact:** The round-1 fix removed the cost for elements the pointer only crosses. That was the main cost, so the fix holds. What remains is about two handles per ancestor per rested element. This memory lives in the page's renderer, not in Erfana, and it is freed when pick mode turns off or the page navigates.
- **Fix:** Release the pick object group for a frame when the hovered element changes and its chain was never used.
- **Trade-off:** One extra command per change of hovered element.
- **Confidence:** medium.

### [low] The bounds loop still reads computed styles for every ancestor, 60 times a second, while a tab is visible
- **Area:** frontend
- **Location:** `src/renderer/src/components/Panels/BrowserPanel/useBrowserBounds.ts:134-137`: `const tick = (): void => { if (!running) return; sync(false); frame = requestAnimationFrame(tick) }`
- **Status:** suspected. This was the round-1 low finding, unchanged. It follows the HTML preview's existing design and sends nothing when the bounds are unchanged.
- **Impact:** Steady style reads while the app is idle with a browser tab shown.
- **Fix:** Run the loop only for the first frames after a show or re-parent, then rely on `ResizeObserver` plus dockview layout events.
- **Confidence:** medium.

### [low] The benches have not been re-run since the fix round
- **Area:** hot-path
- **Location:** `docs/performance/browser-025-highlight.md:10` and `docs/performance/browser-025-send.md:10`: "branch `feature/built-in-browser` at `9a802d9b` (its app source is that of `b95ca4fc` …)"
- **Status:** measured before the fixes; not measured after. The fix-round commits 17426356 and 8fd4ed87 changed the hover pipeline (`pickHover.ts`), the still conversion (`StillImage.tsx`) and the panel's store subscriptions.
- **Impact:** Each change removes work, so I expect the results to stay the same or improve (inferred). Still, the AC-049 and AC-050 evidence no longer matches the code that ships.
- **Fix:** Re-run both benches at HEAD before UAT and update the code line in each document.
- **Confidence:** high.

## What is strong

- **Flood limit fixed properly** (`cdpFloodBudget.ts:50-63`, `:159-163`):
  - Only the three log events and the four network events the collector reads are counted.
  - Each class has its own limit: 200/s and 1 MB for log events, 2,000/s and 8 MB for network events.
  - `Network.dataReceived` and the target events are free.
  - Nothing is serialised to be measured; `JSON.stringify` is gone.
  - Tests cover these cases: a 600-request dev-server load passes, the 201st console call still trips, and free events are never counted (`cdpFloodBudget.test.ts:104-147`).
  - The FR-038 wording is in the owner queue (item 33).
- **Ancestor chain read lazily** (`pickHover.ts:149-166`): it is read on the first Up or Down, or after a 150 ms rest. The promise is reused, and the timer is cleared when the hovered element changes (`:168-171`).
- **Terminal address scan:**
  - It returns at once when its 20 slots are full (`terminalLocalAddressScan.ts:67`).
  - A quick check for either host name runs before escapes are stripped (`:33`, `:40`).
  - Terminal output already arrives in batches (`terminal-handlers.ts:17`).
- **Still image released when a tab closes,** from both paths:
  - `browserTabEvents.ts:111` and `browserTabLifecycle.ts:113` call `browserStill.forget`.
  - `forget` clears every holder, advances the generation and drops the image (`browserStill.ts:178-188`).
  - A capture still in flight is thrown away by the generation and holder check (`:150`).
- **BGRA conversion:** one pass over 32-bit words on an aligned copy, with a byte loop for big-endian machines (`StillImage.tsx:62-68`). I checked the bit maths (A and G kept, R and B swapped), and the tests include an odd byte offset (`StillImage.test.tsx:20`).
- **Hover re-renders limited:**
  - `useBrowserPick` reads the pick store without the label, compared field by field (`useBrowserPick.ts:126`).
  - Only `PickRow` reads `label` (`PickRow.tsx:142`).
  - `PickAnnouncer` likewise skips the label (`PickAnnouncer.tsx:54`).
- **Still holds from round 1:** stale hovers are dropped (`pickHover.ts:76-89`), log memory is bounded, tracked requests are capped at 500, per-tab cleanup is done in main, and the public suffix list is parsed only on first use.

## Owner-pending items seen (not scored)
- Item 33 – the FR-038 wording for the two flood-limit classes.
- Item 27 – the live pick outline on Retina screens needs a manual check at UAT.
- AC-082 cold start with packaged builds and the Windows and Linux bench runs (AC-051) are still open (round-1 note).

## Score rationale
There is no critical or high finding. The round-1 high (the flood limit counting network events) and two of the three mediums (chain reads on every hover, the still image kept after a tab closes) are really fixed in the code, with tests. The fixes add no new cost beyond the low findings above. One medium remains: the PNG encode on main's thread. It is local, has a clear fix, and the measured send time bounds it at today's fixture size. That matches anchor 8: "No critical or high finding; medium findings are few, local and have a clear fix." Fixing it, or recording it as technical debt, and re-running the benches would make this a 9.

## Round 2 notes
| Round-1 finding | Status at 8fd4ed87 |
|---|---|
| [high] Flood limit counts every network event | Fixed (`cdpFloodBudget.ts`, `BrowserCdpSession.ts:320`). A narrow leftover: `data:` URL byte counting (low above). |
| [medium] Chain read on every hover | Fixed (`pickHover.ts`). Handles for rested elements remain (low above). |
| [medium] PNG encode on main's thread | Not fixed, and not tracked as debt. Still medium. |
| [medium] Still image kept after a tab closes | Fixed (`browserStill.forget` from both close paths). |
| [low] Byte-by-byte BGRA conversion | Fixed (word pass). |
| [low] Terminal scan never stops | Fixed (early exit when full, plus the host check first). |
| [low] Bounds loop at 60 Hz | Unchanged (low above). |
| [low] Whole panel re-renders on hover | Fixed (`useShallow` without the label; `PickRow` reads the label alone). |
| New: `useNavFold` | Measures after every render with a new canvas (low above). |

## Not verified
- **Benches:** not re-run at HEAD, and I cannot run them.
- **Main-thread time:** how long `toPNG` blocks main at screen sizes above the bench fixture.
- **Real pages:** whether a real page hits the network byte limit through `data:` URLs.
- **`useNavFold` cost:** its real cost per render in a trace.
- **Style-sheet map:** `PickCaptureReads.styleSheets` (`pickCaptureReads.ts:72`) grows with each `CSS.styleSheetAdded` while pick mode is on. Hot reload under Vite can add sheets, and the map is cleared only when pick mode starts again (`BrowserTabPick.ts:258`). Each entry is small, so I did not rate it.
