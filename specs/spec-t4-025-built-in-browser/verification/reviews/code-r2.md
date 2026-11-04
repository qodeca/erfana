# Code review – spec 025

Reviewer: `erfana:code-reviewer` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).


Score: 8/10
Counts: critical 0, high 0, medium 1, low 5

The browser code is ready to ship from the code lens. I found nothing critical or high. One medium finding keeps the score at 8: the teardown that runs on a project switch or window close can stall forever behind one step that has no time limit. The other five findings are small, and each has a short fix.

**What I checked and ran (HEAD 8fd4ed87):**
- I read the code changed in 17426356 and 8fd4ed87 in full: `tabFeatureRegistry.ts`, `tabFeatureAttach.ts`, `BrowserTabService.ts`, `tabRequestGate.ts`, the four handler modules, `browserProjectTeardown.ts`, the teardown wiring in `browserAppSetup.ts`, `BrowserPicks.ts`, `cdpFloodBudget.ts`, `cdpTargetLogs.ts`, the `BrowserCdpSession` event path, `pickHover.ts`, `LocalFileServers.ts`, `ToolbarTooltip.tsx`, `PickAnnouncer.tsx`, `pickRow.logic.ts`, `useNavFold.ts`, and the changes to the sign-in box, still image and draft handling.
- `npx vitest run -c vitest.main.config.ts src/main/services/browser src/main/ipc/browserTab src/main/ipc/browser-tab-handlers` → Test Files 129 passed, Tests 1905 passed.
- `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/Panels/BrowserPanel` → Tests 371 passed.
- `npx eslint` over all browser source paths (main, ipc, preload, shared, BrowserPanel) → exit 0.
- Not run: e2e, per the brief.

## Findings

### [medium] One teardown step has no time limit, and every later teardown waits behind it
- **Where:**
  - `src/main/services/browser/browserProjectTeardown.ts:100`, in the queue that runs one teardown at a time:
    ```ts
    await step(scope)
    ```
  - `src/main/services/browser/pick/BrowserPicks.ts:161`, the `endPick` stage:
    ```ts
    .map((entry) => entry.pick.end().catch((error: unknown) => logger.warn('Browser teardown: pick mode did not end cleanly', { error: String(error) })))
    ```
    `pick.end()` waits for `unfreeze()`.
  - `src/main/services/browser/pick/pickFreeze.ts:89`:
    ```ts
    await this.reader.call('Debugger.resume', undefined, t.sessionKey).catch(() => undefined)
    ```
- **What happens:** `abortCaptureWrites` gives up after 2 s (`withTimeout`), but `endPick` has no limit. It waits on replies from the page's debugger connection (CDP), and nothing on that path has a timeout.
  - The module promises "never rejects", which is true. It does not promise that the step always finishes.
  - If a frozen page's renderer never answers, `run()` and `runForWindow()` never reach `closeViews`.
  - The queue (`tail`) runs teardowns one at a time, so every later project switch and window close also stalls.
- **Why it matters:** the old project's pages and served local folders would stay alive inside the new project. The module header names this as the outcome it must avoid ("a teardown that stopped half-way would leave the old project's pages alive in the new one").
- **How likely:** low in practice (it needs an unresponsive renderer during a freeze). But the queue turns one stuck tab into a stuck app. Confidence: medium.
- **Fix:** put a time limit on every step in `runStages`, e.g. `await withTimeout(clock, Promise.resolve(step(scope)), STEP_MS)`, and log a timeout like a throw. At the least, wrap `endPicks` the same way `abortCaptureWrites` is wrapped. Add a test where `pick.end()` never resolves and `closeViews` must still run.

### [low] Up or Down can outline the wrong element when the pointer moves during a slow first read
`src/main/services/browser/pick/pickHover.ts:113-116`
```ts
const step = liveStep(await this.chainOf(hovered).catch(() => null), hovered.index, move)
if ('note' in step) return this.deps.emit({ kind: 'note', note: step.note })
hovered.index = step.index
const record = await this.deps.highlight.show(step.node)
```
- **What happens:** the list of parent elements (the "ancestor chain") is now read only when it is first needed. An Up or Down in the first 150 ms on an element therefore waits for the whole read, which takes about four commands per parent element.
  - If the pointer moves to element B during that wait, `once()` outlines B. Then `refine` resumes and outlines a parent of the old element A.
  - The state still says "B, index null". The early return at `:138` (`sameNode(hovered.node, hit.node)` while a highlight shows) then keeps the wrong outline until the pointer leaves B.
