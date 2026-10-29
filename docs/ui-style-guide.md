# Erfana UI Style Guide

<!-- Convention: new section headings use sentence case (project rule).
     Existing Title-Case headings are grandfathered to preserve anchor URLs
     referenced elsewhere; do not bulk-rename without coordinating links. -->

> **Version**: 3.0
> **Last Updated**: October 2026
> **Design System**: the cards in [`docs/design-system/`](design-system/index.html); this file keeps only what they do not decide

> **The visual decisions have moved to [`docs/design-system/`](design-system/index.html).**
> Colours, typography, spacing, surfaces and interactive states are now decided by
> cards that render each rule live — open `docs/design-system/index.html`. Those sections
> below are stubs: they keep their headings so existing links resolve, and they
> hold no rules, so they cannot contradict a card.
>
> They were retired rather than corrected. This file specified the focus ring
> **three different ways** — a 2px border, a 3px glow and a 1px outline, all
> normative, with no rule for which applied where — and prescribed `--space-14`,
> which its own scale omitted. Two documents describing one system is how that
> happens; the fix is one document, not a better second one.

What is left here is the part `docs/design-system/` does not decide: the `erf-` class namespace
and the token discipline that `npm run lint:css` now enforces. The text selection policy and the
dark-only stance moved to the [Theme card](design-system/system/foundations/theme.html).

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing System](#spacing-system)
5. [Borders & Shadows](#borders--shadows)
6. [Interactive States](#interactive-states)
7. [Text selection policy](#text-selection-policy)
8. [CSS class namespacing (`erf-`)](#css-class-namespacing-erf-)
9. [Do's and Don'ts](#dos-and-donts)
10. [Checklist for UI Changes](#checklist-for-ui-changes)
11. [Quick Reference](#quick-reference)

---

## Design Philosophy

> **Decided by the cards in [`docs/design-system/index.html`](design-system/index.html)** – brand colours by [`colors.html`](design-system/system/foundations/colors.html), corners, shadows and depth by [`surfaces.html`](design-system/system/foundations/surfaces.html), focus by [`focus.html`](design-system/system/foundations/focus.html).
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no visual rule, so it cannot contradict the cards.

### Not Supported

> **Decided by the Theme card, [`docs/design-system/system/foundations/theme.html`](design-system/system/foundations/theme.html#dark-only)** (§ Dark only).
> Erfana is dark-only: no `prefers-color-scheme` query, and `color-scheme: dark` set once on `:root`.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

---

## Color System

> **Decided by [`docs/design-system/system/foundations/colors.html`](design-system/system/foundations/colors.html).** Every swatch is painted with the shipping token and every value and ratio is baked into the card from the shipping token file, so a colour that fails says `fail` rather than being described as safe.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Typography

> **Decided by [`docs/design-system/system/foundations/type.html`](design-system/system/foundations/type.html).** Rendered at real size in the real bundled font.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Spacing System

> **Decided by [`docs/design-system/system/foundations/spacing.html`](design-system/system/foundations/spacing.html).** Drawn to scale, because the token names mislead: the number is a scale step, not a pixel count, and `--space-2` is 4px.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Borders & Shadows

> **Decided by [`docs/design-system/system/foundations/surfaces.html`](design-system/system/foundations/surfaces.html).** Borders, shadows, control heights and the zero-radius rule, with `npm run lint:css` enforcing the last one.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Interactive States

> **Decided by [`docs/design-system/system/foundations/focus.html`](design-system/system/foundations/focus.html).** One focus ring. This section specified it three different ways - a 2px border, a 3px glow and a 1px outline - all normative, with no rule for which applied where.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Text selection policy

> **Decided by the Theme card, [`docs/design-system/system/foundations/theme.html`](design-system/system/foundations/theme.html#selection)** (§ Text selection).
> The selectable / not selectable / self-managed table, the decision and scope rules, where the override lives
> (`src/renderer/src/styles/utilities.css`, audited by `userSelect.audit.test.ts`) and the dockview cascade
> assumption are all on the card.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## CSS class namespacing (`erf-`)

Component CSS that belongs to the design system is namespaced `erf-`, and `.stylelintrc.json` enforces it with `selector-class-pattern` – every class must match `^erf-[a-z0-9]+(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$`, i.e. an `erf-` prefix, kebab-case words, an optional BEM `__element` and an optional `--modifier` (`erf-band`, `erf-band__row`, `erf-band--open`). The rule applies to `docs/design-system/system/components/**/*.css` and `docs/design-system/system/patterns/**/*.css`, and follows a file when it is adopted into `src/`: today that is `src/renderer/src/styles/hostName.css`, `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.css` and `PreviewNavControls.css` beside it, listed by path in the config (a guard in `npm run design -- --check` fails if an adopted path is missing). When a design-system stylesheet moves into `src/`, add its new path to that override – scoping the rule to `docs/design-system/` alone would switch the guard off at the exact moment the CSS became shipping code.

The prefix is not cosmetic. Mermaid emits `class="row"` on gitGraph commit labels and on its generic label path, and the app injects that SVG with `innerHTML`, so a bare global `.row` reaches into diagram labels in the Markdown preview and in exported images. That collision was found by luck, not by review; the namespace makes it impossible. The cards' own documentation chrome under `docs/design-system/` (`.stage`, `.list-frame`, `.readout`) is not shipped UI and is exempt from the naming rule, though not from the token rules.

---

## Do's and Don'ts

> **Colour, border-radius and z-index examples are gone from this list** because
> `npm run lint:css` enforces them (see the checklist below). What is left is not
> linted in `src/`: `padding: 11px`, `font-size: 13px` and a hardcoded transition all pass
> there, so review for them by hand. In `docs/design-system/` and `docs/designs/` they fail lint.

### Spacing

```css
/* ✅ DO: Use spacing tokens */
padding: var(--space-6) var(--space-8);
margin-bottom: var(--space-4);
gap: var(--space-6);

/* ❌ DON'T: Use arbitrary values */
padding: 11px 15px;
margin-bottom: 7px;
gap: 13px;
```

### Typography

```css
/* ✅ DO: Use typography tokens */
font-size: var(--text-base);
font-weight: var(--font-medium);
font-family: var(--font-mono);

/* ❌ DON'T: Use hardcoded values */
font-size: 13px;
font-weight: 500;
font-family: Monaco, monospace;
```

### Transitions

```css
/* ✅ DO: Use transition tokens */
transition: var(--transition-normal);

/* ❌ DON'T: Hardcode timing */
transition: all 0.2s ease;
transition: 150ms;
```

---

## Checklist for UI Changes

**A machine checks these — do not spend attention on them.** `npm run lint:css`,
which runs in the required `Lint` job:

- Colours use tokens; no raw hex outside `design-tokens.css`
- No bare `z-index`
- No `border-radius` other than `0` or a `var(--border-radius…)` token
- No retired token reaches `docs/design-system/` or `docs/designs/`

**Nobody checks these but you.** They are the ones that actually break for
people, and none of them is expressible as a lint rule:

- [ ] The focus ring is **visible** and reaches 3:1 — tab to it and look
- [ ] Every state has a non-colour cue as well as a colour one
- [ ] Anything that loops forever stops under `prefers-reduced-motion: reduce`
- [ ] Every interactive target is at least 24 x 24 (WCAG 2.2 SC 2.5.8)
- [ ] Any error is linked to its field with `aria-invalid` + `aria-describedby`
- [ ] A role you declare is a promise: `role="tree"` means arrow keys work
- [ ] It works keyboard-only, start to finish
- [ ] Any departure from a card carries `/* deviates: docs/design-system/<card>.html – why */` at the site and a row in that card's Exceptions – nothing detects a departure that has no marker

---

## Quick Reference

**Token Source**: `src/renderer/src/styles/design-tokens.css`

**The rules**: [`docs/design-system/index.html`](design-system/index.html) — open it in a browser.

**Still here**: the [`erf-` namespace](#css-class-namespacing-erf-) and the
[token gotchas](./ui-style-guide-reference.md#common-gotchas). The text selection policy is on the
[Theme card](design-system/system/foundations/theme.html#selection).
