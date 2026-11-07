# UX review – spec 025

Reviewer: `erfana:ux-reviewer` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).

Score: 8/10
Counts: critical 0, high 0, medium 2, low 5

## Findings

### [medium] When a page change closes the prompt-actions panel, keyboard focus is lost
`src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:173-181`
```ts
  // A page change: the panel closes with a note and main lets the capture go; the dialog stays (025-FR-053).
  useEffect(() => {
    if (!afterNavigation || dialogAction !== null || tabId === null || captureId === null) return
    browserTabGateway.closePick({ tabId, captureId, reason: 'cancel' }).catch(warn('Browser closePick failed'))
    const store = useBrowserPickStore.getState()
    store.dropCapture(tabId, captureId)
    store.showNote(tabId, 'pageChanged')
    browserStill.release(tabId, PICK_STILL_HOLDER)
  }, [afterNavigation, dialogAction, tabId, captureId])
```
- The panel takes focus when it opens: Explain, or the action the dialog came back from (`PromptActionsPanel.tsx:116-121`).
- Every other way the panel closes hands focus back. `close()` calls `focusPage()` for `esc`, `cancel` and `clickOutside` (`useBrowserPick.ts:164`), and a send calls `focusPage()` (`:275`).
- This path does not. `dropCapture` makes `PickSurface` return `null` (`PickSurface.tsx:51`), so the focused button is removed from the page and focus falls to the document body.
- From there the panel root's handlers no longer fire: F6 (`useBrowserKeys.ts:230`) and Esc do nothing. `onBlur` also reports toolbar focus off (`:185`).
- Who hits this: UC-004 and UC-001 with a dev server that reloads the whole page while the panel is open. This is common, because the agent is editing the source at the same time.
- What it breaks: WCAG 2.4.3 (focus order) and Nielsen H3 (user control). Confidence: probable. I did not run it (e2e is off-limits), but the code path is direct.
- Fix: call the page-area focus in the same effect, only when focus was inside the surface, and add a case to `useBrowserPick.test.tsx` next to the existing `pageChanged` tests (`:180-200`):
  ```ts
  const hadFocus = document.activeElement?.closest('.erf-picker-owned') != null
  ...
  if (hadFocus) focusPage()
  ```

### [medium] Removing the live role from the status line silenced the notes the design still wants spoken
`src/renderer/src/components/Panels/BrowserPanel/pickRow.logic.ts:218` and `:249-251`
```ts
const SPOKEN_NOTES: ReadonlySet<StatusNote> = new Set<StatusNote>(['topOfPage', 'backAtStart'])
...
  const sameCapture = next.captureId !== null && next.captureId === prev.captureId
  if (sameCapture && next.note !== null && next.noteSeq !== prev.noteSeq && SPOKEN_NOTES.has(next.note)) {
```
- Round 1 rightly moved announcements from the visible status slot (`PickRow.tsx:186`, no longer `aria-live`) to `PickAnnouncer`. But the announcer speaks only two of the seven notes, and only while the same capture is held.
- **Page changed.** The design's Announcements table lists "Page changed | The page changed – pick the element again." (`docs/designs/browser/README.md:969`). This note is set after the capture is dropped (`useBrowserPick.ts:178-179`), so `sameCapture` is false and nothing is said. Together with the focus loss above, a screen-reader user hears only silence when the panel vanishes.
- **Element gone.** "That element is gone – pick again" follows a keyboard Up/Down in the panel (025-FR-027). It is silent, so the press seems to do nothing.
- **Load a page.** "Load a page to pick an element" follows Ctrl/Cmd+E or a press on the disabled Pick element. It is silent too; focus on the button at least reads its `aria-description`.
- The unit test locks in the gap: `pickRow.logic.test.ts:175` expects `pageMoved` to give `null`, and no test covers `pageChanged`.
- What it breaks: WCAG 4.1.3 (status messages). Confidence: definite against the design for "Page changed"; probable for the other two.
- Fix:
  - Speak `pageChanged` whenever its `noteSeq` changes, without the `sameCapture` condition.
  - Add `elementGone` and `loadAPage` as sentences with a full stop, like the end notes.
  - Extend `PickAnnouncer.test.tsx`.

