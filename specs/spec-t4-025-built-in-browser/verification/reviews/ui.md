# UI review – spec 025

Reviewer: `erfana:ui-reviewer` (independent agent, not an author), 2026-11-04, against `873a9e4a`.


Score: 6/10
Counts: critical 0, high 2, medium 6, low 5

Repo root: `/Users/marcinobel/Projects/erfana/erfana` (paths below are relative to it). I read all four BrowserPanel stylesheets in full: `BrowserChrome.css`, `BrowserPanel.css`, `PickRow.css` and `StripRows.css`. I also read the decided Focus, Form and Permission band cards, the proposed Colors and Type cards, `docs/designs/browser/README.md` (§ States, Developer handoff, Differences in the build), and all seven baselines in `e2e/screenshots/browser-*-darwin.png`. I computed every contrast ratio from `src/renderer/src/styles/design-tokens.css` with a local WCAG luminance script.

**Not run:** `npm run lint:css` and `npm run design -- --check`. My standing rules forbid running scripts from the branch under review, so I checked their rules by hand instead (results under "What is strong"). The lead should run both commands before scoring is final.

## Findings

### [high] Secondary text fails WCAG AA contrast on the panel, dialog, sign-in and address-field surfaces
- `src/renderer/src/components/Panels/BrowserPanel/PickRow.css:492` – `color: var(--color-text-secondary);` on `.erf-brw-actions__crumb` (11px mono, on `--color-bg-elevated`)
- `PickRow.css:539` – `color: var(--color-text-secondary);` on `.erf-brw-actions__detail dt` ("Text" / "Source", 11px)
- `PickRow.css:563` – `color: var(--color-text-secondary);` on `.erf-brw-actions__note, .erf-brw-actions__chips`
- `StripRows.css:202` – `color: var(--color-text-secondary);` on `.erf-site-prompt__field` (the sign-in box's Username and Password labels, 11px, on `--color-bg-secondary`)
- `BrowserPanel.css:158-160` – `.erf-brw-address__badge--neutral { color: var(--color-text-secondary); }` (the "File" badge, 11px, on `--color-bg-input`)

**Why it matters:**
- `#858585` on `#2d2d30` measures 3.72:1, below the 4.5:1 that WCAG 1.4.3 requires for text.
- The project's own cards already rule this out. The Colors card says secondary text is for the app background only (`docs/design-system/system/foundations/colors.html:187`). The Type card says "Hints use tertiary text, never secondary … 3.72:1 · fail" (`type.html:145`).
- The failure shows in the committed baseline: `browser-prompt-actions-darwin.png` (the "Text" label and the crumbs).

**Fix:** use `--color-text-tertiary` (6.33:1 on `#2d2d30`) in all five rules. If the hierarchy needs a dimmer step, make it with weight or size, not this token.

### [high] The pick row's first banner clause is clipped mid-word at about 580px with the panel open
- `PickRow.css:75-85` – `.erf-brw-status { flex: 0 1 auto; … overflow: hidden; … white-space: nowrap; }`
- `PickRow.css:94-97` – `.erf-brw-banner-line__first { flex: 0 0 auto; … }`
- `pickRow.logic.ts:84` – `return { first: 'Picking – Esc or click outside closes the panel', rest: [] }`
- Baseline `e2e/screenshots/browser-pick-over-still-darwin.png`, 581px wide, shows "Picking – Esc or click outside closes the |", cut off at the width-preset icon. The "Page paused" chip is lost as well.

**Why it matters:**
- The design (README § Status slot priority, item 1) says the first clause "never truncates and never wraps" and has priority over every optional control (025-FR-065).
- README § Pick row says the width preset and the target "leave the row at narrow while the panel or dialog is open". I found no CSS or TSX that does this. `BrowserPanel.tsx:198-207` only sets `inert` on the rows.
- The "Differences in the build" table does not record it. Owner item 25 covers only the page-focus clause at 360px, not the panel clause at about 580px. A longer terminal name makes it clip at even wider tabs.
- The baseline now locks in the defect as correct.

**Fix:** while `pick.surface` is `panel` or `dialog`, give `.erf-brw-pick` a data attribute (for example `data-surface`). Add a container rule that hides `.erf-brw-width`, and shrinks `.erf-brw-target` to icon plus process, once the row is narrower than the first clause plus Pick element plus More. Then retake the baseline.

### [medium] The instruction dialog's text field uses `--color-border-subtle` – an invisible boundary, against the decided Form card
- `PickRow.css:696` – `border: var(--border-width) solid var(--color-border-subtle);` on `.erf-brw-dialog__field`

**Why it matters:**
- The field fill (`--color-bg-input`) and the dialog surface (`--color-bg-elevated`) are the same colour, `#2d2d30`. The only thing marking the field is its edge, and that edge measures 1.43:1 against the 3:1 that WCAG 1.4.11 requires.
- This is exactly the defect the decided Form card was written to fix: "The boundary is --color-border-input".
- The error state has a red edge and a message but no icon, which the Form card also requires.
- Rated medium rather than high: the field gets focus when the dialog opens, so the focus ring marks it most of the time.

**Fix:** set `border-color: var(--color-border-input)` (3.11:1). Add hover `--color-gray-500`, as `form.css:150` does. Add the error icon beside `.erf-brw-dialog__error`.

### [medium] Busy action buttons are dimmed on the whole button, so a focused one gets a faint ring
- `PickRow.css:603-606` – `.erf-brw-actions__action[aria-disabled='true'] { opacity: var(--opacity-disabled); cursor: not-allowed; }`
- `PromptActionsPanel.tsx:274` – `aria-disabled={busy !== null && busy !== action ? true : undefined}`. These buttons stay in the Tab cycle.

**Why it matters:** the decided Permission band card says: "The dim lives on the icon, never on the button: opacity on the button makes a group that the focus outline is inside, and the ring came out at roughly 2.3:1." This panel breaks that rule while a send is in flight.

**Fix:** wrap the label in a `<span>` and dim `.erf-brw-actions__action[aria-disabled='true'] > span`, as `BrowserPanel.css:81-83` already does for the tools.

### [medium] `.erf-brw-chip` is defined twice for two different components, and the rules bleed into each other
- `BrowserChrome.css:20-39` – the interactive address chip: `cursor: pointer`, `background: var(--color-bg-secondary)`, and `:hover` → `--color-bg-hover-solid`
- `PickRow.css:133-142` – the same selector for the neutral note chip, adding `margin-inline-start: var(--space-2); … line-height: var(--leading-snug);`
- The same class is used for both kinds: `AddressChips.tsx:106` (a button) and `PromptActionsPanel.tsx:257-258`, `InstructionDialog.tsx:160`, `PickRow.tsx:181-182` (static text)

**Why it matters:**
- Both files are global, so each gets the other's rules.
- Static labels such as "Page paused" and "The page changed after the pick" get a pointer cursor and a hover fill, so they look clickable when they are not.
- Address chips pick up an extra 4px margin on top of the flex gap.
- The handoff names `badge.css`'s neutral chip for the static kind.

**Fix:** rename the static chip (for example `.erf-brw-tag`) and give it no hover and no cursor. Keep `.erf-brw-chip` only in `BrowserChrome.css`.

### [medium] Explain is drawn as the filled primary button; the design draws all four actions as secondary, and the difference is not recorded
- `PromptActionsPanel.tsx:271` – ``className={`erf-brw-actions__action${action === 'explain' ? ' erf-brw-actions__action--primary' : ''}`}``

**Why it matters:**
- `docs/designs/browser/prompt-actions.html` draws Explain as `erf-button erf-button--secondary` in all 25 frames.
- README § Prompt-actions panel says the four buttons are "in the Buttons card's secondary look with a visible edge".
- The baselines show a violet-filled Explain (`browser-prompt-actions-darwin.png`).
- Explain sends with no further step and has focus when the panel opens, so the fill pushes the user toward an immediate send.
- The "Differences in the build" table has no row for this.

**Fix:** drop the `--primary` modifier, or add a Differences row and get the owner's sign-off.

### [medium] The pressed Pick element toggle has no forced-colours treatment
- `PickRow.css:55-59` – `[aria-pressed='true']` relies only on `border-color: var(--color-accent-secondary); background: var(--color-bg-selected);`. I found no `@media (forced-colors)` rule for `.erf-brw-pickbtn`.

**Why it matters:**
- In Windows high-contrast mode (forced colours) the system overrides both the border colour and the fill, so pressed and unpressed look the same.
- README § Cross-cutting cases asks for "pressed toggle full Highlight fill with HighlightText".

**Fix:** `@media (forced-colors: active) { .erf-brw-pickbtn[aria-pressed='true'] { background: Highlight; color: HighlightText; forced-color-adjust: none; } }`

### [medium] The certificate page's blocked "Proceed anyway" looks brighter than its resting state
- `BrowserPanel.css:414` – resting `color: var(--color-text-secondary);` (`#858585`)
- `BrowserPanel.css:425-428` – `[aria-disabled='true'] { color: var(--color-text-tertiary); cursor: not-allowed; }` (`#b0b0b0`, the lighter token)

**Why it matters:** while the input guard is active, the blocked button is lighter than the live one and closer to its hover colour (`#ccc`). The state cue points the wrong way, on a security-sensitive control.

**Fix:** keep the resting colour while blocked and dim with `opacity` on an inner span. Alternatively, raise the resting colour to `--color-text-tertiary` (8.52:1) and use secondary for blocked.

### [low] The build drifts from the developer-handoff tokens and spacing, with no Differences row
- `PickRow.css:281` – `.erf-brw-notice { … gap: var(--space-2); }`. README § Status slot says the send-notice actions sit `--space-6` after the sentence (VS-18).
- `PickRow.css:394` – `width: min(30rem, 100%);`. The handoff names `--comments-window-width` / `--comments-window-max-width`, and 30rem is a hard-coded copy of the 480px max.
- `BrowserPanel.css:56` – `height: var(--space-14);`, a spacing token used as a size. The handoff says `--input-height-sm` until `--toolbar-tool-height` lands.
- `PickRow.css:82` – status text uses `--color-text-secondary`; the handoff says `--color-text-tertiary`.

**Fix:** switch to the named tokens, or record each difference in the table.

### [low] `.erf-brw-banner` uses physical `border-left` while the rest of the feature uses logical properties
- `PickRow.css:633`, `638`, `642` – `border-left: …` / `border-left-color: …`, whereas `StripRows.css:29` uses `border-inline-start`.

**Fix:** use `border-inline-start` (and `-color`), so the rule flips correctly in right-to-left layouts.

### [low] The banner button has no hover state
- `PickRow.css:650-660` – `.erf-brw-banner__button` sets the secondary fill but has no `:hover`. Every sibling secondary button steps to `--color-btn-secondary-hover`.

**Fix:** add `.erf-brw-banner__button:hover { background: var(--color-btn-secondary-hover); }`

### [low] The address chip's inset focus ring carries no `deviates:` marker
- `BrowserChrome.css:42-46` – `outline-offset: calc(var(--space-1) * -1);`. The decided Focus card allows an inset ring only inside a scroller, or in the inner-gap form. The inner-gap form needs a transparent border, and this chip has a visible 1px border.
- The ring still measures 6.24:1, so this is about the record, not visibility. `focusRing.audit.test.ts:24` accepts the offset without checking the context.

**Fix:** add `/* deviates: docs/design-system/system/foundations/focus.html – chip sits inside the field's ring */` above the rule, plus an Exceptions row on the card.

### [low] Status separators include a typed space instead of equal CSS margins
- `PickRow.css:104-107` – `content: '· ';`. README § Pick row (VS-21) says the separators are "drawn by CSS with equal margins, never typed".

**Fix:** `content: '·'; margin-inline: var(--space-2);`

## What is strong
- **Token discipline holds in all four stylesheets.**
  - A grep for hex, `rgb()`, `hsl()`, numeric `z-index`, numeric `border-radius`, durations and keyframes across `BrowserPanel/*.css` returned only a comment line.
  - Every class starts with `erf-`.
  - Every `border-radius` is `var(--border-radius)`.
  - Every `z-index` is a token (`--z-popover`, `--z-dropdown`).
- **One focus ring everywhere:** 2px, `--color-border-focus`, `--space-1` outward. For example `BrowserPanel.css:85-88`, `PickRow.css:65-73` and `StripRows.css:154-160`. Rings measure 6.2–8.4:1.
- **Disabled tools follow the decided Permission band rule.** The icon dims, never the button, so the ring stays at full strength (`BrowserPanel.css:74-83`, `BrowserChrome.css:104-111`).
- **The address bar's security styling matches spec rule 2.**
  - Registrable domain in `--color-text-emphasis`.
  - Dimmed parts in tertiary (8.52:1).
  - Each part is its own bidi isolate (`BrowserPanel.css:206-234`).
  - The input boundary is `--color-border-input`, with the Form card's gray-500 hover (`BrowserPanel.css:123-131`).
- **Forced colours are handled** for the page frame, the pick frame (solid, dashed, dotted), the two-tone still-image outline and the strip rows (`BrowserPanel.css:277-281`, `PickRow.css:330-340` and `379-384`, `StripRows.css:239-246`).
- **Nothing animates,** so reduced motion is met by construction. The no-height-animation rule is written into each file header.
- **Strip rows follow the design:** secondary buttons only, no nudging primary (`StripRows.css:117-132`), and a static, not-allowed guard look (`StripRows.css:163-168`).
- **The certificate page matches the deck** in its baseline (`browser-page-certificate-darwin.png`): filled Back to safety, a text-style Proceed anyway, and the caution shown at once.
- **The "Differences in the build" table is honest and specific,** with 17 rows and a reason for each.

## Owner-pending items seen (not scored)
- Item 2 – owner approval of the browser screens and screen changes.
- Item 16 – the live pick outline is about 2.2:1 on white (also a Differences row).
- Item 17 – the fourth banner style on the Feedback card (`.erf-brw-banner--info`).
- Item 18 – React 19 source file:line not shown.
- Item 19 – strip rows do not fold.
- Item 25 – the AC-081 clause cut at 360px (my high finding is the separate panel clause at about 580px).
- Item 26 – the single-terminal target chooser.
- Item 27 – the live outline on Retina screens.

## Score rationale
There are two high findings: AA text-contrast failures on four surfaces, and the protected first banner clause visibly clipped in a committed baseline. That rules out the 7 anchor (at most one high) and puts the lens at 5–6: it works, but needs planned rework before release. It sits at the top of that band because token, radius, namespace and focus-ring discipline is clean across every stylesheet, and each finding has a small, local CSS fix. Fixing the two highs plus the Form-card and opacity mediums would support an 8.
