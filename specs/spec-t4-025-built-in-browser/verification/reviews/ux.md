# UX review – spec 025

Reviewer: `erfana:ux-reviewer` (independent agent, not an author), 2026-11-04, against `873a9e4a`.


Score: 7/10
Counts: critical 0, high 0, medium 4, low 6

## Findings

### [medium] The instruction dialog says it is modal, but the design and the project rule say it must not
`src/renderer/src/components/Panels/BrowserPanel/InstructionDialog.tsx:143-147`
```tsx
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
```
- The design says the opposite in two places: `docs/designs/browser/README.md:416` ("Modality | `aria-modal="false"`; the tab's other zones `inert` (M-46)") and `README.md:1046` ("Instruction dialog | `dialog`, `aria-modal="false"`"). `prompt-actions.html` line 39 adds that "the terminal and the rest of Erfana stay reachable".
- The dialog has no Tab trap. Nothing in `InstructionDialog.tsx`, `useBrowserKeys.ts:225-248` or `PickSurface.tsx` handles a plain Tab, so Tab from **Send** leaves the tab.
- `src/renderer/src/components/Dialog/CLAUDE.md` (#91) rules that "a dialog never claims a modality it does not enforce".
- What this does to users:
  - With `aria-modal="true"`, VoiceOver and NVDA limit their reading cursor to the dialog.
  - A screen-reader user cannot read the terminal or the editor, which the design says stay reachable.
  - A keyboard user's Tab still escapes, so screen-reader and keyboard behaviour disagree.
- This is not listed in the design's "Differences in the build" table (`README.md:1386` onward).
- Fix: set `aria-modal="false"`, as `PromptActionsPanel.tsx:171` already does. Keep the `inert` rows (`BrowserPanel.tsx:202-207`). Add a unit assertion in `InstructionDialog.test.tsx`.

### [medium] Screen-reader announcements differ from the design: refinements are silent and the visible status line is a live region
- `src/renderer/src/components/Panels/BrowserPanel/PickRow.tsx:164`:
  ```tsx
  <span className="erf-brw-status" aria-live="polite" data-testid={BROWSER_TEST_IDS.PICK_STATUS}>
  ```
- `src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:193-195`: `refine` only calls `browserTabGateway.refine(...)`, with no announcement.
- The design (`README.md:957`) says: "Fed into one always-mounted, visually hidden polite region per browser tab (M-45); the visible status slot has no live role." It also lists announcements for:
  - pick mode on ("Picking. Esc to stop.") and off ("Picking stopped.")
  - each refinement (*Announce – refined*, "Picked {tag}, {size spoken}.", `README.md:752`)
  - "Page paused." (said once)
  - the send, with the fallback named ("…Show terminal and Open capture are also in the target menu.", `README.md:778`)
- `grep -rn -e "Picking stopped" -e "also in the target menu" -e "Picked " src/renderer/src/components/Panels/BrowserPanel stores services` finds only a tooltip (`TargetChooser.tsx:119`). None of these strings is built.
- Effects:
  - **UC-001 step 3** (press Up to select the parent): a screen-reader user hears nothing. The panel's name changes through `aria-labelledby` on the chip, but a dialog's name change is not re-announced, and focus deliberately stays on Explain (`PromptActionsPanel.tsx:106-111`).
  - Because the visible slot is live, the hovered-element label is spoken politely on every hover change: `pickBanner('page', …, label)` returns `rest: [label]` (`pickRow.logic.ts:79`). Every F6 between page and toolbar also rewrites and re-announces the banner.
  - "Picking stopped" is never said: the slot just empties.
- WCAG 4.1.3 (Status messages). Confidence: definite against the design; the effect on users is probable.
- Fix:
  - Take `aria-live` off `.erf-brw-status`.
  - Add one hidden polite region per tab, as `StripRows.tsx:99` already does for the strip, and push the design's announcement strings into it: on/off, refined, paused, sent.
  - Do not feed hover labels into it.

### [medium] Toolbar tooltips never show on keyboard focus, so the AC-065 "first Esc hides the tooltip" path is neither built nor tested
- Every toolbar control uses only the native `title`, for example:
  - `NavigationRow.tsx:173`: `title={canGoBack ? \`Back (${back.label})\` : 'Back – no earlier page'}`
  - `PickRow.tsx:158`: `title={tooltip}`
- `grep -rln Tooltip src/renderer/src/components/Panels/BrowserPanel/` returns only `browserPanel.logic(.test).ts`, so no Erfana tooltip component is used.
- A native `title` shows on hover only, so a keyboard user never sees:
  - the shortcut hints
  - the pick tooltip's teaching line "Menus stay open while picking – click to pick" (025-AC-081 asks the tooltip to name both uses of the key)
- 025-AC-065 (`04-acceptance.md:210`) requires a tooltip on keyboard focus for every navigation-row and pick-row control, with a two-press Esc. The Tooltip card (`README.md:53`) says "Description on hover and focus… Esc-dismissible".
- The test named `025-AC-065 …` (`e2e/browser-keys.e2e.ts:302`) covers only key forwarding; it never exercises a tooltip.
- The Differences table records the gap only for the address badge (`README.md`, "Fold steps | Badge, icon-only"), not for the toolbar.
- Fix: either build focus tooltips over the Tooltip card's component and extend the AC-065 e2e, or record the gap in the Differences table and take the AC-065 wording to the owner.

### [medium] The current page-width choice is shown only by an icon that screen readers ignore
- `WidthPresetMenu.tsx:43-44`:
  ```tsx
  // The shared menu has no radio items: the current choice carries the check, as in More.
  icon: item.id === preset ? <Check size={14} strokeWidth={2} /> : <span className="erf-brw-more__blank" />,
  ```
  `MoreMenu.tsx:63` does the same.
- `ContextMenu.tsx:429` renders icons `aria-hidden="true"` with `role="menuitem"`, so which of Full, Phone or Tablet is current is not exposed. In More it is not exposed anywhere. The row button at least says "Page width: {preset}" (`WidthPresetMenu.tsx:77`).
- The design asks for `menuitemradio` in a `role="group"` (`README.md:608`; the WidthPresetMenu header comment itself says "three radio choices"). The Differences table records this only for the target chooser (`README.md:1398`), not for width.
- This affects UC-005 step 1. WCAG 4.1.2 / 1.3.1. Confidence: definite.
- Fix: add `checked?: boolean` to `ContextMenuItem`, rendering `role="menuitemradio" aria-checked`, and use it in both menus. Alternatively, record the gap in the Differences table.

### [low] F6 stops at the pick row on a first-run empty tab
- `BrowserPanel.tsx:69-70`:
  ```ts
  const ERFANA_PAGE_FOCUSABLE =
    '.erf-brw-frame__erfana button, .erf-brw-frame__erfana [tabindex="-1"]'
  ```
- `ErfanaPages.tsx:58-62`: with no history and no local addresses, the empty tab renders only `<p>` text, so nothing matches the selector.
- `useBrowserKeys.ts:216-218` then calls `focusPageArea()`, which focuses nothing (`BrowserPanel.tsx:174`). The F6 cycle from 025-FR-047 never reaches the address bar again, and nothing explains why.
- This hits the very first browser tab in a new project. Shift+F6 and Tab still work.
- Fix: give the empty page's first paragraph or hint `tabIndex={-1}`, or let `focusPageArea` fall back to `focusAddress()` when nothing matches. Add the case to `BrowserPanel.test.tsx` next to "moves F6 into an Erfana page".

### [low] At about 580 px the banner's first clause is cut mid-sentence
- The committed baseline `e2e/screenshots/browser-pick-over-still-darwin.png` shows "Picking – Esc or click outside closes the |", so the instruction is lost.
- The design's copy rule CF-12 says "the first banner clause must survive 40% longer".
- Related to owner item 25 (360 px) and item 19 (folding), but this happens at a much wider width.
- Fix: decide it together with item 25, for example a two-line wrap or a shorter panel-state clause.

### [low] The empty-tab hint has no full stop
- `ErfanaPages.tsx:75-76`: `Load your app, then click <strong>Pick element</strong> (…) to\n pick an element`
- Owner decision OD-9 (`README.md`, CF-2, which names "the hint") and `03-use-cases.md:16`: fixed sentences show with a full stop.
- Fix: add "." after "element".

### [low] Checkbox names repeat their descriptions
- `ClearDataDialog.tsx:117-129`: the `<label>` wraps the input, the label text and the description span. That span is also `aria-describedby`, so each checkbox's name is "Cookies and other site data Signs you out…" and the description is then read again.
- `SignInBox.tsx:114-126` has the same pattern for "Remember for this project".
- Fix: move the description span out of the `<label>`, or give the label text an id and use `aria-labelledby`.

### [low] An identical strip prompt arriving again is not announced
- `StripRows.tsx:55-59` sets `announcement` to `arrivalAnnouncement(fresh.row)`. When the new text matches the old one (for example the same origin asking for the camera again), the live region's DOM does not change, so nothing is said.
- Fix: clear the region before writing, or add a hidden counter or zero-width toggle per request.

### [low] The prompt-actions panel's accessible name does not follow the design
- `PromptActionsPanel.tsx:172` with `:229-233`: the name is the chip text "span#save-label · 101 × 18".
- The design (`README.md:736`) specifies "Actions for {tag}, {size spoken}", with the target and the key hint as the description. No `aria-describedby` is set.
- Fix: add a visually hidden name "Actions for {name}, {w} by {h}" and point `aria-describedby` at the footer's target and hint.

## What is strong
- **Guard and error flows (UC-001 E2, UC-004 E5):**
  - A guard banner takes focus to its button: `PromptActionsPanel.tsx:114-116` and `InstructionDialog.tsx:112-114`.
  - The banner uses `role="alert"`, while a pre-warning uses `role="status"`: `PromptActionsPanel.tsx:314`.
  - The empty-instruction error is tied to the field with `aria-invalid` and `aria-describedby`: `InstructionDialog.tsx:178-189`.
- **Accidental-press protection:**
  - The certificate page blocks Proceed anyway for 500 ms and ignores a press that began before the page appeared (`ErrorPages.tsx:163-167`).
  - Strip rows re-arm their guard when focus is restored (`StripRow.tsx:91-94`).
  - The panel acts only on a fresh press (`PromptActionsPanel.tsx:151-162`).
- **Address bar:**
  - It is a proper combobox with `aria-activedescendant` and a two-step Esc (`AddressBar.tsx:152-163, 187-198`).
  - A refused address is a `role="alert"` line the field points at (`StripRows.tsx:105`).
- **Load-error page:**
  - It follows FR-059's focus rule (Reload or the heading) and never pulls focus from another panel (`ErrorPages.tsx:43-50, 78-80`).
  - The copy is plain and gives a next step (baseline `browser-page-load-error-darwin.png`: "Is your dev server running? Start it in a terminal, then press Reload.").
- **Pointer-complete flow (025-NFR-011):**
  - The panel has × "Close – nothing is sent" and Parent and Child buttons.
  - The dialog has ← Actions, Cancel and Send.
  - Show terminal and Open last capture are also in the target menu, so the 5 s notice is not the only way in (`TargetChooser.tsx:72-79`; the notice pauses under focus, `PickRow.tsx:68-84`).
- **Focus handoffs:**
  - A Back or Forward button that disables itself while focused hands focus on (`NavigationRow.tsx:114-130`).
  - A strip row that leaves while holding focus restores focus to the next row or to the page (`StripRows.tsx:69-83`).
  - The find row has a polite count and "No matches." (`FindRow.tsx:102-104`).
- The renderer suite passes: `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/Panels/BrowserPanel` reports "Tests 324 passed (324)".

## Owner-pending items seen (not scored)
- **16:** the live pick outline is about 2.2:1 on a white page.
- **17:** the fourth banner style on the Feedback card.
- **19:** strip rows do not fold.
- **22:** the executable-download warning text.
- **25:** at a 360 px tab the banner's first clause is cut (related to my low finding at about 580 px).
- **26:** one terminal only. The target chooser shows a plain item instead of `menuitemradio` (recorded in the Differences table).
- **2:** approval of the screen designs. The status of the in-tab dialog modality and the width radios may change with it.

## Score rationale
I found no critical or high finding. The core flows UC-001 to UC-006 are complete for mouse and keyboard, and their error and guard states are carefully done. There are four medium findings across separate areas: dialog modality semantics, the announcement layer, keyboard-focus tooltips (AC-065), and menu state exposed to screen readers. Each departs from the committed design or from a project rule without being recorded in the Differences table. That matches anchor 7 ("several medium findings that touch more than one area") rather than 8 ("medium findings are few, local"). Fixing the `aria-modal` value, the width-radio state, and either building or recording the announcements and focus tooltips would justify an 8 or higher.

Note: the brief's `test-results/browser-tab-ui/` folder does not exist in the main checkout. Those PNGs are only in older agent worktrees from 2026-11-03, so I used the committed baselines under `/Users/marcinobel/Projects/erfana/erfana/e2e/screenshots/browser-*-darwin.png` instead.
