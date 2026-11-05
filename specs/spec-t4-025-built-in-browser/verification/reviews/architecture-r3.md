# Architecture review – spec 025 (round 3)



Reviewer: `erfana:architecture-reviewer`, an independent agent that did not write this code. Date 2026-11-05, against `898c9c34` on `feature/built-in-browser`. I had no shell, so I could not run `git diff 8fd4ed87..898c9c34`, `npm run lint` or a build. I read every file the brief names instead. Line counts come from Grep `^` counts, and the rubric's max-lines rule counts every line (`eslint.config.mjs:864`).

Score: 8/10
Counts: critical 0, high 0, medium 1, low 12

## Findings

### [medium] The outline band opens its native window on any page placement, not at its first draw
- **What the code says it does.** `pickBand.ts:123` says "Opens the surface, once, at the first draw", and `:146` says it is "`undefined` until the first draw opens it".
- **What the code does.** `OutlineBand.redraw()` calls `this.open()` before it checks whether anything is outlined:
  - `pickBand.ts:174-176`: `const surface = this.open()` / `const wanted = this.wanted` / `if (surface === null || wanted === null) return`
  - The constructor subscribes `redraw` to placement changes at once: `pickBand.ts:153`.
  - `BrowserPicks.bandFor` builds one band for every tab that gets a pick pipeline (`pick/BrowserPicks.ts:120`, `:129-139`).
  - `TabViewFrame.apply` reports every bounds push (`page/TabViewFrame.ts:151`).
- **What follows.** Every browser tab opens a hidden child `BaseWindow` with eight `View`s when it is first shown, even if pick mode is never used. Each one adds six listeners to the parent window (`pickBandWindow.ts:84-89`). These windows live until the tab closes.
- **Inferred, not run.**
  - Past about 10 tabs in one window, the parent's `move` listeners pass Node's default limit of 10, which triggers a `MaxListenersExceededWarning`.
  - On Windows and X11, each tab carries an extra native window.
- **Why it matters.** The amendment's cost argument assumes the surface exists only while picking. The test that should pin this checks only that nothing is drawn (`pickBand.test.ts:160-163`), not that nothing is opened. So the broken contract is invisible to the suite.
- **Fix.**
  - In `redraw()`, return when `this.wanted === null` before calling `open()`.
  - Add `expect(open).not.toHaveBeenCalled()` after `place(...)` in that test.
  - Optional: subscribe to `watchPlacement` on the first `show()` instead of in the constructor.
  - Size: one file plus one test, internal API, a single revert to undo. Confidence: high on the code path.

### [low] ADR 0011 still says nothing Erfana draws sits over the live page; only ADR 0007 records the band
- `docs/adrs/0011-…md:18` (decision 1) says: "Over the page area: only a still image."
- `:50` rejects "A transparent Erfana view above the page". The status line (`:3`) has no 2026-11-05 amendment, and the file has no match for "band" or "child window".
- ADR 0007's amendment (`0007-…md:61-70`) places a click-through child window over the live page area. It supersedes only ADR 0007's own alternative.
- **Why it matters.** The band must never draw over Erfana's own toasts or dialogs. That holds only because ADR 0011 decision 2 (every app overlay takes the page view out) runs through `TabViewFrame`, the one place that moves the page view (`TabViewFrame.ts:140-143`). A reader of ADR 0011, the ADR that owns surfaces over the page, cannot see that dependency.
- **Fix:** add a short amendment note to ADR 0011 that links ADR 0007's amendment and states the invariant: the band follows `TabViewFrame` placement, so any overlay that detaches the page view also hides the band.

