<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Design – issue #124: planned files

Parent: [design-issue-124.md](design-issue-124.md). Every file the change creates (C) or modifies (M), grouped by work item. A path already listed under an earlier item appears again only as a reference (`↑`), so each file is counted once. Rebuilt after QG-4a/4b round 1 by following every widened interface to its implementers and callers (RA4), updated after round 2 (RA2-3) and round 3 (RA3-3), and reconciled with what Phase 5 groups G1 to G7 built, with the fixes after G7 and, in Phase 10, with the QG-6 to QG-8 review fixes. G6, G7 and those fixes live in [design-issue-124-files-g6g7.md](design-issue-124-files-g6g7.md), split off at the G6/G7 reconcile when this file reached 494 lines; the counts below cover both files. One owner per file per group held for G6 and G7 as built (parent §4, §11).

**Counts (PLANNED_FILES):** 329 code, test, fixture, config and design-system files (199 created, 130 modified) plus 12 documents written in Phase 10, over this file and [the G6/G7 file](design-issue-124-files-g6g7.md). The design documents in `docs/design/` (listed at the end) and the scratch UX spec are not counted; conditional files are listed at the end and not counted. Every counted path has its own `- C` or `- M` line, except the 26 corpus fixtures of WI-24 (21) and WI-25 (5), so the totals re-derive by grep: ``cat docs/design/design-issue-124-files*.md | grep -c '^- C `'`` gives 173, plus the 26 fixtures, all created, is 199; the same with `'^- M `'` gives 130. Round 2 added references (`↑`) only, no new path; round 3 added one modified path (`PreviewViewService.test.ts`, RA3-3) and references. Phase 5 added four created paths under WI-1 (`previewLiveWiring.ts`, `previewLiveBackdrop.ts` and its test, `previewLivePipeline.test.ts`), one under WI-2 (`previewViewEviction.test.ts`) and two under WI-7 (`previewFrameBadgeText.ts` and its test); the G2 reconcile added three under WI-18 (the split panel tests and their harness), one under WI-12 (`previewSessionFilterContext.ts`, the fallback split WI-29 made certain) and one planned under WI-11 (`usePreviewBounds.<topic>.test.ts`), plus `docs/error-codes.md` among the Phase 10 documents. The G3 reconcile added nine created paths – the WI-29 follow-up's factory test split (two suites and their mock helper), `previewBoundsDropLog.ts` (WI-5), three under WI-12 (`previewSessionFilterContext.test.ts`, `PreviewRequestFilter.frames.test.ts` and the filter's mock helper), `previewFrameSources.pipeline.test.ts` (WI-15) and `DialogContext.unsavedChanges.test.tsx` (WI-19) – and four modified paths – `PreviewFailureLog.ts` and its test (the WI-29 follow-up), `iconRegistry.tsx` (WI-19) and `e2e/html-preview-corpus.e2e.ts` (WI-24) – while `DialogContext.test.tsx` left the count: WI-19 did not edit it after all. The WI-8 reconcile added two created paths under WI-8 (`usePreviewBounds.repro.test.ts`, `buildPreviewGraph.repro.test.ts`), while `buildPreviewGraph.test.ts` left the count: neither WI-8 nor, as built, WI-9 edited it. WI-10 added no path. The G4/G5 reconcile added ten created paths – three under WI-9 (`previewClip.ts`, `usePreviewBounds.loop.test.ts`, `usePreviewBounds.clip.test.ts`), one under WI-14 (`previewCspViolationBridge.frames.test.ts`) and six under WI-20 (`usePreviewNavigation.ts`, `usePreviewMoveAnnouncer.ts`, their tests, `PreviewChromeBand.nav.test.tsx`, `HtmlPreviewPanel.navigation.test.tsx`) – and three modified paths under WI-20 (`.stylelintrc.json`, `design/claims.js`, `design/README.md`), while `PreviewChromeBand.test.tsx` left the count: WI-20's band tests went to the split file. The G6/G7 reconcile added twelve created paths – six under WI-17b (`previewViewNavigation.ts`, the planned fallback split, `previewPageNavigator.intent.test.ts`, `PreviewViewService.resume.test.ts`, `previewLivePage.outcome.test.ts` and two harnesses in `__test-helpers__/`), two under WI-27 (`html-preview-drag-freeze.e2e.ts`, `html-preview-bounds.harness.ts`), one under WI-25 (`html-preview-same-tab.history.e2e.ts`, the spec's split), two from the frame fix and one from the symlink fix – plus two frame fixtures (`page.css`, `shared.css`); WI-11's planned split got its name (`usePreviewBounds.settled.test.ts`); no modified path was added. The WI-25 fixes after G7 added two created paths (`PreviewViewService.exportName.test.ts`, `find-handlers.test.ts`) and five modified ones (`PreviewFindController.ts` and its test, `PreviewExportController.ts` and its test, `find-handlers.ts`); the still-picture and `pushState` fixes edited only files already counted. The QG-6 to QG-8 review fixes (Phase 10 reconcile) added sixteen created paths – `stablePathDigest.ts` and its test (B0), `previewResizeHold.registry.test.ts` (B2), `navigation-handlers.errors.test.ts` and `preview-schema.open.test.ts` (B3), `previewTabMove.logging.test.ts` (B5), `previewLiveTeardown.test.ts` (TQ1), seven for U1's keyboard entry, `PreviewBandConfirm.test.tsx` (U2) and `usePreviewPanelActions.test.tsx` (J2, QG-9 C1) – and ten modified ones – the three `vitest.*.ts` configs (TQ2), `PreviewBandConfirm.tsx` and `HtmlPreviewPanel.tokens.test.ts` (U2), `allowlist-handlers.ts`, `externalLinkConsent.ts` and their tests (J3), and `e2e/markdown-toolbar.e2e.ts` (a pre-existing flake fixed before QG-5).

Existence was checked with Glob in the working tree on 2026-09-14 and 2026-09-15, before Phase 5: every M path exists, no C path exists. After G2, G3, WI-8 and WI-10, and again after G4 and G5 (2026-09-15), every C path of theirs exists. The G4/G5 paths come from the group reports in `temp/124-phase10-notes.md`, each checked with Glob; `git status` was not re-run for that reconcile. After G6, G7 and the fixes after G7 (2026-09-15) it was: every changed code, test, fixture and design-system path under `src`, `e2e` and `design` is listed in one of the two files, and every C path exists. In Phase 10 (2026-09-15) the whole `git status --porcelain -uall` list was compared, `.ai/`, `temp/` and the Phase 10 documents excluded: 329 paths, each on exactly one C or M line (or among the 26 fixtures), each marker matching its status (`??` for C, `M` for M).

## G1 – refactor first, contract first

### WI-1 – split `PreviewLiveView.ts` (behaviour-neutral, one owner per state)

- M `src/main/services/preview/PreviewLiveView.ts`
- C `src/main/services/preview/previewLiveTypes.ts`
- C `src/main/services/preview/previewLiveBounds.ts` (bounds, the zoom call and the repaint confirmation, RA2-2)
- C `src/main/services/preview/previewLiveVisibility.ts`
- C `src/main/services/preview/previewLivePipeline.ts`
- C `src/main/services/preview/previewLivePipeline.test.ts` (existing suites reached 47 % of the moved pipeline)
- C `src/main/services/preview/previewLiveBackdrop.ts` (backdrop state and the page's own paper)
- C `src/main/services/preview/previewLiveBackdrop.test.ts`
- C `src/main/services/preview/previewLiveTeardown.ts`
- C `src/main/services/preview/previewLiveWiring.ts` (construction and collaborator wiring – the §3 fallback split, made in WI-1)
- C `src/main/services/preview/previewUrl.ts`
- C `src/main/services/preview/previewUrl.test.ts`

### WI-2 – trim `PreviewViewService.ts` (behaviour-neutral)

- M `src/main/services/preview/PreviewViewService.ts` (keeps its `PreviewWindowLike` re-export from `./PreviewLiveView`)
- C `src/main/services/preview/previewBlockedLedger.ts`
- C `src/main/services/preview/previewBlockedLedger.test.ts`
- C `src/main/services/preview/previewViewTypes.ts` (service types only)
- C `src/main/services/preview/previewViewEviction.ts`
- C `src/main/services/preview/previewViewEviction.test.ts`
- C `src/main/services/preview/previewPanelState.ts`
- C `src/main/services/preview/previewPanelState.test.ts`

### WI-3 – toolbar slots and panel actions (behaviour-neutral)

- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.tsx` (slot props default to today's buttons)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewToolbarTools.tsx`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/index.ts`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.tsx`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewPanelActions.ts`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/index.ts`

### WI-4 – split the e2e page object

- M `e2e/pages/html-preview.page.ts`
- C `e2e/pages/html-preview.native.ts`

### WI-7 – shared contract (additive, no runtime change)

- C `src/shared/preview-limits.ts` (includes `RESIZE_HOLD_MAX_IDLE_MS`)
- C `src/shared/dropReporter.ts`
- C `src/shared/dropReporter.test.ts`
- C `src/shared/previewNavKeys.ts`
- C `src/shared/previewNavKeys.test.ts`
- C `src/shared/previewFrameBadgeText.ts` (the `srcdoc` and "too many frames" entry texts of answer 9, singular and plural; main writes the finished sentence)
- C `src/shared/previewFrameBadgeText.test.ts`
- C `src/shared/ipc/preview-navigation-schema.ts` (the optional `history` on a refusal)
- C `src/shared/ipc/preview-navigation-schema.test.ts`
- C `src/shared/ipc/preview-bridge-types.ts` (`PreviewBridge`, moved out of `preview-schema.ts` and re-exported there)
- M `src/shared/ipc/preview-schema.ts`
- M `src/shared/ipc/preview-types.ts` (payload types and optional fields; no new `PreviewEmitters` member – those travel with their emitters)
- M `src/shared/ipc/preview-channels.ts`
- M `src/shared/errors.ts` (four `PREVIEW_NAV_*` codes and messages)
- M `src/preload/previewBridge.ts`
- C `src/preload/previewBridge.test.ts`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/htmlPreview.logic.ts` (frame failure labels; the entry texts are in `previewFrameBadgeText.ts`)
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/htmlPreview.logic.test.ts`

## G2

### WI-6 – drop-point logging, renderer

- M `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.ts`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.test.ts`

### WI-13 – own-token CSP and scheme tripwires

Note (as built): `onReject` gets a `PreviewCspRejection` – `{ kind: 'host', host }` or `{ kind: 'own-token' }`, never the token's value. `previewSchemeScope.test.ts` also pins the `attach(session, …)` shape and that only `PreviewSessionFactory.ts` reaches it; WI-12 and WI-14 keep that shape or update the test in the same change.

- M `src/main/services/preview/previewCsp.ts`
- M `src/main/services/preview/previewCsp.test.ts`
- M `src/main/services/preview/PreviewRootRegistry.ts`
- M `src/main/services/preview/PreviewRootRegistry.test.ts`
- M `src/main/services/preview/previewResponseHeaders.ts`
- M `src/main/services/preview/previewResponseHeaders.test.ts`
- C `src/main/services/preview/previewSchemeScope.test.ts`

### WI-16 – failure badge entries, Markdown no-frames test

Note: the badge shows frame entries as they are – main writes the finished sentence from `src/shared/previewFrameBadgeText.ts` (WI-7), so no entry text is built here.

- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewFailureBadge.tsx` (a doc comment only – the badge needed no code change)
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewFailureBadge.test.tsx`
- C `src/renderer/src/components/Editor/MarkdownPreview.frames.test.tsx`

### WI-17a – link table, click button, history list, key rows (pure, not yet wired)

Note: adds `back` / `forward` to `PREVIEW_FORWARDED_SHORTCUTS` and the forwarded-shortcut schema enum together (moved from WI-7; `previewInputForward.test.ts` requires them to match). As built: `requestedLinkDisposition` (rows 1–5) and `decideLinkDisposition` (all six); `requestOpenFile` takes `disposition` as a fifth argument; the history functions are listed in part 3 §3.5.

- C `src/main/services/preview/previewLinkDisposition.ts`
- C `src/main/services/preview/previewLinkDisposition.test.ts`
- C `src/main/services/preview/previewTabHistory.ts` (with `dropNeighbour`)
- C `src/main/services/preview/previewTabHistory.test.ts`
- M `src/main/services/preview/previewLinkNavigation.ts`
- M `src/main/services/preview/previewLinkNavigation.test.ts`
- M `src/main/services/preview/previewLinkBridge.ts`
- M `src/main/services/preview/previewLinkBridge.test.ts`
- M `src/main/services/preview/PreviewNavigationPolicy.ts`
- M `src/main/services/preview/PreviewNavigationPolicy.test.ts`
- M `src/preload/previewPage.ts`
- M `src/preload/previewPage.contract.test.ts`
- M `src/main/services/preview/previewInputForward.ts`
- M `src/main/services/preview/previewInputForward.test.ts`
- ↑ `src/shared/ipc/preview-schema.ts` (the forwarded-shortcut enum lives there; no other G2 item edits it)
- `src/main/ipc/preview/emit.ts` – not edited (was conditional): the Back/Forward rows are `accel: false, nav: true` and match through the shared key table, so its Cmd/Ctrl-shaped `SHORTCUT_ACCEL` is untouched; its counted edit stays WI-10's (G4)

### WI-18 – tab identity: `params.filePath` as the page, tab store

- C `src/renderer/src/stores/usePreviewTabStore.ts`
- C `src/renderer/src/stores/usePreviewTabStore.test.ts`
- M `src/renderer/src/utils/openFileInPanel.ts`
- M `src/renderer/src/utils/openFileInPanel.test.ts`
- M `src/renderer/src/utils/fileUtils.ts`
- M `src/renderer/src/utils/fileUtils.test.ts`
- M `src/renderer/src/components/DockLayout/components/EditorAreaSplitPanel.tsx` (boundary key and `resetKey`; `onDidRemovePanel` → tab store)
- C `src/renderer/src/components/DockLayout/components/EditorAreaSplitPanel.previewBoundary.test.tsx` (also the `pageChanged` wiring tests)
- M `src/renderer/src/components/Panels/PanelErrorBoundary.tsx`
- M `src/renderer/src/components/Panels/PanelErrorBoundary.test.tsx`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewLifecycle.ts`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewLifecycle.test.ts`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewEvents.ts` (`pageChanged` → `updateParameters`, tab store, `resetPage`)
- M `src/renderer/src/stores/usePreviewStore.ts` (`resetPage` leaves failures and truncation to main's snapshot)
- M `src/renderer/src/stores/usePreviewStore.test.ts`
- M `src/renderer/src/components/Tabs/HtmlPreviewTab.test.tsx` (title follows `updateParameters`)
- `src/renderer/src/components/Tabs/HtmlPreviewTab.tsx` – not edited (was conditional): dockview re-renders tab components on `updateParameters`
- M `src/renderer/src/components/Tabs/tabOperations.test.ts` (a moved tab's name comes from params)
- ↑ `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.tsx`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.test.tsx` (split: 13 tests stay here; the bridge mock, now with `onPageChanged`, moved to the harness)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.events.test.tsx` (5 tests)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.shortcuts.test.tsx` (3 tests)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/__test__/panelHarness.ts` (the shared harness and bridge mock, `MockPreview`)
- M `src/renderer/src/services/preview/PreviewLinkRouter.ts`
- M `src/renderer/src/services/preview/PreviewLinkRouter.test.ts`

### WI-21 – open in default browser, main and preload

- C `src/shared/ipc/browser-channels.ts`
- C `src/shared/ipc/browser-schema.ts`
- C `src/shared/ipc/browser-schema.test.ts`
- ↑ `src/shared/errors.ts` (`OPEN_IN_BROWSER_*`)
- C `src/main/ipc/browser-handlers.ts`
- C `src/main/ipc/browser-handlers.test.ts`
- C `src/main/services/browserLaunch/BrowserLaunchService.ts`
- C `src/main/services/browserLaunch/BrowserLaunchService.test.ts`
- C `src/main/services/browserLaunch/browserLauncher.ts`
- C `src/main/services/browserLaunch/browserLauncher.test.ts`
- M `src/main/utils/projectConfinement.ts`
- M `src/main/utils/projectConfinement.test.ts`
- M `src/main/index.ts`
- M `src/preload/index.ts`
- M `src/preload/index.d.ts`
- M `src/preload/index.test.ts`

### WI-29 – page scope, pending scope and the one reset path

- ↑ `src/main/services/preview/PreviewLiveView.ts` (a `pageScopes.dispose` teardown step, RA3-1; the first load and the approval reload go through `startPageLoad`, kinds `initial` and `reload`)
- ↑ `src/main/services/preview/previewLiveWiring.ts` (builds `previewLivePage`; the link bridge's `recordFailure` and the CSP-violation hook look up `committed()` per write – the wiring builds no CSP bridge any more; the pipeline's `reloadPage` goes through `startPageLoad`)
- ↑ `src/main/services/preview/previewLiveTypes.ts` (`PreviewLiveViewParams.failureLog` became `pageScopes`, the holder; `onBlockedHost` removed, RA2-3)
- ↑ `src/main/services/preview/PreviewViewService.ts` (holder from `createPageScopeHolder(() => createPreviewPageScope(…))` in `open()`, on the existing `createFailureLog` dep – no new dep, so `previewViewTypes.ts`, `buildPreviewGraph.ts` and the harness stay as they are, RA3-3; `dispose()` on the three early exits; `onBlocked` writes `committed().reportBlocked`; `applyApprovedHosts` clears nothing and reloads through `startPageLoad`)
- M `src/main/services/preview/PreviewViewService.test.ts` (approval test `:948-959`: the log is replaced through `startPageLoad`, not cleared – RA3-3)
- ↑ `src/main/services/preview/previewUrl.ts` and its test (`samePreviewDocument`: scheme, host and path; query and fragment ignored, RS3-2)
- C `src/main/services/preview/previewPageScope.ts` (the scope – failure log, blocked-host ledger and sink, CSP-violation bridge, refusal set – and its holder: committed and pending slots, `dropPending()`, `dispose()`)
- C `src/main/services/preview/previewPageScope.test.ts`
- C `src/main/services/preview/previewFrameRefusals.ts` (2048-character cut and CR, LF, U+2028, U+2029 removed before the dedupe key; 100-entry cap; overflow logged once at page end)
- C `src/main/services/preview/previewFrameRefusals.test.ts`
- C `src/main/services/preview/previewLivePage.ts` (pending load and its four end rules: main-frame `did-navigate`, in-page commit, a new `startPageLoad`, `did-stop-loading`; its own listeners for them – `previewViewLifecycle.ts` untouched)
- C `src/main/services/preview/previewLivePage.test.ts`
- C `src/main/services/preview/PreviewViewService.pageScope.test.ts`
- M `src/main/services/preview/PreviewSessionFactory.ts` (the context swaps `recordFailure` for a `pageScopes` getter, `PreviewSessionPageScopes`; no filter edit; 489 lines after WI-29, 480 after WI-12's split)
- M `src/main/services/preview/PreviewSessionFactory.test.ts` (554 lines after WI-29; 357 after the follow-up's split)

Follow-up, done during G3 (logged in [design-issue-124-impl.md](design-issue-124-impl.md)): option B – the holder keeps the view-level badges and copies them into every new page scope (`recordViewFailure`, which the factory calls for the allowlist's drained badges, ↑ `previewPageScope.ts`); the factory test split; dead code removed with its tests.

- C `src/main/services/preview/PreviewSessionFactory.unwind.test.ts` (split from the factory suite)
- C `src/main/services/preview/PreviewSessionFactory.partitionRecycling.test.ts` (split from the factory suite; WI-12 adds to it)
- C `src/main/services/preview/__test-helpers__/previewSessionFactoryMocks.ts` (the split suites' shared mocks; WI-12 adds to it)
- ↑ `src/main/services/preview/previewPanelState.ts` and its test (the blocked ledger removed – zoom only now), `previewViewEviction.ts` and its test (its `panelState` dep removed), `previewBlockedLedger.ts` and its test (`IPreviewBlockedLedger.clear()` removed)
- M `src/main/services/preview/previewCspViolationBridge.ts` (`reset()` removed; first modified here, so WI-14 references it)
- M `src/main/services/preview/previewCspViolationBridge.test.ts`
- M `src/main/services/preview/PreviewFailureLog.ts` (`clear()` removed)
- M `src/main/services/preview/PreviewFailureLog.test.ts`

## G3

### WI-5 – drop-point logging, main

Note (as built): the reason ids, the reporter factory and the service's M4 memory are in `previewBoundsDropLog.ts`; each live view builds its reporter inside `previewLiveBounds.ts`, never through `previewLiveWiring.ts` (WI-15's in G3). The drop-log module's tests are two `describe` blocks in `previewLiveBounds.test.ts`.

- M `src/main/ipc/preview/lifecycle-handlers.ts`
- M `src/main/ipc/preview/lifecycle-handlers.test.ts`
- ↑ `src/main/services/preview/PreviewViewService.ts` (M4), `previewLiveBounds.ts` (M5–M8, M10) and `previewLiveTypes.ts` (optional `webContents.getZoomFactor`)
- C `src/main/services/preview/previewBoundsDropLog.ts` (the main reason ids, `createMainDropReporter`, `createNoViewDropLog`)
- C `src/main/services/preview/previewLiveBounds.test.ts` (also the drop-log module's tests)
- C `src/main/services/preview/PreviewViewService.dropLog.test.ts`

### WI-12 – request kind ledger, `readDestination` fix, request-level frame guard

Note (as built): every handler failure about a main-frame document – the refusal, a 503 read-budget shed, a 500 for a missing CSP – goes through `ctx.pageScopes().forMainDocument()`; the `PreviewSessionPageScopes` slice widened in the factory only and moved to `previewSessionFilterContext.ts` (re-exported), so `PreviewViewService.ts` stayed WI-5's in G3. The filter-context assembly moved to the planned split; the factory is 480 lines.

- C `src/main/services/preview/PreviewRequestKindLedger.ts`
- C `src/main/services/preview/PreviewRequestKindLedger.test.ts`
- M `src/main/services/preview/PreviewProtocolHandler.ts` (every main-frame document failure through `forMainDocument()`)
- M `src/main/services/preview/PreviewProtocolHandler.test.ts`
- M `src/main/services/preview/PreviewRequestFilter.ts`
- M `src/main/services/preview/PreviewRequestFilter.test.ts`
- C `src/main/services/preview/PreviewRequestFilter.frames.test.ts` (the request-level frame guard)
- C `src/main/services/preview/__test-helpers__/previewRequestFilterMocks.ts`
- ↑ `src/main/services/preview/PreviewSessionFactory.ts` and its test (context rebuilt per `create`), and the WI-29 follow-up's split files `PreviewSessionFactory.partitionRecycling.test.ts` and `__test-helpers__/previewSessionFactoryMocks.ts`
- C `src/main/services/preview/previewSessionFilterContext.ts` (filter-context assembly – the §3 fallback split, certain since WI-29)
- C `src/main/services/preview/previewSessionFilterContext.test.ts`
- ↑ `src/main/services/preview/previewSchemeScope.test.ts` – only if the `attach()` shape changes

### WI-15 – frame watch sources and the reload rule

Note (as built): the pipeline asks for the page once per run, collects the frame sources and re-runs `classifyReload([path], frameAssets)` on a swap decision, so the reload policy built in the wiring is unchanged. A frame document is read only inside the project root (`confinePath` on the path as written and after `realpath`); passing the session's `realRoot` to the pipeline is WI-15's one edit of `previewLiveWiring.ts`.

- M `src/main/services/preview/linkExtract.ts`
- M `src/main/services/preview/linkExtract.test.ts`
- C `src/main/services/preview/previewFrameSources.ts`
- C `src/main/services/preview/previewFrameSources.test.ts`
- C `src/main/services/preview/previewFrameSources.pipeline.test.ts` (the pipeline's frame tests, split from `previewFrameSources.test.ts`)
- M `src/main/services/preview/PreviewReloadPolicy.ts`
- M `src/main/services/preview/PreviewReloadPolicy.test.ts`
- ↑ `src/main/services/preview/previewLivePipeline.ts` (frame sources on every run; optional `realRoot`) and `previewLiveWiring.ts` (passes `realRoot`); no other G3 item owns either

### WI-19 – move coordinator, unsaved-changes prompt, save by id

Note (after G2): `findPreviewTabShowing` returns the first match and takes no exclude – the coordinator filters T out; a refusal's `history` goes in through `usePreviewTabStore.getState().setHistory(panelId, history)`; `announcement` and `lastMove` are added to `PreviewTabState` here; the router still opens every disposition as a new tab – `same-tab`, `by-mode` and `mountPreviewLinkRouter` are this item's (its `getLinkMode` dep exists); `EditorAreaSplitPanel.registration.test.tsx` still prints one "no logging bridge" line – add a logger mock there. As built: `EditorAreaSplitPanel` uses `useOptionalDialog()`; the prompt's tests went to a split file, so `DialogContext.test.tsx` (594) is not edited; `UnsavedChangesDialog` takes `alert-triangle` from the icon registry; `previewTabMove.ts` and its test are at the cap.

- C `src/renderer/src/services/preview/previewTabMove.ts` (497 lines after WI-19; 491 after QG-6 B5)
- C `src/renderer/src/services/preview/previewTabMove.test.ts` (500 lines after WI-19; 499 after B5)
- ↑ `src/renderer/src/services/preview/PreviewLinkRouter.ts` and its test (`mountPreviewLinkRouter(deps)` with the prompt and `closePanel`; `getPreviewLinkRouter()` becomes a reader; `same-tab` path)
- C `src/renderer/src/components/Dialog/UnsavedChangesDialog.tsx`
- C `src/renderer/src/components/Dialog/UnsavedChangesDialog.test.tsx`
- M `src/renderer/src/components/Dialog/types.ts`
- M `src/renderer/src/components/Dialog/DialogContext.tsx` (`showUnsavedChanges`; an unmount resolves it as cancel; `useOptionalDialog()`)
- C `src/renderer/src/components/Dialog/DialogContext.unsavedChanges.test.tsx` (the prompt's context tests, split so `DialogContext.test.tsx` is not grown)
- `src/renderer/src/components/Dialog/DialogContext.test.tsx` – not edited (was planned): its unsaved-changes tests went to the split file; 594 lines, over 500 before this change
- M `src/renderer/src/components/Dialog/DialogManager.tsx`
- M `src/renderer/src/components/Dialog/index.ts`
- M `src/renderer/src/utils/iconRegistry.tsx` (`alert-triangle`, the prompt's icon)
- C `src/renderer/src/services/editorSaveRegistry.ts`
- C `src/renderer/src/services/editorSaveRegistry.test.ts`
- C `src/renderer/src/hooks/useEditorSaveRegistration.ts`
- M `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`
- M `src/renderer/src/components/Panels/MarkdownEditorPanel.integration.test.tsx`
- ↑ `src/renderer/src/components/DockLayout/components/EditorAreaSplitPanel.tsx` (the only router creator: `useOptionalDialog()`, prompt and `closePanel` on mount, dispose on unmount)
- M `src/renderer/src/components/DockLayout/components/EditorAreaSplitPanel.registration.test.tsx` (inside a `DialogProvider`, with a logger mock)
- ↑ `src/renderer/src/stores/usePreviewTabStore.ts` and its test (`announcement` with its target and `focusMoved`, `lastMove`, a refusal's `history`)

### WI-22 – open in default browser, renderer

Note (after G2): call `window.api.browser.openFile(params.filePath)` as the bridge defines it; a rejected invoke → the "Launch failed" toast; the renderer builds the named toasts from UX §7; `NO_PROJECT` and `INVALID_REQUEST` → "Launch failed" (RU13); `usedFallback: true` → the info toast. As built: the reply is checked against `BrowserOpenFileResponseSchema`; the Linux toast says "Reveal in File Manager"; no renderer busy timeout and no busy state on the tree item; the band ends at 429 lines and the panel at 359, over their WI-3 targets (recorded).

- M `src/renderer/src/components/ProjectTree/context-menu/commands.tsx`
- M `src/renderer/src/components/ProjectTree/context-menu/commands.test.tsx`
- M `src/renderer/src/components/ProjectTree/context-menu/strategies.tsx`
- M `src/renderer/src/components/ProjectTree/context-menu/strategies.test.tsx`
- M `src/renderer/src/components/ProjectTree/context-menu/types.ts`
- M `src/renderer/src/components/ProjectTree/ProjectTree.tsx`
- ↑ `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewToolbarTools.tsx`, `hooks/usePreviewPanelActions.ts`, `components/PreviewChromeBand.tsx` (passes the action to the trailing tools) and `HtmlPreviewPanel.tsx`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewToolbarTools.test.tsx` (busy, ignored presses, the default slot, the current page)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/previewOpenInBrowser.ts`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/previewOpenInBrowser.test.ts`

## G4

### WI-8 – part 1 reproduction (time-boxed)

Note (as built): the mechanism tests went to two new files, not into `usePreviewBounds.test.ts` (485 lines) or `buildPreviewGraph.test.ts`, so neither was edited; each new file has a plain `it` control. C2's first test (a 0×0 placeholder) was replaced by the clipped-placeholder test once the e2e re-diagnosed C2 (part 1 §1.8). The e2e helpers (`BoundsHarness`, `DropTrail`) live in the spec; the page-object files are untouched. The results are in part 1 §1.8 (a design document, not counted).

- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.repro.test.ts` (C1 ×2 and C2 as `it.fails`; C2 = the clipped placeholder; 223 lines)
- C `src/main/ipc/preview/buildPreviewGraph.repro.test.ts` (C3 as `it.fails`; 119 lines)
- C `e2e/html-preview-bounds.e2e.ts` (460 lines: four `test.fail`, nine passing checks)

### WI-10 – drag freeze, main: window-edge hold and still-picture freshness

Note (after G3): the setBounds handler keeps the parsed push in `push`, so `push.settled` goes through the same call, and pushes during a hold still produce drop lines; M9's reporter comes from `createMainDropReporter` (`previewBoundsDropLog.ts`); the hold-map cleanup goes beside `closeWindow`'s M4 `forget`; `PreviewViewService.ts` is at 434 lines, about 66 below the cap. As built ([impl doc](design-issue-124-impl.md), G4): M9's reason `RESIZE_HOLD_DROP_REASON` joined `previewBoundsDropLog.ts`; `PreviewEmitters.resizeHold` and `IPreviewStillFrameCache.markStale` are optional in the dep types; the bounds changes are tested in `previewStillFrameFreshness.test.ts`; no path beyond this list. `PreviewViewService.ts` ends at 485 lines (15 below the cap), `previewResizeHold.test.ts` at 499 (a later edit splits first) and `src/main/index.ts` at 677 (+4 of the +8 budget).

- C `src/main/services/preview/previewResizeHold.ts` (one `release()`, the second-timeout rule, the idle maximum; the only caller of `visibility.release()`)
- C `src/main/services/preview/previewResizeHold.test.ts`
- C `src/main/services/preview/previewStillFrameFreshness.ts`
- C `src/main/services/preview/previewStillFrameFreshness.test.ts`
- ↑ `src/main/services/preview/previewLiveVisibility.ts` (`hold`, `release` – called only by the state machine; `release` emits `visibilityApplied`), `previewLiveBounds.ts` (CSS size at capture), `PreviewLiveView.ts`, `previewLiveWiring.ts` (visibility gets the CSS size at capture from bounds only through a callback set up there) and `previewBoundsDropLog.ts` (M9's `RESIZE_HOLD_DROP_REASON`, as built)
- M `src/main/services/preview/PreviewStillFrameCache.ts`
- M `src/main/services/preview/PreviewStillFrameCache.test.ts`
- M `src/main/ipc/preview/emit.ts`
- M `src/main/ipc/preview/emit.test.ts`
- ↑ `src/shared/ipc/preview-types.ts` (`PreviewEmitters.resizeHold`), `src/main/ipc/preview/lifecycle-handlers.ts` and its test (`settled`; two checks gained a fifth `undefined` argument), `src/main/services/preview/PreviewViewService.ts` and `previewViewTypes.ts` (`setResizeHold`, per-window map, dropped in `closeWindow`)
- C `src/main/services/preview/PreviewViewService.resizeHold.test.ts`
- M `src/main/ipc/preview-handlers.ts` (bundle `setResizeHold`)
- M `src/main/ipc/preview-handlers.test.ts`
- ↑ `src/main/index.ts` (`will-resize` / `resized` listeners)

### WI-20 – Back and link-mode controls, banners, keys in the chrome, the toolbar card

Note (after G2): read the mode with `usePreviewTabStore((s) => s.tabs.get(panelId)) ?? NO_PREVIEW_TAB`; the toggle calls `setLinkMode`; the Back tooltip reads `backTarget`; forwarded keys route on `payload.key === 'back' | 'forward'` alone (`accel` is false on every platform), panel-root keys through `navKeyFromDomEvent` and `matchPreviewNavKey`; until this item lands, forwarded Back/Forward keys do nothing (same PR); `PanelErrorBoundary.test.tsx` is at 497. After G3: Back carries `data-preview-nav="back"` inside the panel content (`PREVIEW_BACK_BUTTON_SELECTOR`, exported from `previewTabMove.ts`). A move runs through `getPreviewLinkRouter()?.move({ panelId, origin: 'chrome' | 'page', action: 'back' | 'forward' })`, which never rejects; a `null` reader keeps Back `aria-disabled`. The coordinator writes the announcement before the commit and clears it on every other ending; this item speaks it on the matching `pageChanged` (same `filePath` and anchor, `failed` false), one frame later when `focusMoved` is set, and clears it otherwise. The coordinator never clears `lastMove`: this item decides when, through `setLastMove(panelId, null)`. A banner-started move focuses Back with `createPreviewBackFocuser(getDockviewApi)`. Open in browser's busy look goes into `PreviewChromeBand.css` – `.erf-band__tool[aria-disabled='true'] { opacity: var(--opacity-disabled); cursor: default; }`, hover and active transparent – then `npm run design` resyncs `band.css`. `HtmlPreviewPanel.tsx` is at 359 lines and `PreviewChromeBand.tsx` at 429; `previewTabMove.ts` (497) and its test (500) are at the cap – any edit there splits first. `createMockMenuContext` (`ProjectTree/__test__/testUtils.ts`) lacks `openInBrowser`; no G4 item owns it, so it goes to Phase 8. As built ([impl doc](design-issue-124-impl.md), G4; part 3 §3.4, §3.8): `usePreviewNavigation` and `usePreviewMoveAnnouncer` carry the logic and `PreviewNavControls` is presentational; the band's WI-20 tests went to `PreviewChromeBand.nav.test.tsx` and the panel's to `HtmlPreviewPanel.navigation.test.tsx`; the find bar closes and the host list collapses through `onLeavePage` in `usePreviewEvents`, only on a move to another document; the banner's busy look went to `HtmlPreviewPanel.css`; the band ends at 453 lines, its CSS at 432 and the panel at 394 – the band and the panel over their WI-3 targets (recorded).

- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewNavControls.tsx` (Back and the toggle; test ids `preview-band-back`, `preview-band-link-mode`)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewNavControls.css` (the toggle, and the band's two width tiers, 385 and 293 px)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewNavControls.test.tsx`
- ↑ `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.tsx` (leading slot, compact chip text; 453 lines)
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.css` (the spacer comment, and the Open-in-browser busy rule, from WI-22; 432 lines)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.nav.test.tsx` (leading slot, compact chip text – split off, as built)
- `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.test.tsx` – not edited (was planned): its WI-20 cases went to the split file; 599 lines, over 500 before this change
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewBanner.tsx` (second action; busy `aria-disabled`, not `disabled`)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewBanner.test.tsx`
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewFindShortcuts.ts`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewFindShortcuts.test.ts`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewNavigation.ts` (Back, the toggle, the root keys, the banner's return button, focus to Back – as built)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewNavigation.test.ts`
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewMoveAnnouncer.ts` (the panel-root region's text – as built)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewMoveAnnouncer.test.ts`
- ↑ `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewEvents.ts` (`onLeavePage` on a `pageChanged` to another document – the panel closes the find bar, focus to Back, and collapses the host list – and `onPageChanged`, next to WI-18's handler)
- ↑ `components/index.ts` and `hooks/index.ts` (the new exports), `usePreviewPanelActions.ts` (`leavePage`; new options optional), `HtmlPreviewPanel.tsx` (move-caused banner text; focus to Back after a banner-started move; panel-root polite region `preview-move-announcement`, RU3-1; 394 lines), `HtmlPreviewPanel.test.tsx` and its split files (`HtmlPreviewPanel.events.test.tsx`, `.shortcuts.test.tsx`, `__test__/panelHarness.ts`), `src/renderer/src/utils/iconRegistry.tsx` (`arrow-left`, `mouse-pointer-click`) and `PreviewToolbarTools.tsx` (a `deviates:` comment)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.navigation.test.tsx` (the panel's navigation cases – as built)
- M `src/renderer/src/components/Panels/HtmlPreviewPanel/HtmlPreviewPanel.css` (the banner's busy look; first modified here, so WI-11 references it)
- M `scripts/design-sync.mjs` (`COMPONENT_CSS` entry)
- M `.stylelintrc.json` (the `erf-` class rule covers `PreviewNavControls.css`)
- M `design/system/components/permission-band/index.html` (the Exceptions row: `aria-disabled` on Back and Open in browser, `disabled` on Export; 759 → 1 049 lines)
- M `design/system/components/permission-band/band.css` (regenerated by the sync)
- C `design/system/components/permission-band/nav.css` (generated by the sync)
- M `design/claims.json` (two contrast claims)
- M `design/claims.js` (generated)
- M `design/README.md` (`nav.css` in the generated-file lists)

## G5

### WI-9 – part 1 fixes, confirmed causes only

All three causes confirmed (part 1 §1.8), so every row below ships. C2 is the revised fix (part 1 §1.4): the loop's measure intersects the placeholder with every clipping ancestor; an empty area is never sent, writes R7 and clears the viewport rect, and – once a rect has gone out – sets the `collapsed` gate; the return is one forced push, then the flag cleared. As built, in two halves – WI-9a (C1, C2; react-developer) and WI-9b (C3; software-developer), logged in the [impl doc](design-issue-124-impl.md), G5: the clip helpers went to a new `previewClip.ts`, so `htmlPreview.logic.ts` and its test were not edited; WI-9's own tests went to two split files; `usePreviewViewportStore.ts` is called (`clearRect`), not edited; M10 stays as a tripwire, so `previewBoundsDropLog.ts` is untouched; `buildPreviewGraph.test.ts` was not edited and `PreviewViewService.ts` stayed at 485 lines; with the C1 loop, one capped M4 info line per open is expected. No path shared with WI-14.

- ↑ `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.ts` (the loop, the clip check, `pushBounds()` as the forced push, R7 `clipped-away` in `PREVIEW_BOUNDS_DROP_REASON`; R6 went with the pump; 489 lines) and its test (three pump tests rewritten; an R3 test replaced R6's; 487 lines)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/previewClip.ts` (`clipsDescendants`, `intersectRects`, `visibleArea`)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.loop.test.ts` (C1: the loop, one message per frame, none while still)
- C `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.clip.test.ts` (C2: the clip, the flag and its lifetime, R3 and R7)
- ↑ `src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.repro.test.ts` (three `it.fails` → `it`; 226 lines)
- C `src/renderer/src/stores/usePreviewCollapsedStore.ts`
- C `src/renderer/src/stores/usePreviewCollapsedStore.test.ts`
- M `src/renderer/src/services/preview/OverlayGuardService.ts` (the gate term – `getPanelGate` returns the chrome gate, else `'collapsed'`; `subscribeGate` over both stores – and a `collapsed` entry in the guard's local `VISIBILITY_REASON`; the IPC reason is a free string, so no schema edit; 425 lines)
- M `src/renderer/src/services/preview/OverlayGuardService.test.ts` (also its fake state's type: 12 test type errors → 0)
- M `src/main/ipc/preview/buildPreviewGraph.ts` (C3: the default reads the host window's zoom, `:142`, used at `:151`)
- ↑ C3's other places – `src/main/services/preview/previewLiveTypes.ts` (`webContents` required, `:60`; the dep takes `Pick<PreviewWindowLike, 'webContents'>`, `:90`), `previewLiveBounds.ts` (`:103`; M10 "a tripwire after C3", `:119`) and its test (the M10 tests), `previewViewTypes.ts` (`:142`), the hand-offs in `PreviewViewService.ts` (`:88`) and `src/main/ipc/preview-handlers.ts` (`:68`, `:103`); `src/main/ipc/preview/buildPreviewGraph.repro.test.ts` (`it.fails` → `it`, plus M10 checks; 155 lines); `previewStillFrameFreshness.test.ts` (a one-line fake-window fix, `:209`)
- ↑ `e2e/html-preview-bounds.e2e.ts` (the four `test.fail` removed at the G5 gate, with the block's header text; the C3 case also asserts no `main:zoom-mismatch`; 458 lines)

### WI-14 – frame guard, refusal writers, frame CSP console bridge

Note: the `srcdoc` and "too many frames" entry texts come from `src/shared/previewFrameBadgeText.ts` (WI-7); main writes the finished sentence into the entry's `resourceUrlOrHost`. After G2: every refusal is written through `pageScopes.committed().frameRefusals.record(type, address)` and the frame console path goes through `pageScopes.committed().handleCspViolation({ blockedURI, effectiveDirective })`, each looked up per write. Chromium's refusal text quotes `frame-src erfana-preview://<token>` – use it in the parser's test data; a bad token refuses every `src` frame with -30, listed by the failed-load writer. After G3: the filter lists the full URL for `frame-remote` and `frame-escape` (the scheme only for `data:` / `blob:`) and the handler `url.pathname` for a same-token refusal (never the token); the failed-load writer uses the full `validatedURL` (the scheme only for `data:` / `blob:`), so one frame gives one entry, and ignores -20, the filter's own cancel, already listed; `requestKind()` is exported from `PreviewRequestKindLedger.ts`; the own-token pattern is still private in `previewCsp.ts`. As built ([impl doc](design-issue-124-impl.md), G5; part 2 §2.5–§2.8): the own-token pattern is exported as `OWN_TOKEN_PATTERN`; the frame bookkeeping sits in `previewPageScope.ts` (371 lines; its test at 495 – a later edit splits first); the bridge's frame tests went to a split file; `PreviewLiveView.ts` gained one teardown step (347 lines); WI-14's report names no `attach()` change.

- C `src/main/services/preview/previewFrameGuard.ts`
- C `src/main/services/preview/previewFrameGuard.test.ts`
- C `src/main/services/preview/previewFrameEvents.ts` (guard wiring, `srcdoc` detection, failed-load writer; every writer into the committed scope)
- C `src/main/services/preview/previewFrameEvents.test.ts`
- C `src/main/services/preview/previewFrameCspConsole.ts`
- C `src/main/services/preview/previewFrameCspConsole.test.ts`
- ↑ `src/main/services/preview/previewPageScope.ts` and its test (frame counters, committed-frame set and over-limit timer in `createPreviewPageScope`, cleared in its `dispose()`, RS14)
- ↑ `src/main/services/preview/previewCsp.ts` (export the own-token pattern for the frame modules rather than copying it)
- ↑ `src/main/services/preview/previewSchemeScope.test.ts` – only if the `attach()` shape changes
- ↑ `src/main/services/preview/previewCspViolationBridge.ts` and its test (`frame-src` / `child-src` dropped right after the parse, before the caps; first modified in the WI-29 follow-up)
- C `src/main/services/preview/previewCspViolationBridge.frames.test.ts` (the bridge's frame-directive tests, split off – as built)
- M `src/main/services/preview/previewViewLifecycle.ts` (a frame's `did-fail-load` no longer settles the load)
- M `src/main/services/preview/previewViewLifecycle.test.ts`
- ↑ `src/main/services/preview/previewLiveWiring.ts` (attaches the frame events – `frameEvents`: the guard, the `srcdoc` check, the failed-load writer and the frame console bridge – to the view's contents; the wiring holds no CSP bridge any more – each page scope has one; 260 lines) and `PreviewLiveView.ts` (one teardown step, `frameEvents.dispose`)

## G6 and G7

In [design-issue-124-files-g6g7.md](design-issue-124-files-g6g7.md): WI-11 and WI-17b (G6), WI-23 to WI-27 (G7), and the fixes made after G7 – the frame fix, the symlink first-open fix, the WI-25 fixes (the PDF name and Find; the still picture and Back after `pushState`), and the QG-6 to QG-8 review fixes (B0–B5, TQ1–TQ3, U1, U2, J1–J3, QG-9 C1). Counted in the totals above.

## Conditional files (not counted)

- The fallback splits named in the parent §3 and not yet made (`previewViewLoadEvents.ts`, `emitNavigation.ts`, `PreviewPageArea.tsx`, `usePreviewStillStore.ts`, and the bounds hook's drop-log module – decided at the G6/G7 reconcile: the next edit of `usePreviewBounds.ts` makes it first), made only by the item that would push a hub file past 500 lines. `previewLiveWiring.ts` (WI-1), `previewSessionFilterContext.ts` (WI-12) and `previewViewNavigation.ts` (WI-17b) were made and are counted.
- Resolved, no longer conditional: `src/main/ipc/preview/emit.ts` in WI-17a and `src/renderer/src/components/Tabs/HtmlPreviewTab.tsx` in WI-18 – neither was needed; the WI-8 split – WI-8 made `usePreviewBounds.repro.test.ts` and `buildPreviewGraph.repro.test.ts`, counted under WI-8; WI-9's own tests – two split files, counted under WI-9 – and `buildPreviewGraph.test.ts`, which WI-9 did not edit; `PreviewLiveView.ts` in WI-14 – edited (one teardown step), a reference; WI-11's forced-push split – `usePreviewBounds.settled.test.ts`, counted; `previewLinkNavigation.ts` in WI-17b – not needed; `e2e/pages/html-preview.native.ts` in WI-27 – not edited.

## Design documents (not counted)

Tracked with #124 in `docs/design/`, each kept at or under 500 lines: [design-issue-124.md](design-issue-124.md) (the parent), [part 1](design-issue-124-part1.md) to [part 4](design-issue-124-part4.md), this file, [its G6/G7 half](design-issue-124-files-g6g7.md) (split off at the G6/G7 reconcile), and [design-issue-124-impl.md](design-issue-124-impl.md) – Phase 5 as built, the deviations log, added at the G3 reconcile when the parent reached its cap, with the QG-6 to QG-8 fix rounds added in Phase 10.

## Phase 10 documents (DoD-4)

Written after the code, from the shipped behaviour:

| Document | What changes |
|---|---|
| `docs/html-preview/README.md` | frames, the `srcdoc` rule (answer 9: past a cap shown and listed), `_top` / `_blank` inside a frame do nothing, same-tab links, Back and Forward (a deleted page's entry is dropped), the link-mode toggle, open in default browser (Linux always uses the fallback), the gitignore contract; frame files share the 16-file watch budget, so a framed page can show a non-zero "not watched" count; a leaf symlink used as a frame is a missing file (404) on macOS and Linux – the resolver's `O_NOFOLLOW` – and an escaped frame on Windows (not yet run there); a page's links are in its watch set, so saving a linked page reloads the one on screen |
| `docs/security.md` | accepted risks (frames run gitignored pages; a page opened in a browser runs unsandboxed; files the preview refuses are one click from a browser, RX1; no `frame-ancestors`; `srcdoc` past the caps, answer 9); `browser:openFile`, `preview:navigate` and `preview:focusPage` (QG-8 U1) added to the sender-gated list; log lines name a panel by `stablePathDigest` – unkeyed, so a log holder can confirm a guessed path (QG-8 C1); an NTFS stream name refused on Windows (QG-7 S6); a section for the browser-launch e2e seam (`app.isPackaged` first); frame documents read for live reload only inside the project root (WI-15) |
| `docs/ipc-patterns.md` | the channel index: `browser:openFile`, `preview:navigate` (invoke, check and commit, the optional `history` on a refusal), `preview:pageChanged`, `preview:resizeHold`, `preview:focusPage` (QG-8 U1; its row already written) |
| `docs/error-codes.md` | an "Open in default browser" section for the six `OPEN_IN_BROWSER_*` codes (WI-21) |
| `specs/designs/sd-074b-preview-navigation-and-multiview.md` | D4 marked superseded by #124 |
| `specs/designs/sd-074-html-preview.md` | non-goals updated (frames and same-tab links are now goals); the `failureLog.clear()` passages at `:1127` and `:1154` (removed in the WI-29 follow-up) |
| `docs/CHANGELOG.md` | the four parts, the request-type fix, the latent real-path id fix, refused frames now listed, no band row for a remote frame; Fixed (both pre-existing): a project opened through a symlinked folder shows its first page again instead of a 404; Find in an HTML preview finds matches again (it found none from #74 on) |
| `docs/keyboard-shortcuts.md` | Back and Forward per platform, the focus rule (the keys act only with focus in the panel's chrome or in the page), the physical-key rule; the keyboard entry into the page – Tab to the preview, Enter or Space on it, Escape back to the chip (QG-8 U1) |
| `docs/technical-debt.md` | files still over 500 lines (`MarkdownEditorPanel.tsx`, `ProjectTree.tsx`, `commands.test.tsx` +34, `src/preload/index.ts`, `src/main/index.ts`, `constants.ts`, `errors.ts`, the permission-band card at 1 049 lines, +290); the band (453) and the panel (394) over their WI-3 targets; no renderer busy timeout for Open in browser; Export to PDF busy on `disabled`, not `aria-disabled`; the claims predicate cannot composite translucent colours (two pressed-fill pairs checked by hand); test files are not type-checked (`tsconfig.test.json` stops at TypeScript 6 deprecations; 391 errors at HEAD); cross-token subresource reach (RX4); preview constants in two files (RA13); editors opened through a symlink alias not matched (RS12); multi-window needs (`windowId`, `panelId`) keys (RA11); Linux default-browser detection; `srcdoc` caps (answer 9); `preview:open` checks no eligibility for a first page (RX2-6; the resume half, RX3-1, closed by QG-7 item 11); an approval that lands during a same-tab move cancels the move (RS3-3 residual) – texts in the parent §12 round 3; from G6 and G7: the html-waiting card at 799 lines (+8, WI-11); `usePreviewBounds.ts` (496), `usePreviewStore.ts` (492) and `PreviewViewService.ts` (499) at the cap; the prettier config says `arrowParens: avoid` while the code uses parens; from QG-6 to QG-8: entry 19 (the inert renderer coverage block) fixed by TQ2 – close or rewrite it; `PreviewChromeBand.css` at 485 against §3's 440, and `previewBridge.test.ts` (496), `previewResizeHold.test.ts` (500), `PreviewSessionFactory.ts` (494) and `PreviewViewService.ts` (493) near the cap; `nameOf` / `codeOf` repeated across several main files; `redactedLogError` rewrites only some error shapes; the shared `MonacoPage.focus()` has no retry; `src/preload/index.ts` coverage |
| `docs/testing/e2e-testing.md` | the new page-object modules – plain functions taking the `ElectronApplication` or the `Page` (`html-preview.native.ts`, `.frames.ts`, `.browser.ts`, `.navigation.ts`) – and the bounds harness; the new specs (frames, drag freeze, open in browser, the two same-tab halves); the browser-launch seam (enabled in `beforeAll` / `afterAll`, armed per test, the default-browser stub); toasts found by `toast-<type>`; `tsc --ignoreConfig` for e2e files (TS5112); real-input clicks scaled by `getZoomFactor()`; the `HtmlPreviewPage` row's `viewBounds` (`x`, `y`, `width`, `height`, `visible`); the zoom e2e needs Erfana in front – macOS blocks `app.focus({ steal: true })` while another app is active; a `.md` can open rendered, so click `view-mode-btn-editor` before Monaco; Cmd+Down, not Cmd+End, reaches a file's end in Monaco on macOS |
| `e2e/fixtures/html-preview-corpus/README.md` | `design-set/`, `frames/` (21 files; the leaf-symlink rule), the setup-created files (WI-25's `extra/page-N.html` and the 25 MB `design-set/huge.html` among them), the updated `links/` rows (Cmd-click, middle-click, `base-self.html`) |
| `src/renderer/src/components/Panels/HtmlPreviewPanel/CLAUDE.md` | tab identity by `params.filePath`, never by id; the page-reset list (failures mirror main's snapshot); the drag freeze; the resize hold as the one exception to the single-hider rule, ended by one `release()`; `EditorAreaSplitPanel` as the only link-router creator; under "Bounds: the first rect is the one that bites", the measure loop in place of the retired pump and `FIRST_RECT_FRAME_BUDGET`, the drop lines and their `PREVIEW_BOUNDS_DROP_REASON` strings (R7 `clipped-away`), with the main-side reason constants in `previewBoundsDropLog.ts`; the guard's rule with four terms (`collapsed`, WI-9); the toolbar's Back, link-mode toggle and Find leading, and its trailing tools (Open in default browser, then Export to PDF); forwarded keys including Back and Forward; the panel-root live region; the placeholder as the keyboard entry into the page (`usePreviewPageEntry`, active-tab gate, `preview:focusPage`) |

The permission-band card, `design/claims.json` (WI-20) and the html-waiting card (WI-11) ship with the code and are counted above.
