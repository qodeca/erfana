# UI review – spec 025

Reviewer: `erfana:ui-reviewer` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).

Score: 8/10
Counts: critical 0, high 0, medium 3, low 3

Scope: all seven stylesheets this branch adds or changes (`BrowserPanel/{BrowserChrome,BrowserPanel,PickRow,StripRows}.css`, `Tabs/BrowserTab.css`, `browserPopup/PopupStrip.css`, the `ContextMenu.css` addition), plus the TSX that sets their classes. I checked them against the decided Focus, Menu and Permission band cards, the proposed Buttons, Tooltip and Forced colours cards, and the `docs/designs/browser/README.md` Differences table. Contrast ratios are computed from `design-tokens.css` with a WCAG luminance script. I did not run lint, design-sync or e2e myself. I rely on the lead's passing `lint:css` and `design -- --check` runs, and my own greps of these files found no hex/rgb/hsl, no bare `z-index` or `border-radius`, and no non-token font size, weight or line height. Nothing was rendered, so the layout findings below come from reading the CSS.

## Findings

### [medium] The long first clauses of the pick banner can still clip in roughly the 400–680px tab band (probable)
- `PickRow.css:357-371` – the panel and dialog fold stops at `@container (max-width: 660px) { .erf-brw-pick[data-surface] .erf-brw-target { display: none; } }`. Nothing below 660px gives back more room.
- `PickRow.css:85-95` – `.erf-brw-status { flex: 0 1 auto; … overflow: hidden; … white-space: nowrap; }`, while `PickRow.css:104-107` sets `.erf-brw-banner-line__first { flex: 0 0 auto; … }`. When room runs out, the slot clips the clause instead of wrapping or shrinking it.
- `pickRow.logic.ts:84` `'Picking – Esc or click outside closes the panel'`, `:86` `'Picking – Esc or Cancel closes the dialog'`, `:90` `'Picking – the panel closed when you left; pick again'`.
- My estimate at 13px system sans:
  - The row needs about 505px of content: Pick element (≈113) + gaps and margin (≈28) + the panel clause (≈290) + the *Still image* tag (≈74).
  - Below 380px the label hides, but about 420px is still needed.
  - The row has 24px of padding, so with the panel open, tabs between about 400 and 530px clip.
- `outPanelClosed` is worse. `PickRow.tsx:171` sets no `data-surface` when the surface is `none`, so the width icon and the full target stay on the row next to a clause of about 320px.
- `e2e/browser-pick-mode.e2e.ts:337-342` (`firstClauseFit`) is only used for the short page clause (`:368`, `:380`). No test measures the panel, dialog or `outPanelClosed` clauses.
- The Differences row ("so the panel's or dialog's first clause … never clip") is therefore not yet shown to be true.

**Why it matters:** 025-FR-065 and README § Status slot priority say the first clause "never truncates and never wraps". Round 1's high finding is narrowed from about 580px down to about 530px, but not closed. Owner item 32 says the break widths are estimates. It does not accept clipping.

**Fix:**
- Below the width where the clause plus Pick element still fit, hide `.erf-brw-pickbtn__label` and the tag whenever `data-surface` is set. Also give the `outPanelClosed` place the same `data-surface`-style fold.
- Add `firstClauseFit` checks for the panel, dialog and `outPanelClosed` clauses at 400px and 480px tabs.

### [medium] The pressed Pick element toggle opts out of forced colours but does not repaint its border or focus ring
- `PickRow.css:67-73`: `@media (forced-colors: active) { .erf-brw-pickbtn[aria-pressed='true'] { background: Highlight; color: HighlightText; forced-color-adjust: none; } }`
- With `forced-color-adjust: none`, the authored colours survive:
  - the lime border (`PickRow.css:57`), 1.33:1 on a white Canvas;
  - the violet focus ring (`PickRow.css:75-83`, `--color-border-focus`), 2.20:1 on a white Canvas.

**Why it matters:**
- Rule 4 of the Forced colours card says `forced-color-adjust: none` "must then repaint every state with system colours itself".
- In a light Windows contrast theme, a focused, pressed Pick element shows a ring under the 3:1 a focus indicator needs (WCAG 1.4.11 and 2.4.7).
- The button is commonly pressed from the keyboard, so pressed plus focused is a normal state.