- **Note:** the old `refineLive` had the same missing check, but the eager read made the wait rare.
- **Fix:** after the `await`, add `if (this.hovered !== hovered || !this.deps.canHover()) return`. Do the same after `highlight.show`.

### [low] The tooltip's position is measured only when it opens
`src/renderer/src/components/Panels/BrowserPanel/ToolbarTooltip.tsx:244-245`
```ts
setPlacement(shown === null || host === null || !shown.trigger.isConnected ? null : placeTooltip(host, shown.trigger))
}, [shown, band])
```
- **What happens:** the position depends on where the send notice or the banner's first clause ends (`placeTooltip`, `:121-124`). The layout effect only runs again when `shown` changes.
- **Effect for the user:** a focus tooltip that stays open (it has no timeout) keeps its old position while the band changes under it: a send notice appears or leaves, a note replaces a clause, or the panel is resized. The bubble can then overlap the notice or leave a gap.
- **Fix:** watch the band with a `ResizeObserver`, or measure again on each render in the layout effect. Comparing before setting state keeps it cheap.

### [low] The screen-reader region says "Picking stopped." just before every send sentence
- **The code:**
  - `src/renderer/src/components/Panels/BrowserPanel/pickRow.logic.ts:258-259`:
    ```ts
    // A send ends pick mode too; its own sentence is said instead.
    if (!next.on && prev.on && next.sent === null) return 'Picking stopped.'
    ```
  - `browserSend.ts:114` waits for `closeSent`.
  - In main, the reducer's `sent` case (`src/shared/browser/routingState.ts:300`) pushes `{ type: 'pickMode', on: false }` while the `closePick` handler is still running.
- **What happens:** the pick-mode-off event reaches the renderer before the `closeSent` reply, and `setNotice` only runs after that reply (`useBrowserPick.ts:274`). So `PickAnnouncer` renders `on: false, sent: null` first and says "Picking stopped.". Then it says the "Sent …" sentence in a new node.
- **Why it matters:** the rule "the send outranks the pick mode ending" only holds if both changes land in one render. That is the only case the unit tests check (`pickRow.logic.test.ts:184-189`). Confidence: medium – inferred from the order of the messages, not seen in a live run.
- **Fix:** set the notice optimistically before `closeSent`, or keep "Picking stopped." back for one tick while a send is waiting. Add a component test that sends the two updates in two renders.

### [low] The gate's `guarded` member is never used
`src/main/ipc/browserTab/tabRequestGate.ts:64` (`readonly guarded: typeof guarded`) and `:90`.
- **What happens:** all four handler modules import the free `guarded` function directly. None of them reads `gate.guarded`.
- **Fix:** drop the member, or have the modules use it. Keep one way to do it.

### [low] One out-of-date comment from round 1 is still there
`src/renderer/src/components/Panels/BrowserPanel/useBrowserBounds.ts:24-25`
```ts
 * The clip sent is the placeholder itself: width presets wider than the panel
 * (ADR 0011 decision 6) come with commit 18.
```
- **What happens:** width presets are built (`page/TabViewFrame.ts`). The other two comments round 1 flagged (`browserNavigationPolicy.ts:139`, `BrowserTabInput.ts:31`) were rewritten; this one was missed.
- **Fix:** describe what the clip does now and drop the commit number. The same "(commit 18/19)" wording also appears in prop docs in `AddressBar.tsx:54,56`, `NavigationRow.tsx:62` and `browserTestIds.ts:18,28`. Those are harmless, but worth the same sweep.

## What is strong
- **Feature registry:**
  - `TabFeatureList.detachAll` (`tabFeatureRegistry.ts:92-100`) detaches newest first, at most once (`splice(0)`), and logs each failure without stopping the rest.
  - `answerStrip` asks the newest feature first. Every feature except the site returns `AnswerResult | null`, and the site returns `AnswerResult` (`BrowserSite.ts:74`), so it is a final "unknown" fallback, as documented. I confirmed this for all 12 answer methods.
  - `ATTACH_ORDER` keeps the attach order in one place (`tabFeatureAttach.ts:133`).
