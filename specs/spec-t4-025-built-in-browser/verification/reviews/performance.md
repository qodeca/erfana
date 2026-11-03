# Performance review – spec 025

Reviewer: `erfana:performance-reviewer` (independent agent, not an author), 2026-11-04, against `873a9e4a`.


Score: 7/10
Counts: critical 0, high 1, medium 3, low 4

Assumed load: one window with 1–4 browser tabs, mostly pointed at a local dev server (`localhost:5173`-style). Pick mode is used in bursts. The terminal streams agent output the whole time. I ran nothing; only the two benches are `measured`, and every other finding is `suspected` until someone measures it.

## Findings

### [high] The log flood limit counts every network event, so a normal dev-server page load can switch log capture off

- **Area:** data-access (CDP event volume)
- **Location:**
  - `src/main/services/browser/cdp/BrowserCdpSession.ts:362`: `if (target.budget.count(eventPayloadSize(params))) this.floodTripped(target)`. This runs for every message on a target, before `isLogEvent` filters anything.
  - `BrowserCdpSession.ts:337`: `if (this.source === 'network') this.fire('Network.enable', target.sessionKey, NETWORK_ENABLE_PARAMS)`. `Network` is on for every target the whole time a page is open.
  - `src/main/services/browser/cdp/cdpFloodBudget.ts:20`: `export const FLOOD_MAX_EVENTS = 200`
  - `cdpFloodBudget.ts:70`: `return JSON.stringify(params)?.length ?? 0`. Every event is serialised again on main's thread.
- **Status:** suspected. To measure, load an unbundled Vite React dev app with a few hundred modules in a tab, then check `logSnapshot().truncated` and the log for "flood budget exceeded".
- **Impact:**
  - Each request produces about 4–6 events (`requestWillBeSent`, `…ExtraInfo`, `responseReceived`, `…ExtraInfo`, `dataReceived` per chunk, `loadingFinished`). So about 35–50 requests in one second reach the 200-event limit.
  - A Vite dev server serves each module as its own request, so a first load usually goes well past that.
  - Once the limit is hit, `floodTripped` turns off `Runtime`, `Log` and `Network` for that target "until the next navigation". In-page route changes and hot reload do not count as a navigation.
  - Result: every pick on that document reports "logs truncated" and none of the page's later console errors or failed requests. That is the core context the agent is supposed to get, on the product's main use case.
  - The e2e flood test sends 400 `console.error` calls (`e2e/browser-capture-content.e2e.ts:610`). The React fixture is a single bundle (`apps/react18/bundle/dev/app.js`), so no test covers a page with many requests.
  - Side cost: main JSON-serialises every network event of every tab, including headers and initiator stacks.
- **Fix:** Count only the events that can flood the log buffer (`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded`) against the 200-per-second limit. Give network events a separate, larger limit, or count only the `Network.*` events the collector reads. Measure size from the fields actually kept, not by serialising the whole event.
- **Trade-off:** 025-FR-038 states "200 events per target"; the owner needs to confirm that the number was meant for log events.
- **Confidence:** medium. The code path is certain; how often a real dev app hits the limit is not measured.

### [medium] Every hovered element sets off a full ancestor-chain read that is never cancelled, and its page handles build up until pick mode ends

- **Area:** hot-path / memory
- **Location:**
  - `src/main/services/browser/pick/BrowserTabPick.ts:300`: `this.preChain = { chain: readChain(this.reader, this.frames, hit.node), index: null, node: hit.node }`
  - `src/main/services/browser/pick/pickElement.ts:193-197`: per ancestor, `ancestorNode(reader, base, k).then(async (resolved) => { … await boxInView(reader, frames, resolved) })`
  - Handles are only released in `pickModeSwitch.ts:65`: `await this.reader.releaseAll()`
- **Status:** suspected.
  - Measured: the input-to-command step costs 1.2–3.4 ms (`docs/performance/browser-025-highlight.md`, table "Where the time goes").
  - Not measured: the bench waits for each frame before the next move, so the chain reads never overlap.
  - To measure: re-run the bench without that wait on a page whose elements are 20 or more levels deep, and count `Runtime.callFunctionOn` per second plus the page's remote-object count.
- **Impact:**
  - The highlight path itself is cheap (about 7 commands).
  - The chain read adds about 4 commands per ancestor (`resolveNode`, `callFunctionOn`, `describeNode`, `getBoxModel`), plus a `Page.getFrameTree` per frame target and owner reads for each child frame. At depth 20 that is roughly 80 commands per element crossed.
  - These commands run on the page's own main thread, alongside the next hit test.
  - `hoverQueued` drops stale hovers, but the chain reads they already started keep running.
  - Each ancestor leaves 2 handles in `erfana-pick`. The allow-list has no `Runtime.releaseObject`, so handles to every element the mouse crossed – including DOM that React has already removed – stay alive until pick mode is turned off.
  - `pickElement.ts:10` says the chain is read "at confirm", which does not match the code.
