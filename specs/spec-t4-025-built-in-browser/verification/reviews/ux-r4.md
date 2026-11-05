Score: 8/10


Counts: critical 0, high 0, medium 0, low 7

Reviewer: erfana:ux-reviewer (independent agent, not an author), 2026-11-05, against a06eb678.

**What I checked:** the rubric and the round 3 fix record in `aaa-review.md`, the round 3 UX report, the changes in `git diff 898c9c34..a06eb678`, the busy-state code in the browser panel, the design note's Announcements, Strings and Differences sections, and the screenshots under `test-results/browser-tab-ui/`. The five unit-test files for the fixed parts pass: `npx vitest run -c vitest.renderer.config.ts` on `useBrowserPick`, `PromptActionsPanel`, `InstructionDialog`, `PickAnnouncer` and `pickRow.logic` gave 5 files and 71 tests passed. I did not run Playwright or any build, and I did not test with a real screen reader.

## Findings

### [low] While a send is waiting, Cancel and × look clickable and Esc does nothing silently
Evidence:
- A close the user starts now does nothing while a send is in flight (`src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:174`). That is the right behaviour.
- The × only changes its name and tooltip (`PromptActionsPanel.tsx:262-264`). Its CSS has no disabled look and keeps its hover background (`PickRow.css:592-612`). Only the Parent and Child step buttons get a disabled style (`:614-625`).
- The dialog's Cancel gets `aria-disabled` (`InstructionDialog.tsx:202-210`). But the disabled dimming only applies to a `<span>` inside the button (`PickRow.css:784-786`), and Cancel's text is not in a span. So Cancel looks normal.
- Esc is caught and swallowed with no feedback (`PromptActionsPanel.tsx:146-150`, `InstructionDialog.tsx:130-134`).
- While the send waits, the visible hints still say "Esc closes the panel" (`PromptActionsPanel.tsx:305`) and "Picking – Esc or click outside closes the panel" (`pickRow.logic.ts:84`, `:86`).
- The reason ("Already sending – the prompt is in the terminal") appears only in a hover tooltip or to a screen reader.

