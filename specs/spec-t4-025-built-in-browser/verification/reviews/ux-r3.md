# UX review – spec 025 (round 3)



Reviewer: `erfana:ux-reviewer` (independent agent, not an author), 2026-11-05, against `898c9c34` on `feature/built-in-browser`. Repo root: `/Users/marcinobel/Projects/erfana/erfana`. Paths below are relative to it.

Score: 7/10
Counts: critical 0, high 0, medium 3, low 5

Method: I read the rubric (`specs/spec-t4-025-built-in-browser/verification/aaa-review.md`), the round-2 UX report, FR-061 and FR-019 as amended, the design note's Announcements and Differences sections, and the diff `8fd4ed87..898c9c34` for the browser renderer, the pick band, the terminal send queue and the toolbar overflow. I also looked at screenshots under `test-results/browser-tab-ui/` (dated 2026-11-05, Linux keyring row visible). I did not run Playwright, Docker, builds or the unit tests. Test names are cited from source.

## Findings

### [medium] Closing during the queued send says "nothing is sent", but the prompt is still submitted
Evidence:
- The × button is named and titled "Close – nothing is sent" (`src/renderer/src/components/Panels/BrowserPanel/PromptActionsPanel.tsx:259-261`).
- Esc calls `onClose()` whether or not a send is in flight (`PromptActionsPanel.tsx:142-147`). The dialog's Esc and **Cancel** do the same (`InstructionDialog.tsx:130-134`, `:198-200`). So does a click on the still image (`BrowserPanel.tsx:456-457`). None of them checks `busy`.
- `close()` drops the capture and focuses the page (`useBrowserPick.ts:166-175`). It cannot stop the send that is already running. `sendWith` goes on (`:288`), and on success it sets "Sent {action} to {terminal}" (`:302`).
- The paste is already in the terminal at that point. Enter follows once output settles (`src/renderer/src/stores/useTerminalStore.ts:237-246`).
- The wait is no longer about 200 ms. It is at least 400 ms of quiet, 3 s with no output, 8 s for output that never pauses, and up to 60 s after one long pause (`src/renderer/src/stores/terminalInputSettle.ts:23-38`). The lead's "max 3 s" covers only the no-output case.
- The design also says the dialog field is "read-only while sending" (`docs/designs/browser/README.md:413`). The textarea has no `readOnly` (`InstructionDialog.tsx:174-186`), so edits made during the wait are silently dropped.

User impact:
- A reviewer who backs out of a slow "Sending…" gets the opposite of what the control promised. With **Change…**, that means the agent edits source code the user cancelled.
- Nielsen H3 (user control) and H5 (error prevention); Shneiderman S6 (easy reversal). Confidence: probable – the code path is direct; not run.

Fix:
- While `busy !== null`, make Esc, ×, **Cancel** and the click-outside close do nothing.
- Give × and **Cancel** `aria-disabled="true"` with a reason, e.g. "Already sending – the prompt is in the terminal".
- Set `readOnly={busy}` on the textarea.
- Add a `useBrowserPick.test.tsx` case: close during a pending `executePrompt` keeps the panel and sends nothing extra.

### [medium] The longer send wait is silent for screen readers, and the busy button's name does not match its label
Evidence:
- During the wait, the busy action shows the text "Sending…", but its accessible name stays `aria-label={ACTION_NAMES[action]}` ("Explain") (`PromptActionsPanel.tsx:289-296`). This fails WCAG 2.5.3 (label in name) while busy. `aria-busy` alone is not reliably announced on a button.
- `pickAnnouncement` has no sentence for a send that has started (`pickRow.logic.ts:266-282`). The design's Announcements table has none either (`docs/designs/browser/README.md:959-978`). Until "Sent … ." a screen-reader user hears nothing.
- The other actions are `aria-disabled` for the whole wait (`PromptActionsPanel.tsx:291`).
- The send-confirming outline flash (`pickFlash.ts:20`, 1 s) also waits for `closeSent`, which now comes after Enter.
- How often (inferred): when the agent is already working, its spinner keeps output from going quiet, so the 8 s cap applies (`terminalInputSettle.ts:33`, tested by `resolves "cap" at exactly ENTER_MAX_DELAY_MS for a fast spinner`). Sending while the agent works is the normal loop in UC-001 and UC-004.

User impact:
- 1 to 8 s (rarely up to 60 s) of a frozen panel with no spoken progress. Users tend to retry or back out, which leads into the finding above.
- Nielsen H1; WCAG 4.1.3 and 2.5.3. Confidence: definite for the name mismatch; probable for the delay length.

