# Spikes – HTML Preview comments v1 (phase P0)

> Date: 2026-10-25 · Branch: `feature/html-preview-comments` · Design: [docs/designs/html-preview-comments.md](../designs/html-preview-comments.md) (revision 3 folds these results in, see its §19).
> Machine: Windows 11 x64 under emulation on Apple Silicon (Parallels), one monitor at 125% scaling, Electron 44.9.3 (Chromium 152). Timings are upper bounds.
> Probes were throwaway scripts in the session scratchpad and are not committed; the evidence excerpts below are copied from their logs.

## Summary

| Spike | Verdict | Consequence for the plan |
|---|---|---|
| S1a preload in sub-frames | PASS with gaps | Runs in same-token, nested, `srcdoc` and refused-frame error pages; not in `about:blank` / `javascript:` frames → parent draws a click-shield over non-commentable iframes in comment mode |
| S1b top-frame check | PASS | `window === window.top` and `process.isMainFrame` both work in the sandboxed preload |
| S1c token strip timing | PARTIAL | Stripped before inline/defer/module/async scripts; not before callbacks of an already-defined custom element → known residual; rule becomes "first sighting before the preload's `DOMContentLoaded`; seen twice = void" |
| S1d page observer | PASS (risk confirmed) | A head-script `MutationObserver` reads stripped tokens → tokens stay non-authoritative (main re-validates from disk) |
| S1e request kind | FAIL as built, PASS with fix | Ledger mislabels reloads when a page fetches its own URL (28–29/30); fix = drop notes on `onErrorOccurred` + match by request class (document loads carry no `user-agent` header) → 30/30 |
| S1f frame messaging | PASS | `WebFrameMain.send` reaches sub-frame preloads; `wc.ipc` sees sub-frame `senderFrame` |
| S2 reload | PASS | `#hash` kept 10/10; write → scroll restored median 147 ms; 300 ms fallback never fired |
| S3 frame scroll | PASS | `scrollIntoView` inside a frame scrolls the parent too; no reveal step needed |
| S4 pointer position (Windows) | PARTIAL | `getCursorScreenPoint()` ≤ 0.5 px for real input but 129–210 px off for synthetic e2e input → use the trusted event's `screenX/Y` sent with the pick |
| S5 overlay styling | PASS with risks | Constructable stylesheets and `el.style` survive page CSP; top layer beats max z-index; page can `hidePopover()` and a later modal dialog sits above → re-show on `toggle`, document the modal limit |
| S6 fresh still | FAIL as written, PASS with 2 frames | One rAF: 9/20 captures had the outline; two rAFs + pixel check: 20/20; p95 50–69 ms |
| S7 placement | Hybrid + runtime check | Hybrid as written changed rendering in 12/67 cases; adding the parent's computed `white-space-collapse` to the pick → 0; position re-attach must use source order; Vue/Svelte/Angular need placement before the app root |
| S8 frame mapping | PASS | `WebFrameMain.frames` order equals `window[i]` order (creation order) in 5/5; pointer events over a frame reach only the child preload |
| S9 parse cost | Over budget on main thread | 1 MB: 92 ms, 4 MB: 382 ms on main → persistent worker (main-thread time 7–28 ms); token cap 100,000 |
| X-001 agent readability (P1) | PASS after a format change (Claude Code); Codex not run | Round 1: agents deleted blocks and acted on damaged ones → fixed agent note added to every block; round 2: 3/3 pass. P8 confirmation on Erfana-written files: 3/3 pass. Codex not run – owner decision: Claude Code only |

Full write-ups follow.

---

## P0 spikes – HTML Preview comments (S1, S2, S3, S4 Windows, S5, S6, S8)

Run 2026-10-25 on the local Windows VM. S7 and S9 belong to another agent and were not touched.

### Environment

| Fact | Value |
|---|---|
| Electron / Chromium | 44.9.3 / 152.0.7977.167 (`node_modules/electron`, run with `npx electron` from the repo root) |
| OS | Windows 11 x64, emulated (Parallels on Apple Silicon) |
| Display | **one monitor, scale factor 1.25** (1536×960 DIP), not 200 % as briefed – measured with `screen.getAllDisplays()` in every probe |
| Setup reproduced | privileged `erfana-preview:` scheme (`previewScheme.ts` privileges), fresh in-memory partition, `session.protocol.handle` serving a fixture folder, the exact `buildPreviewCsp` shape (`default-src 'none'` … `frame-src erfana-preview://<own token>` … `sandbox allow-scripts`) and the `buildResponseHeaders` set, a webRequest ledger copied from `PreviewRequestKindLedger.ts`, `PREVIEW_WEB_PREFERENCES` with `nodeIntegrationInSubFrames: true`, a `WebContentsView` in a `BrowserWindow.contentView`, `--disable-features=CalculateNativeWinOcclusion` |
| Repo | untouched (`git status` clean). Everything lives in this folder: `harness.cjs` + one folder per spike (`main.cjs`, `preload.cjs`, `fixtures/`, `out-*.log`) |

Every probe auto-quits; output went to log files that were read afterwards.

### Verdicts at a glance

| Spike | Verdict | One line |
|---|---|---|
| S1a sub-frame preload | **PASS** (with two gaps) | Runs in same-token frames, nested frames, `srcdoc` and the error page of a refused frame; **not** in `about:blank` or `javascript:` frames |
| S1b top check | **PASS** | `window === window.top` correct everywhere; `process.isMainFrame` **is** defined in the sandboxed preload and agrees |
| S1c strip timing | **PARTIAL** | Stripped before inline, `defer`, `type=module` (inline + src) and `async` scripts and before upgrade-time custom elements; **not** before the synchronous reactions of an element whose definition already exists |
| S1d page observer | **PASS (residual confirmed)** | A head-registered `MutationObserver` with `attributeOldValue` reads every token stripped after it registered (10 of 10) |
| S1e request kind | **FAIL as designed / PASS with a fix** | No `Sec-Fetch-Dest` (still absent). The FIFO ledger is right for normal loads, but a page that fetches its own URL makes it mislabel the document 28–29 of 30 reloads. A typed ledger fixed it: 30 of 30 |
| S1f frame IPC | **PASS** | `WebFrameMain.send` reaches sub-frame `ipcRenderer.on`; `wc.ipc` receives sub-frame sends with `senderFrame` set |
| S2 reload | **PASS** | `reload()` keeps `#hash` 10/10; reload → `did-finish-load` median 41 ms; write → watcher → reload → restored median 147 ms; the 300 ms fallback never fired |
| S3 frame scroll | **PASS** | `scrollIntoView` in an opaque-origin frame also scrolls the parent; the frame's own scroll restores in one frame |
| S4 cursor (Windows) | **PARTIAL** | Formula correct within 0.5 px for real input at host/preview zoom 1.0 and 1.25; **wrong by 129–210 px for synthetic input (e2e)**. The trusted event's `screenX/Y` is a better source |
| S5 overlay styling | **PASS** (two residuals) | Constructable sheets + CSSOM styles apply in a closed shadow root, even under a stricter page CSP; Popover top layer beats `z-index: 2147483647`; `checkVisibility` works. A later page modal dialog and a page `hidePopover()` defeat the overlay |
| S6 fresh still | **FAIL as designed / PASS with two frames** | One animation frame: outline in only 9/20 captures. Two frames: 20/20, 39/40, 40/40 (busy page). Click → capture done median 21–22 ms, p95 ≤ 51 ms |
| S8 frame mapping | **PASS** | `WebFrameMain.frames` order equals the parent's `window[i]` order (creation order, not DOM order) in 5/5 scenarios; pair `window[i]` with its `<iframe>` by `contentWindow` identity. Pointer events over a frame go only to the child |

---

### S1 – sub-frame preload, top check, token strip, request kind, frame IPC

Probes: `s1/` (main scenario), `s1b/` (about:blank + forged headers), `s1c/` (ledger stress). Logs: `s1/out-s1.log`, `s1/out-s1-typed.log`, `s1b/out-s1b.log`, `s1c/out-s1c-{fifo,evict,typed}.log`.

#### S1a – does the preload run in CSP-sandboxed opaque-origin sub-frames?

**Verdict: PASS, with two gaps (about:blank, `javascript:` URLs).**

Evidence (`preload-start` messages, `s1/out-s1.log`):

| Frame | Preload ran | `senderFrame` |
|---|---|---|
| top `index.html` (ftn 2) | yes, `origin "null"`, `readyState "loading"`, `hasDocEl false` | ftn 2, `top: true` |
| same-token `child.html` (ftn 3) | yes | ftn 3, name `c1` |
| nested `grandchild.html` (ftn 7) | yes | ftn 7, name `gc` |
| `srcdoc` (ftn 4) | yes, `href "about:srcdoc"` | ftn 4 |
| refused (other token, ftn 6) | **yes – inside Chromium's error page**, `href "chrome-error://chromewebdata/"` while `senderFrame.url` is the refused URL | ftn 6 |
| `about:blank` (ftn 5) | **no** – no message, and `WebFrameMain.send` to it got no answer | – |
| `javascript:'<button…>'` frame (`s8`) | **no** – no preload message; pointer events over it reached no preload at all | – |

