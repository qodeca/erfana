# UI review – spec 025 (round 3)



Reviewer: `erfana:ui-reviewer` (independent agent, not an author), 2026-11-05, against `898c9c34`. All paths below are relative to `/Users/marcinobel/Projects/erfana/erfana`.

Score: 8/10
Counts: critical 0, high 0, medium 2, low 5

**Scope**
- Stylesheets: the eight stylesheets on the feature path – `BrowserPanel/{BrowserChrome,BrowserPanel,PickRow,StripRows}.css`, `Tabs/BrowserTab.css`, `browserPopup/PopupStrip.css`, `ContextMenu/ContextMenu.css` and `ToolbarOverflow/ToolbarOverflow.css`.
- Main-process outline: `pickBand.ts`, `pickBandWindow.ts`, `pickOutlineColours.ts` and `electron.vite.design-tokens.ts`.
- Overflow and menu code: the `radioMark` and `choice` code in `ContextMenu.tsx` and `ToolbarOverflow.tsx`.
- Cards: the decided Focus card and the decided Toolbar overflow card (both changed on 2026-11-05), and the proposed Element picker card with its new paper variant.
- Design note: `docs/designs/browser/README.md` with its Differences table, and ADR 0007 with its 2026-11-05 amendment.
- Commits: every feature commit since `8fd4ed87` (`git log --first-parent 8fd4ed87..898c9c34`, 13 commits).

**Lint and design-sync were not run by me.**
- My reviewer rules forbid running scripts from the branch under review, because that branch controls them. This covers `npm run lint:css`, which runs `stylelint` with the repo's own config and plugins, and `npm run design -- --check` (`node scripts/design-sync.mjs`).
- In place of their output I read `.stylelintrc.json:14-243` and ran the same checks by hand over the eight stylesheets:
  - no hex, `rgb()` or `hsl()`;
  - every `border-radius` is `var(--border-radius)`;
  - every `z-index` is a `var(--z-*)` token;
  - every font size, weight and line height is a token or `inherit`;
  - every class this feature adds is `erf-`. The only non-`erf-` selectors are the older `context-menu-*` classes and third-party dockview classes, and the `erf-` lint rule does not cover any of these files (`.stylelintrc.json:68-74`).
- The new docs CSS uses tokens only: `focus.html` `.pick-page*` and `picker.css:58-60` `.erf-picker-outline--paper`.
- The contrast bake targets in the changed cards follow the README contract (`docs/design-system/README.md:96-97`).
- **The lead must attach their own `lint:css` and `design -- --check` exit codes for `898c9c34` to this report.**

Contrast ratios are computed from `design-tokens.css` with the WCAG luminance formula. Nothing was rendered.

## Findings

### [medium] The still-image outline loses its inner line in forced colours, which goes against the note's forced-colours rule (definite violation of M-33; the visible effect is probable)
- `src/renderer/src/components/Panels/BrowserPanel/PickRow.css:531` draws the inner ink line as `box-shadow: inset 0 0 0 var(--border-width) var(--color-brand-black);`.
- The forced-colours block at `PickRow.css:534-539` repaints only `border-color: Highlight` and `outline-color: Canvas`. It adds no CanvasText line.
- The Forced colours card says forced colours remove `box-shadow` (`docs/design-system/system/foundations/forced-colors.html:95`). So in a Windows contrast theme the inner line is simply gone.
- `docs/designs/browser/README.md:391` asks for "outer 1px Canvas, 2px Highlight, inner 1px CanvasText (**a nested pseudo-element, not a shadow**)".
- The still image is a bitmap, and forced colours do not recolour it. Over a picture whose colours sit near the theme's Highlight, the CanvasText line is the part that should carry the edge.
- The live band ignores forced colours too. ADR 0007 records that as a known risk (`docs/adrs/0007-pick-overlay-engine-drawn-through-cdp.md:78`), so it is listed under the low findings, not here. The still image has no such record.