User impact:
- For 0.4 to 8 seconds (the time the agent's terminal takes to accept the text), a sighted user who clicks Cancel, clicks × or presses Esc sees nothing happen, and the hints on screen say the opposite.
- The "Sending…" label on the pressed button softens this, and the panel closes by itself when the send ends.
- Standards: Nielsen H1 (show what the system is doing) and H4 (consistency). Confidence: probable.

Fix:
- Add `.erf-brw-actions__close[aria-disabled='true']` with the same not-allowed cursor, no hover background and dimmed icon as the step buttons.
- Wrap Cancel's text in `<span>` so the existing dimming applies.
- While busy, change the footer and pick-row hints to "Sending – the panel closes when the agent takes it".

### [low] The shell warning still offers "Choose terminal" when there is only one terminal
Evidence:
- The wording is fixed: "Start your agent there, then pick again" (`pickRow.logic.ts:168`).
- The button is still **Choose terminal** (`pickRow.logic.ts:169`, `PromptActionsPanel.tsx:318-322`). It opens a menu that lists the same terminal marked "No agent running", plus Show terminal and Open last capture (`TargetChooser.tsx:74-89`).
- The menu is no longer a dead end: choosing the terminal checks it again (`useBrowserPick.ts:324-329`), and Show terminal is there.

User impact:
- The label promises a choice the user does not have. The useful step – showing the terminal so they can start the agent – is one menu deeper than it needs to be.
- Standard: Nielsen H2 (speak the user's language). Confidence: possible.

Fix:
- With one terminal, make the warning's button **Show terminal**, and keep **Choose terminal** for when a second terminal exists (follow-up to Q-26).

### [low] The design note and the screenshots lag behind the round 3 fixes
Evidence:
- The design note's string for × is still only "Close – nothing is sent" (`docs/designs/browser/README.md:743`).
- Line 105 still says a click on a toolbar control "closes the panel".
- The note does not mention the busy-close behaviour, the `CLOSE_WHILE_SENDING` string or the "Sending…" name, and there is no Differences row for them. The new Announcements row (`:966`) was added correctly.
- The screenshots are older than the fix: `pick-panel-over-still.png` is from 17:16, the commit is from 23:57. That screenshot still shows "Choose another terminal".

User impact:
- People checking the build against the note at user acceptance testing (UAT) will see behaviour the note does not describe, and a picture with the old wording.
- Standard: Nielsen H4. Confidence: definite.

Fix:
- Add the busy-close string and behaviour to the Strings table and the panel section, or add a Differences row.
- Take the `browser-tab-ui` screenshots again.

### [low] Two dialog messages still arrive with their text already in place (carried from rounds 2 and 3)
Evidence:
- "The page reloaded – …" is a `role="status"` element created already holding its text (`InstructionDialog.tsx:164-169`). Screen readers often skip a message like that.
- The empty-field `role="alert"` is not created again on a second empty Send (`:188-193`), so it is not repeated.

User impact:
- A screen-reader user may not hear that the page reloaded, or that the second Send was refused again.
- Standard: WCAG 4.1.3 (status messages). Confidence: probable.

Fix:
- Send "page reloaded" through `PickAnnouncer`.
- Re-key the error element on each empty submit, so it counts as new.

### [low] Under Wayland the live outline is about 2.1:1, and users are not told (carried)
Evidence:
- The gap is recorded in the Differences table (`README.md:1403`).
- I found no mention of Wayland in `docs/user-guide/` (searched for "wayland").

User impact:
- On default Ubuntu and Fedora desktops the hover outline can be hard to see on white pages.
- Standard: WCAG 1.4.11 (contrast of non-text parts). Confidence: definite (recorded).

Fix:
- Add a user-guide note with the `--ozone-platform=x11` workaround, or record the owner's acceptance.

### [low] In high-contrast mode the live outline ignores the user's colours (carried)
Evidence:
- I found no forced-colours branch in `src/main/services/browser/pick/pickOutlineColours.ts` or `pickBand*.ts` (searched for "forced" and "inForcedColorsMode").
- The still image does switch colours (`PickRow.css:542-551`).

User impact:
- A Windows high-contrast user sees the outline change colour when the panel opens.
- Contrast stays at about 18:1, so this is not a failure. Confidence: possible.

Fix:
- When the system is in high-contrast mode, take the outline colours from the system palette, or record the difference.

### [low] No manual test step for a real mouse moving across the outline window (carried)
Evidence:
- The live outline is drawn on a separate window that mouse clicks are meant to pass through.
- In the spec folder, I found the phrases "click through" and "real pointer" only in review reports, not in a manual test step.
- Every automated test sends input from inside the app, which skips the operating system's own hit test that this window depends on.

User impact:
- If clicks or scrolling stop passing through on some operating system, hover and pick break there, and no test would notice.
- Confidence: possible.

Fix:
- Add a manual UAT step on macOS and Windows: hover across the outline's edge, click through it, and scroll over it.

## What is strong
- **The round 3 problem is fixed at its root.** The single `close()` function now ignores Esc, Cancel, click outside and the toolbar while a send is in flight (`useBrowserPick.ts:53-54`, `:174`). A page change or a hidden tab still closes, which is correct. The test `ignores the user's closes while a send waits for Enter, but a page change still closes` checks all four cases and confirms that nothing reaches main.
- **The × and Cancel no longer promise something false.** While sending, they say "Already sending – the prompt is in the terminal", and the text field is read-only (`InstructionDialog.tsx:180`). This matches the design note's "read-only while sending" (`README.md:413`).
- **The busy button's spoken name now matches its visible label.** Both say "Sending…" (`PromptActionsPanel.tsx:293`, `:299`), which meets WCAG 2.5.3 (label in name).
- **The send is now spoken when it starts.** "Sending {action} to {terminal}…" is said once, the "Sent …" message still takes priority, and the design note's Announcements table has the new row (`pickRow.logic.ts:273`, `README.md:966`). Test: `says that a send started, once, while it waits for Enter`.
- **The earlier work still holds:** focus goes back to the page after a page change, the announcer keeps "Picking stopped." back while a send is in flight, the toolbar's radio-style menu items are built correctly, and the outline uses ink and paper colours (18.5:1).
- **The in-use chip and React 19 rows** in the design note's Differences table are now up to date (`README.md:1405-1406`).

## Owner-pending items seen (not scored)
- **2** – approval of the browser screen designs.
- **17** – the fourth banner style on the Feedback card.
- **19** – strip rows do not fold.
- **27** – the live outline on Retina screens needs a manual check at UAT.
- **31** – keyboard tooltips sit in the pick-row band; a tooltip on the navigation row cannot be hovered (WCAG 1.4.13).
- **32** – pick-row break widths with the panel or dialog open.
- **50** – Markdown view modes use on/off toggles, not a radio group.
- **52** – the final macOS e2e run and the outline speed check.
- **Decided, not defects:** Q-26 (one terminal), Q-34 (no in-use chip), Q-16 (ink-and-paper outline drawn by Erfana), Q-44 (queued send).

## Score rationale
- **No critical, high or medium finding.** All three round 3 mediums are fixed in code and covered by tests:
  - the misleading close during a send,
  - the silent wait and the name mismatch,
  - the shell-warning wording.
- **What is left is seven low findings:**
  - three new ones: the busy controls have no visible disabled look, the "Choose terminal" label, and the out-of-date design note and screenshots;
  - four carried over from earlier rounds.
- **Why 8 and not 9:** the anchor for 9 allows "at most a few low findings". Seven is more than a few, and four of them have survived several rounds. The 8 anchor ("ready to ship, no critical or high") fits.
- **What would reach 9:** the visible disabled look for × and Cancel (two CSS rules and one `<span>`), the design note and screenshot refresh, and the Wayland note. All three are small.
- **Not verified:** real screen-reader output, real send durations with a running Claude Code, and real mouse movement across the outline window.

Files cited:
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/PromptActionsPanel.tsx
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/InstructionDialog.tsx
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/PickRow.css
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/pickRow.logic.ts
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/TargetChooser.tsx
- /Users/marcinobel/Projects/erfana/erfana/docs/designs/browser/README.md
- /Users/marcinobel/Projects/erfana/erfana/test-results/browser-tab-ui/pick-panel-over-still.png