### [low] A focus tooltip with no room to show still swallows the first Esc
`src/renderer/src/components/Panels/BrowserPanel/ToolbarTooltip.tsx:186-193` with `:254`
```ts
      if (event.key !== 'Escape' || event.isComposing || current === null) return
      if (current.by === 'focus' && document.activeElement === current.trigger) {
        // The first Esc is the tooltip's alone (025-AC-065); the next one routes.
        event.preventDefault()
        event.stopPropagation()
```
- The Esc handler checks `shown`, not the drawn `view`. When `placeTooltip` returns `null` (less than 80 px of room, for example in pick mode at narrow widths or with a pick-row control focused near the banner), nothing is drawn, yet the first Esc is still consumed.
- The user presses Esc and nothing visible happens (Nielsen H1).
- The design says a tooltip that cannot show takes no Esc: "if no side is free it is not shown", and for the badge "the first Esc already does the field's Esc" (OD-16, `README.md:254`).
- `ToolbarTooltip.test.tsx:202` tests only the placement maths, not Esc.
- Fix: consume Esc only while `view !== null` (keep a `placementRef`), and add a unit test.

### [low] The second identical send in a row is not announced
`pickRow.logic.ts:246`
```ts
  if (next.sent !== null && next.sent !== prev.sent) {
```
- A second "Sent Explain to Terminal" that replaces a notice still on screen (the notice pauses under focus or hover, `PickRow.tsx:89`) has the same text, so nothing is said.
- The re-keyed node in `PickAnnouncer.tsx:66` only helps when the facts change.
- Fix: put the notice's identity (an object or sequence number from `setNotice`) into `PickAnnounceFacts` and compare that.

### [low] The announcement names "Open capture", but the menu item says "Open last capture"
- `pickRow.logic.ts:247`: `` `${next.sent}. Show terminal and Open capture are also in the target menu.` ``
- `TargetChooser.tsx:88`: `{ label: 'Open last capture', action: () => onOpenCapture(lastCapture) }`
- The fallback the user is told about does not match the item they will find (Nielsen H4, consistency). The wording comes from the design deck (`README.md:778`), so this is a copy-deck fix.
- Fix: say "Open last capture" in the announcement (and in the deck row), or rename the menu item.

### [low] Below 800 px, Show terminal and Open capture are bare icons with no tooltip
`PickRow.tsx:113-126` and `PickRow.css:413-417`
```css
/* Under 800px the actions keep their names but show icons only. */
@container (max-width: 800px) {
  .erf-brw-notice__label {
    display: none;
  }
```
- Screen readers keep the names (`aria-label`). Sighted users get two unlabelled icons for 5 seconds, with no `title` and no `tooltipProps`.
- This is the moment UC-001's postcondition ("A notice names the terminal…") wants them used (Nielsen H6, recognition over recall).
- Fix: add `{...tooltipProps('Show terminal')}` and `{...tooltipProps('Open capture')}`. They sit in the pick row, so the band tooltip already covers them.

### [low] Messages that appear with their text, and a guard button with no description
- `InstructionDialog.tsx:164-168`: `<p … role="status">` for "The page reloaded – …" is created already holding its text.
- `InstructionDialog.tsx:187-191`: the empty-field `role="alert"` is the same. A second empty Send changes nothing in the page, so it is not said again.
- `PromptActionsPanel.tsx:331-342`: the guard banner is `role="alert"` created with its text, and focus moves at once to its button ("Choose terminal" or "Open terminal"). The button is not described by the banner text, so the focus announcement can override the alert, and the user hears a button name without the reason.
- The project's Feedback card (proposed) calls this pattern unreliable, and the build already avoids it for the sign-in line (Differences table, "Sign-in rejection line").
- These touch UC-001 A5, E1 and E2, and UC-004 E5.
- Fixes:
  - Add `aria-describedby` from the banner button to the banner text id.
  - Feed "page reloaded" through the tab's always-mounted announcer.
  - Re-key or briefly clear the error on a repeat submit.

