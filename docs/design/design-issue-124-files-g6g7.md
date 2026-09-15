<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Design – issue #124: planned files, G6 and G7

Parent: [design-issue-124-files.md](design-issue-124-files.md) – G1 to G5, the counts, the conditional files, the design documents and the Phase 10 documents; top document: [design-issue-124.md](design-issue-124.md). Split off at the G6/G7 reconcile, when the files doc reached 494 lines. The parent's rules hold: every file the change creates (C) or modifies (M), by work item; a path listed under an earlier item – in either file – comes back only as a reference (`↑`), so each file is counted once, and the parent's totals cover both files.

Reconciled on 2026-09-15 with what G6 and G7 built and with the fixes made after G7, from `124-phase10-notes` run notes (not in repo), the orchestrator's WI-25 file list and the working tree: every path was checked against `git status --short -- src e2e docs design` and every line count with `wc -l`; every C path below exists. Where a note and the code disagreed, the code won. Updated after the WI-25 fixes with the same checks, and in Phase 10 after the QG-6 to QG-8 review fixes (the last section): every changed path in `git status --porcelain -uall`, `.ai/` and `temp/` excluded, was compared with the C and M lines of both files; the 26 paths missing were added and every line count below was measured with `wc -l`.

## G6

### WI-11 – drag freeze, renderer