### [low] The two-tone outline is defined twice, and only the colours are tied to the tokens
- The colours are resolved from tokens at build time (`electron.vite.design-tokens.ts:58-59`).
- The line widths are hard-coded in main: `pickBand.ts:27-31` (`BAND_OUTER_INK_PX = 1`, `BAND_PAPER_PX = 2`).
- The still image uses tokens: `PickRow.css:529-531` (`var(--border-width-thick)`, `var(--border-width)`; values 2px and 1px at `design-tokens.css:347-348`).
- No test ties these together. A Grep for `border-width` or `PickRow.css` in the `pick/*.test.ts` files finds nothing.
- The view-origin math is also written twice in one file: `BrowserPicks.ts:109-114` and `:289-295`.
- **Why it matters.** The amendment's promise that "both look identical" depends on two sources nobody keeps in step.
- **Fix:** resolve both width tokens through `mainDesignTokenDefines`, or add a test that reads them and compares them to the constants. Share one screen-placement helper inside `BrowserPicks`.

### [low] Pick callers do not name their hit-test rule
- `PickHitTest` defaults to `rule: HitRule = 'click'` (`pick/pickHitTest.ts:68`). The pick path relies on that default: `BrowserTabPick.ts:134` calls `new PickHitTest(this.reader, this.frames)`.
- ADR 0007's residual risk (`0007-…md:53`) is that "a coding mistake could put the topmost rule on the pick path". The allow-list makes each CDP call name its rule (`cdpAllowList.ts:174`), but the class one level up does not.
- **Fix:** make `rule` required and pass `'click'` at `BrowserTabPick.ts:134`. That is one call site plus the tests.

### [low] The pending-load clearing rules are spread across `BrowserTab`'s event handlers
- `BrowserTab.ts` calls `localLoad.arm/end/navigationStarted` at 10 sites: `:197, :209, :221, :231, :237, :247, :393, :398, :411, :416, :468`.
- `TabLocalLoad` (`local/tabLocalLoad.ts`) holds the logic but not the subscriptions.
- `LocalFileServers` reads `process.platform` directly (`:276`, `:363`), while every other dependency of that class is injected (`:91-108`).
- Behaviour is pinned well: `BrowserTab.localFiles.test.ts:138-230`.
- **Why it matters.** This gate is security-relevant. A future edit to `BrowserTab`'s listeners could leave the record set and widen the folder's reach without any change to `local/`. `BrowserTab.ts` is also at 475 of 500 lines.
- **Fix:** let `TabLocalLoad` subscribe to `did-navigate`, `did-fail-load`, `did-stop-loading`, `did-start-navigation` and `destroyed` itself, and inject `caseSensitive` into `LocalFileServers`. This is a mechanical move; the existing suite is the safety net.

### [low] `ContextMenuItem` uses three optional flags where some combinations mean nothing
- `ContextMenu.tsx:60-77`: `checked?`, `checkKind?: 'checkbox' | 'radio'`, `radioMark?: 'icon' | 'check'`. `radioMark` is "Ignored on other items", and `checkKind` is ignored without `checked`.
- Rendering branches on all three (`:444`, `:475`), and `ToolbarOverflow.tsx:169` spreads them in conditionally.
- The file has 492 lines of a 500-line limit.
- **Fix:** replace them with one `mark?: { kind: 'checkbox'; checked } | { kind: 'radio'; checked; show: 'icon' | 'check' }`. Callers: `MoreMenu.tsx:66`, `WidthPresetMenu.tsx:47`, `ToolbarOverflow.tsx:169`, plus the tests.

### [low] The `pick/` and `capture/` folders now depend on each other more deeply
- `capture/captureFacts.ts:37` now builds a `PickHitTest` (the covered-by check).
- `capture/surfaceStill.ts:18` imports `pick/pickCaptureReads`.
- `pick/` imports `capture/` from 5 files (`pickCaptureReads.ts:26-30`, `BrowserTabPick.ts:34-36`, `BrowserPicks.ts:33-38`, `pickAppSetup.ts:28-30`, `pickMenu.ts:23`).
- I found no file-level cycle in what I traced (inferred).
- There are also two clock-based timeout helpers (`BrowserPicks.ts:297`, `sourceHints.ts:177`) next to `src/main/utils/withTimeout.ts`, which uses real timers and so cannot replace them as it stands.
- **Fix, when next touched:** move the shared CDP reads (`pickCdp`, `pickFrames`, `pickElement`, `pickHitTest`, `pickGeometry`) into a `pick/reads/` or `cdp/reads/` leaf that both folders import. Add a version of `withTimeout` that takes a clock to `src/main/utils/`.