**Fix:** inside the same media block add `border-color: Highlight;` and `.erf-brw-pickbtn[aria-pressed='true']:focus-visible { outline-color: CanvasText; }` (or `Highlight` with an offset that lands on Canvas).

### [medium] The input guard's "blocked look" on strip rows is barely visible and disappears in forced colours
- `StripRows.css:163-168`: `.erf-site-prompt__button[aria-disabled='true'], .erf-site-prompt__close[aria-disabled='true'] { background: var(--color-btn-secondary-bg); color: var(--color-text-tertiary); cursor: not-allowed; }`
  - The label only moves from 6.87:1 to 5.09:1 on the same fill and edge.
- `StripRows.css:239-246` has no forced-colours rule for `[aria-disabled]`. In a contrast theme the text colour is overridden to ButtonText, so the blocked state is gone completely.

**Why it matters:**
- The Site prompts card (`site-prompts.css:124-128`, OD-6) says the guard shows "the Buttons card's blocked look … so a slow or switch user sees why nothing happened".
- The Buttons card blocked look (`button.css:206-218`) is a transparent fill, a dimmed edge and the label at `--opacity-disabled`.
- The card's forced-colours rule (`button.css:283`) gives disabled `GrayText`, as the Forced colours card's map also says.
- This is a security-relevant cue, and it is hard to see.

**Fix:** wrap the labels in `<span>` and dim `> *` with `opacity: var(--opacity-disabled)`. Set the fill to `transparent`. Add `@media (forced-colors: active) { .erf-site-prompt__button[aria-disabled='true'], .erf-site-prompt__close[aria-disabled='true'] { color: GrayText; border-color: GrayText; } }`.

### [low] Disabled pick-row controls still react to hover
- `PickRow.css:48` `cursor: pointer;` and `PickRow.css:51-54` `.erf-brw-pickbtn:hover { background: var(--color-bg-hover-solid); color: var(--color-white); }` are not reset for `[aria-disabled='true']` (`:62-64` dims only the svg).
- The same applies to `.erf-brw-actions__step:hover` (`:543-546`) against `[aria-disabled='true']` (`:549-551`).
- The Buttons card says "Hover and active do nothing" on a disabled button. `.erf-brw-tool:disabled` (`BrowserPanel.css:76-80`) already does this correctly.

**Fix:** `.erf-brw-pickbtn[aria-disabled='true'], .erf-brw-actions__step[aria-disabled='true'] { cursor: not-allowed; } …[aria-disabled='true']:hover { background: transparent; color: var(--color-text-primary); }`

### [low] The decided Focus card's Exceptions row for the element picker is out of date
- `docs/design-system/system/foundations/focus.html:354` "(outline inside the page, spec 025 – planned)" and `:358` "No `<code>src/</code>` site yet."
- The two-tone ring now ships in `PickRow.css:471-479` (`.erf-brw-still__outline`). The row also says the engine draws the two-tone ring on the live page, but the build draws one colour (owner item 16).

**Fix:** rewrite the row so it names `PickRow.css` (still image, two-tone) and the live-page one-colour outline, pending item 16.

### [low] Literal sizes and a duplicated hidden-text helper in the browser tab CSS
- `BrowserTab.css:19-20` `min-width: 80px; max-width: 300px;` and `:149-150` (`!important` copies). They mirror `HtmlPreviewTab.css:24-25`, but no token exists for them.
- The visually-hidden rule exists twice: `BrowserPanel.css:25-35` (`.erf-brw-hidden`) and `BrowserTab.css:93-101` (`.erf-brw-tab__sr`).
- `BrowserTab.css:21` uses asymmetric physical padding, where the rest of the feature uses logical properties.
- Lint passes these in `src/` (per CLAUDE.md, spacing and size tokens are convention there). This is about consistency, not visibility.

**Fix:** add `--tab-min-width` / `--tab-max-width` tokens shared with `HtmlPreviewTab.css`. Use one hidden-text helper. Use `padding-inline: var(--space-6) var(--space-2)`.