**Fix:** draw the inner line as a pseudo-element, which also matches the note:
```css
.erf-brw-still__outline { box-shadow: none; }
.erf-brw-still__outline::after {
  content: ''; position: absolute; inset: 0;
  border: var(--border-width) solid var(--color-brand-black);
}
@media (forced-colors: active) {
  .erf-brw-still__outline::after { border-color: CanvasText; }
}
```

### [medium] The picked look on the still image has no fill and no doubled edge, but the deck and the new picker frame draw both, and the Differences table does not record it (definite)
- The build draws outline only:
  - `StillImage.tsx:16-18` says "two-tone outline – outline only, no fill (owner decision Q2)".
  - `PickRow.css:522-532` has no fill and no second edge.
- The design draws the picked look:
  - `docs/designs/browser/README.md:391`: "Selected adds a light accent fill and, so it is a shape too, a doubled edge".
  - `README.md:174`: step 4 is "Still image with the outline in its selected look".
  - `erf-picker-outline--selected` appears 40 times in `prompt-actions.html`, 2 times in `picking.html` and once in `menus-and-data.html`. These are the panel and dialog screens the owner will approve under item 2.
- The frame added on 2026-11-05 repeats the gap: `docs/design-system/system/patterns/picker/index.html:117` reads "Picked, on the still image – the same ink-and-paper outline with the light accent fill". That describes a look the build deliberately does not draw.
- Q2 (`.local/autopilot.md:161`, ADR 0007 decision 6) is worded about the **live** highlight. Applying it to the still image is the builder's reading, and it is not recorded as a difference.
- The Differences table at `README.md:1395-1416` has no row for it. The row amended on 2026-11-05 (`README.md:1402`) covers colours only.

**Why it matters:** the brief's fidelity check is the Differences table. The state shown most often in the deck is drawn differently in the app, and nothing says so.

**Fix (pick one):**
- Add a Differences row: "Still image, picked look | light accent fill and doubled edge | outline only | Q2 read as covering the still image too".
- Or add `.erf-brw-still__outline--selected` with `background: color-mix(in srgb, var(--color-accent-primary) 12%, transparent)`, as `picker.css` already does for `--selected`.

Either way, the picker card's frame at `index.html:117` should match whichever is chosen.

### [low] Three documents still describe the pre-11-05 outline
- `specs/spec-t4-025-built-in-browser/requirements/02-requirements.md:367` (025-FR-026) still says "The live outline is a plain engine-drawn outline … so the decided Focus card is unchanged; the card's two-tone outline is drawn on the still image" and "The outline shall be drawn by the engine … (the DevTools-protocol overlay)". The build draws an Erfana band (`pickBand.ts:3-18`), and the Focus card was changed (`focus.html:364-391`).
- `docs/adrs/0007-pick-overlay-engine-drawn-through-cdp.md:79` says the Focus card's picker row "still names … accent … updating it is the owner's call". Commit `9a9cbfbd` has since updated it (Q-46).
- `docs/designs/browser/README.md:1192` still lists `--color-accent-primary` and no `--color-white` for "Pick overlay on the still image". The CSS uses `--color-white` (`PickRow.css:529`).

**Fix:** reword FR-026 through the spec-change path (ADR 0007 already asks for this). Strike the ADR 0007 bullet at line 79. Swap the token in `README.md:1192`.

### [low] Known limits of the live band are in ADR 0007 but missing from the Differences table
- The live band draws ink and paper even in forced colours (`pickOutlineColours.ts:28`; ADR 0007:78). It does not use the Canvas, Highlight and CanvasText lines that `README.md:391` and `:485` ask for.
- After a scroll that is not a wheel (keys, script, smooth scroll), the band stays where the element was until the next mouse move (ADR 0007:76).
- Both are visible differences from the note, and `README.md:1402` mentions neither.
- The visibility effect is small: ink on paper is 18.49:1 (computed), so one of the two tones still clears 3:1 on any page.