### [low] File-size pressure keeps moving
| File | Lines | Limit | Note |
|---|---|---|---|
| `src/main/services/comments/FileCommentService.ts` | 500 | 500 | Not in the baseline; the next added line fails lint. The echo filter added 5 `echoes.track(...)` wraps (`:272-340`) |
| `src/renderer/src/components/ContextMenu/ContextMenu.tsx` | 492 | 500 | |
| `src/main/services/browser/browserAppSetup.ts` | 480 | 500 | Was 483 |
| `src/main/services/browser/BrowserTab.ts` | 475 | 500 | Was 455 |
| `src/main/services/browser/pick/BrowserTabPick.ts` | 474 | 500 | Was 451 |
| `src/renderer/src/components/Panels/BrowserPanel/BrowserPanel.tsx` | 468 | 500 | |
- `src/main/index.ts` has 803 lines, exactly its baseline entry (`scripts/max-lines-baseline.json:4`).
- **Fix:** the `TabLocalLoad` move above frees about 10 lines in `BrowserTab.ts`. For `FileCommentService.ts`, move the write-and-track wrapper into `fileCommentEchoes.ts` (for example `echoes.write(panel, () => writer.x(...))`).

### Carried over from round 2, still open (low each)
1. **Pick is still outside the per-tab feature list.**
   - The `withPicks` wrapper is still there (`pickAppSetup.ts:119-129`, used at `browserAppSetup.ts:309`), and detach still uses `contents.once('destroyed')` (`BrowserPicks.ts:156`).
   - `BrowserPicks.attachTab` is still public (`:102`), and `detachTab` (`:141`) still exists.
   - The `inputFor` doc still reads "for the test hooks" (`BrowserTabService.ts:283`).
   - The band adds one more resource to this event-based detach path.
2. **Browser code still reaches into the preview's internals.** `localRequestPath.ts:20`, `localConfinedFile.ts:35`, `LocalFolderServer.ts:31`, `browserProfileGuards.ts:35`, `widthPresetLayout.ts:25`, `TabViewFrame.ts:26`, `BrowserTab.ts:47`. The second, platform-less `isSafeSegment` is still there (`browserProfileGuards.ts:302`).
3. **The services layer imports the IPC layer.** `browserAppSetup.ts:39-40`, `:62-63`; `pickAppSetup.ts:22`; `popups/popupWindowElectron.ts:21`.
4. **`zoomPercent: 100` is still a placeholder.** It is set at `BrowserTab.ts:344` and overwritten in `page/tabPageState.ts:64`.
5. **ADR 0009 decision 14 text is unchanged.** It still says "…in that order – before the new project opens" (`0009-…md:29`). The teardown runs after the switch commits. Owner decision Q-36 ("fix ADR 0012 and 0009 text") may already cover this; I could not tell which text Q-36 meant.

## What is strong
- **The band is built to be tested.**
  - `pickBand.ts` has no Electron import. The surface comes through `BandSurfaceFactory` (`:75`), and its geometry (`bandStrips`, `:101-120`) is pure.
  - Electron is used only in `pickBandWindow.ts` (123 lines).
  - Platform detection is a pure function (`canPlaceBandWindow`, `:42-47`) with an 8-case table test (`pickBandWindow.test.ts:96-106`).
  - Draw and hide failures fall back to the engine outline (`pickBand.ts:184-186`, `:238-241`; `pickHighlight.ts:160-163`).
- **One place moves the page view.** Every page-view `setBounds` is in `TabViewFrame.ts:140-143`, so `watchPlacement` (`:103-106`) sees every placement change: tab switch, resize, width preset and detach. The amendment's "drawn again whenever the page view is placed again" is true by construction.
- **ADR 0007 amendments are followed point by point.**
  - The window ignores the mouse before its first show (`pickBandWindow.ts:76`), with `focusable: false` and `showInactive()` (`:64`, `:112`). It has no `webContents`.
  - Wheel-settle is 150 ms (`pickHighlight.ts:43`, `:141-152`).
  - It is hidden on all the listed paths (`BrowserTabPick.ts:266`, `:329`, `:406`).
  - The engine quad stays only as a fallback (`pickHighlight.ts:100-108`).
  - The covered-by check names its rule end to end: `captureFacts.ts:146` uses `'topmost'`, the allow-list requires a boolean (`cdpAllowList.ts:174`), and both rules are pinned by tests (`cdpAllowList.test.ts:200-207`, `pickHitTest.test.ts:78`, `:89-90`, `captureFacts.test.ts:78`).