Fix:
- Drop `aria-label` on the action buttons (the visible text is already the name), or switch it to "Sending…" while busy.
- Have `PickAnnouncer` say "Sending {action} to {terminal}…" once when `sending` turns on (add it to the design's Announcements table).
- When the wait passes about 1 s, show "Waiting for {terminal} to take the text" in the pick-row status slot, so the delay is explained.

### [medium] The shell pre-warning tells the user to "Choose another terminal" when only one exists
Evidence:
- `pickRow.logic.ts:168`: "`${terminal} is running ${process}, not an agent. Choose another terminal, or start your agent there and pick again – …`". The banner button is **Choose terminal** (`PromptActionsPanel.tsx:315`).
- FR-061 now scopes v1 to one terminal session; choosing another terminal is follow-up work (`requirements/02-requirements.md:525`, owner decision 2026-11-05).
- The menu that **Choose terminal** opens therefore lists that same terminal, marked "No agent running", plus Show terminal and Open last capture (`TargetChooser.tsx:72-89`).
- The screenshot `test-results/browser-tab-ui/pick-panel-over-still.png` shows this banner as the panel opens on a fresh project with `bash` in front – the first-run case of UC-001.

User impact:
- The first instruction a new user reads points at an action that cannot help. Pressing the button gives a menu with nothing to choose (dead end).
- Nielsen H2 and H9; cognitive walkthrough Q1/Q3 fail at "first send". Confidence: probable.

Fix:
- For one terminal, use the wording "{terminal} is running {process}, not an agent. Start your agent there, then pick again – …".
- Make the banner button **Show terminal**, or keep **Choose terminal** only when there is more than one terminal.
- Update the deck row (`docs/designs/browser/README.md:785`) to match.

### [low] Under Wayland the live outline falls back to about 2.1:1
- `pickBandWindow.ts:42-48` returns `false` for Wayland, and the engine's one-colour outline is used instead. The Differences row records "about 2.1:1 on a white page".
- Wayland is the default session on current Ubuntu and Fedora, and Electron's `auto` ozone hint picks it there.
- This is WCAG 1.4.11 (non-text contrast) for the hovered-element state. It is lessened by the textual label in the pick-row status slot.
- Recorded but not in the owner queue. Confidence: definite (documented).
- Fix: name Wayland in the user guide with `--ozone-platform=x11` as a workaround, or add an owner-queue item to accept it.

### [low] In forced-colours mode the live band and the still-image outline use different colours
- The band always paints `--color-brand-black` and `--color-white` (`pickOutlineColours.ts:27`).
- The still image switches to `Highlight`/`Canvas` under `forced-colors` (`PickRow.css:534-539`).
- A Windows high-contrast user sees the outline change colour when the panel opens, and the live band ignores their chosen palette. Both are still about 18:1, so this is not a contrast failure. Confidence: possible concern.
- Fix: when `nativeTheme.inForcedColorsMode` is on, take the pair from `systemPreferences.getColor('highlight')` and the window's text colour, or accept and record the difference.

### [low] Real-pointer hover through the band window is not covered by any test
- The band relies on `setIgnoreMouseEvents(true)` (`pickBandWindow.ts:68`).
- Every e2e drives input through main-side `webContents.sendInputEvent` (acceptance test rules, "Input path (S-27)", `requirements/04-acceptance.md:7`). That path skips the OS hit test the click-through window depends on.
- `e2e/browser-pick-mode.e2e.ts:316-373` checks that the band is drawn, not that a real mouse reaches the page under it.
- Fix: add a manual UAT step on macOS and Windows – hover across the band's edge, click through it, and scroll the wheel over it.

### [low] Two dialog messages still appear already holding their text (carried from round 2)
- "The page reloaded – …" is a `role="status"` paragraph created with its text (`InstructionDialog.tsx:164-168`).
- The empty-field `role="alert"` (`:187-191`) is not re-announced on a second empty Send.
- The banner part of the round-2 finding is fixed (`aria-describedby` at `PromptActionsPanel.tsx:330-342`).
- Fix: send "page reloaded" through `PickAnnouncer`, and re-key the error node on each empty submit.

### [low] The design note still describes the removed in-use chip and the old React 19 behaviour
- The in-use chip, the capture chip and the in-use tab states are still specified in `docs/designs/browser/README.md:119-120, 138, 345, 593, 623, 1037`. FR-019 now says no indicator, and there is no Differences row for the removal.
- The React 19 Differences row says "no source line shows for them… needs a new dependency – an owner decision". The build now resolves through source maps (`src/main/services/browser/capture/sourceMapLocation.ts:1-27`, owner Q-18).
- UAT reviewers checking screens against the note will look for things that are gone, or not expect things that now show (H4).
- Fix: add a Differences row for FR-019, and rewrite or close the React 19 row.

## What is strong
- **All round-2 findings are addressed in code except one low:**
  - Focus after a page-change close goes to the page area (`useBrowserPick.ts:182-209`). The ordering is right: `surface` turns `'none'` in the same render as `afterNavigation`, so focus is already on the body when the effect checks. Tests: `moves focus to the page area when focus was inside the panel` and two siblings.
  - The page-changed, element-gone and load-a-page notes are spoken whether or not a capture is held (`pickRow.logic.ts:232`). Test: `says the page change, element gone and load-a-page notes`.
  - A tooltip that cannot be drawn no longer takes Esc (`ToolbarTooltip.tsx:153-154, 195`).
  - A second identical send is said again (`sentKey`, `pickRow.logic.ts:267`).
  - The announcement says "Open last capture", matching the menu.
  - Below 800 px, the notice's icon buttons have tooltips (`PickRow.tsx:113-124`).
- **The announcer handles the new send timing well.** Pick mode ending while a send is in flight is held back, so the user hears "Sent …" rather than "Picking stopped." (`PickAnnouncer.tsx:65-68`). Test: `says the send, not "Picking stopped.", when pick mode goes off one render before the notice`.
- **The live outline design is sound for visibility.**
  - Ink–paper–ink, 1 + 2 + 1 px, gives 18.5:1 between the two colours, so one line clears 3:1 on any page (`pickBand.ts:26-33`, `pickOutlineColours.ts:5-7`).
  - It is drawn outside the page and stays out of its capture.
  - It hides while the page view is hidden (`BrowserPicks.ts:289-291` returns `null`) and while scrolling (`pickHighlight.ts:136-150`).
  - It never takes focus (`focusable: false`, `showInactive`).
- **Toolbar radio items are correctly built:**
  - `menuitemradio` with `aria-checked` (`ContextMenu.tsx:444-445`).
  - A decorative, `aria-hidden` lime check (`:475-478`).
  - The row button keeps `aria-pressed`.
  - Width presets in More and the row menu now report as radio items (`MoreMenu.tsx:66`, `WidthPresetMenu.tsx:47`).
  - Each menu has only one radio set, separated from the other items, so no `group` is needed.
- **Keyboard routing stays correct.** Toolbar focus is reported again when the page took focus without a blur (`useBrowserKeys.ts:181-190`), so key routing does not go stale after a strip row disappears.

## Owner-pending items seen (not scored)
- **2** – approval of the browser screen designs.
- **17** – the fourth banner style on the Feedback card.
- **19** – strip rows do not fold.
- **27** – Retina live outline needs a manual check at UAT.
- **31** – keyboard tooltips sit in the pick-row band; a navigation-row bubble cannot be hovered (WCAG 1.4.13).
- **32** – pick-row break widths with the panel or dialog open.
- **50** – Markdown view modes use `aria-pressed` toggles, not a radio group (decided Toolbar card).
- **52** – final macOS e2e run and band bench.
- **Decided, not defects:** Q-26 (025-AC-077 narrowed to one terminal), Q-34 (no in-use chip; the permission prompt and site settings remain), Q-16 (ink and paper live outline drawn by Erfana).

## Score rationale
- No critical or high finding.
- The anchor for 8 needs medium findings that are "few, local and have a clear fix". This round has three mediums in two areas:
  - Two in the busy state of a send (the misleading close and the silent wait). Both come from the new queued send, which stretched a 200 ms window to between 0.4 and 8 s or more.
  - One in the shell-guard wording, which the one-terminal scope made wrong.
- That fits anchor 7: "several medium findings that touch more than one area".
- Each fix is small and local: one `busy` check plus the name and announcement change in `PromptActionsPanel` and `useBrowserPick`, and one copy change in `pickRow.logic.ts`. With those done, the lens would meet anchor 8 or 9.
- The work since round 2 is otherwise good:
  - All round-2 mediums and four of the five lows are fixed and tested.
  - The pick band is a strong visibility answer.
  - The radio-item menus are semantically correct.

Not verified: real-mouse hover through the band, actual send durations against a running Claude Code, and anything visible only in a fresh macOS screenshot.
