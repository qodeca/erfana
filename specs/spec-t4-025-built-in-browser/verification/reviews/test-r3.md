# Test review – spec 025 (round 3)

Reviewer: `erfana:test-reviewer` (independent agent, not an author), 2026-11-05, against `898c9c34` (round 3).


Score: 8/10
Counts: critical 0, high 0, medium 1, low 3

I had no shell in this session, only file read, grep and glob. I did not run `node scripts/check-spec025-trace.mjs`, vitest, or `git diff`, so I cannot cite trace output, coverage output or the diff since `8fd4ed87`. Every claim below comes from reading files at the checked-out tree.

## Findings

### [medium] The trace script counts a `test.fail(...)` title as covered, and one test title hides that it covers only part of its AC
- Location: `scripts/check-spec025-trace.mjs:29` and `e2e/browser-pick-freeze.e2e.ts:197-198`.
- The title regex is `\b(?:it|test)(?:\.(?!skip|todo|fixme)\w+)*\(`. It excludes `skip`, `todo` and `fixme`, but `test.fail(` still matches. An expected-failure marker therefore turns an AC green in the trace.
- Today there are no `test.fail` or `.only` markers in the browser e2e or unit files. My grep of `e2e/browser-*.ts`, `e2e/utils/files.ts` and the browser unit tests found only `test.skip` with a stated platform or keyring reason. The gap is not hit now, but the DoD says `test.fail` must only mark owner-pending items, and nothing enforces that.
- Related: `025-AC-067` is covered by one e2e test titled `the capture is taken at the pick (025-AC-067)` (`e2e/browser-pick-freeze.e2e.ts:197`). That test covers the click-pick step. The two-tab step is not driven, and the owner has accepted that. The trace shows AC-067 as fully covered in e2e, even though the title and trace say nothing about the missing step.
- Fix: make the regex reject `.fail`, or print a count of `.fail` markers. Put "(two-tab step: manual)" in the AC-067 test title or its manual-evidence row.

### [low] The band e2e check compares the native views against what main says it drew
- Location: `e2e/browser-pick-mode.e2e.ts:362`.
- `nativeIsWhatMainDrew` compares the view rects to `band.hook.strips`, which main supplies, so on its own it proves nothing. It is backed by an independent check. The expected ink and paper rings are computed from the page element's own box at lines 333-336 and 376-377. Lines 366-367 check that no strip reaches into the interior and that the interior is the page background.
- A wrong geometry would still fail. The residual gap is that it reads native view rects, not real screen pixels. The owner already tracks the Retina case as queue item 27.
- Fix: none needed. Optionally rename `nativeIsWhatMainDrew` to say it only checks the hook-to-native handoff.

### [low] `pickBandWindow.test.ts` fakes the whole `electron` module, so the focus and click-through guarantees rest on the option values
- Location: `src/main/services/browser/pick/pickBandWindow.test.ts:8-70`, assertions at lines 118-131.
- The fake `show()` and `focus()` throw, which guards against regressions in the call path. `focusable: false` and `setIgnoreMouseEvents(true)` are asserted only as arguments. A wrong real-Electron behaviour would be missed.
- The e2e lane covers that part, so this is acceptable.
- Fix: none needed. Make sure the e2e covers the pointer passing through the band, if it does not already. I did not look for it.

### [low] The `sendToTerminalId` tests use margins tied to the constants' values
- Location: `src/renderer/src/stores/useTerminalStore.sendToTerminalId.test.ts:137`.
- `ENTER_NO_OUTPUT_DELAY_MS - 100` and the fixed `50` ms advance assume the delay is more than 100 ms. They use fake timers, so they are deterministic and not flaky. They would fail confusingly if the constant were tuned below 100 ms.
- Fix: derive the margins from the constants, for example `Math.floor(ENTER_NO_OUT_DELAY_MS / 2)`.

## What is strong