- **One identity gate:** `createTabGate` (`tabRequestGate.ts:67-92`) runs the same order everywhere: sender trust, strict zod schema, window from the sender, tab owned by that window. The handlers keep their own error answers. Popups deliberately skip the exact-URL check, and the header documents why (ADR 0011 decision 9).
- **Teardown order:** the three stages are typed (`TEARDOWN_STAGES`), steps are copied before they run (`[...this.steps.get(stage)!]`), and a project switch and a window close share one sequence (`browserAppSetup.ts:341-344`, `:481-483`).
- **Flood budget:** `keptPayloadSize` (`cdpFloodBudget.ts:73-94`) measures only the text the log collector keeps, without serialising events. The two classes trip the target once. `rearm` resets the budget on every new document, and turns logs back on only when a flood turned them off (`cdpTargetLogs.ts:100-105`).
- **Race handling:** `LocalFileServers.startEntry` now counts pending starts toward the cap (`:260`, decremented in `finally`). A local server started for a tab that closed meanwhile is released by `openLocalFile`'s re-check (`BrowserTabService.ts:218-221`). `create` still re-checks the window and the project after its `await`.
- **`useNavFold` fix:** decisions now read the count the DOM shows (`renderedFold`, `useNavFold.ts:117-120,144`), so the resize observer and the frame callback can no longer disagree within one frame.
- **Round 1 findings, checked:**
  - The path join now goes through `joinPath` (`fileUtils.ts:135`, `useBrowserPick.ts:320`).
  - A page change clears the typed instruction (`useBrowserPick.ts:171`).
  - The sign-in box recovers after a refusal (`StripRow.tsx` answer promise; `StripRows.tsx` returns `result === 'accepted'`).
  - The server cap counts pending starts.
  - "Open in system browser" uses `pageAddress()` (`BrowserTab.ts:339-342`, not cut at 8192 characters).
  - The focus report checks for a closed page (`BrowserTabInput.ts:208`).
  - Popup activation trackers are released (`BrowserPopups.ts:174-175`).
- **Type safety:** no `any`, `@ts-ignore` or `@ts-expect-error` in the browser source. The 22 `as unknown as` casts sit at the boundaries between Electron and the test seams. The non-null `!` uses I checked are all on values that cannot be missing (`features[i]!` inside the loop bounds, `steps.get(stage)!` on a map filled from the same constant).

## Owner-pending items seen (not scored)
- **Item 31:** keyboard tooltips are drawn in the pick row band (`ToolbarTooltip.tsx:24-31`).
- **Item 33:** FR-038 wording against the two-class budget (`cdpFloodBudget.ts:34-38`).
- **Item 34:** FR-019 in-use chips. `MEDIA_CAPTURE_UNOBSERVED` is passed at one place (`browserAppSetup.ts`, `site/mediaInUse.ts`).
- **Item 26:** one terminal (AC-077).
- **Item 18:** React 19 file:line.
- **Items 16 and 27:** live outline contrast, and the outline on Retina screens.
- **Item 30:** the `openedBy` field in the popup strip answer (`popup-handlers.ts`).

## Score rationale
There is no critical or high finding in the Code lens. Every candidate was checked against the code; I dropped the ones I could not confirm (for example, the race between a local server starting and a teardown is already handled). One medium remains: the teardown step with no time limit. It is local to the teardown queue, and the fix is a one-line wrapper. The five lows are small edge cases, unused code or comment drift. That matches the rubric's 8 ("no critical or high finding; medium findings are few, local and have a clear fix"). A 9 would need the medium fixed.

## Round 2 notes
- Round 1 scored 8 with 1 medium and 7 lows against 873a9e4a.
- Seven of its eight findings are fixed in 17426356, each with evidence above. The eighth, the out-of-date comments, is partly fixed: `useBrowserBounds.ts:24-25` remains.
- The new findings sit in code this round added or changed:
  - the teardown stages (now asynchronous, staged and run one at a time);
  - the lazy chain read in `pickHover.ts`, which widens an old gap in the Up and Down path;
  - `ToolbarTooltip`;
  - `PickAnnouncer`, with its `pickAnnouncement` logic;
  - the shared gate.
- The `useNavFold` change in 8fd4ed87 is correct, and its new regression test passes.
- **Recommendations, highest impact first:**
  1. Put a time limit on teardown steps (software-developer), plus a test for a step that never finishes (test-writer).
  2. Add the check after the `await` in `PickHover.refine`.
  3. Re-measure the tooltip position on band layout changes.
  4. Fix the announcement order around a send, and add a test that spans two renders (test-writer).
  5. Remove the unused gate member and the last out-of-date comment.
