# Code review – spec 025 (round 3)



Score: 8/10
Counts: critical 0, high 0, medium 1, low 3

Reviewer: `erfana:code-reviewer`, an independent agent that did not write this code. Reviewed 2026-11-05 against `898c9c34`, with extra attention to `8fd4ed87..898c9c34`.

**What I ran**
- `npx vitest run -c vitest.main.config.ts src/main/services/browser src/main/ipc/browserTab src/main/ipc/browser-tab-handlers src/main/services/comments` → Test Files 185 passed (185), Tests 2734 passed, 9 skipped.
- `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/Panels/BrowserPanel src/renderer/src/stores/useTerminalStore src/renderer/src/stores/terminalInputSettle` → Tests 466 passed (466).
- `npx eslint` over `src/main/services/browser`, `src/main/ipc/browserTab`, `src/preload`, `src/shared/ipc`, the BrowserPanel folder, `useTerminalStore.ts` and `fileCommentEchoes.ts` → exit 0.
- `npx tsc --noEmit -p tsconfig.node.json --composite false` → exit 0. The same for `tsconfig.web.json` → exit 0.
- Not run, per the brief: Playwright, Docker and builds.

**What I read**
- In full: `pick/pickBand.ts`, `pick/pickBandWindow.ts`, `pick/pickHighlight.ts`, `pick/pickOutlineColours.ts`, `pick/pickPainted.ts`, `capture/sourceMapLocation.ts`, `capture/pageResourceFetch.ts`, `local/tabLocalLoad.ts`, `comments/fileCommentEchoes.ts`, `stores/terminalInputSettle.ts`.
- The round-3 diff of: `sourceHints.ts`, `cdpPickFunctions.ts`, `pickCdp.ts`, `pickCaptureReads.ts`, `pickHitTest.ts`, `captureFacts.ts`, `cdpAllowList.ts`, `LocalFileServers.ts`, `BrowserTab.ts`, `tabNavigationGuard.ts`, `browserAppRequestFilter.ts`, `BrowserTabInput.ts`, `BrowserTabPick.ts`, `BrowserPicks.ts`, `pickHover.ts`, `browserProjectTeardown.ts`, `cdpFloodBudget.ts`, `useTerminalStore.ts`, `FileCommentService.ts`, `PickAnnouncer.tsx`, `pickRow.logic.ts`, `ToolbarTooltip.tsx`, `useBrowserPick.ts`, `useBrowserKeys.ts`, `AddressChips.tsx`, and the radio-item change in `ContextMenu.tsx` and `ToolbarOverflow.tsx` (9a9cbfbd).

## Findings

### [medium] The S-13 "git-ignored path" rule for resolved source is not built, and the new React 19 path feeds more paths into it
- **Where:** `src/main/services/browser/capture/sourceHints.ts:121-127` (`isResolvableSourcePath`) and `:136-158` (`resolveSourcePath`). They refuse:
  - an empty or `..` part, or a part that starts with `.`;
  - `node_modules`;
  - the names in `REFUSED_FILE_NAMES`;
  - any file without a UI extension.

  Nothing checks whether the path is git-ignored:
  ```ts
  if (parts.some((p) => p === '' || p === '..' || p.startsWith('.'))) return false
  if (parts.some((p) => p.toLowerCase() === 'node_modules')) return false
  ```
- **What the spec says:** 025-FR-037 (`requirements/02-requirements.md:470`) and 025-AC-037 (`requirements/04-acceptance.md:334`) both say a path that resolves "to a git-ignored file … is not added as resolved source". The solution design repeats it (`architecture/001-solution-design.md:113`).
- **Evidence that it is missing:**
  - `grep -rn -i "git-ignored|gitignore|isIgnored|check-ignore" src/main/services/browser` finds nothing in the source.
  - `sourceHints.test.ts` and `e2e/browser-capture-react.e2e.ts` have no git-ignored case.
  - `.local/autopilot.md:57` lists "git-ignored source check" as open. It is not an Owner queue item.
