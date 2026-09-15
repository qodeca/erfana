# Windows validation report – everything on `develop` since v0.19.0

> **Point-in-time document.** Written on the date below and not maintained afterwards. Commit SHAs, test counts and CI states were true on that date and go stale immediately.

**Date**: 2026-09-15
**Host**: Windows 11 Pro 10.0.26200 (emulated x64), Node 24.14.1, npm 11.11.0, Python 3.14.3, Chrome as default browser, display 2419x1372 at **100% scaling** (96 DPI)
**Branch at start**: `develop` @ `75e26954`
**Branch at end**: `develop` @ `02414d90`
**Answers**: [2026-09-15-windows-post-0.19.0-validation.md](2026-09-15-windows-post-0.19.0-validation.md)

---

## 1. Verdict

**Ready for the next release, with three caveats and five hands-on checks still open.**

Everything since v0.19.0 now runs on Windows. The advisory `Windows checks` job is green, the full unit suite passes, all 289 electron e2e tests and 6 visual tests pass, and 51 tests that Windows had never run are now running.

Nothing found was a defect in shipped product code. Every failure traced to a test that made a macOS-shaped assumption.

Caveats, in order of weight:

1. **A dependency security gap that this validation surfaced** (§7). Four high-severity advisories survive #125, two of them in packages the app ships and uses. One of those, `extract-zip`, is guarded by a check that does not cover the advisory's attack shape.
2. **#125 could not be verified on this host.** `npm ci` cannot complete here (§6), so the electron-builder bump rests on CI alone.
3. **The drag-freeze flake** (§4.3). Intermittent, trigger not identified.

Five hands-on checks are not run (§5.2). They need a person at the keyboard and are listed with steps.

---

## 2. What landed

