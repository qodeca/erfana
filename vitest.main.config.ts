// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
//
// The config for the main-process tests alone: `npm run test:main`, the main
// pass of `npm run test:cov` and the CI Coverage job start here with
// `--config vitest.main.config.ts --project main --project main-perf`. It runs
// the two main-process projects (vitest.main.projects.ts): `main`, then
// `main-perf`, the timing-budget suites, one at a time once `main` is done.
//
// It also holds main's coverage floors. vitest reads `coverage` only from the
// config a run starts with, and collects it from every project of that run, so
// one run of both projects writes one merged report to coverage/main.
import { defineConfig } from 'vitest/config'
import { mainProjects } from './vitest.main.projects'
import { maxWorkers } from './vitest.workers'

export default defineConfig({
  test: {
    // Worker cap (issue #171), as in every config a run can start from.
    maxWorkers,
    projects: mainProjects,
    reporters: 'default',
    // Coverage MUST live under `test.coverage` — a top-level `coverage` key is
    // ignored by vitest, which is where the per-file floors below sat inert until
    // issue #55 F4 moved them here so the thresholds actually fire.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage/main',
      // `scripts/**` is instrumented so the packaging-integrity guards in
      // scripts/fuses.js (issue #43 / #55) carry a real per-file floor (F4).
      // `src/shared/**` is instrumented here because the shared tests run in
      // this project; it includes the #124 browser-launch IPC payload validator
      // (`src/shared/ipc/browser-schema.ts`), which carries a per-file floor below.
      include: ['src/main/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}'],
      // An explicit `include` counts an included file that no test loads, at
      // 0 %, so an untested module lowers the totals instead of vanishing from
      // them (vitest 4 removed `all: true`, which did this before). vitest adds
      // such a file only when the run did not already cover it, so
      // scripts/fuses.js (loaded by scripts/fuses.test.mjs) still reports one
      // row at its real coverage under `--project main`. The checks.yml
      // Coverage job keeps scoping to `--project main` (#55, F4).
      cleanOnRerun: true,
      thresholds: {
        // Project-wide floors: the measured value rounded down, minus one point.
        // Re-measured 2026-10-25 after the vitest 3 → 5 upgrade, whose v8
        // provider maps coverage through the AST instead of v8-to-istanbul and
        // counts more branches: the same code read lines/statements 91.42,
        // functions 93.18, branches 91.37 on vitest 3 and reads lines 90.28,
        // statements 89.19, functions 89.58, branches 82.85 now. A change in
        // how coverage is measured, not a drop in what is tested (owner
        // decision). Raise them as coverage grows; never lower one to make a
        // change pass.
        lines: 89,
        functions: 88,
        branches: 81,
        statements: 88,
        // Trust-chain modules (Phase 4 whisper download verification —
        // minisign-signed manifest, hostname-allowlisted streaming SHA-256
        // downloader, safe zip/tar extraction) carry user-facing security
        // weight. Any regression in their coverage is a real risk — the
        // 90% per-file floor here ratchets the bar above the project-wide
        // 10% aggregate. Fires only under `--coverage` (npm run test:cov);
        // does not affect the regular test:ci run.
        // See: docs/windows/whisper-trust-chain.md, ADRs 0001–0004
        // The two branch floors below 90 were re-measured on vitest 5's
        // AST-based branch count (2026-10-25: secureDownloader 89.13,
        // zipArchive 86.48); every other axis still meets 90.
        'src/main/utils/verifyManifest.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/main/utils/secureDownloader.ts': { lines: 90, functions: 90, branches: 88, statements: 90 },
        'src/main/utils/zipArchive.ts': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'src/main/utils/tarArchive.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // Packaging-integrity guards + Electron fuses (issue #43 / #55). This is
        // a build-time hook, so its afterPack orchestration body and the test-only
        // rename path are not unit-reachable; the floor is set to what the
        // 165-test suite meets today (F4) and should ratchet up if that changes.
        // Branches re-measured on vitest 5's AST-based count (2026-10-25: 77.35).
        'scripts/fuses.js': { lines: 86, functions: 88, branches: 76, statements: 86 },
        // Shared model-id parser + context-window capability registry (#41). It is
        // the SINGLE source of truth behind both the meter's window size and the
        // model label, and a coverage gap here means an unexercised capability row
        // or grammar branch — the exact defect class #41 fixed. Declared as a
        // per-file floor rather than a manually-checked target (design F24 / §12);
        // measured at 100% statements / 98% branches when this entry landed.
        // See: docs/designs/context-meter/41-model-capability-registry.md §9.5
        'src/main/services/claudeStatus/modelId.ts': { lines: 95, functions: 95, branches: 95, statements: 95 },
        // Renderer / child-process crash + window-hang trail (#60). When the
        // renderer dies the window goes blank and no renderer-side boundary can
        // record it — these handlers are the only evidence the next incident
        // gets, so a silent coverage regression here is a diagnostics outage.
        // The module is small and fully unit-reachable; measured at 100% when
        // this entry landed. See: docs/designs/large-projects/design-issue-60.md §2.6, §5
        'src/main/utils/rendererCrashHandlers.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // The identity half of every IPC trust gate (spec 025 commit 1,
        // 025-NFR-001): the set of Erfana window webContents. A gap here is an
        // unexercised path in deciding who may call the privileged IPC, so it is
        // pinned 2 points under the value measured when this entry landed.
        // measured 100/100/100/100
        'src/main/ipc/appWebContents.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser isolation and profile guards (spec 025 commits 4–5,
        // 025-NFR-001, 025-FR-016, ADR 0009, ADR 0012): which webContents skip the
        // baseline, which schemes are privileged, and every check that keeps the
        // profile folder, its marker and its deletes inside the project. Each
        // floor is pinned ~2 points under the value measured when it landed
        // (2026-11-03); never raise one above what the Coverage job measures.
        // measured 100/100/93.33/100
        'src/main/services/browser/browserSessionRegistry.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/browserLocalScheme.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/appSchemes.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 93.4/95.23/83.33/92.52
        'src/main/services/browser/browserProfileGuards.ts': { lines: 91, functions: 93, branches: 81, statements: 90 },
        // measured 97.43/100/93.33/97.72
        'src/main/services/browser/browserProfileMarker.ts': { lines: 95, functions: 98, branches: 91, statements: 95 },
        // The generation record that refuses a replayed signed file (ADR 0009
        // decision 6). measured 100/100/95/100
        'src/main/services/browser/profileGenerations.ts': { lines: 98, functions: 98, branches: 93, statements: 98 },
        // measured 96.05/100/85.71/96.77
        'src/main/services/browser/browserProfileDeletes.ts': { lines: 94, functions: 98, branches: 83, statements: 94 },
        // measured 100/100/100/100
        'src/main/services/browser/BrowserProfileService.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser tabs and their gates (spec 025 commits 6–7, 025-NFR-001,
        // 025-FR-005, 025-FR-019, S2, S7, A4, A16): the per-window-kind channel
        // allow-list, the deny-by-default session policy, the pinned view settings,
        // the navigation sources, the app-address request filter, the tab, the tab
        // service and its IPC handlers. Pinned ~2 points under the value measured
        // when they landed (2026-11-03), never above 98.
        // measured 100/100/100/100
        'src/main/ipc/channelAllowList.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/94.73/94.44/98.66 (lines/functions/branches/statements)
        'src/main/ipc/browser-tab-handlers.ts': { lines: 98, functions: 92, branches: 92, statements: 96 },
        // measured 100/100/100/100
        'src/main/services/browser/browserSessionPolicy.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/browserWebPreferences.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/browserNavigationPolicy.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/browserAppRequestFilter.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 99.32/100/97.95/98.85
        'src/main/services/browser/BrowserTab.ts': { lines: 97, functions: 98, branches: 95, statements: 96 },
        // measured 96.87/100/92.5/96.05
        'src/main/services/browser/BrowserTabService.ts': { lines: 94, functions: 98, branches: 90, statements: 94 },
        // Built-in browser, main side (spec 025, commit 18): the keyring notices as strip
        // rows, the one place tab events are parsed and sent, and the tab's input wiring.
        // measured 100/100/100/100 each
        'src/main/services/browser/site/keyringStrip.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/main/services/browser/tabEventSend.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/main/services/browser/input/tabInputFactory.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser local files (spec 025 commit 11, 025-FR-005 rule 1,
        // ADR 0012 option 4 – the per-folder loopback server): the request path,
        // the real-path confinement, the fetch-metadata policy, the server and
        // the registry. Pinned ~2 points under the value measured when they
        // landed (2026-11-03), never above 98.
        // measured 100/100/100/100
        'src/main/services/browser/local/localRequestPath.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/75/89.47/93.1
        'src/main/services/browser/local/localConfinedFile.ts': { lines: 98, functions: 73, branches: 87, statements: 91 },
        // measured 100/100/100/100
        'src/main/services/browser/local/localResponsePolicy.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 96.42/100/87.5/95.58
        'src/main/services/browser/local/LocalFolderServer.ts': { lines: 94, functions: 98, branches: 85, statements: 93 },
        // measured 100/100/93.97/100
        'src/main/services/browser/local/LocalFileServers.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // Built-in browser page features (spec 025 commit 12h, 025-FR-008,
        // 025-FR-012, 025-FR-023, 025-FR-056, 025-FR-059, 025-FR-063): load
        // errors, crash and hang notices, find, zoom per site, width presets
        // and the clipping parent, Clear and Forget, history, terminal
        // addresses, and their channels. Pinned ~2 points under the value
        // measured when they landed (2026-11-03), never above 98.
        // measured 97.93/95.45/89.13/97.45
        'src/main/services/browser/page/BrowserPages.ts': { lines: 95, functions: 93, branches: 87, statements: 95 },
        // measured 100/100/91.07/98.3
        'src/main/services/browser/page/BrowserTabPage.ts': { lines: 98, functions: 98, branches: 89, statements: 96 },
        // measured 100/100/96.87/100
        'src/main/services/browser/page/TabViewFrame.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/page/browserClearData.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/page/historyStore.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/83.33/94.44/96.42
        'src/main/services/browser/page/hungNotice.ts': { lines: 98, functions: 81, branches: 92, statements: 94 },
        // measured 90.9/75/75/88.46
        'src/main/services/browser/page/plainProfileFile.ts': { lines: 88, functions: 73, branches: 73, statements: 86 },
        // measured 100/100/100/100
        'src/main/services/browser/page/tabPageState.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/85.71/97.05
        'src/main/services/browser/page/terminalLocalAddressScan.ts': { lines: 98, functions: 98, branches: 83, statements: 95 },
        // measured 100/100/100/100
        'src/main/services/browser/page/widthPresetLayout.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/87.5/97.67
        'src/main/services/browser/page/zoomStore.ts': { lines: 98, functions: 98, branches: 85, statements: 95 },
        // measured 96.29/93.75/76.92/96.92
        'src/main/ipc/browserTab/page-handlers.ts': { lines: 94, functions: 91, branches: 74, statements: 94 },
        // Built-in browser window open, popups, leave-page prompt and page
        // right-click menu (spec 025 commits 12e–g, 025-FR-011, 025-FR-057,
        // 025-FR-058): the popup blocker and its row, pop-up exceptions, the
        // tab-or-window decision, the popup window's size, title and
        // navigation rules, the leave-page prompt and its guard, and the menu
        // that takes one offered action. A gap here is an untested way for a
        // page to open a window or act through the menu. Pinned ~2 points
        // under the value measured when they landed (2026-11-03, on their own
        // suites), never above 98.
        // measured 100/100/100/100
        'src/main/services/browser/popups/TabWindowOpen.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 96.87/94.11/100/95.23
        'src/main/services/browser/popups/popupActivation.ts': { lines: 94, functions: 92, branches: 98, statements: 93 },
        // measured 100/100/100/100
        'src/main/services/browser/popups/popupBlockedRow.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/popups/popupExceptionStore.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/93.93/100
        'src/main/services/browser/popups/windowFeatures.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 98.66/100/95.83/97.8
        'src/main/services/browser/popups/BrowserPopupWindow.ts': { lines: 96, functions: 98, branches: 93, statements: 95 },
        // measured 100/100/83.33/100
        'src/main/services/browser/popups/BrowserPopups.ts': { lines: 98, functions: 98, branches: 81, statements: 98 },
        // measured 100/100/75/100
        'src/main/services/browser/popups/popupWindowElectron.ts': { lines: 98, functions: 98, branches: 73, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/dialogs/guardedStripRow.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/93.75/100
        'src/main/services/browser/dialogs/leavePage.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/dialogs/pageDialogs.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/94.11/100/96.96
        'src/main/services/browser/dialogs/TabPageExtras.ts': { lines: 98, functions: 92, branches: 98, statements: 94 },
        // measured 100/100/100/100
        'src/main/services/browser/contextMenu/contextMenuItems.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/93.54/100
        'src/main/services/browser/contextMenu/TabContextMenu.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/100/100
        'src/main/ipc/browserTab/popup-handlers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser pick and send, main side (spec 025 commits 14–15,
        // 025-FR-025 to 025-FR-039, 025-FR-046, 025-FR-053, 025-FR-061): the hit
        // test through frames, the highlight, the element chain and its facts,
        // the freeze, the capture files and their store and expiry, the shell
        // guard and the pinned page functions. A gap here is an untested way for
        // a page to reach the capture file outside its fenced block, or for a
        // capture to be written where it should not. Pinned ~2 points under the
        // value measured when they landed (2026-11-03, on their own suites),
        // never above 98.
        // measured 100/100/96.42/100
        'src/main/services/browser/capture/BrowserCapture.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/96.87/100
        'src/main/services/browser/capture/BrowserTargetStatus.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 97.7/95.45/73.77/94.44
        'src/main/services/browser/capture/CaptureStore.ts': { lines: 95, functions: 93, branches: 71, statements: 92 },
        // measured 100/100/100/100
        'src/main/services/browser/capture/accentColour.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/83.72/95.06
        'src/main/services/browser/capture/captureFacts.ts': { lines: 98, functions: 98, branches: 81, statements: 93 },
        // measured 100/100/100/100
        'src/main/services/browser/capture/captureImage.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/88.63/100
        'src/main/services/browser/capture/captureRender.ts': { lines: 98, functions: 98, branches: 86, statements: 98 },
        // measured 100/100/98.78/100
        'src/main/services/browser/capture/sourceHints.ts': { lines: 98, functions: 98, branches: 96, statements: 98 },
        // The terminal foreground the shell guard reads (025-FR-061; design
        // § 9.4, Q8) and the Windows process snapshot it shares with the
        // Claude-status detector. A gap here is a bare shell read as an agent,
        // which types a prompt into the shell. Measured 2026-11-03 on their own
        // suites; processSnapshot's missing function is the real `execFile`
        // default, which a unit test must not spawn.
        // measured 100/100/94.44/100
        'src/main/services/terminalForegroundRead.ts': { lines: 98, functions: 98, branches: 92, statements: 98 },
        // measured 98.3/84.61/95.83/97.18
        'src/main/services/process/processSnapshot.ts': { lines: 96, functions: 82, branches: 93, statements: 95 },
        // measured 97.5/96.29/94.33/98.01
        'src/main/services/browser/pick/BrowserPicks.ts': { lines: 95, functions: 94, branches: 92, statements: 96 },
        // measured 96.88/87.93/80.57/92.02
        'src/main/services/browser/pick/BrowserTabPick.ts': { lines: 94, functions: 85, branches: 78, statements: 90 },
        // measured 100/100/88.88/100
        'src/main/services/browser/pick/pickAppSetup.ts': { lines: 98, functions: 98, branches: 86, statements: 98 },
        // measured 100/92.85/100/98
        'src/main/services/browser/pick/pickCaptureReads.ts': { lines: 98, functions: 90, branches: 98, statements: 96 },
        // measured 100/100/90.69/100
        'src/main/services/browser/pick/pickCdp.ts': { lines: 98, functions: 98, branches: 88, statements: 98 },
        // measured 98.48/100/83.58/96.25
        'src/main/services/browser/pick/pickElement.ts': { lines: 96, functions: 98, branches: 81, statements: 94 },
        // measured 100/100/91.42/98.85
        'src/main/services/browser/pick/pickFrames.ts': { lines: 98, functions: 98, branches: 89, statements: 96 },
        // measured 100/93.33/100/98
        'src/main/services/browser/pick/pickFreeze.ts': { lines: 98, functions: 91, branches: 98, statements: 96 },
        // measured 100/100/100/100
        'src/main/services/browser/pick/pickGeometry.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/88.88/91.66/94.11
        'src/main/services/browser/pick/pickHighlight.ts': { lines: 98, functions: 86, branches: 89, statements: 92 },
        // measured 98.03/100/87.87/98.43
        'src/main/services/browser/pick/pickHitTest.ts': { lines: 96, functions: 98, branches: 85, statements: 96 },
        // measured 100/100/100/100
        'src/main/services/browser/pick/pickMenu.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/pick/pickModeSwitch.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/pick/pickSupport.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/cdp/cdpPickFunctions.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/ipc/browserTab/pick-handlers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/testHooks/browserPickHook.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser CDP session (spec 025 commit 9, 025-NFR-001 bullet 2,
        // 025-FR-038, 025-FR-056, S6, S23): the only sendCommand caller, the
        // method allow-list and its pinned parameters, the flood budget, the log
        // buffer and the hang probe. A coverage drop in the allow-list is a hole
        // in the page isolation. Each floor is pinned ~2 points under the value
        // measured when it landed (2026-11-03, on the cdp suites alone).
        // measured 99.45/100/93.75/97.85
        'src/main/services/browser/cdp/BrowserCdpSession.ts': { lines: 97, functions: 98, branches: 91, statements: 95 },
        // measured 100/100/95.65/98.91
        'src/main/services/browser/cdp/cdpAllowList.ts': { lines: 98, functions: 98, branches: 93, statements: 96 },
        // measured 100/100/100/100
        'src/main/services/browser/cdp/cdpPinned.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/cdp/cdpFloodBudget.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/cdp/browserLogBuffer.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/97.1/100
        'src/main/services/browser/cdp/cdpLogCollector.ts': { lines: 98, functions: 98, branches: 95, statements: 98 },
        // measured 100/100/95.12/98.88
        'src/main/services/browser/cdp/browserHangProbe.ts': { lines: 98, functions: 98, branches: 93, statements: 96 },
        // Built-in browser site permissions and downloads (spec 025 commits
        // 12a–b, 025-FR-019, 025-FR-020, S-18, S-26): the strip's queue, input
        // guard and gap, the per-pair saved decisions and their signed file,
        // the per-tab broker, the session-to-tab routing, the download name
        // and the save flow that deletes partial files. A gap here is an
        // untested way for a page to get a permission or a file through.
        // Pinned ~2 points under the value measured when they landed
        // (2026-11-03), never above 98.
        // measured 100/100/92.06/99.09
        'src/main/services/browser/permissions/tabStrip.ts': { lines: 98, functions: 98, branches: 90, statements: 97 },
        // measured 100/100/100/100
        'src/main/services/browser/permissions/sitePermissions.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/permissions/tabPermissions.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 97.36/93.75/90/94.18
        'src/main/services/browser/permissions/permissionStore.ts': { lines: 95, functions: 91, branches: 88, statements: 92 },
        // measured 97.16/90.9/93.25/95.9
        'src/main/services/browser/permissions/BrowserSite.ts': { lines: 95, functions: 88, branches: 91, statements: 93 },
        // measured 100/100/78.57/94.73
        'src/main/services/browser/downloads/downloadFileName.ts': { lines: 98, functions: 98, branches: 76, statements: 92 },
        // measured 97.67/80/88.13/96
        'src/main/services/browser/downloads/BrowserDownloads.ts': { lines: 95, functions: 78, branches: 86, statements: 94 },
        // Built-in browser certificates, sign-in and private network (spec 025
        // commits 12c–d, 025-FR-021, 025-FR-022, S-16, S-26): the warning page
        // and its guard, the 7-day exceptions, saved sign-ins encrypted and
        // signed, the auto-send rules, the address classifier and the
        // public-to-local refusal. A gap here is an untested way to trust a
        // forged certificate or send a password where it should not go.
        // Pinned ~2 points under the value measured when they landed
        // (2026-11-03), never above 98.
        // measured 100/100/98.7/100
        'src/main/services/browser/site/addressClass.ts': { lines: 98, functions: 98, branches: 96, statements: 98 },
        // measured 100/100/97.67/97.67
        'src/main/services/browser/site/browserAuth.ts': { lines: 98, functions: 98, branches: 95, statements: 95 },
        // measured 98.7/100/97.95/97.72
        'src/main/services/browser/site/browserCertificates.ts': { lines: 96, functions: 98, branches: 95, statements: 95 },
        // measured 100/100/96.55/100
        'src/main/services/browser/site/browserPrivateNetwork.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/site/certificateStore.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/site/credentialStore.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 94.44/87.5/87.5/90.24
        'src/main/services/browser/site/signedProfileFile.ts': { lines: 92, functions: 85, branches: 85, statements: 88 },
        // measured 90.9/79.16/92.85/92
        'src/main/services/browser/site/siteSecurity.ts': { lines: 88, functions: 77, branches: 90, statements: 90 },
        // measured 100/100/100/100
        'src/main/services/browser/site/siteRequestHooks.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser key and mouse routing (spec 025 commit 13,
        // 025-FR-014, 025-FR-047 to 025-FR-052, ADR 0011 decisions 11–16):
        // what reaches a page, what Erfana takes, the click guard and the
        // first-click rule. A gap here is a key or click that leaks to the
        // page or an app shortcut that fires from it. Pinned ~2 points under
        // the value measured when they landed (2026-11-03), never above 98.
        // measured 100/100/100/100
        'src/main/services/browser/input/browserKeyRouter.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/input/browserMouseRouter.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/input/appWindowBrowserKeys.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/input/macAppRoles.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browser/input/BrowserTabInput.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Multi-page HTML preview (#124). These modules decide what the preview
        // BrowserView is allowed to load and where it may navigate — frame/scheme
        // gating, request filtering, URL normalisation, page and tab scope — plus
        // the external-browser launch path, which hands a URL to the OS. A silent
        // coverage regression here is a security regression, so each floor is
        // pinned ~2 points under the value measured when this entry landed
        // (see the QG-8 review, finding TQ2). Never raise a floor above what the
        // Coverage job actually measures.
        // measured 100/100/96.55/100
        'src/main/services/preview/previewFrameGuard.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 96.99/100/93.75/96.99
        'src/main/services/preview/PreviewRequestFilter.ts': { lines: 94, functions: 98, branches: 91, statements: 94 },
        // measured 100/100/100/100
        'src/main/services/preview/previewUrl.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewPageScope.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewFrameSources.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewPageNavigator.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/96/100
        'src/main/services/preview/previewViewNavigation.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewTabHistory.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewStillFrameFreshness.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browserLaunch/browserLauncher.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/browserLaunch/BrowserLaunchService.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/ipc/browser-schema.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Built-in browser shared modules (spec 025 commit 3, 025-NFR-001,
        // 025-FR-014, 025-FR-036, S9, S10, S-15): the IPC payload gate, the
        // key routing that decides what reaches a page, the context file's
        // untrusted fence, and every page string or origin Erfana draws. Each
        // floor is pinned ~2 points under the value measured when it landed
        // (2026-11-03, macOS, on the shared browser suites alone).
        // measured 100/100/100/100
        'src/shared/ipc/browser-tab-schema.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/ipc/browser-tab-channels.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100 (certificate page and sign-in row parts, commits 12c–d)
        'src/shared/ipc/browser-tab-site-schema.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/98.11/100
        'src/shared/browser/contextFile.ts': { lines: 98, functions: 98, branches: 96, statements: 98 },
        // measured 100/100/100/100
        'src/shared/browser/pageText.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/90.9/100
        'src/shared/browser/textCut.ts': { lines: 98, functions: 98, branches: 88, statements: 98 },
        // measured 100/100/100/100
        'src/shared/browser/elementLabel.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 98.3/100/96.61/98.57
        'src/shared/browser/originFormat.ts': { lines: 96, functions: 98, branches: 94, statements: 96 },
        // measured 100/100/91.11/96.87
        'src/shared/browser/idnDisplay.ts': { lines: 98, functions: 98, branches: 89, statements: 94 },
        // measured 100/100/86.88/94.87 (the uncovered branches are overflow guards)
        'src/shared/browser/punycode.ts': { lines: 98, functions: 98, branches: 84, statements: 92 },
        // measured 100/100/94.73/100
        'src/shared/browser/publicSuffix.ts': { lines: 98, functions: 98, branches: 92, statements: 98 },
        // measured 100/100/98.63/98.3
        'src/shared/browser/browserKeys.ts': { lines: 98, functions: 98, branches: 96, statements: 96 },
        // measured 100/100/94.44/99.45
        'src/shared/browser/routingState.ts': { lines: 98, functions: 98, branches: 92, statements: 97 },
        // Offline link and wording check (#138). It reads contributor-controlled
        // Markdown in the local gate, and its path walk is what keeps a link from
        // probing or reading files outside the repository, so it carries the
        // trust-chain floor (spec: 90). measured 99.52/100/94.65/99.52.
        // See: docs/features/138-user-guide.md § 3.4
        'scripts/check-links.mjs': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // Claim-ledger drift check (docs/user-guide/claims.json). It reads
        // contributor-controlled paths, and safeResolve is what keeps a ledger
        // entry from reading outside the repository, so it carries the same
        // floor as check-links. measured 98.68/100/98.5/98.36.
        'scripts/check-claims.mjs': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // HTML Preview comments – format core (docs/designs/comments/html-preview-comments.md
        // § 12.5). These modules write into the user's own .html files: the
        // serializer, escaping, splice and its verification decide whether a
        // comment can turn into live markup or corrupt a byte outside its block
        // (threat S13, decision 24). Each floor is pinned 2 points under the value
        // measured when this entry landed (2026-10-26); never raise one above
        // what the Coverage job measures.
        // measured 100/100/100/100
        'src/shared/comments/format.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/parse.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/splice.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/anchor.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Spec 024 commit 8 split the three above into a kind-agnostic base and
        // the HTML entry; the split-off modules keep the same floor (measured
        // 100/100/100/100 each on 2026-10-30, Windows, comment suites).
        'src/shared/comments/blocks.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/splice.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/reattach.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/cutText.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // The file-kind seam and the HTML kind (spec 024 § 3; new in commit 8,
        // measured 100/100/100/100 on 2026-10-30, Windows).
        'src/shared/comments/fileKind.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/htmlKind.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Spec 024 format additions (commit 11, C1, C-01, C-02): `anchor.sel`, the
        // agent-note-line encoder and hints, and the per-kind agent notes
        // (measured 100/100/100/100 each on 2026-10-30, Windows, comment suites).
        'src/shared/comments/anchorSel.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/noteLines.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/agentNotes.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Spec 024 overlayCore (ADR 0006): pure rules shared by both overlays; measured 100/100/100/100.
        'src/shared/comments/overlayCore/pinLayout.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/overlayCore/modeState.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/overlayCore/gesture.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // The re-attach tables and quote readers split out of anchor.ts
        // (measured 100/100/100/100 on 2026-10-26, Windows).
        'src/shared/comments/anchorLookup.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'src/shared/comments/quoteText.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // The position-corroboration rule split out of anchor.ts (§19 Rev 4,
        // measured 100/100/100/100 on 2026-10-26, Windows).
        'src/shared/comments/anchorEvidence.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/comments/conflictMarkers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/comments/encoding.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/instrument.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/htmlIndex.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/htmlComments/frameworkMarkers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/comments/thread.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // HTML Preview comments – the writer (design § 7.6, § 12.5: at least
        // 92/92/88/92). The only page-driven write into the user's files: path
        // confinement, link refusal, the re-read/re-hash compare-and-swap and the
        // strict no-fallback write. Pinned 2 points under the value measured when
        // this entry landed (2026-10-26, Windows; the only branch it missed, the
        // POSIX `ELOOP` refusal, runs on Linux instead of the Windows-only
        // followed-symlink check).
        // measured 100/100/98.63/99.07
        'src/main/utils/atomicWriteBytesStrict.ts': { lines: 98, functions: 98, branches: 96, statements: 97 },
        // measured 100/100/100/100
        'src/main/services/comments/CommentWriter.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/commentFileAccess.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Which extensions take comments, feeding the confinement above (spec 024
        // § 3, C18; new in commit 8, measured 100/100/100/100 on 2026-10-30).
        'src/main/services/comments/commentFileKinds.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/commentFileLock.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/commentRefusals.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // HTML Preview comments – instrumentation (design § 4.2, § 6, § 12.5: at
        // least 92/92/88/92). These modules decide which served document gets
        // element tokens and which element a token names, and the confinement
        // core returns the real path the comments key on – including the exact
        // realpath containment of security review F1. Pinned about 2 points
        // under the value measured when this entry landed (2026-10-26, Windows,
        // on the preview and comments suites alone; the full run covers more).
        // measured 98.61/100/97.29/98.78
        'src/main/services/preview/comments/commentParseCore.ts': { lines: 96, functions: 98, branches: 95, statements: 96 },
        // measured 100/100/100/100
        'src/main/services/comments/commentParseProtocol.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/commentParseWorker.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/95.23/95.91/97.19
        'src/main/services/comments/CommentParseWorkerAdapter.ts': { lines: 98, functions: 93, branches: 93, statements: 95 },
        // The parse worker split into a shared runner plus per-kind jobs (spec 024
        // architecture note 001 § 8 C22): the entry that registers every kind's
        // job table, the HTML kind's table, and its typed view of the client
        // (2026-10-30, Windows, on the comment and preview suites).
        // measured 100/100/100/100
        'src/main/services/workers/comment-parse.worker.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/htmlCommentJobs.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/htmlCommentParseClient.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/94.44/100
        'src/main/services/preview/comments/ElementTokenTable.ts': { lines: 98, functions: 98, branches: 92, statements: 98 },
        // measured 100/100/93.75/100
        'src/main/services/preview/comments/commentInstrumentation.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentE2eHook.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // HTML Preview comments – service and IPC (P5; design § 8, § 12.5: at
        // least 92/92/88/92, the payload schema at least 98). These modules take
        // the page's picks and the renderer's requests: frame → file
        // confinement, main-minted keys bound to one view, the sender's own
        // window, the schema on every request and answer, and what reaches the
        // logs. Pinned 2 points under the value measured when this entry landed
        // (2026-10-26, Windows, on the preview and IPC suites alone), never under
        // the design minimum – PreviewCommentService and commentDraftBuilder
        // branches sit on that minimum, 88.
        // measured 100/100/100/100
        'src/shared/ipc/preview-comment-schema.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/shared/ipc/preview-comment-channels.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/ipc/preview/comment-handlers.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/ipc/preview/commentEmit.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/previewLiveComments.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 97.16/94.64/88.88/96.17
        'src/main/services/preview/comments/PreviewCommentService.ts': { lines: 95, functions: 92, branches: 88, statements: 94 },
        // measured 100/100/88.57/95
        'src/main/services/preview/comments/commentDraftBuilder.ts': { lines: 98, functions: 98, branches: 88, statements: 93 },
        // measured 100/100/94.11/98
        'src/main/services/preview/comments/commentDraftOpener.ts': { lines: 98, functions: 98, branches: 92, statements: 96 },
        // measured 100/100/92/100
        'src/main/services/preview/comments/commentFrameBroadcaster.ts': { lines: 98, functions: 98, branches: 90, statements: 98 },
        // measured 100/100/97.22/100
        'src/main/services/preview/comments/commentFrames.ts': { lines: 98, functions: 98, branches: 95, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/commentKeyStore.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/93.75/100
        'src/main/services/comments/commentListBuilder.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentMenuPoint.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentOverlayTheme.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/96.66/100
        'src/main/services/preview/comments/commentPanelStatus.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/94.44/99
        'src/main/services/preview/comments/commentPickHandler.ts': { lines: 98, functions: 98, branches: 92, statements: 97 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentPins.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/91.66/98.87
        'src/main/services/preview/comments/commentReloadCoordinator.ts': { lines: 98, functions: 98, branches: 89, statements: 96 },
        // measured 100/100/95.45/100
        'src/main/services/comments/commentSaveFlow.ts': { lines: 98, functions: 98, branches: 93, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentScripts.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentServiceEvents.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/commentServiceTypes.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/95.23/96.07
        'src/main/services/preview/comments/commentStillCapture.ts': { lines: 98, functions: 98, branches: 93, statements: 94 },
        // measured 100/100/100/100
        'src/main/services/comments/commentUnsavedSources.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/comments/frameFileMap.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // The file jobs the parse worker runs for a pick, a pin, the list and a
        // write (§19 R3-12), and the identity rule the writer and the settings
        // share – same pinning (2026-10-26, Windows, on the comment suites alone).
        // measured 100/100/100/100
        'src/main/services/comments/commentFileJobs.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/commentJobDocs.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/90.27/95.38
        'src/main/services/preview/comments/commentDraftCore.ts': { lines: 98, functions: 98, branches: 88, statements: 93 },
        // measured 100/100/92.85/100
        'src/main/services/comments/commentListCore.ts': { lines: 98, functions: 98, branches: 90, statements: 98 },
        // measured 100/100/98.24/98.71
        'src/main/services/comments/commentWriteCore.ts': { lines: 98, functions: 98, branches: 96, statements: 96 },
        // measured 100/100/100/100
        'src/shared/comments/identity.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // Spec 024 – the Markdown comment kind (024-FR-003, 024-NFR-008), measured on the
        // markdownComments and comments/markdown suites alone (lines/functions/branches/statements):
        // measured 97.95/100/87.3/96.77
        'src/shared/markdownComments/markdownKind.ts': { lines: 97, functions: 98, branches: 86, statements: 96 },
        // measured 100/100/100/100
        'src/shared/markdownComments/markdownLimits.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/92.15/98.43
        'src/shared/markdownComments/mdAnchor.ts': { lines: 98, functions: 98, branches: 91, statements: 98 },
        // measured 100/100/97.36/100
        'src/shared/markdownComments/mdCommentScan.ts': { lines: 98, functions: 98, branches: 96, statements: 98 },
        // measured 100/100/92.85/97.72
        'src/shared/markdownComments/mdHast.ts': { lines: 98, functions: 98, branches: 92, statements: 97 },
        // measured 100/92.3/91.93/98.07
        'src/shared/markdownComments/mdHints.ts': { lines: 98, functions: 92, branches: 91, statements: 98 },
        // measured 100/100/90.62/100
        'src/shared/markdownComments/mdIndex.ts': { lines: 98, functions: 98, branches: 90, statements: 98 },
        // measured 100/100/95.08/100
        'src/shared/markdownComments/mdLocate.ts': { lines: 98, functions: 98, branches: 94, statements: 98 },
        // measured 100/100/96.15/100
        'src/shared/markdownComments/mdRender.ts': { lines: 98, functions: 98, branches: 96, statements: 98 },
        // measured 98.07/100/92.64/94.93
        'src/shared/markdownComments/mdSlots.ts': { lines: 98, functions: 98, branches: 92, statements: 94 },
        // measured 100/100/100/100
        'src/shared/markdownComments/mdSource.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/comments/markdown/markdownCommentJobs.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 100/100/100/100
        'src/main/services/preview/PreviewRequestKindLedger.ts': { lines: 98, functions: 98, branches: 98, statements: 98 },
        // measured 93.9/100/94.73/93.9
        'src/main/services/preview/previewPathResolve.ts': { lines: 91, functions: 98, branches: 92, statements: 91 },
      },
      exclude: [
        'node_modules/**',
        'out/**',
        '**/out/**',
        '**/dist/**',
        '**/release/**',
        '**/coverage/**',
        '**/temp/**',
        '**/*.test.*',
        '**/__tests__/**',
        '**/__test__/**',
        '**/__test-helpers__/**',
        '**/__fixtures__/**',
        // Spec 024 shared test suites and test-only file kinds (overlay.suite.ts, the .txt preview).
        '**/__conformance__/**',
        'vitest.*.ts',
        'electron.vite.config.ts',
        // Type-only: declarations and interface modules compile to nothing. A
        // type-only `types.ts` elsewhere reports 0 of 0 lines and moves no
        // total; it is not excluded by name, because some `types.ts` files
        // hold runtime code (src/main/services/import/types.ts).
        '**/*.d.ts',
        '**/*.types.ts',
        'src/main/interfaces/**',
        // Script entry points: each runs its command as soon as it is loaded, so
        // importing one would run it. They run as their own process (an npm
        // script, or a child process in their test). Scripts that export their
        // logic stay counted, tested or not – the build hooks included.
        'scripts/add-spdx-headers.mjs',
        'scripts/check-spdx-headers.mjs',
        'scripts/design-sync.mjs',
        'scripts/prebuild.mjs',
        'scripts/run-mcp.js',
        'scripts/test-cov.mjs',
        // Imported natively by eslint.config.mjs, so every test that runs ESLint
        // in-process (eslint-*.test.mjs) loads a second copy outside vitest's
        // transform, and v8 maps that copy onto the transformed source: the
        // report shows each function twice, half of them unrun. Its behaviour
        // is tested in scripts/check-max-lines.test.mjs.
        'scripts/lib/max-lines-baseline.mjs'
      ],
    },
  },
})