## What is strong
- **Every round-1 finding was acted on:**
  - Secondary text on raised surfaces is now tertiary (6.33:1): `PickRow.css:594`, `641`, `665`, `StripRows.css:202`, `BrowserPanel.css:160`.
  - The dialog field uses `--color-border-input` (3.11:1) with a gray-500 hover and an error icon (`PickRow.css:803-838`, `InstructionDialog.tsx:188-191`).
  - The busy dim moved to the label (`PickRow.css:709-712`, `PromptActionsPanel.tsx:296`).
  - The static tag is split out as `.erf-brw-tag` (`PickRow.css:149-159`).
  - All four actions are secondary (`PromptActionsPanel.tsx:288`).
  - The certificate guard now dims the label, never brightens it (`BrowserPanel.css:426-435`).
  - The banner uses logical borders and has a hover state (`PickRow.css:739-770`).
  - The chip's inset ring has its `deviates:` marker (`BrowserChrome.css:41-47`) and an Exceptions row (`focus.html`).
  - The separator is drawn by CSS with equal spacing (`PickRow.css:114-118`).
- **Token discipline holds** in all seven stylesheets: no colour literals, every radius is `var(--border-radius)`, every `z-index` is a token, and every class is `erf-`.
- **One focus ring everywhere:** 2px `--color-border-focus`, offset `--space-1` outward. It measures 8.40:1 on the app background, 5.01:1 on gray-800 and 5.78:1 on the selected fill. The inset cases (chips, strip rows, suggestion rows, tabs) follow the decided Menu and Focus cards or carry a marker.
- **The new tooltip matches the proposed Tooltip card exactly:** gray-800 fill, subtle edge, `--shadow-md`, `--z-tooltip` and a CanvasText forced-colours edge (`PickRow.css:176-219`). Its text measures 6.87:1.
- **The instruction dialog's primary Send matches the design deck:** 13 of 14 frames draw it as `erf-button--primary`.
- **Forced colours are handled** for the page frame, the pick frames (dashed and dotted Highlight), the still outline (Highlight with a Canvas outline), the strip rows and the tooltip.
- **Nothing animates** over the native view. Tab transitions use `--transition-fast` and fall under the global reduced-motion rule (`index.css:32`).

## Owner-pending items seen (not scored)
- Item 2 – screen approval.
- Item 16 – the live outline is about 2.2:1 on white.
- Item 17 – the fourth banner style: `.erf-brw-banner--info` (`InstructionDialog.tsx:164`) has no CSS of its own and falls back to the neutral edge.
- Item 19 – strip rows do not fold.
- Item 26 – the single-terminal chooser.
- Item 27 – the outline on Retina screens.
- Item 31 – tooltips drawn in the pick-row band.
- Item 32 – pick-row break widths. My first medium finding is a clip below the last break, not the choice of break widths.

## Score rationale
There are no critical or high findings. Three medium findings remain, each confined to one or two rules with a clear CSS fix: a residual clause clip band, an incomplete forced-colours opt-out, and a weak guard look. That matches the 8 anchor ("medium findings are few, local and have a clear fix"). It is not a 9, because mediums remain and one of them is round 1's protected-clause defect, narrowed but not shown closed.

## Round 2 notes
- All 13 round-1 findings are addressed in 17426356.
- Round 1's second high (the panel clause clipped at about 580px) is mostly fixed: at 581px the target now leaves the row, so the old baseline width fits. By my estimate it still clips at about 400–530px, and for `outPanelClosed` at wider widths. I scored it as medium.
- Round 1's forced-colours medium is fixed for the fill but opens the new ring and border gap above.
- 8fd4ed87 touches only `useNavFold`, with no visual CSS change.

Files referenced:
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/PickRow.css
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/StripRows.css
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/BrowserPanel.css
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/BrowserChrome.css
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/pickRow.logic.ts
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Panels/BrowserPanel/PickRow.tsx
- /Users/marcinobel/Projects/erfana/erfana/src/renderer/src/components/Tabs/BrowserTab.css
- /Users/marcinobel/Projects/erfana/erfana/docs/design-system/system/foundations/focus.html
- /Users/marcinobel/Projects/erfana/erfana/e2e/browser-pick-mode.e2e.ts