**Fix:** add both to the amended Differences row. Optionally, in `pickOutlineColours.ts`, use `systemPreferences.getColor('highlight' / 'window' / 'window-text')` while `nativeTheme.inForcedColorsMode` is on.

### [low] The menu check column uses a physical margin, and its comment is out of date (from the develop merge plus `9a9cbfbd`)
- `src/renderer/src/components/ContextMenu/ContextMenu.css:125` sets `margin-left: var(--space-6);` on a column the card places "at the inline end".
- The comment at `:114-117` still says "The check of a menuitemcheckbox". Since `radioMark: 'check'` (`ContextMenu.tsx:69-77`, `:475`) it also draws for `menuitemradio` items.
- The rest of the file uses physical margins as well (`:59`, `:91`), so this is a consistency nit, not a regression.
- Contrast is fine: the lime check is 11.55:1 on `--color-bg-tertiary` and 10.47:1 on `--color-bg-hover-solid` (computed).

**Fix:** use `margin-inline-start: var(--space-6);` and change the comment to "a checked menuitemcheckbox or a `radioMark: 'check'` menuitemradio".

### [low] Round-2 consistency low is still open, and the hidden-text helper now has four copies
- `src/renderer/src/components/Tabs/BrowserTab.css:19-20` and `:149-150` still hold `min-width: 80px; max-width: 300px` (the second pair with `!important`).
- The visually-hidden rule now exists in four places: `BrowserPanel.css:25-35`, `BrowserTab.css:93-101`, and two new copies at `PickRow.css:155-163` and `PickRow.css:408-416` (added in `85357e1f`).

**Fix:** add `--tab-min-width` and `--tab-max-width` tokens, shared with `HtmlPreviewTab.css`. Keep one `.erf-brw-hidden` helper and apply it to the label (or `@extend`-style shared selectors) in the 380px and 560px container rules.

### [low] Band lines may draw unevenly at fractional display scales (possible concern – needs a look on real hardware)
- `pickBand.ts:98-104` rounds every strip to whole DIP (device-independent pixels).
- At 125% or 150% scale, 1 DIP is 1.25–1.5 device pixels. A native `View` edge can then snap to 1 or 2 device pixels per side, so the two ink lines may come out different widths.
- On the still image, by contrast, CSS draws the lines by sub-pixel layout.
- This is not a contrast risk, because the 18.49:1 pair holds. It may be a look difference between the live and still outlines, which the ADR says "look identical".

**Fix:** check at Windows 125% during UAT (alongside owner item 27). If uneven, snap strip edges to device pixels with `screen.getDisplayMatching(...).scaleFactor`.

## What is strong
- **The new outline is token-driven from end to end.**
  - Main has no colour literal of its own. The build resolves `--color-brand-black` and `--color-white` from `design-tokens.css` (`electron.vite.design-tokens.ts:48-60`).
  - They are inlined as `__ERFANA_OUTLINE_INK__` and `__ERFANA_OUTLINE_PAPER__`, and read in exactly one place (`pickOutlineColours.ts:15-28`, with typed declarations in `src/main/env.d.ts:19-26`).
  - The still image uses the same two tokens by name (`PickRow.css:529-531`).
- **The live band and the still outline have the same shape.**
  - Band (`pickBand.ts:105-114`): an ink ring 4px thick starting 1px outside the border box, with a 2px paper ring over it at the border box. That leaves 1 ink + 2 paper + 1 ink.
  - Still image (`PickRow.css:529-531`): border-box `2px white` border, `1px` ink outline outside it, `1px` inset ink line.
- **The contrast case is sound and baked.**
  - Ink on paper is 18.49:1 (my calculation matches the baked 18.48:1 at `focus.html:384-386` and `picker/index.html:159`).
  - With that ratio, one of the two tones is at least √18.49 ≈ 4.3:1 from any background, which is more than 3:1.
  - The accent-page case is baked at 8.39:1 (`picker/index.html:160`), and the paper-only weak case honestly shows 2.20:1 with no verdict (`focus.html:380`).