## What is strong
All ten round-1 findings are fixed in the code:
- `aria-modal="false"` on the dialog (`InstructionDialog.tsx:147`).
- `menuitemradio` with `aria-checked` in the shared menu (`ContextMenu.tsx:418-419`), used by `WidthPresetMenu.tsx:46` and `MoreMenu.tsx:65`.
- F6 on an empty tab wraps to the address bar (`BrowserPanel.tsx:175-178`).
- The full stop on the empty-tab hint (`ErfanaPages.tsx:76`).
- Checkbox names come from the label text alone (`ClearDataDialog.tsx:123`, `SignInBox.tsx:120`).
- A repeated strip prompt is announced again (`StripRows.tsx:64-66`).
- The panel's name is "Actions for {tag}, {w} by {h}", with the footer as its description (`PromptActionsPanel.tsx:183-197`).

Other strengths:
- **The announcement layer follows the design's rule:** one always-mounted hidden polite region per tab (`PickAnnouncer.tsx:65`). Hover labels are kept out of it by type, because `storeFacts` never reads `label`. Each sentence is a new keyed node, so a repeated sentence is still spoken. The refinement wording puts the size the way a screen reader says it ("320 by 200", `spokenSize`).
- **Keyboard tooltips meet 025-AC-065:**
  - They show at once on `:focus-visible` and after 400 ms on hover. Focus wins over hover.
  - With focus, the first Esc hides the tooltip and the second routes. With hover only, the Esc routes and hides it in the same press.
  - A text change follows a focus tooltip and drops a hover one.
  - The text is also the control's `aria-description`, so screen-reader users get it even when no bubble shows.
  - The e2e `025-AC-065 a toolbar tooltip shown by keyboard focus…` (`e2e/browser-keys.e2e.ts:440-508`) walks Reload, Pick element (off and on), the target chooser and the hover case, asserting focus and the routing state at each step.
- **F6, Ctrl+Tab and Esc routing** cover the panel and dialog states exactly as 025-FR-049 and 025-FR-050 ask (`useBrowserKeys.ts:191-248`).
- **The dialog keeps the rows above the page `inert`** without claiming to be modal (`BrowserPanel.tsx:200-207`).
- **Error and guard flows** are carefully built: the guard moves focus to its button, the empty instruction is tied to the field with `aria-invalid` and `aria-describedby`, and accidental-press guards are in place. The send-failure toast says what was kept: "your text is still in the dialog – press Send to try again" (`useBrowserPick.ts:267`).
- **Test run:** `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/Panels/BrowserPanel src/renderer/src/components/ContextMenu` reports `Tests  518 passed (518)`.

## Owner-pending items seen (not scored)
- **31:** keyboard tooltips are drawn in the pick-row band, on one line cut with "…", and a navigation-row bubble cannot be hovered (WCAG 1.4.13 "hoverable"). Recorded in the Differences table.
- **32:** the pick-row break widths while the panel or dialog is open. This decides whether round 1's 580 px banner cut is fixed; the committed baselines predate the fix.
- **16:** the live pick outline is about 2.2:1 on a white page.
- **19:** strip rows do not fold.
- **26:** one terminal only, so the target menu shows a plain item rather than `menuitemradio`.
- **2:** approval of the screen designs.
- **34:** FR-019 in-use chips cannot be observed in Electron 44.
- Already recorded in the Differences table, not a defect: the address badge tooltip is still the native `title`, on hover only (the AC-065 badge clause).

## Score rationale
There is no critical or high finding. The two medium findings are in the same place, the page-change close of the prompt-actions panel and its notes, and each has a short, clear code fix. That fits anchor 8: "medium findings are few, local and have a clear fix". The other five findings are low: wording, an edge-case Esc, announcement repeats, and icon tooltips. All round-1 medium findings are fixed in the code, and the new announcer and tooltips match the design's rules. The remaining gaps are in which notes the announcer speaks and in one focus handoff that was missed, not in the design of the system.

## Round 2 notes
- I checked every round-1 finding against `8fd4ed87`; all ten are addressed in code. The 580 px banner cut is claimed fixed by `17426356` ("width preset leaves, target folds"), but I could not see it, because the baselines (`/Users/marcinobel/Projects/erfana/erfana/e2e/screenshots/browser-pick-over-still-darwin.png`) predate the fix. Treat it as unverified until they are retaken.
- The silent-notes finding was introduced by the round-1 fix itself. Taking `aria-live` off the status slot was correct, but the new announcer's list is narrower than the design's (`README.md:955-977`).
- I ran no e2e. Unit tests only, as quoted above. Nothing in the repo was edited.