| PR | What | Files |
|---|---|---|
| [#128](https://github.com/qodeca/erfana/pull/128) | The 29 failing unit tests | 4 |
| [#129](https://github.com/qodeca/erfana/pull/129) | Monaco dropping typed characters; a bad count assumption | 3 |
| [#130](https://github.com/qodeca/erfana/pull/130) | Three over-broad win32 skips; real 8.3 short-name cover | 4 |

All merged into `develop`, all green on every required check.

---

## 3. Step A – the 29 failing tests

All six files were classified. **All test-only. No product defect in either direction.**

| File | Tests | Cause | Fixed by |
|---|---|---|---|
| `navigation-handlers.test.ts` | 10 | short-name fixture | own line |
| `PreviewViewService.navigation.test.ts` | 11 | short-name fixture | shared harness |
| `PreviewViewService.resume.test.ts` | 5 | short-name fixture | shared harness |
| `PreviewViewService.exportName.test.ts` | 1 | short-name fixture | shared harness |
| `PreviewViewService.pageScope.test.ts` | 1 | short-name fixture | own line |
| `MarkdownEditorPanel.integration.test.tsx` | 1 | CRLF | own line |

**Cause 1 — Windows 8.3 short names (28 of 29).** `os.tmpdir()` is a short name on Windows. `fs.realpathSync` keeps that spelling; `fsPromises.realpath` expands it. Three fixtures built their root with the non-expanding form while the resolver used the expanding one, so root and target carried two spellings of one directory and every page was refused. Production is unaffected: `PreviewRootRegistry.issue` already resolves with the expanding form.

**Cause 2 — CRLF (1 of 29).** `MarkdownEditorPanel.integration.test.tsx` reads its own panel source off disk and matches it against needles joined with LF. `.gitattributes` carries `* text=auto`, so the file is CRLF on a Windows checkout.

**The three that failed the other way.** Three cases allowed an open that should have been refused. That direction needed ruling out before anything else, because a preview gate that fails open is a security defect. It does not: `fallbackPage` (`previewViewNavigation.ts:394-396`) returns early when `locate` fails and so skips the `.html` and eligibility checks, but a target that cannot be located is still refused downstream by the protocol handler — 403 for escape and excluded, 404 for missing, and `isSafeSegment` rejects the out-of-root URL before any of that. All three pass after the fixture fix.

**Not done, worth doing.** Nothing asserts that downstream refusal for this specific branch. It is trusted, not proven.

---

## 4. Steps B and C – the gate and the suites

### 4.1 Local gate

| Command | Result |
|---|---|
| `npx eslint .` (no `--fix`) | pass |
| `npm run lint:css` | pass |
| `npm run design -- --check` | pass, 10 generated files up to date |
| `npm run typecheck` | pass |
| `npm run test:ci` | pass — 563 files, 13729 passed, 123 skipped |
| `npm run check:headers` | pass, 1375 files |
| `npx electron-vite build` | pass, 38 s |
| `npm run test:cov` | see below |

`npm run test:main` was **dropped from the list, not skipped**. `vitest --config vitest.main.ts` auto-discovers `vitest.workspace.ts` and expands to all three projects, so it runs the same suite as `test:ci`. That is also why the CI step named "Main-process tests" logs renderer results. Running both reports one suite as two gates.

`npx eslint` without `--fix` is **stricter than CI**, whose Lint job fixes its own checkout and then passes. A purely auto-fixable finding here would be a false red, not a CI failure. None appeared.

### 4.2 Coverage floors on Windows

Measured per project, scoped the way the CI Coverage job scopes.

| File | Floor | Windows | Status |
|---|---|---|---|
| `src/main/utils/tarArchive.ts` | 90% lines | 86.04% | known wontfix, symlink cases skip on win32 |
| `scripts/fuses.js` | 86% lines | 80% | known wontfix, same reason |
| `BrowserLaunchService.ts` | 98% | 97.43% lines, 93.75% branches | **was missing, now passes** — see §5.1 |

**All twelve new #124 preview floors pass on Windows.** Preload and renderer projects report no misses. After #130, Windows coverage matches the documented expectation exactly: only the two symlink-related floors miss.

`known-flakes.md` listed the `BrowserLaunchService` floor as unmeasured and possibly failing. It was failing. Narrowing its suite's win32 skip fixed it.

### 4.3 e2e

| Suite | Result |
|---|---|
| 12 `html-preview-*` specs | pass |
| Full electron project | **289 passed, 0 failed, 1 skipped** |
| Visual project | **6 passed**, no baselines regenerated |

The first run failed 13. Eleven were test defects, now fixed (§5.3). Two were the drag-freeze flake.

**The drag-freeze flake — open, trigger unknown.** `html-preview-drag-freeze.e2e.ts` failed 7 times across the first four runs with one error: `the page stayed drawn after a sash moved past the threshold`. It has since passed 5 consecutive runs — one full suite and four isolated. I could not identify what changed and do not claim to have.

What the app log does show, from the failing runs: nine `Preview drag freeze` lines, every one `drag-hide-unconfirmed`, and no `drag-hide-slow`. So when it fails, the renderer armed the freeze and asked main to hide the view, and the confirmation never arrived before the drag ended. There is no timing margin there on Windows. The fallback is safe by design — `previewDragFreeze.ts:281` holds the layout rather than let the page smear, the strict rule winning over a smooth drag — so the user-visible cost is a splitter that will not follow the pointer, never a page drawn over the chrome.

**Belongs in `known-flakes.md`.** Not currently listed.

---

## 5. Step D – the Windows-only checks

### 5.1 The largest finding: three suites were switched off on Windows

Three `describe.skipIf(process.platform === 'win32')` blocks disabled whole suites on the one platform whose path handling differs most. **None carried a comment saying why.**

| Suite | Was | Actually, measured |
|---|---|---|
| `BrowserLaunchService.integration` | 19 skipped | 18 pass, 1 genuinely macOS |
| `previewFrames.integration` | 22 skipped | 21 pass, 1 genuinely macOS |
| `previewNavigation.integration` | 15 skipped | 15 pass, none needed |

54 working tests hidden from every Windows run, the sender-gating cases among them. Each skip now sits on the one case that needs it, with the reason written down. Whole-suite effect: **123 skipped, down from 174.**

The one `BrowserLaunchService` case that does fail builds a darwin launcher by hand and gets `LAUNCH_FAILED` on Windows. **Why is not run down.** It is recorded at the skip.

### 5.2 Check results

| ID | Check | Result |
|---|---|---|
| W1 | Edge resize, maximize/restore, fast drag | **pass** via `html-preview-bounds` / `drag-freeze`, subject to §4.3 |
| W2 | Back/Forward from page and toolbar | **pass** via `html-preview-same-tab.history` |
| W4 | Launch-failure toast | **pass** via `html-preview-open-in-browser` |
| W5 | Second drive, UNC, non-ASCII | **fixtures verified**: `subst X:` reachable, `\\localhost\C$\…` reachable, `zażółć-gęślą/strona-ąćęłń.html` reachable. Not driven through the UI. |
| W6 | Directory symlink as project root | **pass** — `previewNavigation.integration` (15 cases, "a project behind a symlinked folder") now runs on Windows and passes |
| W7 | Frame via a leaf symlink | **pass, and better than expected** — see below |
| W9 | NTFS stream refused | **pass** — the `namesAlternateDataStream` table and the NOT_HTML refusal run on Windows; a real stream was created on disk to confirm the shape (`tool.exe` carrying `:$DATA` and `x.html`) |
| W10 | Keyboard entry and Escape | **pass** via `html-preview-keyboard-focus` |
| W12 | Real 8.3 short names | **pass** — new test, 5 cases, see below |
| W1b | Aero snap, real mouse drag | **not run** |
| W2b | Menu bar must not flash on Alt | **not run** |
| W3 | Open in default browser, tree and toolbar | **not run** |
| W8 | `design-set/` end to end | **not run** |
| W11 | Unsaved-changes prompt by keyboard | **not run** |

**W7 answers audit candidate 1 in `known-flakes.md`.** A frame naming a leaf symlink that points outside the project is listed under `frame-escape` on Windows and `missing-local-file` on macOS. macOS has `O_NOFOLLOW`, refuses to open the link, and reads the frame as missing; Windows follows the link, resolves the target outside the root, and names the real problem. **Windows gives the more accurate label.** The register predicted this; it is confirmed and is not a defect.

**W12 is new and was the gap worth closing.** The shared nav harness pins `platform: 'darwin'`, and the platform-override tests pass a fake platform argument, so no test had ever met a real OS-generated 8.3 alias. `previewPathResolve.win32ShortName.test.ts` now covers five cases against the real filesystem: the step 8h re-resolve accepts an in-root page named through the short spelling of the root, refuses an escape reached the same way, and `isSafeSegment` rejects a `~1` segment on win32 while allowing it elsewhere. **All pass. The short-name defences hold on real Windows.**

### 5.3 The e2e test defects fixed

**Monaco drops typed characters (10 failures).** `MonacoPage.setContent` and `appendContent` sent one keystroke per character. Monaco discards some during re-layout, reliably on this host: `manually saved` arrived as `mnulysvd`, `autosaved line` as `ausv ie`, `my local work` as `mlcl ok`. Which characters are lost varies per run. The repo already knew — `third-party-components.e2e.ts:96` documents it and uses `keyboard.insertText()`. These two writers predate that. Real users type at human speed; nothing in the product loses keystrokes.

**A count assumption (1 failure).** `workspace-layout.e2e.ts` asserted the recent-projects list held exactly one entry. `userDataDir` is worker-scoped while the app fixtures are test-scoped, so every project an earlier test opened is still listed. The host saw five. The test arrived with **#121 and has never run in CI**, because `e2e.yml` is disabled. It would fail on macOS too, given the right test order.

### 5.4 Steps to finish the five open checks

Fixtures are built at
`%TEMP%\claude\C--Users-marcinobel-Projects-erfana\75408b7e-…\scratchpad\uat\corpus`
(`subst X:` maps the parent; `corpus-link` is a directory symlink to it; `tool.exe` carries a real alternate data stream; `zażółć-gęślą/` holds a non-ASCII page; `self-contained/page~1.html` is the short-name case).

Run the app with a throwaway profile so your real settings survive:
`npx electron-vite dev -- --user-data-dir=%TEMP%\erfana-uat`

| ID | Do this | Expect |
|---|---|---|
| W1b | Drag the splitter with the mouse. Then Win+Left / Win+Up, maximize, restore. Watch `~/.erfana/logs/combined.log` for `Preview drag freeze` and `no-settled-push`. | Page hidden during the drag, back in place on release, never over the tab strip, toolbar, tree or terminal. No `drag-hide-unconfirmed`. |
| W2b | With focus in the page, press Alt+Left twice then Alt+Right. Repeat with focus on the toolbar. | Back, Back, Forward. **The auto-hidden menu bar must not appear.** Monaco and the terminal keep their own Alt+arrow behaviour. |
| W3 | Open in default browser, from the tree item and from the toolbar after a same-tab move. Your default is **Chrome**, not Edge as the handoff assumed. | Chrome opens the right page from its real path; the busy look clears. |
| W8 | Walk `design-set/`: open, move in both link modes, Back/Forward, Find, PDF export, open in browser. | Same as macOS. |
| W11 | Make an editor tab of `B.html` dirty. From the preview, follow a same-tab link to `B.html`. Answer the prompt with the keyboard only, waiting more than 2 s before choosing "Don't save". | Keys act on the dialog. "Don't save" leaves the file unchanged on disk. |

---

## 6. Step 0' – dependencies

**`npm ci` cannot complete on this host.** Run in a scratch copy of `package.json`, `package-lock.json` and `patches/`, so the working tree was never at risk:

```
⨯ node-gyp failed to rebuild '…\node_modules\node-pty'
Error: `C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe` failed with exit code: 1
    failedTask=installAppDeps
```

The same was true of the previous Windows host. Every check in this report therefore ran against the `node_modules` installed on 2026-09-03, which carries **electron-builder 26.8.1** while the lockfile says **26.15.3**.

**Consequence: #125's electron-builder bump is not verified on Windows.** It rests on CI's `build_win.yml`. Nothing else in the drift affects this report — electron-builder is used by exactly one command, and `electron`, `vitest`, `zod` and `playwright` all match the lockfile.

**A second finding: no local Windows packaging is possible at all** without Azure credentials. Observed on this Windows host; the `azureSignOptions` block is declared unconditionally under `win:`, so the same is **inferred** for a Windows target built from macOS or Linux, but that was not exercised.

```
Error: Unable to find valid azure env field AZURE_TENANT_ID for signing.
```

`npm run build:win` fails this way, and so does **`npm run build:unpack`** (`electron-builder --dir`), which was tried as the unsigned fallback. `electron-builder.yml` declares `azureSignOptions` at `win:` level unconditionally and hooks `afterSign: ./scripts/resign.js`; CI overrides the values at invocation. Both the handoff and `docs/build/release.md` describe local builds as simply unsigned. They are not unsigned — they cannot be produced. The newest artifact under `release/` is from **v0.9.4, dated 2026-04-23**, which is consistent with nobody having built Windows locally since.

So the installer comparison this report was meant to make **could not be attempted**, independently of the electron-builder version question. Worth either a documented escape hatch (`--config.win.azureSignOptions=null`, or gating the block on an env var) or a correction to the docs. Windows packaging itself is not broken: CI's `build_win.yml` builds it on every push.

---

## 7. Dependency security – needs your decision

`npm audit` against the **current** lockfile (electron-builder 26.15.3, so post-#125) reports **16 vulnerabilities: 1 critical, 12 high, 3 moderate.** Four high-severity ones are in production dependencies:

| Package | How it arrives | Advisory |
|---|---|---|
| `extract-zip` 2.0.1 | **direct runtime dependency** | unvalidated symlink path traversal; arbitrary file writes through symlink archive entries |
| `sharp` | via `@llamaindex/liteparse` (direct runtime) | libvips CVE-2026-33327/33328/35590/35591; libheif GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545 |
| `@llamaindex/liteparse` 1.4.1 | direct runtime | via `sharp` |
| `electron` | devDependency, via `extract-zip` | build-time only |

Both shipped packages are genuinely used: `extract-zip` in `src/main/utils/zipArchive.ts`, `@llamaindex/liteparse` in `src/main/services/import/converters/LiteParseConverter.ts` (PDF, Office and image conversion).

**The `extract-zip` guard does not cover this advisory's shape.** `zipArchive.ts` runs a pre-extract validation pass, but `validateEntries` calls `assertSafeEntry(entry.fileName, …)` — it validates entry **names** only, and never inspects whether an entry is a symlink. The advisory's attack uses a symlink entry with an innocuous name followed by a write through it, which a name-only check passes. The file's own header lists its reject conditions and symlinks are not among them.

**What holds the risk down:** the only archives extracted are whisper build zips, which are SHA-pinned and minisign-manifest-signed, so an attacker must defeat that trust chain first. This is an incomplete defence-in-depth layer, not a breach. I have not written an exploit and have not verified the advisory reproduces against this code.

**Per the project protocol this belongs in private advisory reporting, never a public issue, and it is yours to initiate.** Nothing has been filed.

---

## 8. Step E – regression sweep

The v0.19.0 sweep's automated half (its §4, nine commands) is superseded by §4.1 and §4.3 above and passes, with `test:main` dropped as redundant and `test:cov` reported as floors rather than pass/fail.

Its §5 manual half, 34 items, is **not re-run** — it is hands-on work in the same session as the five open checks above. What #121 and #125 touched is covered by automation instead: "Reload from Disk", saving, tabs, toolbar, search and layout all run inside the 289-test electron suite, which passes.

Amendments the next person should apply rather than ticking the old wording:

- §5.2 rows 1–2 ("new tab" / "reuses the tab") now depend on link mode. Run both modes.
- §5.2 row 6 badge text is replaced by the `previewFrameBadgeText` labels.
- §5.1 row 5 tested a 249-character panel-id bound that `stablePathDigest` replaced. Retest above 260 characters, and add: two paths sharing their first 150 characters must open as **two** tabs, not one.
- No old item covers frames, the preview never drawing over the chrome, open-in-browser from tree and toolbar, keyboard entry into the page, history and the still frame surviving sleep/wake, PDF export naming the page after a same-tab move, or Ctrl+S / Ctrl+W acting only on the active tab (#121 — Windows takes the `Ctrl` branch).
- Re-run the §5.6 handle-leak batch **with frames open**.

Still open from the v0.19.0 sweep and not re-filed: display scaling 125%/150% (this host runs at **100%**, so it still cannot be checked here), the Zoom In keystroke, and issue **#120**.

---

## 9. New, not already in `known-flakes.md` or `technical-debt.md` 47–63

1. **Three over-broad win32 `describe.skipIf` blocks** hid 54 passing tests. Fixed in #130. The pattern is worth a lint rule or a review habit: a platform skip with no stated reason.
2. **The drag-freeze flake** (§4.3). Needs a `known-flakes.md` entry.
3. **`previewSchemeScope.test.ts` times out at 5 s** under full-suite load, passing alone in 2.6 s and in 4.35 s with coverage on. It sits that close to the limit. Needs a `known-flakes.md` entry.
4. **The e2e suite leaks temp directories on Windows.** Cleanup hits `EBUSY: resource busy or locked` because files are still held when teardown runs; **419 folders, 6.1 MB** accumulated across this session's runs. Git-ignored, so litter rather than breakage.
5. **`npm run test:cov` runs the whole 13,847-test suite three times** (once per project config, each auto-expanding through the workspace file) and its `spawnSync` with `stdio: 'inherit'` does not reach a redirected log on Windows, so the failing threshold is invisible. That is why the first coverage run reported nothing useful.
6. **`npm run build:win` needs Azure credentials** (§6), contradicting the documentation.
7. **The dependency advisories** (§7).
8. **`e2e.yml` is disabled**, and #121 shipped a test that has therefore never run anywhere. That is the second-order cost of the disabled pipeline, and it is worth weighing against whatever keeps it off.

---

## 10. Suggested next steps

1. Decide on §7. It is the only item with a security dimension.
2. Run the five hands-on checks in §5.4.
3. Add entries 2 and 3 of §9 to `docs/windows/known-flakes.md`.
4. Re-enable `e2e.yml` on Windows if the drag-freeze flake can be pinned down; it is the only suite blocking it, and CI covers no Windows e2e today.