- **The decided-card edits follow the process.**
  - Focus card: the picker Exceptions row was rewritten with live frames on three page colours (`focus.html:364-391`, Q-46). `reviewed="2026-10-28"` was correctly left alone, as `docs/design-system/README.md:234-235` requires of agent edits.
  - Toolbar overflow card: rule 7 now covers radio items (`toolbar-overflow/index.html:150-154`). The owner row was added (`:530`), the exception row was removed, both `deviates:` markers were deleted from `MarkdownToolbar.tsx` and `MermaidToolbar.tsx`, and `deviations.html` dropped from 33 to 31.
- **Radio items are done the minimal, typed way.** `ToolbarAction.choice` maps to `checkKind: 'radio', radioMark: 'check'` (`ToolbarOverflow.tsx:169`). The tests assert the role, `aria-checked`, the kept icon and the end check (`MarkdownToolbar.overflow.test.tsx:239-258`, `MermaidToolbar.overflow.test.tsx:131-144`). A disabled current direction dims its check with its label (`ContextMenu.css:129-131`), as the card says.
- **Every round-2 finding is closed in `85357e1f`:**
  - Clause clip: labels are hidden visually only and the tag leaves below 560px (`PickRow.css:399-422`). Twelve new tests check panel, dialog and `outPanelClosed` at 400px and 480px tabs (`e2e/browser-pick-mode.e2e.ts:436-472`; not run by me).
  - Forced-colours pressed toggle: the edge is Highlight and the ring is CanvasText (`PickRow.css:83-94`).
  - Strip guard: uses the Buttons card's blocked look, with a GrayText forced-colours rule (`StripRows.css:162-185`, `:262-267`).
  - Disabled hover is reset (`PickRow.css:66-75`, `:604-611`).
  - The Focus card row was refreshed.
- **The in-use chip was removed cleanly.** `BrowserChrome.css` lost only `.erf-brw-chip--static` (`c56b9718`), and the FR-019 amendment explains why.
- **The design screens follow the new outline.** All 70 outline uses across the three browser design screens carry `erf-picker-outline--paper` (grep count: 28 + 40 + 2), so the deck and the build agree on colour.

## Owner-pending items seen (not scored)
- **Item 2** – screen approval of `docs/designs/browser/`. My second medium finding should be settled at this step.
- **Item 17** – the fourth banner style (`.erf-brw-banner--info`).
- **Item 19** – strip rows do not fold.
- **Item 27** – the live outline on Retina, which needs a manual check. My fractional-scale low finding belongs with it.
- **Item 31** – toolbar tooltips are drawn in the pick-row band.
- **Item 32** – the pick-row break widths are estimates.
- **Item 50** – Markdown view modes in the row are toggle buttons, not a radio group (this predates the branch).
- **Q-47** – the saved screenshot file keeps the accent outline (`__ERFANA_ACCENT_PRIMARY__`, `electron.vite.design-tokens.ts:56`). It therefore differs from the on-screen ink-and-paper outline by owner decision.

## Score rationale
- **No critical or high findings.**
- **Two medium findings, both local with a clear fix:**
  - an inner line drawn as a shadow, which forced colours drop;
  - an unrecorded difference in the picked look between the deck and the build.
- **Five low findings,** all documentation, consistency, or a possible rendering detail.
- **Rubric fit:** this matches the 8 anchor ("medium findings are few, local and have a clear fix"). It is not a 9, because two mediums remain.
- **Round 3 overall:** the main change since round 2 – the ink-and-paper outline drawn by Erfana – is well built. It is token-sourced, gives the same shape live and on the still image, has proven contrast, and its card edits were approved by the owner. It does not lower the score.
- **Caveat:** the score assumes the lead's `lint:css` and `design -- --check` runs on `898c9c34` exit 0. I did not run them myself, for the reason given at the top.
