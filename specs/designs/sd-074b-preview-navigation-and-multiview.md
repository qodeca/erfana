# Design: HTML preview — in-page link navigation + independent preview tabs

**Revises**: [`sd-074-html-preview.md`](sd-074-html-preview.md) §10 non-goals (concurrency, link navigation) | **Issues**: to be filed (three: IPC sender gating, independent previews, in-page link navigation) | **Tier**: 2 | **Complexity**: complex | **Branch**: `feature/html-preview-navigation` off `develop` | **Status**: revision 2, approved, **shipped in [#79](https://github.com/qodeca/erfana/issues/79) (v0.18.0)**; D7, D8, §4.5 and the code references below were reconciled with what was built on 2026-09-04 (v0.19.0 Windows fixes)

Two behaviours are added to the running HTML preview:

1. **Links work.** A link inside a previewed page opens its target inside Erfana, in a new tab.
2. **Previews are ordinary tabs.** Every `.html` file opens in its own tab and runs independently; idle previews sleep rather than being refused.

> **Revision 2.** Revision 1 was reviewed through four lenses (security, Electron/Chromium platform behaviour, concurrency correctness, architecture) and returned 6 must-fix and 16 should-fix findings. Three decisions changed: in-place navigation is dropped, unbounded live previews became sleep-when-idle, and the app's IPC surface is hardened in its own phase *before* the preview page gains any channel. The findings are folded into the sections below rather than listed separately.

---

## 1. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Read the anchor's `target` via a **one-way preload** in the preview session | `will-navigate` does not carry `target`; a plain link and `target="_self"` are indistinguishable there. The attribute exists only in the DOM. Revises the "no preload in the sealed box" rule (`previewSessionPolicy.ts:14-17`) |
| D2 | The preload exposes **nothing** to the page — no `contextBridge`, no globals | Page script cannot reach `ipcRenderer` under `contextIsolation: true`. The channel is page→main only, WebContents-scoped, never on global `ipcMain` |
| D3 | **The CSP is not relaxed** | Erfana drives navigation with `loadURL`; the page never navigates itself |
| D4 | **Every link opens a new tab.** No in-place navigation in this version | Operator decision. `target="_self"`, `_top`, `_parent` and `<base target>` are all documented as behaving like a new tab. See §3.3 for what this drops and why |
| D5 | **Previews sleep when idle**: the 3 most recently active stay live; the rest tear down to a still frame and re-open automatically when their tab is activated | Replaces revision 1's uncapped "keep every preview alive". Caps live renderer processes. The still frame plus auto-reopen is exactly the exit state whose absence killed LRU in the original design (`sd-074-html-preview.md:1406`) |
| D6 | External `http(s)` / `mailto:` links **open in the OS browser, after the destination is shown** | Matches Markdown preview (`MarkdownPreview.tsx:440-447`); the destination readout answers the review's point that a trusted click is not informed consent |
| D7 | One in-memory session partition **per view**, its name recycled after a bounded purge (v0.19.0) | `previewSessionPolicy.ts:64-66`. N previews get N isolated sessions. Shared state to reconcile is the allowlist (§4.4) and the watcher budget (§4.6); the blocked-host toast budget §4.5 once named went with the toast |
| D8 | **Keep** `PREVIEW_VIEW_LIMIT_REACHED`, as the refusal for a **cross-window panel-id collision** only | Revision 1 deleted it. As built (`PreviewViewService.open`), the same panel id arriving from a *different* window is refused with it, because panel ids are path-derived and replacing would destroy the other window's running view. There is no hard ceiling and nothing is configurable: past `PREVIEW.MAX_LIVE_VIEWS` the service suspends the least recently active preview, it never refuses. Keeping the code preserves the one refusal path and its tested UI branch |
| D9 | **Harden the global IPC surface before any preload exists** (phase 0) | ~118 `ipcMain` registrations, sender checks in 8 files. Today the sealed page has no channel at all; after D1 its *process* does, and a renderer compromise then reaches ungated handlers |

---

## 2. Current state (verified)

> This section describes the code **as it stood at v0.18.0**, before this design was built. The line numbers and names in it (`forPanel()`, the single `live` field, `openEpoch`) are historical: `PreviewViewService` now delegates to `PreviewViewRegistry` (§4.2), and the per-panel lookup those call sites went through no longer exists.

**Links are inert.** `previewViewLifecycle.ts:106-110` denies `setWindowOpenHandler` and `preventDefault`s `will-navigate`; `previewCsp.ts:78-86` serves `sandbox allow-scripts` with `form-action 'none'` and `base-uri 'none'`.

> **Correction from review.** Revision 1 claimed these were "two independent locks" and that Blink blocks the navigation first. Per the HTML sandboxing flags, the sandboxed-navigation flag prevents content navigating browsing contexts **other than its own**; a top-level document under `CSP: sandbox` may still navigate itself. For `target="_self"` and `location.href`, `will-navigate` is therefore the **only** lock — and it has no test (`previewViewLifecycle.test.ts` only stubs the window-open handler). The "unclassified Blink console error" premise behind part of the badge work is likewise unverified.

A clicked link today produces no navigation, no badge entry and no toast — `previewConsoleClassify.ts:101-118` matches neither case. There is no user-facing documentation of this.

**One preview at a time.** `PreviewViewService.ts:137` holds one `live` view; `:177-185` refuses a different `panelId`; `:187-200` replaces the same one; `:324-326` funnels every per-panel operation through `forPanel()`; a single `openEpoch` (`:142`) is re-checked at `:175,187,223,266,332`.

**Two pre-existing defects that multi-view would multiply per tab** (§4.1).

**Layout constraint that keeps visibility simple**: Dockview drag-and-drop is disabled and nothing creates a positioned group (`EditorAreaSplitPanel.tsx:161`), so at most one editor tab is visible at a time. Nothing enforces this, which is itself a finding (§4.8).

**Already multi-view-safe**: `PreviewRootRegistry` (Map by token), `PreviewStillFrameCache` (Map by panelId), `PreviewFindController` and `PreviewFailureLog` (per view), `PreviewWatchCoordinator` + `PreviewWatchPool` (per view), and the renderer bounds pump (per panel, with its own sequence number).

---

## 3. Behaviour specification

### 3.1 Target mapping

| `target` on the anchor | Erfana behaviour |
|---|---|
| absent, `_blank`, named, `_self`, `_top`, `_parent` | **new tab** |
| any value, with Cmd/Ctrl held, or middle-click | **new tab** |

Every link opens a new tab; "new tab" means the app's existing rule — reuse the tab already showing that file, otherwise create one (`openFileInPanel.ts:210-233`).

This inverts the HTML default (`_self`). The consequence is accepted deliberately: a generated documentation site mints a tab per click. D5's sleep policy is what makes that affordable, and it is the reason D5 is not optional.

### 3.2 Link kinds

| Link | Result | Decided by |
|---|---|---|
| `#hash` on the current document | native in-page scroll, never routed | preload short-circuit |
| in-project `.html`, preview-eligible | preview tab | main policy → renderer `resolvePanelKind` |
| in-project `.html`, ineligible (`node_modules/`, `dist/`, `out/`, `coverage/`, `.git/`, gitignored) | opens as source | renderer `resolvePanelKind` |
| in-project `.md`, image, any other file | its natural panel, as a project-tree click | renderer `resolvePanelKind` |
| `file.html#section` | opens the file, lands on the anchor | anchor carried in the open payload |
| path outside the project, or missing | refused, failure entry | main policy (existing confinement) |
| `https:`, `http:`, `mailto:` | destination shown, then OS browser | main policy |
| **anything else**, and `<a download>` | blocked, failure entry `blocked-link` | main policy, **default arm** |

Main re-resolves every path through `previewPathResolve.ts` and `PreviewEligibilityService.ts`. Nothing trusts the string the page supplied.

`decideLinkIntent` (`PreviewNavigationPolicy.ts`; planned here as `decideNavigation`) is an exhaustive switch whose **default arm returns `blocked`**, so an unlisted scheme (`intent:`, `ms-msdt:`, `search-ms:`, `smb:`) is refused without appearing on any list. The preload sends `anchor.href` — the URL-parsed IDL property, never `getAttribute('href')` — because the WHATWG parser strips tabs and newlines, so `java\nscript:` would defeat a raw prefix check.

### 3.3 What is deliberately not built

**In-place navigation is dropped.** It would break the app's file-equals-panel identity in both directions, and revision 1 documented only the harmless one. The damaging direction: after panel `preview-<hash(a.html)>` navigates to `b.html`, clicking **a.html** in the tree hits the reuse branch (`openFileInPanel.ts:206-216`), calls `setActive()` and stops — the user asks for A and is shown B. The tab title (`HtmlPreviewPanel.tsx:207-210`), label, tooltip and close label (`HtmlPreviewTab.tsx:103-108`) and the `PanelErrorBoundary` key (`EditorAreaSplitPanel.tsx:60`) all keep pointing at the original file, mis-scoping error containment.

Dropping it also removes three dependent problems: the forwarded-accelerator contract cannot express `Alt+Left` (`previewInputForward.ts:88-101` ignores `alt` on the accel branch and forbids it on the other, and `PreviewForwardedShortcutSchema` is a strict 4-key enum that would drop new keys at emit with only a warning); an Erfana-owned history stack silently diverges from Chromium's and misses fragment hops (`will-navigate` does not fire for in-page navigation); and `PreviewLiveView.ts`, already 545 lines against a 500-line cap, would grow further.

If in-place is wanted later it needs a renderer-side current-document index that `openFileInPanel` consults, store-driven paths for title/tooltip/boundary key, `did-navigate-in-page` subscription, and a redesigned accelerator contract. That is a separate issue.

---

## 4. Phase A — independent preview tabs

### 4.1 Two pre-existing races, fixed first

Both exist today with one view; a Map turns each into a per-panel copy.

**`close()` racing an in-flight `open()` leaks a whole view** — `PreviewViewService.ts:263-270`. `close()` bumps the epoch only inside `if (live !== null)`. An open suspended at `sessionFactory.create` (`:212`) has `live === null`, so a close landing in that window is a no-op; the open passes its re-check at `:223` and installs a view for a panel whose renderer already unmounted. The renderer fires close unconditionally on unmount (`usePreviewLifecycle.ts:124-131`), so this is the ordinary path, and nothing reaps the result: `destroyAll` fires only on the global off-toggle, and project-switch teardown is not wired at all. *(Partly closed 2026-08-29: a per-window `closed` handler now drains that window's views through `PreviewViewService.closeWindow`, so a stranded view no longer outlives its window. A project switch inside a surviving window is still unreaped — see technical-debt #36.)*
*Fix*: bump the per-panel sequence **unconditionally** in `close()`; keep a `closingPanels` set; re-check `(generation, seq)` after `live.load()` as well — that await has no guard today.

**`teardown()` is not exception-safe** — `PreviewLiveView.ts:473-509`. It latches `this.destroyed` at `:477`, then awaits `lifecycle.dispose()` (`:489`) and `watchCoordinator.dispose()` (`:491`) with no `try/finally`. A throw skips `factoryTeardown`, `findController.dispose`, `failureLog.drop`, `registry.revoke` and `wc.destroy()`, leaving a permanently inert object. Under a Map with `Promise.allSettled` swallowing the rejection, the entry survives and that panel id is occupied forever.
*Fix*: `try/finally` around the body; delete from the registry **before** awaiting; put `registry.revoke` and the notifier refcount decrement in the `finally`.

### 4.2 View registry

Extract `PreviewViewRegistry` from `PreviewViewService` — the service would otherwise absorb the map, the two counters and per-view window tracking while `PreviewLiveView.ts` is already over the file-size cap. The registry owns:

- **`Map<viewKey, PreviewLiveView>` keyed by `(windowId, panelId)`**, not `panelId` alone. Panel ids derive deterministically from the file path (`openFileInPanel.ts:120-122`), so two windows previewing the same file would mint the same id and window B's open would take the *replace* branch and destroy window A's view. Erfana ships one window today; keying correctly is free now and removes the trap later.
- **The split guard**: a global `generation` bumped by `onProjectChanged` / `destroyAll` / `dispose`, plus a per-key `openSeq` bumped by `open` and `close`. An in-flight open captures both and aborts after any `await` if either moved. The single counter today makes two legitimate concurrent opens cancel each other.
- The owning `BrowserWindow` per view, for window-scoped emission (§4.9) and for the correct zoom factor (`buildPreviewGraph.ts:93-97` currently takes the first non-destroyed window).

`destroyAll` / `onProjectChanged` / `dispose` bump `generation`, then tear down every view under `Promise.allSettled`, honouring `PREVIEW.CLOSE_TIMEOUT_MS`.

### 4.3 Sleep policy (D5)

- Keep the **3** most recently active previews live (`PREVIEW.MAX_LIVE_VIEWS`, configurable).
- On eviction: capture the still frame through the existing `PreviewStillFrameCache`, tear the view down through the §4.1 path, set the panel's store state to `suspended`.
- On activation of a suspended panel: re-open automatically. Page state is lost by design; the still frame covers the gap so the tab is never blank.
- `PREVIEW_VIEW_LIMIT_REACHED` (D8) stays wired only for the cross-window panel-id collision. There is no hard ceiling: over `MAX_LIVE_VIEWS` the service suspends, it never refuses.

**Measure before assuming a sleeping tab was free.** Electron documents `backgroundThrottling` as throttling when *the page* is backgrounded, and `View.getVisible()` as distinct from being visible on screen; nothing documents a hidden child view inside a foreground window counting as backgrounded. Measure a hidden preview's page-visibility state first. If it is not throttled, drive `webContents.setBackgroundThrottling()` from the visibility signal `OverlayGuardService` already computes.

### 4.4 Allowlist consistency and fan-out

`PreviewAllowlistStore` holds one in-memory host set (`:97`) that every session's request filter reads live (`PreviewSessionFactory.ts:228-231`), while only the approving panel rebuilds its CSP (`PreviewLiveView.ts:295`). With two previews open, approving a host opens panel B's **network filter** while its **CSP** still forbids it. The fan-out fixes a latent bug, not just a new one.

Approval therefore rebuilds the CSP of every live view of that project, purges its session and reloads it — but the review found `applyApprovedHosts` re-enters across an `await` with no liveness re-check (`:290-299`), and `boundedDestroy` (`:512-544`) leaves a window of up to `CLOSE_TIMEOUT_MS` in which the contents is *closing* but `isDestroyed()` is still false. Calling into that state is a hard fault, not a no-op (cf. electron/electron#47099).

*Requirements*: add an explicit `closing` flag set by `boundedDestroy` and fold it into `isDefunct`; re-check `isDefunct` after **every** await; make "rebuild CSP → purge → clear → reload" a single per-view method that aborts at any step; snapshot the map and run the fan-out under `Promise.allSettled`. A `rebuildCsp` on a revoked token is a silent no-op (`PreviewRootRegistry.ts:83-87`), so losing that race must be detected rather than assumed benign.

### 4.5 Blocked-host reporting budget

*Revised after the build.* The blocked-host **toast** and its project-keyed budget (`PreviewHostBlockNotifier.ts`) were deleted when the permission band replaced the toast, so the refcount this section originally specified has nothing to count. What ships instead is **per view**, with no shared state: each blocked origin is reported once per change of kinds on `preview:hostBlocked`, capped at `PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW` (50) with a per-hostname sub-cap of `PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST` (5) so one host cannot spend the budget on ports (`src/shared/constants.ts`; applied in `PreviewViewService` and `previewCspViolationBridge.ts`). The ledger lives and dies with its view, so a superseded open that is discarded holds nothing.

### 4.6 Watcher budget

16 per pool (`constants.ts:476`), one pool per view (`buildPreviewGraph.ts:140-142`), so the cost is 16·N.

Make the budget a **token the pool takes and returns beside its own entries map** — not a counter coordinators consult. The pool has three asymmetric paths (`PreviewWatchPool.ts:115-123,144-151`): a cap rejection that takes no descriptor, a re-acquire that only bumps a refcount, and a release that returns early while the refcount is positive. A budget owned elsewhere leaks across them, and it leaks toward permanent starvation.

Set `PREVIEW.MAX_WATCHED_FILES_GLOBAL` **above** the supported live-preview count, not below it: revision 1 chose 64 while its own perf scenario opened 5 previews (5 × 16 = 80). With D5 capping live views at 3, 64 is workable, but the number must be derived from `MAX_LIVE_VIEWS × MAX_WATCHED_FILES` plus headroom, not chosen freely. Over budget degrades and records a failure entry.

*Deferred*: one shared refcounted pool across views, which would also dedupe a CSS file watched by two previews. It needs the per-view realpath re-arm gate (`buildPreviewGraph.ts:161-167`) moved onto the pool entry.

### 4.7 Asset reads

Revision 1's global in-flight **byte** budget is dropped. The read path deliberately never learns size first (`previewPathResolve.ts:250-256`, "never trusts st.size"), so a byte budget must reserve pessimistically at `MAX_ASSET_BYTES` (25 MB) per read: 128 MB would admit 5 concurrent reads app-wide against today's 8 *per session*, attacking the AC24 target it was meant to defend. Its "defer rather than fail" also had no queue cap, no deadline and no failure entry, and would hold a session slot while waiting on the global budget.

Instead: make `MAX_CONCURRENT_ASSET_READS` a **global** limiter across sessions, sized for `MAX_LIVE_VIEWS`, and record a failure entry on rejection so the failure mode is observable. Technical-debt #38 (per-session amplification) is narrowed by the live-view cap rather than closed; leave the ledger entry open with a note.

### 4.8 Renderer

- Delete `holderPanelId` and its actions (`usePreviewStore.ts:78,219-221`); add `suspended` to the panel state.
- `OverlayGuardService`: `getLivePreviewPanelId()` → `getLivePreviewPanelIds()`; `readLivePreviewPanelId` (`:224-233`, first-non-idle scan) → a full-set reader, which retires the Map-iteration-order caveat in its own comment; the v0.18.0 `trackedPanelId` + `lastVisible` scalars (`:129,136`) → a single `lastVisible: Map<panelId, boolean>` pruned when a panel leaves the live set (as built in `src/renderer/src/services/preview/OverlayGuardService.ts`; there is no `trackedPanelId` any more). The rule per panel stays `visible = panelId === activeTabId && !occluded`.
- **Make the one-visible-tab assumption executable.** It holds only because `disableDnd` is set (`EditorAreaSplitPanel.tsx:161`) and nothing asserts it — the same file already anticipates DnD returning (`:154-160`). Add a dev-mode invariant in `recompute` that logs when more than one live panel computes `true`.
- Keep the `limit-reached` view state in `selectPanelView`: it is reachable through the D8 cross-window refusal (`htmlPreview.logic.ts`), which is the only refusal left.
- The service remains the sole `api.preview.setVisibility` caller; the ESLint `no-restricted-syntax` guard in `eslint.config.mjs` is unchanged. (An earlier revision named a `scripts/preview-eslint-guard.test.ts`; no such file was ever written and the guard has no dedicated test.)

### 4.9 Events, project switch, and tests

- Add a **window-scoped** emit path. `emit.ts:98-104` broadcasts to all windows, which is harmless for panel-id-carrying events but wrong for the new `openFileRequested` (§5.4) — two windows would each open a tab.
- **`subscribeProjectChanged` has no producer.** Both revision 1 and its plan called it "declared but never passed" (`preview-handlers.ts:58-60`, `index.ts:394-397`); in fact `FileService.setProjectPath` (`:51`) emits nothing and its callers publish no event. This phase adds the event source, then defines the ordering against the renderer's own `preview:close` on the same switch: main-side teardown removes from the registry first, so a concurrent close is a clean no-op.
- Write the **`will-navigate` deny test here**, not in phase C. Per §2 it is the only lock.
- The unit tests that invert change **in this phase**, because `Unit tests` is a required check: `PreviewViewService.test.ts:317-360,457-480`, `lifecycle-handlers.test.ts:89,138`, `usePreviewStore.test.ts:92-101`, `HtmlPreviewPanel.test.tsx:162-171`, `htmlPreview.logic.test.ts:80-95`, and the `e2e/html-preview-corpus.e2e.ts` helpers at `:56-58,67,92-118,125,145-151` which assume "the one live preview".

---

## 5. Phase B — link routing

Phase 0 (§7) must have landed: the preload gives the preview's *process* an IPC path, and the global handler surface must be gated before that exists.

### 5.1 The preview preload

New `src/preload/previewPage.ts`, a fourth entry in `electron.vite.config.ts:91-95`.

**Build constraint** (`electron.vite.config.ts:31-55`, the #73 guard): preload entries must be self-contained. A value-import shared with another entry makes Rollup hoist a chunk a sandboxed preload cannot `require`, and the packaged app opens on the root error screen. Inline the channel name and constants, or use `import type`. `src/preload/imageExport.ts` is the working precedent. In particular the protocol classification (§5.3) stays main-side and is **not** value-imported here.

Behaviour:

1. Listen for `click` and `auxclick` on `document`.
2. Ignore when `!event.isTrusted` (so `a.click()` cannot drive it) or the button is neither primary nor middle.
3. Find the nearest `<a href>` / `<area href>` through `event.composedPath()`.
4. Let same-document fragment links proceed natively.
5. Read `target` from the anchor, falling back to an explicit `document.querySelector('base[target]')` re-read per click — there is no IDL surface for a document base target, and a page can mutate `<base>` at runtime.
6. `preventDefault()`, defer to a microtask, **re-check `defaultPrevented`**, then `ipcRenderer.send(channel, { href: anchor.href, target, modifiers, download })`.
7. No `contextBridge` call anywhere in the file.

Step 6's re-check exists because revision 1 had the ordering backwards: a preload listener registers before any page script, so among document-level listeners Erfana's fires **first**, not last. Deferring restores "the page gets to decide first".

**Documented blind spots**: a page that calls `stopPropagation()` on its own handler, and links inside **closed** shadow roots, both stay inert — the same behaviour as today.

### 5.2 Wiring the preload

Keep `PREVIEW_WEB_PREFERENCES` preload-free. It is a frozen module-level literal with no filesystem access, asserted by key **absence** (`previewSessionPolicy.ts:29-32`), and a preload path is environment-dependent (`__dirname` differs between build and Vitest).

Add `buildPreviewWebPreferences(session, preloadPath)` composing the frozen literal with the path resolved at the composition root and **`existsSync`-checked**, following `ScreenshotOverlayWindow.ts:108-112`, which revision 1 cited but did not copy. Without that check a packaging regression returns links to today's silence with no signal. Record a failure entry if the bundle is missing.

Invert the pinning test: assert the **constructed** preferences carry the expected path, and that the built `out/preload/previewPage.js` contains no `contextBridge`, no `webFrame` and no `ipcRenderer.invoke`/`.on`.

### 5.3 The channel

`webContents.ipc.on(...)` — **WebContents-scoped, deliberately not frame-scoped**: a `WebFrameMain` is replaced when a navigated page replaces it, so a `mainFrame.ipc` handler registered once would be lost. Check inside the handler that the sender frame is the main frame, which recovers the frame-scoping property without the lifetime problem.

It is never registered on global `ipcMain`, so it does not appear in the channel index and does not interact with `isTrustedPreviewSender`. (Revision 1 cited `image-export:harness-*` as "the same shape"; that one is frame-scoped, so the citation is dropped.)

`PreviewWebContentsHandle` (`PreviewSessionFactory.ts:73-97`) gains `readonly ipc`, and every test fake with it.

Main-side validation: strict zod, `href` ≤ 2048 chars, `target` ≤ 64 chars, 10 intents/second per view.

### 5.4 The policy module and routing

New `src/main/services/preview/PreviewNavigationPolicy.ts`:

```
decideLinkIntent({ href, currentUrl, token, target?, download? })
  → { kind: 'in-project',    relPath, anchor }   // relPath still untrusted; confined by the caller
  | { kind: 'external',      url }
  | { kind: 'same-document' }
  | { kind: 'blocked',       reason: LinkBlockReason }
```

(As built. The planned name was `decideNavigation`; path resolution moved to the caller, `previewLinkNavigation.ts`, which confines `relPath` and maps a refusal to its failure entry.)

Parse with `new URL(href)` in try/catch. Match `url.protocol` against an exact `Set`; reject non-empty `url.username` / `url.password`. `ftp:` and `tel:` are excluded unless a requirement names them. Deny-lists remain only as a redundant second check, never as the decision. The default arm is `blocked` (§3.2).

Move `SAFE_EXTERNAL_PROTOCOLS` / `DANGEROUS_PROTOCOLS` from `linkProtocols.ts:15-35` into `src/shared/` so main and renderer classify identically — and replace their `startsWith()` matching with parsed-protocol equality on both sides.

**Routing**: main emits window-scoped `preview:openFileRequested { sourcePanelId, filePath, anchor? }` — deliberately **without a panel kind**. Main's eligibility check answers only its own question (is this path in-project and resolvable); `resolvePanelKind` stays the single owner of panel kind, as it is for the tree and the terminal. Subscribe from the app-level renderer service layer that already owns `getOverlayGuard()`, reading `dockviewApi` from `useProjectStore` — `EditorAreaSplitPanel` only sees `event.api` inside a closure and retains no api, so it is the wrong host. Then `openFileInPanel`, which keeps the ESLint `preview-` id guard satisfied by construction.

Add optional `anchor` to the `preview:open` payload (`preview-schema.ts:73-80`).

### 5.5 External links

Show the parsed origin before handing off — a one-line confirmation in the tab chrome. `isTrusted` proves the user agent generated the event, not that the user knew the destination: a previewed page owns its viewport and can reposition an anchor under the cursor, and the preview has no address bar, no status bar and no hover-URL (sd-074 accepted risk 8 already concedes partial UI spoofing). `isTrusted` remains the necessary gate; it is not the consent.

Then `shell.openExternal` from main, on the gated URL.

### 5.6 Failure reporting

`PreviewFailureType` (`preview-types.ts:31-46`) gains `'blocked-link'`, for dangerous schemes and blocked downloads; escape attempts, ineligible targets and dead links reuse `path-escape`, `excluded-path` and `missing-local-file`. Add reason code `PREVIEW_LINK_BLOCKED`.

**Log only the parsed scheme and host, never the full href**, and strip control characters before the value enters the failure log — it is attacker-controlled, so it is both a leak surface and a log-injection surface. `previewViewLifecycle.ts:152` already models this with `redactPath`; `shell-handlers.ts:29,32,34` is the counter-example to avoid.

This closes today's silent-failure gap: a clicked link that goes nowhere finally says why.

---

## 6. Security position

| Change | Delta | Control |
|---|---|---|
| First page→main channel | The sealed box gains an outbound message | Phase 0 gates the global surface first (D9); the channel is WebContents-scoped with a main-frame check; strict zod, length caps, rate limit; main re-resolves every path |
| A preload runs in the page's process | Preload code is privileged relative to the page | Exposes nothing; the build-output test forbids `contextBridge`, `webFrame` and `ipcRenderer.invoke`/`.on` |
| `shell.openExternal` reachable from an untrusted page | A page can lure a click to any URL | Parsed-protocol allow-list, credential rejection, destination shown before hand-off, genuine user gesture required |
| Erfana opens project files on a page's request | A page could induce navigation of the workspace | Only a confined, eligible path opens, in a normal tab; no file content returns to the page |
| CSP | unchanged | `sandbox allow-scripts`, `form-action 'none'`, `base-uri 'none'`, `frame-src 'none'` |
| N sessions instead of 1 | N in-memory partitions, capped at `MAX_LIVE_VIEWS` | Each still asserts `storagePath === null` (`PreviewSessionFactory.ts:243`) |

`docs/security.md:589` currently states "Erfana exposes no scripted API to the page — no preload, no `postMessage` endpoint, no bridge". That sentence must be corrected, and the reason the session permission handler (`previewSessionPolicy.ts:83-84`) no longer covers `openExternal` stated explicitly — that handler is the named mitigation in the Electron advisory for external-protocol launches from sandboxed content, and calling `shell.openExternal` from main deliberately routes around it.

**Verify independently before acting**: the advisory identifiers and the Electron version-pin recommendation came from the review, not from first-hand reading.

---

## 7. Phase 0 — global IPC sender gate

Roughly 118 `ipcMain.handle` / `.on` registrations exist; sender checks appear in 8 files. Ungated and directly useful to an attacker: `shell:openExternal` (no validation at all — its own comment says the renderer must validate), `terminal:create`, `terminal:write`, and the mutating `file:*` handlers, plus settings, import, external-file and project-lock.

- Add a single `ipcMain` pre-dispatch guard rejecting any sender whose frame URL is not the bundled renderer, reusing the logic in `isTrustedPreviewSender.ts:40-58`. Handlers become gated **by default** rather than by author discipline.
- Harden `shell:openExternal` per §5.4's parsing rules.
- Re-examine the Electron version range in `package.json` (was `^39.2.4`).

**Advisory findings, verified against `npm audit` rather than taken from review.** Three advisories affected the installed 39.8.9, all fixed in **39.8.10**:

| Severity | Advisory | Applies to Erfana? |
|---|---|---|
| high | Sandboxed iframe can bypass the `allow-popups` restriction via the OpenURL navigation path | **Yes, directly.** The preview's CSP omits `allow-popups` precisely to stop this (`previewCsp.ts:86`) |
| high | Custom protocol with `supportFetchAPI` but not `corsEnabled` allows cross-origin reads | **No.** `registerPreviewScheme` sets `corsEnabled: true` (`previewScheme.ts:41-45`) |
| low | Off-screen rendering trusts GPU-supplied geometry over shared-memory size | No — Erfana does not use off-screen rendering |

Resolution: floor raised to `^39.8.10` and installed. `CVE-2026-70612`, named in the review, was **not** confirmed by first-hand reading; the advisories above are what `npm audit` actually reports, and the first one covers the same class of risk.

**Correction (lens review F4).** An earlier revision of this section said one advisory remained, reachable only through `extract-zip`. That was wrong on both counts, and the corrected picture is below. `npm audit` run 2026-08-29 against this lockfile:

| Scope | Result |
|---|---|
| All dependencies | 29 advisories — 1 critical, 25 high, 1 moderate, 2 low |
| Production only (`--omit=dev`) | **10 high, no critical** |

- **Fixed here:** `tar` was pinned at `7.5.16` as a direct **production** dependency, reached at runtime by `tarArchive.ts` → `WhisperModelManager` when a whisper binary is extracted. It carried a critical decompression-DoS advisory (GHSA-23hp-3jrh-7fpw) plus eleven others. Bumped to **`7.5.22`**, which clears every one of them — the newest, GHSA-r292-9mhp-454m, covers `<=7.5.20`, so 7.5.19 would not have been enough.
- **Still critical, but build-time only:** the remaining critical is `tar@6.2.1` inside `electron-builder`'s own chain (`@electron/node-gyp`, `@electron/rebuild`, `cacache`). It never ships to a user. `npm audit` offers `electron-builder@26.15.3`, a same-major fix that also clears a large share of the 25 high findings. **Not applied here**: electron-builder is the release toolchain, and a change to it wants a real release to validate rather than a merge to `develop`.
- **`extract-zip`:** the framing was imprecise. Erfana has its **own** direct dependency on the vulnerable version, and that copy is mitigated by the `assertSafeEntry` zip-slip pre-validation pass in `src/main/utils/zipArchive.ts`. Electron's internal copy has no such guard and moves only with a major upgrade. Two different things, previously conflated.
- **`electron` itself is among the ten production advisories.** The flagged range covers the installed 39.8.10, and 39.x has been out of support since 2026-05-05. Raising the floor inside a dead line buys the fixes already published and none of the future ones — see the Electron 44 decision, which is tracked separately from this work.

The other nine production advisories (`@llamaindex/liteparse`, `@turbodocx/html-to-docx`, `axios`, `fast-uri`, `form-data`, `image-size`, `nanoid`, `sharp`) all predate this work and are untouched by it.

This phase stands on its own merits and should ship whether or not the rest lands.

---

## 8. Performance

| Budget | Under this design |
|---|---|
| AC24 save-to-visible < 300 ms | re-measured with `MAX_LIVE_VIEWS` previews open; watcher pool and main-thread entry parse now contend |
| `MAX_WATCHED_FILES` 16/view | plus a global ceiling derived from `MAX_LIVE_VIEWS × 16` + headroom (§4.6) |
| `MAX_CONCURRENT_ASSET_READS` 8 | becomes global, sized for `MAX_LIVE_VIEWS` (§4.7) |
| `RELOAD_MIN_INTERVAL_MS` 750 | per view; bounded by the live-view cap |
| Still frames | one per suspended panel; `MAX_FRAME_EDGE_PX` / 2 MB caps unchanged |
| CPU of sleeping previews | measured, not assumed (§4.3) |

`e2e/html-preview.perf.spec.ts` — named in the original design (`sd-074-html-preview.md:1332`) but never written — is added here, parameterised by preview count, with a CPU/RSS ceiling rather than an eyeball check.

---

## 9. Documentation

`docs/html-preview/README.md` (Links section, sleep behaviour, the two blind spots — it documents neither of today's limitations), `docs/security.md` (§6), `HtmlPreviewPanel/CLAUDE.md` (the single-live-view invariant goes; add the sleep state), `src/main/services/CLAUDE.md` (the registry and the policy module), `docs/error-codes.md` (add `PREVIEW_LINK_BLOCKED`; re-check the "Preview (5 codes)" heading and count), `docs/ipc-patterns.md` (why the preview-page channel is absent from the index), `docs/api-services-features.md`, `docs/known-issues.md` (`stopPropagation` pages and closed shadow roots are user-visible), `docs/technical-debt.md` (#38 narrowed, not closed), `sd-074-html-preview.md` non-goals, `docs/CHANGELOG.md` — which must state plainly that link behaviour departs from web convention, since the changelog is the only place that will ever be discoverable.

**Markdown stays as it is**: a `.html` link clicked in a Markdown preview keeps opening source (`MarkdownEditorPanel.tsx:430-435`) while the same link in an HTML preview runs — a markdown link is a "show me the source" gesture, an HTML hyperlink is a hyperlink. Unifying them first requires the "Open as text" action recorded at `docs/technical-debt.md:455`, so it is a separate issue. Record the rationale in the sd-074 non-goals row rather than leaving the divergence unstated.

---

## 10. Verification

1. `npm run lint && npm run typecheck && npm run test:ci`
2. `npm run check:headers && npx reuse lint` — every new file needs an SPDX header
3. `npx electron-vite build` — where the preload self-containment guard fires
4. `npm run test:e2e` — CI does not cover Electron paths

Manual corpus: `../erfana-html-test` (its `README.md` is the checklist).

---

## 11. Sequencing

| Phase | Content | Leaves main green? |
|---|---|---|
| **0** | Global IPC sender gate, `openExternal` hardening, this document | yes — independent value |
| **A** | §4.1 races, registry, sleep, budgets, renderer, project-changed event, inverted tests | yes |
| **B** | §5 preload, policy, routing, external links, failure type | yes |
| **C** | §8–9 docs, e2e fixtures, perf gate | yes |

Estimate: 0 ≈ 0.5 day, A ≈ 2 days, B ≈ 1.5 days, C ≈ 0.5 day.