- All frames shared one renderer process (`pid 6`, `osPid 7340`): sandboxed same-scheme frames are not out-of-process here.
- `s1b`: an `about:blank` child of a sandboxed parent is cross-origin to it – `contentDocument` is `null` for the page and the parent preload gets `SecurityError … Blocked a frame with origin "null"`. So a page cannot build UI there; a `javascript:` URL frame can (its button rendered and was clickable by the page's own content).
- Refused frames produce `did-fail-load ERR_BLOCKED_BY_CSP` and **no** `did-frame-navigate`.
- "Gitignored framed pages" is an Erfana serving rule, not an Electron behaviour; at the Electron level such a frame is identical to `child.html`.

**Consequence for the plan**
- §4.2 `commentFrameBroadcaster.ts` and §7.1 step 2 ("mode-only state to every other frame (srcdoc, about:blank, refused) so clicks are swallowed everywhere"): it cannot work for `about:blank` and `javascript:` frames – they have no preload. Replace with: **in comment mode the parent overlay draws a transparent hit-shield over every `<iframe>` that main did not report as commentable** (main already knows via the S8 map). A click there resolves to the `<iframe>` element itself, which is exactly what §10.2 wants for refused / `srcdoc` / `about:blank` frames. Mode-only state to `srcdoc` and error-page frames then becomes optional.
- §9.1 S8/S9 and §4.2 `frameFileMap.ts`: add "a refused frame's `senderFrame.url` names the refused URL while its document is `chrome-error://`; never map it" (the plan's rule "file only from `did-frame-navigate`" already covers it – refused frames emit none; say so explicitly). `did-frame-navigate` also fires for `about:blank` / `about:srcdoc` with code -1 – `frameFileMap` must ignore non-`erfana-preview:` URLs.

#### S1b – does `window === window.top` distinguish frames; is `process.isMainFrame` defined?

**Verdict: PASS. `process.isMainFrame` is defined and correct.**

Evidence: every `preload-start` carries `isTop` and `processInfo`:

```
top    : "isTop":true,  "processInfo":{"isMainFrame":true,  "hasIsMainFrame":true, "sandboxed":true, "keys":"…,hang,isMainFrame,pid,platform,…"}
child  : "isTop":false, "processInfo":{"isMainFrame":false, …}
srcdoc : "isTop":false, "processInfo":{"isMainFrame":false, …}
error  : "isTop":false, "processInfo":{"isMainFrame":false, …}
```

**Consequence**: §4.2 `previewPage.ts` row says "`process.isMainFrame` is not in Electron's sandboxed `process` list" – wrong for Electron 44. Keep `window === window.top` as the primary gate (it needs no Electron API), and either drop the claim or use `process.isMainFrame` as a cross-check. Both agreed in all 5 frame kinds.

#### S1c – is `data-erfana-el` stripped before page code sees it?

**Verdict: PARTIAL.**

The preload's `MutationObserver` (on `document`, `childList` + `subtree`, registered at preload time when `documentElement` is still `null`) stripped tokens in small batches at each microtask checkpoint. What the page saw (`visibleTokens` = page-world `querySelectorAll('[data-erfana-el]')`):

| Page code | Saw a token? | Evidence |
|---|---|---|
| first inline `<script>` in `<head>` | no | `head-inline-1 … "visibleTokens":[]` – after strip batch 1 `["T-html","T-head","T-meta","T-title"]` |
| inline `<script>` in `<body>` (element before it) | no | batch 6 `["T-body","T-before1"]`, then `body-inline-1 … []` |
| `defer` script | no | `defer-script … [] "rs":"interactive"` |
| `type=module` inline and `src` | no | `module-inline … []`, `module-src … []` |
| `async` script | no | `async-script … []` |
| custom element **upgraded later** (`<x-late>` parsed before `define`) | no | `xlate-connectedCallback (upgrade) … "attr":null` |
| custom element **with a definition already registered** (`<x-probe>` after `define`) | **yes** | `xprobe-attributeChangedCallback … "newV":"T-xprobe1"` then `xprobe-connectedCallback:xp1 … "attr":"T-xprobe1"`, stripped only afterwards (batch 9) |
| its children at `connectedCallback` | not parsed yet | `"childCount":0` |
| elements after the last script | stripped before `DOMContentLoaded` | batch 15 `["T-tail2"] "readyState":"interactive"` arrives before the `dcl` message |

Same results in the child frame (`child-head-inline … []`, `child-body-inline … []`), the grandchild, and on reload, history back and renderer-initiated navigation. The constructor of a parser-created custom element sees no attributes yet (`xprobe-ctor … "attr":null`); the synchronous reactions after it do.

**Consequence**
- §6 bullet 2 and §9.1 S1: state the residual – a custom element whose definition exists before it is parsed sees its own token in `attributeChangedCallback` (if observed) and `connectedCallback`. Components that copy their attributes onto an inner element (common in web-component libraries) will copy the token into a script-created node.
- §4.2 `previewPageComments.ts` ("parser-inserted nodes before `DOMContentLoaded` only, each accepted once") and SEC-26: **the preload cannot tell parser-inserted from script-inserted nodes** – no DOM API exposes it. Reword to what it can enforce: "first sighting before the preload's own `DOMContentLoaded` listener runs; **a token seen twice in one load is void** (both copies stripped, neither mapped)". Gate on the preload's `DOMContentLoaded` listener, not on `document.readyState` – the last strip batch runs at `readyState "interactive"`, just before the event.
- P4 e2e exit test (§13): add the "definition registered before the element" case as an expected token exposure, plus a "component copies attributes" fixture to prove the duplicate rule.

#### S1d – can a page `MutationObserver` with `attributeOldValue` see the stripped values?

**Verdict: PASS – the residual is real.**

Evidence: the observer registered in the first head script reported, at `DOMContentLoaded` and at `load`:

```
page-MO@DCL  "oldValues":["T-body","T-before1","T-after1","T-xlate","T-xprobe1","T-xchild1","T-iframe1","T-tail","T-xprobe2","T-tail2"], "directReads":[]
```

Every token stripped after it registered (10 of 10); only the four stripped before the first script (`html`, `head`, `meta`, `title`) stayed hidden. `directReads` was empty – the preload's observer always ran first.

**Consequence**: none to the design – §6 already calls this harmless because tokens are single-use and frame-bound. Make SEC-26 assert it explicitly ("a page that collects every token via `attributeOldValue` still cannot open a draft for another element").

#### S1e – request-kind ledger reliability; is `Sec-Fetch-Dest` available?

**Verdict: `Sec-Fetch-Dest` – not available. Ledger as built – FAIL under self-fetching pages. Typed ledger – PASS.**

What `protocol.handle` sees on Electron 44 (`s1/out-s1.log`, `s1b/out-s1b.log`):

| Request | `accept` | other headers | `destination` / `mode` / `referrer` |
|---|---|---|---|
| main-frame load, reload, back, forward (`loadURL` / `reload()` / history) | `text/html,…` | none | `""` / `"cors"` / `""` |
| renderer-initiated navigation (`location.href = …`) | `text/html,…` | `upgrade-insecure-requests: 1` | same |
| sub-frame document | `text/html,…` | `upgrade-insecure-requests: 1` | same |
| `fetch()`, `<script>` | `*/*` | `user-agent` | same |
| `fetch` with forged `Accept: text/html,…` | `text/html,…` (forged, accepted) | `user-agent` | – |
| `fetch` with forged `Upgrade-Insecure-Requests: 1` | `*/*` | `upgrade-insecure-requests: 1`, `user-agent` (no preflight) | – |
| `fetch` with forged `Sec-Fetch-Dest: iframe` | `*/*` | `user-agent`; the forged header is dropped (`secFetchDest: absent`) | – |

- No `sec-fetch-*` header at all, `destination` always empty, `mode` always `"cors"` (navigations included). `Accept` and `Upgrade-Insecure-Requests` are page-forgeable.
- **Navigations never carried `user-agent`; every fetch / script did** (100 % of the requests in these logs). A page cannot remove the header.
- History back/forward re-requested the document every time (new renderer process each cross-document navigation: pid 6 → 11 → 13 → 16), so there is no back-forward-cache restore to plan for.

Ledger results:

| Scenario | Today's FIFO ledger | Typed ledger (below) |
|---|---|---|
| first load, reload, back, forward, renderer navigation, frames, nested frames, `fetch(location.href)` from top and frame | correct | correct (`s1/out-s1-typed.log`, every document and frame marked document, every fetch `xhr`, 0 notes left) |
| 24 same-URL races `fetch` vs new `<iframe>` (fetch first / frame first / same tick) | 24/24 correct | 24/24 correct |
| **page fetches its own URL non-stop while main reloads it, 30 reloads** (`s1c`) | **28–29 of 30 documents labelled `xhr`** (would be served raw → "Comments unavailable"); 190–372 stale notes left | **30 of 30 correct** |
| same stress, only "forget notes on `onErrorOccurred`" | – | 9 of 30 still wrong |

Cause: fetches that the reload aborts were noted by `onBeforeRequest` but never reach the handler, so their notes stay for `REQUEST_KIND_LEDGER_TTL_MS` (10 s) and the next document load of that URL takes the oldest one. One aborted self-fetch is enough to break the next 10 s of loads.

Typed ledger tested (`harness.cjs`, `ledgerMode: 'typed'`): (1) a note stores webRequest `details.id` and is dropped on `webRequest.onErrorOccurred`; (2) `take(url, isNavigation)` only matches a note of the same class – navigation (`mainFrame`/`subFrame`) when the request has no `user-agent` header, everything else when it has one.

**Consequence**
- §3 "Raw vs instrumented bytes", §4.2 `PreviewProtocolHandler.ts` row, §6 bullet 1, S24, M-060, §9.2 ledger header note: "instrument only when the ledger note is exactly a document/sub-frame load" holds only with the typed ledger. Change P3 to: **ledger notes are dropped on `onErrorOccurred`, and `take` matches the request class (navigation = no `user-agent` header)**. Security still never depends on it.
- The class signal is undocumented Electron behaviour: add "navigations reach `protocol.handle` without `user-agent`" to the R17 upgrade checklist and to the P3 real-Electron exit test.
- New tests: M-060b (unit) "aborted fetch notes do not poison the next document load"; an e2e/F case "page that fetches its own URL in a loop is still commentable after reload".
- Side note for today's code, outside this feature: the same poisoning can misfire the existing "entry page missing" / "unsupported asset type" badges on self-fetching pages.

#### S1f – `WebFrameMain.send` to sub-frames; `wc.ipc` receiving sub-frame sends

**Verdict: PASS.**

Evidence (`s1/out-s1.log` 3026–3037 ms): `f.send('probe:state', {yourFtn})` to every frame in `framesInSubtree`; replies:

```
state-received  from ftn 2 (top), 3 (child), 4 (srcdoc), 6 (error page), 7 (grandchild)   -- payload yourFtn matches
(no reply from ftn 5, about:blank – no preload)
```

Every `wc.ipc.on('probe:log')` event from a sub-frame had `senderFrame` = `{frameTreeNodeId, routingId, processId, name, url, origin: "null", parent ≠ null}` and `event.frameId` = routing id. Child frame tree node ids are new on every load (reload: 3,4,5,6,7 → 8,9,10,11,12); the main frame keeps ftn 2 but gets a new routing id.

**Consequence**: §8 page → main row confirmed. §4.2 `ElementTokenTable` "evicted when that frame navigates away" – a reload also replaces every child ftn, which makes per-load keys natural.

---

### S2 – does `wc.reload()` keep `#hash`; reload and restore timing

Probe `s2/` (log `s2/out-s2.log`): a ~4,800 px page (6 sections, 4 PNG images 800×300), loaded at `#s5`, scrolled to a different y each run, then reloaded; restore through world 996 with the §7.5 step 6 script (set hash if different, `requestAnimationFrame` loop `scrollTo`).

**Verdict: PASS.**

| Measure (10 runs) | Median | Min–max |
|---|---|---|
| `reload()` keeps `location.hash` | 10/10 (`url … long.html#s5`, `hash "#s5"` after load) | – |
| `reload()` → `did-finish-load` | 40.9 ms | 37.1–63.2 |
| `reload()` → restored `scrollTo` | 43.5 ms | 40.0–67.2 |
| restore loop itself | 1 frame, 0.4–3.2 ms | – |
| atomic write (temp + rename) → first chokidar event (entry-watch options: `awaitWriteFinish` 50/25 ms) | 68 ms | 59–105 (event was `change` every time) |
| write → event → 30 ms coalesce → reload → restored | 147.1 ms | 138.1–187.3 |

- Chromium did **not** restore the pre-reload scroll by itself: every reload landed on the `#s5` anchor (`before.y 3216`); without a hash (S3) it landed at 0. The explicit restore is required.
- The watcher always fired within 105 ms, so the 300 ms fallback reload never triggered.

**Consequence**: §7.5 steps 5–6 confirmed as designed. Note in §7.5 that the anchor jump is painted before the restore (one frame of flash at the anchor position is possible). F-001 budget: write → scroll restored uses ~15 % of the 1 s; the rest is `commentHello` → `commentState` → pin draw plus the S9 parse. Keep the 300 ms fallback as a safety net. The chokidar measurement used the same options as `PREVIEW_ENTRY_WATCH_OVERRIDES` but not the re-arming wrapper (`createRearmingSingleFileWatcher` is TS source).

---

### S3 – `scrollIntoView` inside an opaque-origin same-scheme frame; frame scroll restore

Probe `s3/` (log `s3/out-s3.log`): parent 4,900 px tall, `<iframe>` at y 2500 (600×400), frame 3,060 px tall, target at y 2000.

**Verdict: PASS.**

| Call (from the frame) | Frame `scrollY` | Parent `scrollY` |
|---|---|---|
| preload (isolated world) `scrollIntoView({block:'center'})` | 0 → 1830 | 0 → **2351** |
| preload `scrollIntoView({block:'start'})` | 0 → 2000 | 0 → 2502 |
| preload `scrollIntoView({block:'center', container:'nearest'})` | 0 → 1830 | stays 0 |
| page main world `scrollIntoView({block:'center'})` | 0 → 1830 | 0 → 2351 |
| frame scroll after full `reload()`, before restore | 1234 → **0** | 2300 → 0 |
| frame preload restore `scrollTo(0, 1234)` | 0 → 1234 in 1 frame, 0.6 ms | – |

**Consequence**: §7.10 and §15 S3 – no parent-preload reveal step is needed; the frame's own `scrollIntoView({block:'center'})` brings the iframe into view too. `container: 'nearest'` exists in Chromium 152 if a reveal must not move the parent. §7.5 step 6 frame restore (best effort) works; J-016 stands. Chromium does not restore the frame scroll by itself after reload, so `commentState.restore` is required for frames.

---

### S4 – `screen.getCursorScreenPoint()` vs window content origin and zoom (Windows)

Probes `s4/main.cjs` (log `s4/out-s4.log`) and `s4/main-global.cjs` (log `s4/out-s4b.log`). Host `BrowserWindow` content origin (47, 95) DIP; view CSS rect (120, 80, 600×400) placed as `rect × hostZoom` (the `clampAndZoomBounds` rule); page point (200, 150). Real input came from `s4/cursor.py`: it pins the probe window's HWND and the main process PID, checks `WindowFromPoint → GetAncestor(GA_ROOT)` against both before moving the cursor and again before the one right-click, aborts on any mismatch, and restored the cursor afterwards (`restored {x:1917, y:801}`). All 9 moves (5 of them with the right-click) passed both checks (`verifiedRoot` = pinned HWND, `verifiedPid` = main PID); none aborted.

Math compared: design formula `(cursorDip − contentOrigin) / hostZoom` vs the page-derived host CSS point `cssRect + clientXY × previewZoom / hostZoom`.

**Verdict: PARTIAL – correct for real input, wrong for synthetic input.**

| Host zoom | Preview zoom | Real cursor: formula vs page (error px) | Synthetic `sendInputEvent`: formula vs page (error px) |
|---|---|---|---|
| 1.0 | 1.0 | (320, 229) vs (320, 229) – **0, 0** | (160, 120) vs (320, 230) – **−160, −110** |
| 1.25 | 1.0 | (279.2, 199.2) vs (279.2, 199.2) – **0, 0** | **−128.8, −88** |
| 1.0 | 1.25 | (369, 268) vs (368.75, 267.5) – **0.25, 0.5** | **−210, −147.5** |
| 1.25 | 1.25 | (320, 230.4) vs (320, 230) – **0, 0.4** | **−168.8, −118** |
| 1.25 | 1.25, pick inside an iframe at (250, 120) | (429.6, 250.4) vs expected (430, 250) – **≤ 0.4** | – |

- `sendInputEvent` does not move the OS cursor, so `getCursorScreenPoint()` returns wherever the real pointer is. Every e2e test in §12.4 drives the page this way.
- The trusted event's `screenX/screenY` equalled `getCursorScreenPoint()` exactly for real input (5/5, including the frame pick: `screenXY {584, 408}` = `cursorDip {584, 408}`), independent of preview zoom.
- Synthetic events report `screenX/Y = 0, 0`, **unless** `sendInputEvent` is given `globalX/globalY`: then `screenX/Y` = those values in the top frame and in a frame, and `(screenX − contentOrigin) / hostZoom` matched the expected point within 0.4 px (`s4/out-s4b.log`).
- Remaining error is DIP rounding (`getCursorScreenPoint` returns integer DIPs): ≤ 1 DIP = ≤ 0.8 host CSS px at zoom 1.25.
- Not testable here: mixed-DPI / second monitor (one monitor), and the machine ran at **125 %**, not 200 %. Linux X11/Wayland is outside this agent's scope.

**Consequence**
- §7.3 step 4: replace `screen.getCursorScreenPoint()` with **the trusted `contextmenu`/`click` event's `screenX/screenY`, sent by the preload in `commentPick`** (finite, bounded numbers, clamped to the panel; a forged value only misplaces the menu). Formula unchanged: `(screenXY − window content origin) / host zoom`. It is identical for real input, needs no frame offset, and e2e can drive it.
- §8 `preview-page:commentPick`: make `point` part of pointer picks too, e.g. `point: {x, y, space: 'screen' | 'element'}`.
- §12.4: the hover/right-click helpers must pass `globalX/globalY` = content origin + view origin + point to `sendInputEvent`; otherwise menu-position assertions depend on where the real cursor rests.
- R7 / R14: keep `getCursorScreenPoint()` only as a fallback when `screenX/Y` are both 0; the Linux/Wayland spike should test `screenX/Y` as well as the cursor API.

---

### S5 – closed shadow root styling, Popover top layer, `checkVisibility`

Probe `s5/` (log `s5/out-s5.log`), three pages: `normal.html`, `hostile-css.html` (`div {display:none !important; opacity:0 !important; transform:scale(0) !important; clip-path…; filter…; visibility:hidden !important}`, `[popover], :popover-open {display:none !important}`, `* {pointer-events:none !important}`), and `strict-csp.html` (adds `<meta http-equiv="Content-Security-Policy" content="style-src 'none'">`). Host = `<div popover="manual">` with `style.cssText = 'all: initial !important; position: fixed !important; …'` (CSSOM), closed shadow root from the isolated world. Pixels sampled from `capturePage` (image 1125×875 for a 900×700 CSS view, so scaled 1.25).

**Verdict: PASS, with two residuals.**

| Check | normal | hostile CSS | strict meta CSP |
|---|---|---|---|
| `adoptedStyleSheets` box (green) | `rgb(0, 200, 0)`, pixel `0,200,0` | same | **same** |
| `element.style` / `Object.assign(el.style…)` box (magenta) | applied, pixel `255,0,255` | same | **same** |
| `setAttribute('style', …)` box (cyan) | applied | applied | **blocked** (`style-src-attr`, page-visible `securitypolicyviolation`) |
| `<style>` element in the shadow root (orange) | applied | applied | **blocked** (`style-src-elem`) |
| host computed `display/position/opacity/visibility/transform` | `block/fixed/1/visible/none` | **same** (inline `!important` beats page `!important`) | same |
| `host.shadowRoot` from the main world | `"null"` | `"null"` | `"null"` |
| over a `position:fixed; z-index:2147483647` red element: `elementFromPoint` / pixel | `DIV[popover]` / green | `DIV[popover]` / green | `DIV[popover]` / green |
| page then calls `dialog.showModal()` | dialog on top (yellow), `elementFromPoint → pagedialog` | same | same |
| we `hidePopover()` + `showPopover()` again | painted on top again (green) **but `elementFromPoint` still `pagedialog`** (overlay inert while the modal is open) | same | same |
| page calls `host.hidePopover()` | `popoverOpen: false` – the page can close our overlay | same | same |

`checkVisibility` from the isolated world (`normal.html`):

| Element | `checkVisibility()` | `{opacityProperty, visibilityProperty}` | `+ contentVisibilityAuto` |
|---|---|---|---|
| visible | true | true | true |
| `opacity:0` | true | **false** | false |
| `visibility:hidden` | true | **false** | false |
| `display:none` | false | false | false |
| inside `content-visibility:hidden` | false | false | false |
| inside off-screen `content-visibility:auto` | true | true | **false** |
| inside an `opacity:0` ancestor | true | **false** | false |
| 0×0 element | true | **true** | true |

**Consequence**
- §10.2 "Styles via constructable stylesheets (spike S5)": confirmed. Add the rule **"only `adoptedStyleSheets` and CSSOM (`el.style.*`, `style.cssText`); never `setAttribute('style')` or a `<style>` element"** – a page's own meta CSP can block those two and their failures are visible to the page. Contract test (§9.2) can ban both in `previewPageComments.ts`.
- §4.2 `previewPageComments.ts` re-attach and SEC-21/SEC-28: re-attach must also listen for the host's `toggle` event (`newState: 'closed'`) – a page can `hidePopover()` our host – and count it against the same 3-per-second budget.
- §10.2 / risk 8: document that a page modal `<dialog>` opened after our popover paints above it, and while it is open the overlay is not hit-testable even after a re-raise (pins visible but not clickable). Picks inside the dialog still work through the capture-phase window listeners.
- §6 status bullet and §10.5: use `checkVisibility({opacityProperty: true, visibilityProperty: true})` **without** `contentVisibilityAuto` (it marks off-screen `content-visibility:auto` content hidden, which would show "not visible now" for ordinary long pages), and add an explicit zero-size check (`getClientRects()` area), because a 0×0 element passes.

---

### S6 – fresh still capture with the outline painted

Probe `s6/` (logs `s6/out-s6.log`, `s6/out-s6-raf2x40.log`). Right-click via `sendInputEvent` → preload capture-phase `contextmenu` paints a 4 px `rgb(124, 58, 237)` ring in the top-layer shadow root → signal main (immediately / after 1 rAF / after 2 rAFs) → `wc.capturePage({0,0,900,700}, {stayHidden:true})` (the cache's call) → downscale to 1024 px longest edge + `toDataURL` (the cache's encode). Ring presence checked by sampling the captured pixel on the ring. "Busy" = page runs a 40 ms long task every 100 ms. No capture rejected in 160 captures.

**Verdict: FAIL with one frame (as written in §3 / §7.3), PASS with two frames.**

| Variant | Ring in capture | Click → pick at main (median / p95) | Pick → capture done | Click → capture done | Click → data URL ready |
|---|---|---|---|---|---|
| no rAF | 6/20 | 1.4 / 9.4 ms | 8.9 / 17.2 | 10.4 / 23.1 | 26.2 / 40.5 |
| **1 rAF (plan)** | **9/20** | 4.4 / 8.9 | 13.3 / 15.0 | 17.8 / 22.1 | 37.7 / 42.3 |
| 1 rAF, busy page | 14/20 | 2.8 / 16.5 | 7.9 / 9.0 | 11.4 / 23.2 | 28.0 / 38.2 |
| **2 rAF** | **20/20**, then **39/40** (miss = first capture after load) | 9.1 / 13.4 | 12.0 / 18.7 | **21.3 / 29.7** | **40.8 / 49.6** |
| **2 rAF, busy page** | **40/40** | 11.6 / 43.5 | 7.5 / 14.8 | **22.3 / 51.4** | **38.5 / 68.6** |

**Consequence**
- §3 "Stale still image under popups", §7.3 step 4 and E-011: change "wait one animation frame" to **"wait two animation frames"** (the same reason `previewLiveBounds.ts` uses two in `REPAINTED_SCRIPT`), and add a cheap check: main samples the captured pixels on the ring (it knows the rect from the pick and the colour from `theme`) and retries the capture once if the ring is missing (~20 ms).
- F-003 budget: click → still image ready p95 ≤ 50 ms idle and ≤ 69 ms on a busy page, leaving ~80 ms of the 150 ms for `draftOpened` IPC, React mount and the hide. Feasible; still to be measured end to end in P5/P7.
- Inference from reading `PreviewStillFrameCache.ts` (not run): `captureIfStale` **skips** when a capture of the panel is already in flight, and the right-click itself is `mouseDown`/`mouseUp`, which `previewStillFrameFreshness.ts` counts as stale-making input (marks the stored frame `stale`, schedules a refresh 500 ms later). P5 needs a dedicated "fresh capture" entry on the cache that supersedes an in-flight idle capture and is not marked stale by the triggering click.

---

### S8 – frame ↔ owner `<iframe>` mapping without `webFrame`/`postMessage`; pointer routing

Probe `s8/` (log `s8/out-s8.log`). Parent with A, B, a `srcdoc` frame and a `javascript:` frame; then C inserted by script **before** A; then B moved to the front with `insertBefore` (reloads it, new ftn); then A moved to the end with `moveBefore` (keeps the frame); then C renamed itself (`window.name`). After each step, main sent the parent `WebFrameMain.frames` (in order) and the parent paired `window[i]` with the `<iframe>` whose `contentWindow === window[i]`.

**Verdict: PASS.**

| Step | DOM order | `window[i]` order = `WebFrameMain.frames` order | Pairs consistent |
|---|---|---|---|
| initial | A B SD JS | A B SD JS (ftn 3 4 5 6) | yes |
| C added before A | **C** A B SD JS | A B SD JS **C** (ftn 7 last) | yes |
| B moved to front (`insertBefore`) | **B** C A SD JS | A SD JS C **B** (B is a new frame, ftn 8) | yes |
| A moved to end (`moveBefore`) | B C SD JS **A** | **A** SD JS C B (A keeps ftn 3 and index 0) | yes |
| C sets `window.name` | unchanged | `WebFrameMain.name` of C → `"renamed-by-child"` | yes |

- Order is **creation order on both sides**, not DOM order; identity pairing handles the difference. `moveBefore` exists in Chromium 152.
- `WebFrameMain.name` is page-controlled (the child renamed itself), so names must not be used.
- Pointer events over a frame reached **only the child preload** (`pointermove`/`pointerdown`/`mousedown`/`contextmenu` from `fa.html` with frame-local `clientX 90, clientY 60`); the parent got nothing over the frame, only events over its own area. Over the `javascript:` frame no preload received anything.

**Consequence**
- §6 "Frames" bullet and §10.2 Alt+↑ (spike S8): mapping = **main sends the parent its children in `WebFrameMain.frames` order as opaque keys** (one new optional field on `commentState`, e.g. `frames: [{key}]`, §8); the parent pairs index `i` with `window[i]` and the `<iframe>` by `contentWindow` identity. The parent checks `window.length === frames.length` and asks again (re-sends `commentHello`) on mismatch; main re-sends on `frame-created`, `did-frame-navigate` and frame removal. Never use frame names or `src`.
- Child picks carry frame-local coordinates; with S4's `screenX/Y` change the menu point needs no frame offset. Pins and outline are drawn by the child itself, so no parent offset is needed for them either.
- The hit-shield from S1a uses the same map: any `<iframe>` whose key is not marked commentable gets a shield in comment mode.

---

### Not tested here, and why

| Item | Reason |
|---|---|
| S4 on Linux X11/Wayland, mixed-DPI, second monitor, macOS | Outside this agent's scope / single monitor on this VM; the VM ran at 125 %, not 200 % |
| The real `PreviewStillFrameCache` / `captureWhileVisible` path in S6 | TypeScript source behind a build; the probe reproduced its `capturePage` call and encode. The in-flight-skip / stale interaction is inferred from code |
| The real re-arming entry watcher in S2 | Same reason; chokidar 5 was used with the same options |
| "Gitignored framed pages" in S1a | Erfana serving rule, not Electron behaviour; identical at the Electron level |
| S7, S9 | Assigned to another agent |

### Probe index

| Spike | Main | Preload | Log |
|---|---|---|---|
| shared | `harness.cjs` | – | – |
| S1 | `s1/main.cjs` (`S1_LEDGER=typed` for the typed run) | `s1/preload.cjs` | `s1/out-s1.log`, `s1/out-s1-typed.log` |
| S1 about:blank / forged headers | `s1b/main.cjs` | `s1b/preload.cjs` | `s1b/out-s1b.log` |
| S1 ledger stress | `s1c/main.cjs` (`S1C_MODE=fifo\|evict\|typed`) | `s1c/preload.cjs` | `s1c/out-s1c-*.log` |
| S2 | `s2/main.cjs` | `s2/preload.cjs` | `s2/out-s2.log` |
| S3 | `s3/main.cjs` | `s3/preload.cjs` | `s3/out-s3.log` |
| S4 | `s4/main.cjs`, `s4/main-global.cjs`, `s4/cursor.py` | `s4/preload.cjs` | `s4/out-s4.log`, `s4/out-s4b.log` |
| S5 | `s5/main.cjs` | `s5/preload.cjs` | `s5/out-s5.log` |
| S6 | `s6/main.cjs` (`S6_VARIANTS`, `S6_RUNS`, `S6_LOG`) | `s6/preload.cjs` | `s6/out-s6.log`, `s6/out-s6-raf2x40.log` |
| S8 | `s8/main.cjs` | `s8/preload.cjs` | `s8/out-s8.log` |

Run any probe from the repo root: `npx electron "<this folder>/<spike>/main.cjs"`.


---

## P0 spikes S7 and S9 – results

Date: 2026-10-25 · Branch: `feature/html-preview-comments` · Design: `docs/designs/html-preview-comments.md` (revision 2)

**Machine (applies to every number below):** Windows 11 running in a Parallels VM on Apple Silicon. The OS reports x64, but the CPU is ARMv8 (`PROCESSOR_IDENTIFIER`: "ARMv8 (64-bit) Family 8"), so the x64 Node/Electron binaries run **under x64 emulation**. 10 vCPUs, 34 GB RAM. Expect native x64 or arm64 machines to be faster. Treat the timings as upper bounds.

**Toolchain:**
- Electron 44.9.3 (Chromium 152.0.7977.167, Node 24.22.0, V8 15.2).
- Node 24.14.1 (V8 13.6).
- parse5 8.0.1, from the repo's `node_modules`.
- git 2.53.0.windows.2.

Nothing under `src/`, `e2e/`, `docs/` or config was changed. All scripts and outputs are in this folder (file list at the end).

---

### S7 – Placement and frameworks

#### Question

The §5.2 hybrid rule puts the block on its own lines for line-start targets and adds no whitespace for mid-line targets. Do the added comment node and whitespace change rendering or script behaviour? Which cases are affected (inline flow, `pre`, CSS `white-space`, flex/grid, tables, lists, SVG, scripts that read `childNodes`, framework hydration)? What should the final placement rule be?

#### Verdict

**Keep the hybrid rule, but add a runtime white-space check.** The preload reads the computed `white-space-collapse` of the target's parent at pick time and sends it with the pick. Main uses own-lines placement only when **all** of these hold:

1. The start tag is the first non-whitespace on its line.
2. The target has no `pre` / `textarea` / `listing` / `plaintext` ancestor (U-042, detectable from source).
3. The pick reports `collapse`.

In every other case (including "unknown") main uses mid-line placement. On the corpus this rule gives **0 rendering changes** in 67 line-start targets (1 harmless false positive, 0 misses).

| Rule | Visible rendering changes on the corpus |
|---|---|
| Hybrid as written (pre exception only) | 12 of 67 line-start targets – every CSS `white-space: pre*` / `break-spaces` / `white-space-collapse` case, plus SVG `xml:space="preserve"` and SVG `white-space: pre` |
| Own-lines with no exceptions | 17 |
| Mid-line everywhere | 0 |

Three further findings change the plan:

- **The §3 git claim is half wrong.** Own-lines keeps the target line out of `git diff`. But a concurrent edit to the target line, or to the line above it, still **conflicts** in a 3-way merge (62 of 62 cases; confirmed with a real `git merge` under the myers, histogram and patience algorithms).
- **The comment node itself, in either placement, is visible to page scripts and to Vue- and Svelte-style hydration.** Placement cannot fix this. It needs documenting, plus a decision about framework pages.
- **§5.9 "Position" must use source order, not DOM siblings.** In 7 of 9 implied-structure cases the block is not a sibling of its target.

#### Evidence

**Method:**
- **Prototype:** `lib.cjs` implements the §5.2 rule with parse5 `sourceCodeLocationInfo`: offset = `startTag.startOffset`, EOL = the target line's own EOL, indent = the line's leading whitespace. The block follows the §5.2 grammar, with §5.4 escaping and 7 lines.
- **Corpus:** 10 pages, 83 target elements, 67 of them line-start (`corpus/`).
- **Variants:** one file per target and mode – (a) own-lines with no exceptions, hybrid (pre exception), (b) mid-line everywhere. That gives 150 unique variant files. `delete(add(f)) === f` was asserted for all 249 insertions.
- **Rendering:**
  - Each page rendered in an offscreen Electron 44 `BrowserWindow` (software rendering, 1002×913 viewport).
  - Long pages captured as scrolled tiles; each frame taken only once two consecutive paints were byte-identical.
  - Compared against the original: every element's `getBoundingClientRect`, every non-whitespace text run's rect, `body.innerText`, script output, hydration result, new console errors and a full-page pixel diff.
  - Noise baseline: each original rendered twice, plus once more after its variants. 0 px and 0 rect differences on all 10 pages.
- **Runtime rule:** "Hybrid + runtime" uses the parent's computed `white-space-collapse`, read from the original render.

**Per case (targets with any change)**

| Case | Targets | Line-start | (a) Own-lines | Hybrid (pre exception) | (b) Mid-line | Hybrid + runtime check |
|---|---|---|---|---|---|---|
| c01 static page (CRLF) | 8 | 8 | 0 | 0 | 0 | 0 |
| c02 inline flow, inline-block, ruby, comment trick | 11 | 6 | 0 | 0 | 0 | 0 |
| c03 `pre` / `listing` with child elements | 6 | 5 | 5 | 0 | 0 | 0 |
| c04 CSS `white-space` on non-`pre` (via `<style>`) | 13 | 13 | 10 | 10 | 0 | 0 |
| c05 flex / grid / inline-flex / columns | 6 | 6 | 0 | 0 | 0 | 0 |
| c06 tables (implied tbody, colgroup), select | 10 | 9 | 0 | 0 | 0 | 0 |
| c07 lists, inline-block nav, dl, details | 6 | 6 | 0 | 0 | 0 | 0 |
| c08 inline SVG | 8 | 8 | 2 | 2 | 0 | 0 |
| c09 scripts reading `childNodes` / `firstChild` / `innerHTML` | 5 | 3 | 5 | 5 | 5 | 5 |
| c10 SSR + hand-made hydration | 10 | 3 | 5 | 5 | 4 | 5 |

c09 and c10 are script behaviour (the pages print their findings on screen). All other changes are pure rendering.

**Rendering changes, by target** (the full 83-row table is in `s7-per-target.md`; all changes are in `s7-changed.md`)

| Target (parent `white-space-collapse`) | (a) Own-lines | Hybrid | (b) Mid-line | Hybrid + runtime |
|---|---|---|---|---|
| 5 × `pre`/`listing` children (`preserve`) | extra line: 4–13 elements move 19.6–22.4 px, `innerText` changes | same as original | same | same |
| `.ws-pre`, `.ws-prewrap`, `.ws-bs`, `.wsc-preserve` (`preserve` / `break-spaces`) | extra line: 30–42 elements move 22.4 px | **changed** | same | same |
| `.ws-preline`, `.wsc-breaks` (`preserve-breaks`) | extra line | **changed** | same | same |
| inherited `pre`, GitHub-style `td.blob-code`, `.highlight code`, inline `style="white-space: pre-wrap"` | extra line | **changed** | same | same |
| SVG `<text xml:space="preserve">`, SVG `<text>` with `white-space: pre` | tspan moves 28 px | **changed** | same | same |
| `display: flex; white-space: pre` (`preserve`) | same (flex ignores whitespace-only runs) | same | same | same (forced mid-line: harmless false positive) |
| `nowrap`, `normal`, inline flow, inline-block gaps, ruby, `<br>`, flex, grid, tables, implied tbody, select/optgroup, lists, `details/summary`, `picture/source`, SVG shapes, `foreignObject` | same | same | same | same |

Screenshots of every changed variant are in `shots/`. For example, `shots/c04-css-ws__ws-pre__ownLines.png` vs `shots/c04-css-ws__original.png` shows the extra blank line at the top of the `white-space: pre` box.

**U-041 (parse5 DOM equal, ignoring comments and whitespace-only text outside pre-like elements)**

| Mode | Targets where U-041 fails |
|---|---|
| Own-lines | 5 – exactly the `pre`/`listing` cases |
| Hybrid | 0 |
| Mid-line | 0 |

U-041 cannot see CSS `white-space` (it is source-only), so it passes all 12 hybrid rendering failures. This confirms that runtime information is needed.

**Script behaviour (c09)** – the same in both placements, except where noted:

| Probe | Original | Own-lines | Mid-line |
|---|---|---|---|
| `list.childNodes[1]` | `SPAN` | `#comment` | `#comment` |
| `list.childNodes.length` | 5 | 7 | 6 |
| `span.previousSibling` | `#text` | `#text` | `#comment` |
| `list.textContent` | `"\n    one…"` | gains `"\n    "` | unchanged |
| `glued.firstChild` / `.textContent` (target is the first child, no whitespace) | `B` / `"x"` | `#comment` / **the full block text, including author and `@data`, shown on the page** | same as own-lines |
| `tabs.firstChild.classList.add()` | ok | **TypeError** (a comment has no `classList`) | same |
| "view source" demo (`demo.innerHTML` shown in a `<pre>`) | button markup | shows the whole block | same |
| numbering by `childNodes` index | 1, 3, 5 | shifted | shifted |

**Framework hydration – how the real frameworks behave** (read from source and docs; fetched pages treated as data)

| Framework | Unknown comment where an element is expected | Extra whitespace text node | On mismatch |
|---|---|---|---|
| React 18/19 (`react-dom-bindings/src/client/ReactFiberConfigDOM.js`, `getNextHydratable`) | **Skipped.** Only element and text nodes, and its own markers (`$`, `$?`, `$!`, `&`, `F!`, …), stop the cursor | **Not skipped** (text nodes are hydratable) | The root or Suspense boundary falls back to client rendering (recoverable error) |
| Vue 3 (`runtime-core/src/hydration.ts`) | **Not skipped** → node mismatch | Not skipped | In production too: the server node is removed and the client vnode mounted in its place; leftover children removed; `console.error('Hydration completed but contains mismatches.')`; text mismatches rewrite `textContent` |
| Svelte 5 (`internal/client/dom/hydration.js`, `operations.js`, `render.js`) | **Not skipped** – `hydrate_next` / `next` / `sibling` advance by raw sibling count; only `skip_nodes` passes over unknown comments | Not skipped | `hydration_mismatch` → `HYDRATION_ERROR` → clears the target and mounts fresh (unless `recover: false`) |
| Angular (`angular.dev/guide/hydration`) | The DOM must match, "including whitespaces and comment nodes" | – | Throws a DOM-mismatch error (`ngSkipHydration` destroys and re-renders) |

**Hand-made hydration routines** (`hydrate-runtime.js`; they walk server nodes by index, following the policies above). The block sits on the `<li>` or `<button>`:

| Root | Original | Block (mid-line; markup is minified, so own-lines is identical) |
|---|---|---|
| React-like (`<!-- -->` separators) | hydrated | hydrated; commented element kept |
| Vue-like (`<!--[-->` fragments) | hydrated | 2–4 mismatches and a console error. On `<li>` the **server element is reused for the next item** (text `beta` → `gamma`), so a pin would sit on the wrong item. On `<button>` the element is replaced, so the pin is lost |
| Svelte-like (`<!--[-->` anchors, strict) | hydrated | full client re-render; commented element replaced, so the pin is lost |
| React-like, pretty-printed SSR (line-start targets) | **already client-rendered** (whitespace mismatch) | unchanged (no worse) |
| Lenient (skips whitespace and comments), pretty-printed | hydrated | hydrated in both modes |
| React-like, text ending in `\n` followed by a line-start `<b>` | hydrated | own-lines: **client re-render** (extra `"\n"` text node); mid-line: hydrated |

Visible output was the same after recovery. The effects are console errors, re-mounts, and lost or **misplaced** element identity – which is exactly what the token → element pin mapping (§6) relies on.

**§5.9 "Position" – DOM sibling vs source order** (`position-check.md`, hybrid insertion)

| Case | The comment lands in | DOM-sibling rule finds the target | Source-order rule finds it |
|---|---|---|---|
| first `<tr>`, implied `tbody` | `table` (next sibling is `tbody`) | **no** | yes |
| first `<col>`, implied `colgroup` | `table` | **no** | yes |
| `<ul>` after unclosed `<p>` | `p` | **no** | yes |
| `<li>` / `<dd>` / `<td>` / `<option>` after an unclosed sibling | the previous sibling | **no** (4 of 4) | yes |
| second `<tr>`; plain sibling | parent | yes | yes |

**Git behaviour** (`git-results.json`, `gitmerge-real.log`; 62 line-start targets outside `pre`, 7-line block)

| | Own-lines | Mid-line |
|---|---|---|
| `git diff` per add | +7 / −0 (pure insertion) | +7 / −1 (the target line becomes `ind--><target…`) |
| Target line shown as changed | 0 / 62 | 62 / 62 |
| 3-way merge vs a concurrent edit of the **target line** | **conflict 62 / 62** | conflict 62 / 62 |
| … of the **line above** | **conflict 62 / 62** | conflict 62 / 62 |
| … of the line below | clean 62 / 62 | conflict 62 / 62 |
| … two lines above | clean | clean |

A real repository `git merge` (ort) gives the same result with `diff-algorithm` set to myers, histogram or patience: git treats changes on adjacent lines as conflicting. CRLF was preserved byte-for-byte (c01: original 38 CRLF; own-lines 45, mid-line 44; 0 bare LF).

#### Plan changes (S7)

1. **§3 "Placement and whitespace" row and §5.2 Placement:**
   - Own-lines placement only when (a) line-start, (b) no `pre`/`textarea`/`listing`/`plaintext` ancestor, and (c) the pick reports `white-space-collapse: collapse` on the parent of the element whose start tag receives the block. For JS-built or climbed targets (§5.6) that is the **anchor element's** parent, not the clicked element's.
   - Otherwise, including a missing flag or a re-anchor through backup anchors at Save (§7.6 step 6), use mid-line placement.
   - Replace "concurrent edits to it do not conflict with the block" with: "the target line is unchanged in `git diff`; a concurrent edit of the target line or the line above still conflicts (git treats adjacent changes as conflicting); an edit of the line below does not, unlike mid-line placement".
   - Keep E-024 as written (it checks diffs, not merges).
2. **§8 `preview-page:commentPick`:**
   - Add `ws: 'collapse' | 'preserve'` (an enum; page CSS can influence it, which is harmless because both placements satisfy decision 24).
   - §7.3 step 3: the draft stores it. §4.2 `splice.ts` `planInsert` takes it.
   - New tests: I-003 (enum), J-0xx (preload computes it from `getComputedStyle(anchorParent).whiteSpaceCollapse`), U-04x (flag → mid-line).
3. **§5.9 step 1 "Position":** redefine it as "the first eligible start tag in **source order** after the block's end offset, skipping whitespace and other erfana blocks, has the stored tag" – not the next DOM sibling. Extend U-080 with implied `tbody`/`colgroup` and unclosed `p`/`li`/`dt`/`td`/`option`. §6 "On every load" resolution must use the same source-order rule (the S9 prototype does: a binary search over start offsets).
4. **§12.2 E-019:** add a non-`pre` CSS `white-space: pre / pre-wrap / pre-line` fixture and SVG `xml:space="preserve"` – the residual risk §3 names – and assert that rects and `innerText` are equal. This spike's c03/c04/c08 pages can serve as the fixture source.
5. **Known limitation (§14 `docs/html-preview/README.md`, §9.1 S6, §10.7 wording):** pages whose scripts read `childNodes` / `firstChild` / `previousSibling` / `innerHTML` see the comment in both placements. They may misbehave (TypeError), or **display the block text, including the author, on screen**. This is inherent to decision 6 and cannot be fixed by placement.
6. **Framework hydration (decision 5 / §5.6) – needs an owner decision:** Vue/Svelte/Angular-style SSR pages mis-hydrate around any inline comment, and on Vue a pin can land on the wrong element. Options:
   - **(A, recommended)** Detect a comment-intolerant hydration root from source (`<!--[-->`/`<!--]-->`/`<!---->`, `data-server-rendered`, `ngh` / `ng-version`, `q:container`, `<!--lit-part`). Treat elements inside it as not eligible in-file, then climb to the root's container: the block goes **before** the container, with `runtime` anchors and no snapshot. This reuses the existing §5.6 climb.
   - **(B)** Document it as a v1 limitation.

   React pages are safe with mid-line placement, which minified SSR markup always gets.

---

### S9 – Parse cost

#### Question

What is the main-thread cost per load of the shared parse plus instrumentation (§4.2 `PreviewProtocolHandler`, §6) at 0.5 / 1 / 4 MB and on a 10-frame page? Is it within the §5.8 budget (≤ 50 ms at 1 MB, ≤ 200 ms at 4 MB), and if not, does a worker fix it?

#### Verdict

**Over budget on the main thread by about 2×, and the first (cold) parse blocks for 0.3–0.9 s. P3 needs a worker.**

| Measure (Electron 44) | 1 MB | 4 MB |
|---|---|---|
| Warm median on the main thread | 92.5 ms (budget 50) | 381.8 ms (budget 200) |
| Cold first parse on the main thread | 417 ms | 891 ms |
| Main thread busy, with a persistent `worker_threads` worker (median) | 6.9 ms | 28.2 ms – 19.7 ms of it is a rebuild of the token `Map`, which can be avoided |
| Transfer overhead (zero-copy) | 1–4 ms | 1–4 ms |
| Added load latency | about the parse time | about the parse time |

A tokenizer-only pass (no tree) is about 2× faster (47 ms at 1 MB, 185 ms at 4 MB). That is still borderline, and it loses the tree semantics, so it is not a substitute.

#### Evidence

**Generated inputs** (`bench-gen.cjs`, seeded):
- Content: nested section/container/row wrappers, cards, tables, articles, inline SVG icons, `<script>`/`<style>` blocks; LF, 2-space indent.
- Comments: 9.6% of bytes, about 15% of them real-shaped erfana blocks.
- Density: 66 bytes per eligible element. **This is the dense end:** the repo's own largest HTML files measure 65–324 B/element (about 140 median, `density.json`). Real pages of the same size should parse somewhat faster and have about half as many elements.

**Pipeline measured** (`pipeline.cjs`):
1. Strict UTF-8 decode plus byte-identical round-trip check.
2. `parse5.parse(…, {sourceCodeLocationInfo: true})`.
3. One iterative walk: eligible start tags per §5.6 (not `html`/`head`, not inside `head` or `template` content) and every comment node, with the anchored erfana header test.
4. Block → target resolution by source order (binary search).
5. Token minting (`crypto.randomBytes`, 12 base32).
6. **One** string rebuild inserting ` data-erfana-el="…"` after each tag name.
7. A token → offset `Map`.
8. UTF-8 encode.

Each set ran in a fresh process: 1 cold run, 2 warm-ups, then 10 measured runs. With n = 10, p95 is the slowest run.

**Main thread, full pipeline (ms)**

| Runtime | Input | Elements | Comments (erfana) | parse | walk | instrument | **Total median** | p95 | Cold | §5.8 |
|---|---|---|---|---|---|---|---|---|---|---|
| Electron 44 | 0.5 MB | 8,430 | 196 (22) | 35.8 | 2.8 | 4.4 | **45.5** | 103.7 | 330.2 | – |
| Electron 44 | 1 MB | 16,159 | 357 (52) | 73.7 | 5.8 | 10.3 | **92.5** | 134.3 | 417.3 | **missed** (50) |
| Electron 44 | 4 MB | 64,187 | 1,382 (219) | 312.7 | 19.9 | 46.4 | **381.8** | 493.1 | 890.7 | **missed** (200) |
| Electron 44 | 10 × 200 KB | 32,839 | 744 (119) | 154.2 | 11.4 | 20.7 | **190.0** (longest frame 27.5) | 215.5 | 649.6 | – |
| Node 24.14 | 1 MB | 16,159 | 357 (52) | 87.6 | 7.3 | 9.7 | **109.7** | 182.9 | 497.6 | **missed** |
| Node 24.14 | 4 MB | 64,187 | 1,382 (219) | 342.8 | 30.5 | 41.1 | **432.1** | 585.0 | 987.8 | **missed** |

- Decode and encode are ≤ 5 ms in every row.
- Recording source locations costs about 20–30% of the parse time (Electron, no locations: 56.6 ms at 1 MB, 257.6 ms at 4 MB).
- Electron was measured with `ELECTRON_RUN_AS_NODE=1` – the same V8 and Node as the main process, but without Chromium's load on that thread, so the real main process can only be slower.
- The full tables, including Node 0.5 MB and the 10-frame set, are in `s9-tables.md`.

**Memory** (Electron, a single run in a fresh process)

| Input | Peak RSS growth | Heap held while the tree is alive | Served copy growth (30 B per token) |
|---|---|---|---|
| 1 MB | 64 MB | 15 MB | +46% (1.01 → 1.47 MiB) |
| 4 MB | 164 MB | 58 MB | +46% (4.02 → 5.85 MiB, still far below `MAX_ASSET_BYTES` 25 MB) |
| 10 × 200 KB | 88 MB | 30 MB | +47% |

**Persistent worker** (`worker_threads`, Electron 44, start-up 151 ms; the input `ArrayBuffer` is transferred in, and the instrumented bytes, an `Int32Array` of offsets and one token string are transferred out)

| Input | End-to-end latency median / p95 | Worker compute | Transfer overhead | **Main-thread busy (ELU)** | Of which `Map` rebuild |
|---|---|---|---|---|---|
| 0.5 MB | 64 / 210 | 56.5 | 1.2 | **3.6** | 2.4 |
| 1 MB | 88.6 / 104 | 80.8 | 1.6 | **6.9** | 4.9 |
| 4 MB | 383 / 423 | 355.9 | 3.5 | **28.2** | 19.7 |
| 10 frames, 1 worker (serial) | 143 / 156 | 126.2 | 6.7 | **16.1** | 8.1 |
| 10 frames, pool of 4 (concurrent) | 87.9 / 279 | – | – | **24.2** | 11.9 |

- Cold first request in a fresh worker: 337 ms at 0.5 MB (JIT warm-up).
- Cold first request across a pool of 4: 1.2 s.
- Node 24.14 numbers are similar (`s9-worker-node.json`).
- ELU = event-loop utilisation, the time the main thread is actually busy. `monitorEventLoopDelay` maxima (14–25 ms) sit at the Windows timer granularity and are not meaningful here.

#### Plan changes (S9)

1. **§5.8 parse budget row and §4.2 `PreviewProtocolHandler`:**
   - Run the shared parse in a **persistent `worker_threads` worker**. Follow the repo's own pattern: `src/main/services/GitStatusWorkerAdapter.ts` plus its own bundle entry (`electron.vite.config.ts:176`). `worker_threads` rather than `utilityProcess`, because `ArrayBuffer` transfer is zero-copy.
   - Add `services/preview/comments/commentParseWorker.ts` and its adapter to the §4.2 module map.
   - Restate the budget as: **main-thread busy ≤ 10 ms at 1 MB and ≤ 30 ms at 4 MB; added load latency recorded per OS** (≈ 90 / 380 ms here).
2. **§4.2 `ElementTokenTable`:** keep the per-load table as `{tokens: string, offsets: Int32Array}` with an aligned `indexOf` lookup (picks are ≤ 5 per second), not a `Map`. This removes most of the 4 MB main-thread cost (19.7 of 28.2 ms).
3. **Pre-warm:** start the worker and run one small warm-up parse when the first HTML preview opens with `htmlPreview.comments.enabled` on. Otherwise the first commented page pays about 340 ms of JIT warm-up on top of start-up (151 ms). Use one worker with a serial queue: a pool of 4 halved warm frame latency but cost 1.2 s cold, so it is not worth it in v1.
4. **§7.6 steps 6 and 8, and `preview:commentList`, also parse the whole file.** At Save that is a parse plus a verification re-parse: about 2 × 310 ms of main-thread block at 4 MB on this box. Route every parse5 pass over page files through the same worker, so a Save never freezes the window.
5. **§5.8 "Tokens per document 50,000":** a 4 MB element-dense file has 64,187 eligible elements, and §5.8 does not say what happens above the cap. Either define it (serve raw, comments read-only, reason "too many elements", logged through `dropReporter`) or raise the cap to 100,000. Cost is linear; the table holds about 0.8 MB of token string at 64k. Recommended: raise to 100k **and** define the over-cap path.
6. **§12.2 F-002 and §13 P3 exit:** record main-thread busy (ELU), worker latency and the cold first parse separately. Gate on main-thread busy. Record latency on Windows; gate latency on macOS/Linux, as F-001 does.
7. **Decision 28 / F-001:** at 4 MB, worker latency (about 380 ms here) plus reload and paint eats into the 1 s save → pin budget. Add a 4 MB sample to F-001 on the gating OSes.

---

### Files in this folder

| File | What |
|---|---|
| `lib.cjs` | S7 insertion prototype (§5.2), block serializer, U-041 comparison |
| `build-corpus.cjs`, `hydrate-runtime.js`, `corpus/` | S7 corpus (10 pages, 83 targets) and hand-made hydration routines |
| `make-variants.cjs`, `variants/`, `manifest.json` | Per-target variants (150 unique), U-041 results |
| `render-probe.cjs`, `render-results.json`, `render-probe.log`, `shots/` | Electron render comparison and screenshots of every changed variant |
| `report-s7.cjs`, `s7-summary.json`, `s7-per-target.md`, `s7-changed.md`, `s7-by-case.md` | S7 tables |
| `position-check.cjs`, `position-check.md` | §5.9 position rule check |
| `gitdiff.cjs`, `git-results.json`, `gitmerge-real.sh`, `gitmerge-real.log` | Git diff shape and merge-conflict tests |
| `bench-gen.cjs`, `bench/` | S9 generated inputs |
| `pipeline.cjs`, `bench-child.cjs`, `bench.cjs`, `s9-results.json` | S9 main-thread benchmark |
| `bench-worker.cjs`, `s9-worker-electron.json`, `s9-worker-node.json` | S9 worker benchmark |
| `bench-extra.cjs`, `s9-extra.jsonl` | Tokenizer-only lower bound, single-run memory |
| `density.cjs`, `density.json` | Element density of real repo HTML vs the generated inputs |
| `report-s9.cjs`, `s9-tables.md` | S9 tables |

Reproduce from the repo root with `node <scratch>/<script> <scratch>` – except `render-probe.cjs`, which runs as `npx electron <scratch>/render-probe.cjs <scratch>`. Build order: `build-corpus` → `make-variants` → `render-probe` → `gitdiff` → `report-s7`, and `bench-gen` → `bench` / `bench-worker` / `bench-extra` → `report-s9`.

---

## X-001 agent readability – P1 run (2026-10-26)

> Design: §16 HPC-X-001 (decision 27). Pages: `e2e/fixtures/html-preview-corpus/comments/agent-review/` (`landing.html`, `slides.html`, `signup-form.html`), written by the P1 serializer, with three blocks damaged on purpose. Answer key: `RUBRIC.md` in the same folder (never copied into the run repo).
> Method: each run copies only the three pages into a fresh git repo, commits them, then runs `claude -p "apply the review comments" --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep"`. Scored with `git diff` against the rubric. Claude Code 2.1.310, default model.

### Round 1 – format as first drafted

| Check | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| All 13 open comments acted on at their target | Pass | Pass | Pass |
| Resolved comments (3) not acted on | Pass | Pass | Pass |
| Damaged blocks (3) not acted on | Pass | Fail – 2 of 3 acted on | Fail – 2 of 3 acted on |
| Blocks untouched | Pass | Fail – 15 blocks deleted | Fail – 15 blocks deleted |
| Files intact, no escape misread | Pass | Pass | Pass |

Findings:

- **Agents delete the block after acting on it.** Nothing in the block said to keep it.
- **Agents act on a damaged block when its readable text looks clear.** The `readable-mismatch` blockquote and the `bad-json` Prev button were applied in runs 2 and 3. The conflict-marker block was left alone in every run.
- No misreading of `@data` or of the escapes in any run.

### Format change applied before P2

Every block now carries a fixed agent note as its second line (constant `AGENT_NOTE_LINES` in `src/shared/htmlComments/format.ts`):

```text
note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
  If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
  Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
```

- Readers skip the note. A block reads the same with the note present, absent, reworded, cut short or re-indented (U-022…U-025, P-001/P-002, compat page c09).
- The note never contains `@data` followed by a space. A first wording did, and a tool that searched for that text truncated the note instead of the real data line (U-023 guards this).
- Goldens, `v1.lock.json`, compat pages, the agent-review pages and `RUBRIC.md` were regenerated; `docs/html-comments/format-v1.md` documents the note.

### Round 2 – with the agent note

| Check | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| All 13 open comments acted on at their target | Pass | Pass | Pass |
| Resolved comments (3) not acted on | Pass | Pass | Pass |
| Damaged blocks (3) not acted on – agent asked the user instead | Pass | Pass | Pass |
| Blocks untouched (0 block lines changed, moved or removed) | Pass | Pass | Pass |
| Files intact, no escape misread | Pass | Pass | Pass |

Verdict: **PASS, 3 of 3** for Claude Code. Run 3 put the button padding on the element (`style="padding: 15px 27px;"`) instead of the `.btn-primary` rule; that still meets the comment.

### Codex – not run

The Codex CLI is not installed on this machine (not on the bash or PowerShell `PATH`, not in global npm), and running it needs the owner's OpenAI sign-in. The Codex half of X-001 is open and on the owner review list; it runs on the macOS handoff (§16) or after the owner installs and signs in to Codex here. The P8 confirmation run repeats both agents on real Erfana-written files.

---

## X-001 confirmation (Erfana-written files)

> Plan §13 P8, run 2026-10-26. Claude Code 2.1.310, default model; Claude Code only (owner decision: Codex not needed).
> Pages: the three agent-review pages re-created through the production writer. Their blocks were stripped from copies, then every comment, reply and resolve was a separate `CommentWriter` save (in-process comment file jobs, as the writer suites run it; crypto-random ids), with the targets, authors, texts and timestamps of `src/shared/htmlComments/__fixtures__/gen/agentReview.ts`. The writer cannot produce a damaged block, so the three blocks damaged on purpose in the P1 pages are absent: 16 blocks – 13 open (one with a reply), 3 resolved (comment, reply and resolve as three saves).
> Method: as round 2 – each run copies only the three pages into a fresh git repo, commits them, then runs `claude -p "apply the review comments" --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep"`. Scored with `git diff` against a rubric derived from `agent-review/RUBRIC.md`, and by re-parsing each result with `analyzeCommentDocument`.

Writer check before the runs: every block parses `ok` and attached, every file writable; with the random ids normalised, each page is byte-identical to its P1 page minus the damaged blocks – the production writer writes exactly what the P1 serializer wrote.

| Check | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| All 13 open comments acted on at their target | Pass | Pass | Pass |
| Resolved comments (3) not acted on | Pass | Pass | Pass |
| Blocks untouched (16 of 16 byte-identical, same order, all still `ok`) | Pass | Pass | Pass |
| No change outside the 13 targets | Pass | Pass | Pass |
| Files intact, no escape copied into the page | Pass | Pass | Pass |

Verdict: **PASS, 3 of 3.** The three runs produced byte-identical files (37 changed lines), so they are one outcome, not three independent samples.

Findings:

- **Removing an element hands its open comment to the next element with the same tag.** After the grinder card was removed, its open block resolves `via: position` to the "Pause any time" card: §5.9 step 1 checks only the tag. `format-v1.md` told agents Erfana then shows "element not found", which holds only when the next element has another tag; the sentence is corrected in the same change. Run 1 noticed and warned that a later pass could remove the wrong card; run 2 assumed the quote prevents that (it does not – position runs first). Round 2 had the same case unnoticed. An anchoring follow-up, not a format-readability failure – listed for owner review.
- **The spec pointer 404s before release.** Run 1 fetched `https://raw.githubusercontent.com/qodeca/erfana/main/docs/html-comments/format-v1.md` (404 – the doc is not on `main` yet) and fell back to the note in each block. Agents guess `main`, not the default branch.
- The runs inherit the operator's Claude Code setup: each created a branch (global CLAUDE.md) and used Bash and, in run 1, WebFetch outside `--allowedTools` (permission allow-list). Same as round 2; no effect on the score.
- Runs 1 and 3 reported "12 open comments" while making all 13 changes – a counting slip in the summary only.