- **Why it matters:**
  - Generated or built files are usually git-ignored. Examples: `dist/assets/App.js`, `build/…`, a generated `src/gen/*.ts`. Erfana can then label one of them "reported by the page, confirmed to exist" and point the agent at a file it should not edit.
  - This round makes it more likely. `sourceMapLocation.ts:154-160` now offers absolute raw paths and Vite `/@fs/` paths from the page's source map as candidates. `sourceHints.ts:229-245` (`withMappedSource`) passes up to four of them to `resolveSourcePath`.
  - The other S-13 refusals hold, so the impact is limited to the wrong file being labelled, not a leak. Confidence: high that the check is missing.
- **Fix:** before accepting a path, ask git whether the project-relative path is ignored. Run `git check-ignore -q -- <rel>` with `cwd: projectRoot` through `execFile`, never a shell. Bound it by the existing 750 ms budget and treat a failure as "ignored" (fail closed). Alternatively, reuse whatever ignore matcher the project tree already uses. Add a unit test with a temporary repo whose `.gitignore` lists `dist/`, plus a row in the 025-AC-037 e2e.

### [low] The band can stay in the wrong place after a scroll that is not a plain wheel, and an in-flight follow can redraw it mid-scroll
- **Where:** `src/main/services/browser/pick/pickHighlight.ts:141-152` (`scrolled`) and `:187-195` (`follow`); `BrowserTabPick.ts:302`:
  ```ts
  if (mouse.type === 'mouseWheel') return this.highlight.scrolled()
  ```
- **What happens:**
  - The band follows the element only after wheel events: it hides, then re-reads the box 150 ms after the last wheel event.
  - Anything else that moves the element leaves the band where it was: keyboard or scrollbar scrolling, a scroll the page's own script makes, a layout shift, a page-zoom change (`redraw` multiplies the old CSS box by the new zoom), or a smooth-scroll animation still running at the 150 ms mark.
  - `PickHover.once` (`pickHover.ts:159`) skips a pointer move over the same node while a highlight shows. So while the pointer stays on that element, nothing corrects the band.
  - Separately, `follow` checks `generation`, but `scrolled()` never changes it. A second wheel event while `follow` is waiting on `boxInView` suspends the band, and then `follow` resumes and shows it again at a mid-scroll box.
- **Why it is low:** the engine's `Overlay.highlightQuad` outline was also a fixed quad, so this is not a regression. The still image and the capture use fresh reads, so nothing sent to the agent is wrong. Confidence: medium – inferred from the code, not seen in a run.
- **Fix:**
  - Bump a scroll counter in `scrolled()` and check it in `follow` after the `await`.
  - In `once`, when the node is the same and the last follow is older than the settle time, re-read the box. Or listen to `Page.frameResized` or zoom changes and re-follow.

### [low] The Enter wait for a browser prompt can now take up to 8 s (60 s at most), and anything typed into that terminal meanwhile is sent with the prompt
- **Where:**
  - `src/renderer/src/stores/useTerminalStore.ts:238`: `const reason = await waitForInputToSettle(() => lastOutputById.get(terminalId), writtenAt)`.
  - `terminalInputSettle.ts:36-38,76`: `ENTER_MAX_DELAY_MS = 8000`, `ENTER_HARD_MAX_DELAY_MS = 60_000`.
  - `TerminalPanel.tsx:403` updates the output time only inside `if (xtermRef.current)`.
- **What happens:**
  - A Claude Code session that is busy keeps drawing its spinner, so the "quiet" rule never fires and the browser send waits for the 8 s cap. `sendCapture` (`browserSend.ts`) holds the panel busy and does not call `closeSent` until then.
  - If the terminal view is not mounted, there is no output signal, and every send waits the 3 s `no-output` delay. I did not confirm whether the right-sidebar terminal stays mounted when hidden (needs_context).
  - During the wait, keys the user types into that terminal sit in the agent's prompt box and are sent with the prompt when Enter is pressed. Before, that window was 200 ms.