- **Band unit tests (`pickBand.test.ts`)** check pixel-level behaviour, not only counts. Ink/paper walks run on all four edges and the corners (lines 17-36). They also cover fractional rounding, clipping, 0/1/2 DIP elements, a draw that throws, a hide that throws, and dispose being safe to repeat. `onDrawn` is checked to fire only after a successful draw (lines 232-256).
- **`pickBandWindow.test.ts`** asserts the never-focus guarantee: the fake `show()` and `focus()` throw (lines 52-57). It also asserts that no mouse event is set after destroy (line 175) and that all parent listeners are removed (lines 163 and 170).
- **`captureFacts.test.ts:73-87`** replaced the `test.fail` for AC-035 with two real tests. One asserts `ignorePointerEventsNone: true` is passed to `DOM.getNodeForLocation`. The other asserts that a click-through element on top of the picked one yields `coveredBy` null. The e2e twin at `e2e/browser-pick-frames.e2e.ts:295` also exists.
- **`sourceMapLocation.test.ts`** covers hostile cases: other-origin scripts and maps, `file:` maps, oversize scripts and maps, a 500-code-unit path cap, malformed or version-mismatch maps, and abort on a hung fetch (lines 151-205).
- **`LocalFileServers.test.ts:284-344`** covers the pending-load rules with both allow and deny: sub-resources are let through, a top-level load is not let through on the pending state alone, and a fragment is ignored when matching the failure.
- **`siteSecurity.test.ts`** now uses `vi.waitFor` (lines 82-130), which is condition-based and has no fixed sleeps.
- **No `waitForTimeout` and no unexplained skips.** My grep across the browser e2e and unit tests found none. Every `skip` states its reason: POSIX shell, Windows read-only hook, keyring, macOS `chflags`.
- **The `timing` project** (`playwright.config.ts:69-83`) isolates the P95 gates with `workers: 1`, `fullyParallel: false` and `dependencies: ['electron']`. The budgets are unchanged, and the config explains why.
- **`readFileIfPresent` (`e2e/utils/files.ts:17-24`)** swallows only `ENOENT` and rethrows everything else. It does no polling itself, so any polling lives in callers. I did not verify those callers.
- **The renderer coverage config carries per-file floors for the browser files** (`vitest.renderer.config.ts:126-190`), mostly at 98.

## Owner-pending items seen (not scored)

From `.local/autopilot.md`, "Owner queue" (the browser-spec items are the same as in the round-2 list):
- Items 2, 5, 17, 19, 31, 32: screen approval and the merge.
- Item 27: the live pick outline on a Retina screen needs a manual look.
- Item 28: AC-045 evidence, after release.
- Item 52: the final macOS `npm run test:e2e` run on `898c9c34` plus the band bench (`ERFANA_E2E_BENCH=1 … --project=bench e2e/browser-pick-highlight.bench.ts`). This blocks goal check 5 and the AC-049 record.
- Item 49: `conptyHostReaper.test.ts:191` writes a Windows-style file name to the repo root on macOS. It is not browser code. I did not check it.
- Item 50: Markdown view modes use `aria-pressed` toggle buttons instead of radio buttons.

## Score rationale

- **Anchor reached:** 8 ("no critical or high; medium few, local, clear fix"). I found no critical or high finding in the files I read.
- **Why not higher:** one medium finding (a trace gap that could let a `test.fail` pass as coverage, plus the AC-067 partial title) and three lows. I also could not run the trace script or the coverage config check. I did not confirm that no floor was lowered.
- **Not verified:** the output of `node scripts/check-spec025-trace.mjs`, any vitest run, and the `git diff --stat 8fd4ed87..898c9c34`. I did not read `FileCommentService`, `fileCommentEchoes`, `pickHover` or `browser-capture-content.e2e.ts` in detail. I also did not read `browser-media-in-use.e2e.ts`, `browser-tab-chrome.e2e.ts` (`needsOsFocus`) or `browser-capture-react.e2e.ts`. The `pickHitTest` topmost tests and the `useTerminalStore.sendToTerminalId` suite are covered only in part (AC-035 and the first 180 lines).