- **Fix:** Read the chain lazily, on the first Up or Down press, or once the pointer has rested on one element (about 150 ms) instead of on every crossing. The first Up then waits about one chain read.
- **Confidence:** medium.

### [medium] The PNG encode at send blocks main's thread for the whole full-resolution image

- **Area:** concurrency
- **Location:**
  - `src/main/services/browser/pick/pickAppSetup.ts:41`: `return new Uint8Array(nativeImage.createFromBitmap(buffer, { width: bitmap.width, height: bitmap.height }).toPNG())`
  - Called twice per send from `capture/captureRender.ts:178-179`, after a full `copyBitmap` (`:134`).
- **Status:**
  - Measured: Explain → terminal p95 is 231 ms on the React app and 265.8 ms on the 3840 × 2160 worst case (`docs/performance/browser-025-send.md`). That is within the 2 s target.
  - Suspected: how long main's thread is blocked. To measure, time `encodePng` in `BrowserPicks.write` on the worst-case fixture.
- **Impact:** This runs once per send, with up to 33 MB of pixels. While `toPNG` runs, main processes no IPC, so terminal output, every window's events, and the `before-mouse-event` / `before-input-event` routing of every tab all stall.
- **Fix:** Encode off the main thread, in a `worker_thread` that writes PNG chunks using `zlib.deflate`. Main then only hands over the buffer.
- **Trade-off:** a small encoder module to maintain.
- **Confidence:** medium.

### [medium] Closing a tab while a pick is held can leave its full-size still image in renderer memory

- **Area:** memory
- **Location:**
  - `src/renderer/src/services/browser/browserTabEvents.ts:107-110`: `useBrowserPickStore.getState().forget(event.tabId)` then `browserTabClosedByMain(event.tabId, deps.removePanel)`
  - The only release of the pick holder tied to the panel's state is an effect, `useBrowserPick.ts:170-172`: `if (captureId === null && tabId !== null) browserStill.release(tabId, PICK_STILL_HOLDER)`
  - `BrowserTabPick.dispose()` (`BrowserTabPick.ts:220-231`) sends no `ended` event.
- **Status:** suspected. To measure, open the prompt-actions panel, close the editor tab, then take a heap snapshot and check `useBrowserStillStore.getState().byTab`.
- **Impact:**
  - The `forget` and the panel removal happen in the same task and React batches them, so the panel may unmount before the effect runs.
  - Unlike `useStillSurface` (`:66-71`), there is no unmount cleanup for `PICK_STILL_HOLDER`. If the effect never runs, the bitmap stays (up to 4096², about 6–33 MB at typical sizes) for the life of the window, together with the `browserStill` `tabs` entry.
- **Fix:** In the `tabClosed` handler, and in `closeBrowserTab`, release every holder for that tab and call `useBrowserStillStore.getState().clear(tabId)`.
- **Trade-off:** none.
- **Confidence:** medium.

### [low] Every menu, suggestion list and More opening copies a raw full-resolution bitmap over IPC, then converts it byte by byte before paint

- **Area:** frontend
- **Location:**
  - `capture/surfaceStill.ts:45-46`
  - `BrowserTabPick.ts:369-370`
  - `StillImage.tsx:67`: `context.putImageData(new ImageData(bgraToRgba(image.data), image.width, image.height), 0, 0)`. This runs inside `useLayoutEffect`.
- **Status:**
  - Measured for picks only: menu frame p95 is 46.4 ms on the React app and 147.1 ms on the worst case (`browser-025-send.md`, table "How (a) is made up"). The worst case is the slower one; the bench doc says the cause is "inferred, not broken down".
  - Not measured for More, the right-click menu or suggestions.
- **Impact:** Each opening moves up to 33 MB and runs a per-byte JS loop on the renderer's main thread before the first paint.
- **Fix:** Swap channels through a `Uint32Array` view (one pass over words instead of bytes). Or `createImageBitmap` from `ImageData` off the layout effect.
- **Confidence:** medium.

### [low] The terminal address scan runs on every terminal output chunk, even with no browser tab open and after its 20-address cap is full

- **Area:** hot-path
- **Location:**
  - `browserAppSetup.ts:332`: `deps.terminalOutput?.on('data', (event) => pages.terminalOutput(event.webContentsId, event.terminalId, event.data))`
  - `page/terminalLocalAddressScan.ts:36`: `text.replace(ESCAPES, '').matchAll(ADDRESS)`
- **Status:** suspected.
- **Impact:** Two regex passes over the text, linear in its size, plus a copy, for every PTY chunk an agent streams. Small, but it never stops.
- **Fix:** Return early once `seen.size >= MAX_LOCAL_ADDRESSES`. Run a cheap `includes('localhost') || includes('127.0.0.1')` check before stripping escapes.
- **Confidence:** high.