Note (after G2): `usePreviewBounds.test.ts` is at 487 of 500 lines after WI-9 (`usePreviewBounds.ts` at 489), so the forced-push tests go to a split file; the panel's bridge mock now lives in `__test__/panelHarness.ts`, and the `previewBoundary` suite's bridge is a Proxy that needs no change. After G3: refresh the stale `failureLog.clear()` comment at `usePreviewStore.ts:71` (the WI-29 follow-up removed `clear()`). After WI-8 and WI-10: answer every `held: false` with a forced push carrying `settled: true`, even when the rect is unchanged (WI-9's forced-push option), and drop a pending one when `held: true` arrives again – main sends `held: true` at the hold's start and again if the edge moves after `held: false`, and repeats `held: false` every 500 ms until answered; clear `resizeHeld` on `visibilityApplied` (either value) for that panel – none arrives during a hold, one on release – and on close, unmount or `suspended`; `stillFrameChanged` carries `stale: true` when input followed the capture; frames cached before WI-10 lack `cssWidth` / `cssHeight`, so `PreviewFallback` needs a path for them; a panel hidden by the `collapsed` gate counts as no visible preview for the splitter drag (part 1 §1.5).

As built ([impl doc](design-issue-124-impl.md), G6; part 1 §1.5): the forced-push split is `usePreviewBounds.settled.test.ts`; the settled push goes out two frames after `held: false`, from `usePreviewEvents` (`pushSettledBounds`, over `pushBounds({ settled })`); the guard gained `visiblePanelId()`, unit-tested in a follow-up; the still's `--sized` and `--fill` variants are in `HtmlPreviewPanel.css`. No path beyond this list. Line counts: `usePreviewBounds.ts` 496 and `usePreviewStore.ts` 492 – both at the cap, so the next edit splits first (parent §3); `OverlayGuardService.ts` 459, `HtmlPreviewPanel.tsx` 406, `HtmlPreviewPanel.test.tsx` 384, `previewDragFreeze.ts` 388 and its test 462, `AppDockLayout.tsx` 415 (+5); the html-waiting card 799 (791 at HEAD – over 500 before this change).

- C `src/renderer/src/services/preview/previewDragFreeze.ts` (its "is a live preview visible in this panel" dep is false while the `collapsed` gate is set, as for an open host list)
- C `src/renderer/src/services/preview/previewDragFreeze.test.ts`
- C `src/renderer/src/hooks/useSplitterDragFreeze.ts`
- C `src/renderer/src/hooks/useSplitterDragFreeze.test.ts`
- M `src/renderer/src/components/DockLayout/AppDockLayout.tsx` (+5 lines)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.settled.test.ts` (the forced settled push – the split planned as `usePreviewBounds.<topic>.test.ts`; 131 lines)
- ↑ `usePreviewBounds.ts` (`pushBounds({ settled })`; 496 lines – its main suite stays at 487, the tests went to the split), `usePreviewStore.ts` and its test (`resizeHeld`, `stale`, the latched hold picture), `usePreviewEvents.ts` (`resizeHold`), `HtmlPreviewPanel.tsx`, `HtmlPreviewPanel.css` (first modified in WI-20), `HtmlPreviewPanel.test.tsx`, `__test__/panelHarness.ts` (its `MockPreview` gains `onResizeHold`)
- ↑ `src/renderer/src/services/preview/OverlayGuardService.ts` (the resize-hold exception in the header comment and, as built, `visiblePanelId()`; 459 lines; WI-9 added the `collapsed` gate) and its test (`visiblePanelId()`, a follow-up)
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewFallback.tsx`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewFallback.test.tsx`
- M `design/product/html-waiting/index.html` (precedence row: drag freeze and window-edge hold; 791 → 799 lines)

### WI-17b – page navigator, check and commit, navigation handlers

Note (after G2): moves start with `startPageLoad(filePath, 'open' | 'back' | 'forward', load)`, the anchor inside `load`; an outcome callback added to `previewLivePage` ends the navigator's intent with the pending load; `pendingLoad()` is the "navigation pending" check; `failed` (status ≥ 400) is computed there and only logged today; the commit retargets the entry watcher, the watch set and the link bridge's `currentUrl`; `PreviewViewService.pageScope.test.ts` has a harness for the RS3-3 test. Link routing wires `runsAsPreview(realTarget)` and the platform into the link bridge and converts the confined real path to project space – `join(projectPath, relative(realRoot, realTarget))` – before `PreviewEligibilityService.check`, or a symlinked project counts every page as outside; `pageChanged.filePath` uses the same spelling, which the renderer compares by exact string. `disposition` travels through `PreviewEmitters.openFileRequested` and `emit.ts`. History: `createTabHistory` (a rebuild for the same panel passes the old generation + 1), `currentEntry`, `canStep`, `neighbourEntry`, `pushEntry`, `replaceCurrent`, `stepHistory`, `dropNeighbour`, `historyState`; over-long `pushState` fragments (anchor over 1024, path over 4096) are cut or dropped before the push. Held Back repeats are dropped by the renderer's move lock. After G3: the renderer half is built (WI-19). A Back/Forward `check` carries the tab store's `generation` (0 before the first `pageChanged`); an `open` commit sends the checked target's `filePath` and anchor; a Back/Forward commit sends the generation from the check's answer; a rejected invoke reads as `PREVIEW_NAV_UNAVAILABLE`; every refusal's `history` is written to the tab store; `SKIPPED` after a prompt gives an info toast, otherwise a log line; `pageChanged.filePath` must be the exact target string. Frame files are recomputed on every post-load run (WI-15), so the commit's watch-set retarget needs no extra step when a `did-finish-load` follows.

As built ([impl doc](design-issue-124-impl.md), G6; part 3 §3.4, §3.5): four new modules, seven new test files and two shared harnesses. The fence was widened (option A) with `buildPreviewGraph.ts` (the `checkEligibility` wiring) and `previewLiveTypes.ts` (types); navigation and resume went to the planned fallback split `previewViewNavigation.ts`, now counted; the project-space conversion sits in the wiring, `openFileRequested.filePath` included; `checkEligibility` and `pageChanged` are optional deps. Line counts: `PreviewViewService.ts` 499 and `PreviewViewService.pageScope.test.ts` 499 – both at the cap, a later edit splits first; `navigation-handlers.test.ts` 479; `previewPageNavigator.ts` 357, `previewEntryWatch.ts` 123, `navigation-handlers.ts` 105; `PreviewLiveView.ts` 394 and `previewLiveWiring.ts` 358 after G6. `previewViewNavigation.ts` was 306 after WI-17b and is 357 after the symlink fix (below).

- C `src/main/services/preview/previewPageNavigator.ts`
- C `src/main/services/preview/previewPageNavigator.test.ts`
- C `src/main/services/preview/previewPageNavigator.intent.test.ts` (split by topic, as built)
- C `src/main/services/preview/__test-helpers__/previewPageNavigatorHarness.ts` (the two navigator suites' shared harness)
- C `src/main/services/preview/previewEntryWatch.ts`
- C `src/main/services/preview/previewEntryWatch.test.ts`
- C `src/main/services/preview/previewViewNavigation.ts` (navigation and resume – the §3 fallback split for `PreviewViewService.ts`, made here)
- C `src/main/services/preview/previewLivePage.outcome.test.ts` (the outcome callback that ends the intent with the pending load)
- ↑ `previewLivePage.ts` and its test, `previewViewLifecycle.ts` and its test, `PreviewLiveView.ts` (a failed navigation commit sets the load state to `failed`, no `ready`), `previewLiveWiring.ts` (the navigator is fed by the lifecycle hooks; a commit retargets the entry watcher, the watch set and the link bridge, all built there; `requestOpenFile` passes `disposition` on), `previewLivePipeline.ts` (`pause`, `resume`), `PreviewViewService.ts` (resume gate on `history[index]`), `PreviewViewService.pageScope.test.ts` (an approval during a pending move, RS3-3), `previewViewTypes.ts`, `previewLinkBridge.ts` and its test, `previewPanelState.ts` and its test
- `src/main/services/preview/previewLinkNavigation.ts` – no WI-17b edit needed (was conditional): the project-space conversion sits in the wiring's `runsAsPreview` dep (the group report); its counted edit stays WI-17a's
- ↑ `src/main/ipc/preview/buildPreviewGraph.ts` (the `checkEligibility` wiring) and `src/main/services/preview/previewLiveTypes.ts` (types) – the fence widened, option A
- C `src/main/services/preview/PreviewViewService.navigation.test.ts`
- C `src/main/services/preview/PreviewViewService.resume.test.ts` (split by topic, as built)
- C `src/main/services/preview/__test-helpers__/previewViewServiceNavHarness.ts` (the two service suites' shared harness, over a real temporary folder)
- C `src/main/ipc/preview/navigation-handlers.ts`
- C `src/main/ipc/preview/navigation-handlers.test.ts` (479 lines)
- ↑ `src/main/ipc/preview-handlers.ts` and its test (registration)
- ↑ `src/main/ipc/preview/emit.ts` and its test, `src/shared/ipc/preview-types.ts` (`PreviewEmitters.pageChanged`, `disposition`)
- `PreviewStillFrameCache.ts` – not edited by WI-17b, which only calls `invalidate(panelId)`; the still-picture fix after G7 edits it (below; counted under WI-10)

## G7 – integration and end-to-end tests

### WI-23 – integration tests (real files, real symlinks in a temp folder)

As built: 16, 12, 22 and 19 tests (353, 331, 423 and 235 lines). They run in `npm run test:main` and `npm run test:ci` – `vitest.main.ts` includes every `src/main/**/*.test.ts` – so there is no separate integration command (parent §4 and §5 corrected). The symlink cases skip on win32. `previewNavigation.integration.test.ts` confirmed the symlink first-open bug with two `it.fails`, which the fix below turned into `it`. **Superseded 2026-09-15 (#130)**: what actually shipped was a whole-file `describe.skipIf(win32)` on three of the four, hiding 54 passing tests from every Windows run; the skips are now scoped to the cases that need them.

- C `src/main/services/preview/previewRequestKind.integration.test.ts`
- C `src/main/services/preview/previewFrames.integration.test.ts`
- C `src/main/services/preview/previewNavigation.integration.test.ts`
- C `src/main/services/browserLaunch/BrowserLaunchService.integration.test.ts`

### WI-24 – e2e part 2 and the frame corpus

Note (after G3): WI-12 made the `unsupported-asset-type` badge fire, so the comment at `e2e/html-preview-corpus.e2e.ts:150-156` is now wrong – tighten the `error/` corpus test to at least three entries, one naming `data.unknownext`. Reload cases from WI-15: a stylesheet used only by a frame reloads; one shared by the page and a frame reloads; one used only by the top page swaps in place.

As built ([impl doc](design-issue-124-impl.md), G7): the helpers take the `ElectronApplication` or the `Page`, not an `HtmlPreviewPage`, whose app handle is private; frame reads and clicks are test-side only (`WebFrameMain.executeJavaScript`); `frames/` holds 21 files, not 19 – `page.css` and `shared.css` carry WI-15's stylesheet cases. Two findings: a product bug (the script-made `blob:` frame, fixed after G7 – below) and a design correction (the leaf symlink, part 2 §2.12, §2.13), so `escape.html`'s expected label now depends on the platform. Fixed at the gate: `dismissToasts()` waited for the test id `TEST_IDS.TOAST`, but a toast renders as `` `${TEST_IDS.TOAST}-${type}` `` (`ToastNotification.tsx:205`), so it never closed one; it now re-exports the shared `dismissAllToasts` from `html-preview.browser.ts` (`html-preview.frames.ts:257`).

- C `e2e/html-preview-frames.e2e.ts` (451 lines, after the frame fix and its follow-up)
- C `e2e/pages/html-preview.frames.ts` (plain functions taking the `ElectronApplication` or the `Page`, as built; 262 lines after the gate's toast fix)
- M `e2e/html-preview-corpus.e2e.ts` (the `error/` test: at least three entries, `data.unknownext` among them; 304 lines)
- C in `e2e/fixtures/html-preview-corpus/frames/` (21 files as built; 19 planned):
  - P2-AC1: `index.html` (a `src` frame and a `srcdoc` frame, both running script, CSS and an image), `child.html`, `child.css`, `child.svg`;
  - P2-AC4 depth: `chain.html` plus `chain-1.html` to `chain-4.html`, each setting a title sentinel; `srcdoc-chain.html` (`srcdoc` levels 1–3; at level 4 a `srcdoc` frame and a `src` frame pointing at `chain-4.html`);
  - P2-AC3: `refused.html` (frames: a remote address, another token, a `data:` URL, a script-made `blob:` URL, `node_modules/x.html`, `.hidden/x.html`, `missing.html`, `escape.html`, `private.html`), `private.html` (the gitignored frame, which must load);
  - P2-AC4 count: `many.html` (60 frames of `tiny.html`), `tiny.html`, `many-srcdoc.html` (60 `srcdoc` frames, all shown, one count entry – answer 9);
  - P2-AC2: `cdn.html`, `cdn-child.html` (the CDN host is used only inside the frame);
  - WI-15's stylesheet cases (as built): `page.css` (the top page only – swapped in place) and `shared.css` (the page and its `src` frame – a reload); `child.css` is the frame-only case;
  - frame links: `frame-nav-a.html`, `frame-nav-b.html`.
- **Created in test setup, never committed**, in the temp copy of the project: the symlink `frames/escape.html` pointing outside the project; `frames/node_modules/x.html` (the repository `.gitignore` ignores every `node_modules`, line 10); `frames/.hidden/x.html`; `frames/.gitignore` naming `private.html` (a committed one would hide the fixture from git itself). `missing.html` never exists.

### WI-25 – e2e part 3, the multi-page mockup, the links page

Note (after G3): `UnsavedChangesDialog` has no test ids – find it by role and name (WI-19).

As built (the orchestrator's file list, each path checked with `wc -l`): the spec was split in two to stay under 500 lines – `html-preview-same-tab.e2e.ts` (300: the link table, the tab follows its page) and `html-preview-same-tab.history.e2e.ts` (387: one file one tab, Back and Forward, the Forward key, two previews with focus in Monaco); `html-preview.navigation.ts` 308; `html-preview-links.e2e.ts` 381 (the new-tab block, P3-AC5). Created in test setup, never committed: `extra/page-N.html` and `design-set/huge.html` (over 25 MB, so the handler answers 413 – how the e2e reaches the move-caused failed banner). Four tests were red at this reconcile – the PDF name after a move, a moved tab's still picture, Back after a `pushState` step, and Find; all four were product bugs, fixed after G7 (below; [impl doc](design-issue-124-impl.md), G7).

- C `e2e/html-preview-same-tab.e2e.ts` (300 lines)
- C `e2e/html-preview-same-tab.history.e2e.ts` (the history half of the split, with the Forward shortcut and the two-previews-with-Monaco case; 387 lines)
- C `e2e/pages/html-preview.navigation.ts` (plain functions)
- M `e2e/html-preview-links.e2e.ts`
- C in `e2e/fixtures/html-preview-corpus/design-set/`: `index.html` (overview: plain and `_self` links, a phone-width frame showing `pricing.html`), `pricing.html`, `about.html`, `contact.html` (each with `#section` anchors and links back), `styles.css`
- M `e2e/fixtures/html-preview-corpus/links/index.html` (rows for the new rules: plain, `_self`, `_blank`, named target, Cmd-click, middle-click)
- C `e2e/fixtures/html-preview-corpus/links/base-self.html` (`<base target="_self">`)

### WI-26 – e2e part 4

Note (after G2): the seam is armed by `ERFANA_E2E_BROWSER_SEAM=1` plus `globalThis.__erfanaE2eBrowserLaunch`, set with `app.evaluate`; it receives `{ via, appPath, filePath }` (type `E2eBrowserLaunch`); a seam that throws gives `LAUNCH_FAILED`; stub `app.getApplicationInfoForProtocol` to reject to force the fallback; macOS temp paths resolve `/var` → `/private/var`. After G3 (WI-22): the toolbar button has test id `preview-band-open-in-browser` and the name "Open in default browser", and is `aria-disabled="true"` while busy, never `disabled`; the tree item "Open in default browser" comes second, after "Open as source", then a separator; toasts: "Could not open in browser" (error), "Opened in the app for .html files" (the fallback notice), success silent; after a same-tab move the seam receives B; the Finder / Explorer / File Manager wording follows `window.api.utils.getPlatform()`.

As built: 7 tests, 7 of 7 over three runs; the helpers arm the seam, stub the default-browser lookup and find the toasts and the button; the product matched the design.

- C `e2e/html-preview-open-in-browser.e2e.ts` (269 lines)
- C `e2e/pages/html-preview.browser.ts` (plain functions; 176 lines)

### WI-27 – e2e drag freeze and bounds checks

As built: the drag-freeze cases went to their own spec over a shared harness; the check-only rects after maximize, `setSize` and a terminal expand-and-collapse are WI-8's bounds tests, not repeated.

- C `e2e/html-preview-drag-freeze.e2e.ts` (sash drag, fast drag into the preview; 5 tests, 194 lines)
- C `e2e/html-preview-bounds.harness.ts` (the bounds spec's helpers, shared; 334 lines after the gate's toast fix)
- ↑ `e2e/html-preview-bounds.e2e.ts` (its helpers moved to the harness; 458 → 161 lines)
- `e2e/pages/html-preview.native.ts` – not edited (was a reference)

## After G7 – the fixes

### The frame fix (a WI-24 finding, dispatched after WI-17b)

An inert `about:blank` commit – the empty document a script-made `<iframe>` with no `src` commits first – no longer counts as a shown document, so a later refused `src` is a refused frame, not a refused link (part 2 §2.6; [impl doc](design-issue-124-impl.md), G7). A follow-up split the frame-events suite and added the count-cap test: 51 script-made frames, the 51st refused, one over-limit entry.

- ↑ `src/main/services/preview/previewFrameEvents.ts` (the committed-frame set skips `about:blank`; 296 lines) and its test (split: 256), `previewFrameGuard.ts` (exports `isAboutBlankUrl`; 305) and its test (324) – all WI-14's
- C `src/main/services/preview/previewFrameEvents.guard.test.ts` (the guard-facing rows and the count-cap test; 169 lines)
- C `src/main/services/preview/__test-helpers__/previewFrameEventsHarness.ts` (the split suites' shared harness; 142 lines)
- ↑ `e2e/html-preview-frames.e2e.ts` (the platform switch for `escape.html`'s label) and `frames/refused.html` (its stale comment) – WI-24's

### The symlink first-open fix (user decision, 2026-09-15)

A project opened through a symlinked folder served no first page: the renderer's path was turned into a URL against the real root, and the page failed with 404. The first open and a failed resume's fallback now go through the move check's lookup – re-confined on the real root, loaded at the real path, named in project space – with no new eligibility check (part 3 §3.4; [impl doc](design-issue-124-impl.md), G7).

- ↑ `src/main/services/preview/previewViewNavigation.ts` (`locate` and `locateRendererPage`, split out of the move check; 306 → 357 lines) – WI-17b's
- C `src/main/services/preview/previewViewNavigation.test.ts` (10 tests – seven `it` and a three-row `it.each`; 207 lines)
- ↑ `src/main/services/preview/previewNavigation.integration.test.ts` (two `it.fails` → `it`; its first-open helper and its "falls back to the tab's own page" test, which had the bug built in, corrected; 423 lines) – WI-23's

### The PDF name and Find (WI-25's red tests 1 and 4)

The save dialog's name comes from the committed page, main-side (`exportNameForPage`, fallback `preview`, never from the renderer); Find's `findNext` is inverted at the Electron handoff – a bug since #74 ([impl doc](design-issue-124-impl.md), G7).

- M `src/main/services/preview/PreviewFindController.ts` (`findNext` inverted for Electron; 133 lines)
- M `src/main/services/preview/PreviewFindController.test.ts` (149 lines)
- M `src/main/services/preview/PreviewExportController.ts` (`exportNameForPage`; 157 lines)
- M `src/main/services/preview/PreviewExportController.test.ts` (152 lines)
- M `src/main/ipc/preview/find-handlers.ts` (`FALLBACK_EXPORT_NAME`; 122 lines)
- C `src/main/ipc/preview/find-handlers.test.ts` (69 lines)
- C `src/main/services/preview/PreviewViewService.exportName.test.ts` (76 lines)
- ↑ `src/main/services/preview/PreviewLiveView.ts` (`exportPdf` names the committed page; 402 lines) – WI-1's

### The still picture and Back after `pushState` (WI-25's red tests 2 and 3)

B's first post-load step no longer waits out A's reload throttle, and invalidating a panel's still frame cancels a capture in flight (RS2-8, part 3 §3.4); Back and Forward step with `goToIndex(neighbour)`, because `goBack()` / `goForward()` skip an entry pushed without a user gesture (part 3 §3.5). No new path.

- ↑ `src/main/services/preview/previewLivePipeline.ts` (another page's first run starts at once; 418 lines) and its test (404) – WI-1's; outside the fix's fence, kept by decision
- ↑ `src/main/services/preview/PreviewStillFrameCache.ts` (`invalidate` cancels an in-flight capture; 362 lines) and its test (443) – WI-10's
- ↑ `src/main/services/preview/previewPageNavigator.ts` (`goToIndex`; 361 lines) and its test, `PreviewViewService.navigation.test.ts` (the RS2-8 test hides as soon as B has loaded) and the two harnesses in `__test-helpers__/` (`previewPageNavigatorHarness.ts`, `previewViewServiceNavHarness.ts`) – WI-17b's

## QG-6 to QG-8 – the review fixes

The QG-6 judge's batches B0–B5 (with QG-7's security fixes folded in), then QG-8's fixes (TQ1–TQ3, U1, U2 and its riders, J1–J3) and QG-9's C1 test, as built ([impl doc](design-issue-124-impl.md), QG-6 to QG-8). They added 16 created and 10 modified paths. A path edited by more than one batch is listed once, under the first; later batches name it again as a reference. Edits are attributed from the batch reports and file times – one uncommitted diff cannot attribute an edit to a batch.

### Before QG-5 – a pre-existing e2e flake

- M `e2e/markdown-toolbar.e2e.ts` (focus retry, text polls – test-only; the same failures at the base commit; 307 lines)

### B0 – the shared digest and the project-space rule

- C `src/shared/stablePathDigest.ts` (moved from `fileUtils.ts`; QG-8 C1's doc comment; 48 lines)
- C `src/shared/stablePathDigest.test.ts` (48 lines)
- ↑ `src/renderer/src/utils/fileUtils.ts` (re-exports it; 229) and its test (the renderer-side pin), `src/main/services/preview/previewUrl.ts` (`toProjectPath`; 109) and its test (138)

### B1 – the navigator (QG-6 A3, A6; QG-7 S1, S2, S3)

- ↑ `src/shared/preview-limits.ts` (`NAV_MAX_ANCHOR_CHARS`, `HISTORY_GESTURE_WINDOW_MS`), `src/shared/ipc/preview-navigation-schema.ts`, `previewPageNavigator.ts` and its two suites with their harness, `previewLivePage.ts` (`isNavigationKind`; 334) with its test and outcome test, `previewLiveWiring.ts`, `previewStillFrameFreshness.ts` and its test, `PreviewViewService.navigation.test.ts`, `previewNavigation.integration.test.ts` (437), `e2e/html-preview-same-tab.history.e2e.ts` and `e2e/pages/html-preview.navigation.ts` (the S1 replace case and the S2 `pushState` tripwire)

### B2 – the service split and the resume gate (QG-6 A4 split, QG-7 item 11)

- C `src/main/services/preview/previewResizeHold.registry.test.ts` (`createResizeHoldRegistry`; 162 lines)
- ↑ `previewResizeHold.ts` (291) and its test (500), `PreviewViewService.ts` (499 → 481), `previewViewNavigation.ts` (`PreviewStartingPageResult`, the gated fallback; 447) and its test (282), `PreviewViewService.resume.test.ts` (200), `src/main/ipc/preview/navigation-handlers.test.ts` (479 → 449)

### B3 – security fixes (QG-7 S4 to S7, item 3)

- C `src/main/ipc/preview/navigation-handlers.errors.test.ts` (S5; J3 added the protocol-handler and request-filter cases; 175 lines)
- C `src/shared/ipc/preview-schema.open.test.ts` (S7, the 4096 caps; 52 lines)
- ↑ `previewEntryWatch.ts` (136) and its test, `navigation-handlers.ts` (107), `src/main/services/browserLaunch/BrowserLaunchService.ts` (`namesAlternateDataStream`; 159) and its test (328), `src/shared/ipc/preview-schema.ts` (424), `previewFrameCspConsole.ts` (214) and its test

### B4 – the S3 sweep

- ↑ `src/shared/dropReporter.ts` (the one digest line for every drop line; 168) and its test, `PreviewLiveView.ts`, `previewLivePipeline.ts` (431) and its test, `PreviewStillFrameCache.ts` (379), `previewLiveTeardown.ts` (239), `previewFrameEvents.ts` (310), `previewViewEviction.ts` and its test, `previewLiveBounds.ts` and its test, `previewFrameRefusals.ts` and its test, `PreviewViewService.dropLog.test.ts`, `PreviewSessionFactory.ts` (the purge sites) and `PreviewSessionFactory.partitionRecycling.test.ts` (250), and the renderer drop-line pins in `usePreviewBounds.test.ts` (488) and `usePreviewBounds.clip.test.ts`

### B5 – renderer (QG-6 A7, A13; QG-7 S3)

- C `src/renderer/src/services/preview/previewTabMove.logging.test.ts` (102 lines)
- ↑ `src/renderer/src/utils/openFileInPanel.ts` (`findEditorTabsShowing`; 389) and its test (455), `previewTabMove.ts` (497 → 491) and its test (499), `OverlayGuardService.ts` (comments; 463), `usePreviewEvents.ts` (header), `usePreviewLifecycle.ts` (digested lines, no `filePath`; 268) and its test (220)

### QG-8 TQ1 to TQ3 – tests and coverage

- C `src/main/services/preview/previewLiveTeardown.test.ts` (TQ1; 447 lines)
- ↑ `src/preload/previewBridge.test.ts` (TQ3 member pin, then the subscription table; 496) and `HtmlPreviewPanel/__test__/panelHarness.ts` (the mock typed from the bridge; TQ4's allowlist reset; 242)
- M `vitest.main.ts` (per-file floors for 12 modules; `browser-schema.ts` in the include; test helpers excluded; 132 lines)
- M `vitest.renderer.ts` (the coverage block moved inside `test`; 4 per-file floors; 82 lines)
- M `vitest.preload.ts` (the coverage block moved inside `test`; the raised floor; 50 lines)

### QG-8 U1 – keyboard entry into the page (added after design approval)

- C `src/main/ipc/preview/focus-handlers.ts` (`preview:focusPage`; 92 lines)
- C `src/main/ipc/preview/focus-handlers.test.ts` (154 lines)
- C `src/main/services/preview/previewViewFocus.ts` (58 lines)
- C `src/main/services/preview/previewViewFocus.test.ts` (69 lines)
- C `src/main/services/preview/PreviewViewService.focus.test.ts` (93 lines)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewPageEntry.ts` (103 lines)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.pageEntry.test.tsx` (159 lines)
- ↑ `src/shared/ipc/preview-channels.ts` (`FOCUS_PAGE`), `preview-types.ts`, `preview-bridge-types.ts`, `src/preload/previewBridge.ts`, `src/main/ipc/preview-handlers.ts` (registration), `PreviewViewService.ts` (493), `previewViewTypes.ts`, `PreviewLiveView.ts` (`focusPage()`; 439), `__test-helpers__/previewViewServiceNavHarness.ts` (a `focus` spy), `PreviewSessionFactory.ts` (494), `hooks/index.ts`, `HtmlPreviewPanel.tsx` (430) and its test, `htmlPreview.logic.ts` (`previewPlaceholderLabel`) and its test, `e2e/pages/html-preview.page.ts` (`placeholder()` takes either name)

### QG-8 U2, its riders and U4 – focus rings and busy labels

- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewBandConfirm.tsx` (busy label in a span; 220 lines)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewBandConfirm.test.tsx` (47 lines)
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.tokens.test.ts` (the ring guards; 401 lines)
- ↑ `PreviewChromeBand.css` (485 – over §3's 440, debt), `HtmlPreviewPanel.css` (the placeholder ring; 268), `PreviewBanner.tsx` (172) and its test, `PreviewNavControls.css` (U4 wording; 119), the permission-band card (1 109), `band.css`, `nav.css`, `design/claims.json` (three focus-ring claims) and `design/claims.js`

### QG-8 J1 to J3, and QG-9 C1

- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewPanelActions.test.tsx` (J2's StrictMode cases, then C1's "Open as source" after a move; 153 lines)
- M `src/main/ipc/preview/allowlist-handlers.ts` (J3; 97 lines)
- M `src/main/ipc/preview/allowlist-handlers.test.ts` (205 lines)
- M `src/main/ipc/preview/externalLinkConsent.ts` (J3, the log line only; 168 lines)
- M `src/main/ipc/preview/externalLinkConsent.test.ts` (217 lines)
- ↑ J1: `previewStillFrameFreshness.ts` (`takeRecentGesture`; 165) and `previewPageNavigator.ts` (366) with the B1 files; J2: `usePreviewPanelActions.ts` (287), `PreviewToolbarTools.test.tsx` (255); J3: `lifecycle-handlers.ts` (281) and its test (483), `find-handlers.ts` (124) and its test (119), `PreviewProtocolHandler.ts` and `PreviewRequestFilter.ts` (their catch-alls)