- **Why it is low:** this was an owner decision (Q-44, #449), and the queue itself is correct:
  - `enqueueSend` chains on a promise that never rejects;
  - `sendNow` catches every failure;
  - `clearActivity` clears the output time.
- **Fix:** none needed in the code for this PR. Record the spinner case and the typing-during-wait case in the #449 notes. Consider letting a key the user types into that terminal before Enter cancel the auto-Enter.

### [low] The React 19 source lookup downloads and parses again on every pick, inside the 750 ms budget
- **Where:** `src/main/services/browser/capture/sourceMapLocation.ts:34-36,179-193`. On each pick it fetches the script (up to 8 MiB) and its map (up to 8 MiB). It then runs `JSON.parse` and `new AnyMap(...)` on the main thread (`:133-143`). There is no cache keyed by script URL.
- **What happens:**
  - The 750 ms budget aborts the fetches (`sourceHints.ts`, the `AbortController` in `collectSourceHints`), but not a parse that has started. A large dev bundle can therefore block the main thread for its parse, and then the work is thrown away as "source not found".
  - Eval frames (webpack's `eval-source-map`) give `null` by design (`parseFrame`, `:88`). Those apps also say "source not found". The spec allows that (`02-requirements.md:470`, "missing source map"), but the module does not name that case.
- **Fix:** cache the parsed `TraceMap` per script URL and document version, for example in a small LRU cleared on navigation, so later picks of the same page cost nothing. Name the eval case in the module comment. A parse-time limit would need a worker, so that belongs to the Performance lens.

## What is strong
- **All round 2 findings are fixed, each with a test:**
  - **Teardown timeout:** `browserProjectTeardown.ts:126-148` (`bounded`, `TEARDOWN_STEP_TIMEOUT_MS = 5_000`, injected clock), wired in at `browserAppSetup.ts` with `new BrowserProjectTeardown({ clock: mainClock })`.
  - **Up and Down after a slow first read:** `pickHover.ts`, the `stillOn` check after both awaits, plus `reoutline`.
  - **Tooltip position:** re-measured by a `ResizeObserver` in `ToolbarTooltip.tsx`, with `samePlacement` to avoid re-renders that change nothing.
  - **"Picking stopped." before the send sentence:** `PickAnnouncer.tsx` holds the pick-mode-off change back while `sending`. `pickAnnouncement` (`pickRow.logic.ts`) suppresses "Picking stopped." while sending.
  - **Unused gate member:** `guarded` is removed from `tabRequestGate.ts`.
  - **Old comment:** the `useBrowserBounds.ts` header is rewritten.
- **The band design is careful:**
  - `OutlineBand` has no Electron dependency and fails safe. A draw error calls `fail` → `dispose`, and after that `available` is false, so `PickHighlight.usableBand()` falls back to the engine outline (`pickHighlight.ts:160-163`).
  - The native window ignores the mouse before it is first shown, is `focusable: false`, and is only ever shown with `showInactive` (`pickBandWindow.ts:57-76,112`).
  - It removes its listeners on the parent window when it is destroyed (`:92-96`).
  - Strip order keeps the paper above the ink even when strips are clipped away (`pickBand.ts:113-119`).
  - The band is disposed through `BrowserTabPick.dispose` → `highlight.dispose()` (`BrowserTabPick.ts:266`), and it unsubscribes from `watchPlacement`.
- **Bounded, fail-closed source-map read:**
  - Same-origin checks on the script, the map and the sources (`sourceMapLocation.ts:183,211,173`).
  - `redirect: 'error'` and `credentials: 'omit'`, and the body is cancelled once it passes the cap (`pageResourceFetch.ts:29,47-68`).
  - Only fixed miss reasons are logged (`pickCaptureReads.ts`, `logger.debug(..., { reason: result.miss })`).
  - `resolveSourcePath` now uses `fileURLToPath`, which is correct for Windows `file:///C:/…`.
- **Pending-load gate:**
  - It is scoped to one `webContents` and one server, and never applies to a top-level load (`LocalFileServers.ts`, the `allowsRequest` branch).
  - It is cleared on commit, failure (only for the matching URL, so an older load's failure does not clear a newer one – `BrowserTab.ts`, the `did-fail-load` handler), stop, `did-stop-loading`, destroy and server close (`closeEntry`).
- **Covered-by check:** the `topmost` rule is read-only and must be named explicitly. The CDP allow-list now requires `ignorePointerEventsNone` as a boolean, and picking keeps the `click` rule (`pickHitTest.ts`, `cdpAllowList.ts`).
- **Comment echo filter:** fail-open, used once per write, and generation-guarded against a project switch. A `send` that throws is logged, not left as an unhandled rejection (`fileCommentEchoes.ts:50-96`).
- **Clean removal of the in-use chip:** `grep -rn "mediaInUse|TabMediaInUse|MEDIA_CAPTURE_UNOBSERVED" src` finds nothing. The schema tests assert that `inUse` is now refused (`browser-tab-schema.test.ts:141`, `BrowserTab.test.ts:89`).
- **Type safety:** no `any`, `@ts-ignore` or `@ts-expect-error` in the new browser code. The new casts are guarded: `resultValue` checks `isRecord` before `as Record<string, unknown>` (`pickCdp.ts:56-58,133`), and `version === 3` is checked before `as SourceMapInput` (`sourceMapLocation.ts:138-139`).

## Owner-pending items seen (not scored)
- **Item 27:** the live outline at a forced 2× scale on Retina screens. Now relevant only to the engine fallback, because the band is a separate window (`pickPainted.ts:8-16`).
- **Item 31:** keyboard tooltips are drawn in the pick-row band (`ToolbarTooltip.tsx`).
- **Item 32:** the pick-row break widths are estimates.
- **Items 17 and 19:** the fourth banner style, and strip-row folding.
- **Item 50:** Markdown view-mode buttons are still toggles in the toolbar row. The "…" menu now uses radio items (`ToolbarOverflow.tsx`, `choice` → `checkKind: 'radio'`).
- **Item 52:** the final macOS e2e run and the band bench on `898c9c34`. I did not run them, per the brief.

## Score rationale
There is no critical or high finding in the Code lens.
- **The one medium:** a spec rule (S-13 "git-ignored") that is not built. It sits in one function, has a clear fix (a bounded `git check-ignore` that fails closed) and needs one test. Its impact is a wrongly labelled file, not a leak.
- **The three lows:**
  - the band not following some scrolls, which is no worse than the engine outline it replaces;
  - the wait before Enter from the #449 queue, which was an owner decision;
  - repeated source-map work on every pick.
- **The rest:** tests, lint and typecheck are all green, and every round 2 finding is fixed with a regression test.

That matches anchor 8: no critical or high finding, and medium findings that are few, local and have a clear fix. A 9 needs the S-13 git-ignored check built and tested.

**Next steps, highest impact first**
1. Build the git-ignored check in `resolveSourcePath` (software-developer), with a unit test and an AC-037 e2e row (test-writer).
2. Guard `PickHighlight.follow` against a second wheel event, and re-follow on a zoom change or on the next pointer move over the same element.
3. Cache parsed source maps per script URL and document version (worth a Performance-lens look).
4. Record the spinner case and the typing-during-wait case for #449.

**Not checked**
- The ContextMenu and ToolbarOverflow files that came in with the develop merge (d7e3fcbf). I read only the radio-item change from 9a9cbfbd; the rest is outside the browser code this lens covers.
- E2e behaviour, by brief.
- Coverage numbers were not measured.