### [low] The bounds loop recomputes styles for every ancestor on every frame while a tab is visible

- **Area:** frontend
- **Location:**
  - `useBrowserBounds.ts:134-137`: the `requestAnimationFrame(tick)` loop calls `sync(false)`
  - which calls `HtmlPreviewPanel/previewClip.ts:112`: `if (clipsDescendants(window.getComputedStyle(node))) clips.push(node.getBoundingClientRect())`
- **Status:** suspected.
- **Impact:** This is the same design the preview already uses, and it sends nothing when the bounds are unchanged. The cost is steady style reads at 60 Hz while the app is idle.
- **Fix:** Keep the loop only for the first frames after a show or re-parent, then switch to `ResizeObserver` plus dockview layout events.
- **Confidence:** medium.

### [low] Each element crossed in pick mode re-renders the whole BrowserPanel

- **Area:** frontend
- **Location:**
  - `useBrowserPick.ts:116`: `useBrowserPickStore(s => (tabId === null ? IDLE_PICK : (s.byTab.get(tabId) ?? IDLE_PICK)))`
  - consumed at `BrowserPanel.tsx:194`
  - No `memo(` anywhere under `BrowserPanel/` (grep: no matches).
- **Status:** suspected.
- **Impact:** A `highlight` label change re-renders the toolbar, the rows and the page area. The outline itself is drawn by the engine, so AC-049 is not affected; this costs renderer CPU only.
- **Fix:** Select `label` in `PickRow` only, and select the rest of the pick state separately.
- **Confidence:** medium.

## What is strong

- **Benches measured and documented:** both AC benches have method, machine, raw data and re-run commands.
  - AC-049: p95 41.2–41.9 ms against a 50 ms target, with Erfana's own share at 1.2–3.4 ms (`docs/performance/browser-025-highlight.md`).
  - AC-050: menu p95 73.3 ms and send p95 231 ms on the React app, 148.8 / 265.8 ms on the worst case (`browser-025-send.md`).
- **The hover pipeline drops stale work:** one hit test is in flight at a time and only the latest is kept (`BrowserTabPick.ts:274-287`). Out-of-date highlight replies are discarded by a generation counter (`pickHighlight.ts:61-75`).
- **Log memory is bounded:** 20 entries per frame per list (`browserLogBuffer.ts:87-90`), messages cut to 500 characters and URLs to 2,048, tracked requests capped at 500 (`cdpLogCollector.ts:37`, `:269-272`). Console objects are released in a 250 ms batch (`BrowserCdpSession.ts:444-452`).
- **Per-tab cleanup on the main side is thorough:** pick listeners and CDP subscriptions are removed (`BrowserTabPick.ts:219-231`). CDP teardown clears timers and listeners (`BrowserCdpSession.ts:481-495`). The service deletes each per-tab map entry (`BrowserTabService.ts:465-484`).
- **Little work at startup with no tab open:** the 140 KB public suffix list is parsed on first use (`publicSuffixList.ts:22`). No session or CDP work happens before the first tab.
- **Bounds pushes are deduplicated and ordered:** unchanged measurements send nothing (`useBrowserBounds.ts:98`) and older pushes are dropped (`TabViewFrame.ts:90`).
- **The capture skips needless encoding:** no PNG encode at confirm; the still image is capped at 4096 px per side (`BrowserTabPick.ts:51`).

## Owner-pending items seen (not scored)

- AC-082 cold start with the cookie-encryption fuse needs packaged builds and is still open (`.local/autopilot.md:73`).
- Benches have only been run on macOS; the Windows and Linux runs are tracked under AC-051.
- Item 27: the live pick outline on Retina screens needs a manual check at UAT.

## Score rationale

There is one high finding: the flood limit is calibrated for console events but also counts network events. Its fix is small and local. There are three medium findings in separate areas: per-hover chain reads, the PNG encode on main's thread, and a possible still-image leak in the renderer. The two benches pass with a wide margin, and log, request and per-tab memory are carefully bounded. That fits anchor 7 ("no critical; at most one high"). Fixing the flood-limit counting and the per-hover chain read would put this lens at 8 or higher.

## Not verified

- **Real-world flood limit behaviour:** whether a real dev-server load hits the limit. No multi-request fixture exists, and I could not run one.
- **Main-thread time:** how long main is blocked by `toPNG` and by bitmap copies; the benches only time end-to-end intervals.
- **Electron input routing:** whether `before-mouse-event` / `before-input-event` hold page input until main's handler runs. This is inferred from Electron's design; I did not read Electron's source.
- **The still-image leak:** React batching order between the zustand `forget` and the dockview panel removal; this needs a heap snapshot.
- **Untraced paths:** `captureFacts.ts`, `sourceHints.ts` and `BrowserCapture.prefetchAll` (the freeze-path reads) were not traced command by command.