- **Design tokens have one build-time source.** `mainDesignTokenDefines` feeds both the build (`electron.vite.config.ts:241`) and the vitest main projects (`vitest.main.projects.ts:47`). Main keeps no hex values, and the layer rule holds.
- **The React 19 source maps are well layered.**
  - `sourceMapLocation.ts` is pure functions plus one injected `PageFetch`, with fixed, loggable miss reasons (`:55-64`).
  - `sourceHints.ts` takes the lookup as an optional callback (`reactSourceLookup`, `:171`), so it does not import the source-map module.
  - The fetch goes through the tab's own session (`pageResourceFetch.ts:21-23`, wired at `BrowserPicks.ts:119`), and every limit is a named constant.
- **The pending-load gate matches ADR 0012's amendment.** Each clear condition listed in the ADR has its own test (`BrowserTab.localFiles.test.ts:144-230`), and closing a server clears its records (`LocalFileServers.ts:374-376`).
- **Small, injected modules elsewhere.**
  - `FileCommentEchoes` (97 lines) takes an injected reader (`:41`), is fail-open by design and has its own suite.
  - The queued send (`useTerminalStore.ts:198-206`) is a 9-line per-terminal chain. Its "never rejects" invariant is stated and kept (`sendNow`'s `catch`, `:253-256`).
- **The in-use chip was removed cleanly.** Grep finds no `inUse` or `mediaInUse` left in browser or shared code (the only matches are the unrelated `previewWatchBudget.ts`), and the state schema no longer has the field (`browser-tab-state-schema.ts`).

## Owner-pending items seen (not scored)
- **Item 2:** screen approval. It covers the Focus card's picker-outline row that ADR 0007 `:79` names. Q-46 says that wording is approved, so the ADR's residual-risk line may be out of date.
- **Item 27:** the live outline on 2x (Retina) screens needs a manual look at UAT. This sits next to the band's real-OS pass-through check, which ADR 0007 `:74` also leaves to a manual run.
- **Item 52:** the final macOS e2e run and the band latency bench (025-AC-049) on macOS.
- **Item 50:** Markdown view modes as a real radio group. This is related to the new `choice` and `radioMark` path, but it predates this branch.
- **Items 19, 31, 32:** strip folding, tooltip placement and pick-row break widths. These are outside this lens.
- **Item 49:** a test writes a stray file. It is not browser code.

## Score rationale
- There is no critical or high finding.
- The one medium (the band opens its window on every tab's first placement) is local to `pickBand.ts`, has a one-line fix and needs one test assertion. That fits the 8 anchor: "medium findings are few, local and have a clear fix".
- The new work in this round is architecturally sound:
  - The native outline sits behind an Electron-free seam.
  - It follows a single placement chokepoint.
  - Design-token values have one build-time source.
  - The hit-test rule is explicit at the allow-list.
  - The source-map lookup is injected and bounded.
  - Each ADR amendment I checked matches its code.
- It is not 9:
  - There is one medium.
  - There are 12 lows, more than "a few". Five of them were reported in round 2 (two of those in round 1 too) and are still open.
  - ADR 0011 was not amended for a surface it explicitly rejected.
- Fixing the medium, folding pick into the feature list and adding the ADR 0011 note would lift this lens to 9.

**Out of scope for this lens:**
- The `MaxListenersExceededWarning` and per-tab native window cost: performance-reviewer.
- Whether the topmost-rule residual risk and the `isSafeSegment` divergence are acceptable: security-auditor.
- The missing test assertions named above: test-writer.
