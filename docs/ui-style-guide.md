# Erfana UI Style Guide

<!-- Convention: new section headings use sentence case (project rule).
     Existing Title-Case headings are grandfathered to preserve anchor URLs
     referenced elsewhere; do not bulk-rename without coordinating links. -->

> **Version**: 3.0
> **Last Updated**: August 2026
> **Design System**: the cards in [`design/`](../design/index.html); this file keeps only what they do not decide

> **The visual decisions have moved to [`design/`](../design/index.html).**
> Colours, typography, spacing, surfaces and interactive states are now decided by
> cards that render each rule live — open `design/index.html`. Those sections
> below are stubs: they keep their headings so existing links resolve, and they
> hold no rules, so they cannot contradict a card.
>
> They were retired rather than corrected. This file specified the focus ring
> **three different ways** — a 2px border, a 3px glow and a 1px outline, all
> normative, with no rule for which applied where — and prescribed `--space-14`,
> which its own scale omitted. Two documents describing one system is how that
> happens; the fix is one document, not a better second one.

What is left here is the part `design/` does not decide: the text selection
policy (a dockview cascade fact with a test behind it), the dark-only stance, and
the token discipline that `npm run lint:css` now enforces.

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

> **Decided by the cards in [`design/`](../design/index.html)** – brand colours by [`colors.html`](../design/system/foundations/colors.html), corners, shadows and depth by [`surfaces.html`](../design/system/foundations/surfaces.html), focus by [`focus.html`](../design/system/foundations/focus.html).
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no visual rule, so it cannot contradict the cards.

### Not Supported

- **Light Mode** - Erfana is dark-mode only. Do not add `prefers-color-scheme` queries.

> Everything else this list used to hold (corner radius, browser scrollbar support) is decided by the `design/` cards above.

---

## Color System

> **Decided by [`design/system/foundations/colors.html`](../design/system/foundations/colors.html).** Every swatch is painted with the shipping token and every ratio is computed in the page, so a colour that fails is visibly red rather than described as safe.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Typography

> **Decided by [`design/system/foundations/type.html`](../design/system/foundations/type.html).** Rendered at real size in the real bundled font.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Spacing System

> **Decided by [`design/system/foundations/spacing.html`](../design/system/foundations/spacing.html).** Drawn to scale, because the token names mislead: the number is a scale step, not a pixel count, and `--space-2` is 4px.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Borders & Shadows

> **Decided by [`design/system/foundations/surfaces.html`](../design/system/foundations/surfaces.html).** Borders, shadows, control heights and the zero-radius rule, with `npm run lint:css` enforcing the last one.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Interactive States

> **Decided by [`design/system/foundations/focus.html`](../design/system/foundations/focus.html).** One focus ring. This section specified it three different ways - a 2px border, a 3px glow and a 1px outline - all normative, with no rule for which applied where.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Text selection policy

`dockview-core` sets `user-select: none` on panel chrome, and that rule inherits into nested content – so without an explicit override, text inside panel content surfaces is silently non-selectable. This previously broke the markdown-preview prompt-template context menu (Explain / Modify / Ask / Visualize), which reads `window.getSelection().toString()` and silently does nothing when the result is empty. Treat selectability as a deliberate per-surface decision.

| Policy | When to use | Example surfaces | CSS |
|---|---|---|---|
| Selectable | Data-bearing text users would want to copy – markdown body, dialog messages, toasts, settings descriptions, paths, filenames, status data, log lines | MarkdownPreview, Dialog body + title, Toast, Settings descriptions, FilePicker filename + path, status bar token counts, chat bubbles | `user-select: text;` |
| Not selectable | Chrome where selection would interfere with click/drag affordances – tabs, tree nodes, toolbars, context menus, activity bar, drag handles, image-pan layers | EditorTab, ProjectTree node, Toolbar, ContextMenu, ActivityBar | `user-select: none;` (or rely on dockview's inherited `none`) |
| Self-managed | Components that own their selection model via canvas or library internals | Monaco editor, xterm terminal canvas | Do not override; the component owns it |

**Decision rule.** Would a user reasonably want to copy this text? If yes – add explicit selectable CSS. If it is a clickable or draggable label acting as chrome – leave `none`. If the component owns its own selection – do not interfere.

**Scope rule.** Opt in at the data-text element, not at a click-target or drag-target ancestor. A row container with both `cursor: pointer` and `user-select: text` creates a gesture conflict (drag-to-select competes with click-to-pick). FilePicker is the worked example – the override lives on `.file-picker-filename` and `.file-picker-path` (data), not on `.file-picker-item` (the clickable row). Use container scope (`.dialog-body`, `.markdown-preview-content`) only when no descendant is interactive. When a container has both selectable content and chrome children (welcome panel's recent-project rows mix data text with action buttons), enumerate the data selectors explicitly – do not blanket the container.

**Canonical override** lives in `src/renderer/src/styles/utilities.css`. To make a new surface selectable, add its selector to the grouped rule there (and add a row to `src/renderer/src/styles/userSelect.audit.test.ts`). Four CSS-module surfaces (`.metadataItem`, `.errorMessage`, `.statusSlot`, `.bannerMessage` in `ImageViewerPanel.module.css`) declare the rule in-place because the build-time class-name hashing prevents the central selector from matching them at runtime — for any other new surface, add it to `utilities.css`, not to the component file.

```css
/* src/renderer/src/styles/utilities.css */
.markdown-preview-content,
.dialog-body,
/* ... */ {
  user-select: text;
}
```

The `-webkit-user-select` prefix is not needed; Erfana ships on Chromium 142 via Electron 39.8.x and unprefixed `user-select` has been honored in Chromium since v54.

**Cascade assumption.** These overrides rely on app stylesheets loading after `dockview-core/dist/styles/dockview.css` in the Vite bundle. Don't change CSS import order without re-running `src/renderer/src/styles/userSelect.audit.test.ts`, which asserts every audited selector still declares `user-select: text` in its source file.

See #211 (pre-migration issue number; it does not resolve in the current repository) for the original audit and per-component policy decisions.

## CSS class namespacing (`erf-`)

Component CSS that belongs to the design system is namespaced `erf-`, and `.stylelintrc.json` enforces it with `selector-class-pattern` – every class must match `^erf-[a-z0-9]+(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$`, i.e. an `erf-` prefix, kebab-case words, an optional BEM `__element` and an optional `--modifier` (`erf-band`, `erf-band__row`, `erf-band--open`). The rule applies to `design/system/components/**/*.css` and follows a file when it is adopted into `src/`: today that is `src/renderer/src/styles/hostName.css` and `src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.css`, listed by path in the config. When a design-system stylesheet moves into `src/`, add its new path to that override – scoping the rule to `design/` alone would switch the guard off at the exact moment the CSS became shipping code.

The prefix is not cosmetic. Mermaid emits `class="row"` on gitGraph commit labels and on its generic label path, and the app injects that SVG with `innerHTML`, so a bare global `.row` reaches into diagram labels in the Markdown preview and in exported images. That collision was found by luck, not by review; the namespace makes it impossible. The cards' own documentation chrome under `design/` (`.stage`, `.list-frame`, `.readout`) is not shipped UI and is exempt from the naming rule, though not from the token rules.

---

## Do's and Don'ts

> **Most of these are now checked by a machine.** `npm run lint:css` fails on raw
> hex outside the token file, on a bare `z-index`, and on any `border-radius`
> other than `0` or the circle token. They are kept here as the rationale — a rule
> nobody can explain gets deleted by the next person who finds it inconvenient.

### Colors

```css
/* ✅ DO: Use semantic tokens */
color: var(--color-text-primary);
background: var(--color-bg-secondary);
border-color: var(--color-border-default);

/* ❌ DON'T: Use hardcoded colors */
color: #cccccc;
background: #2d2d30;
border-color: #3c3c3c;
```

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

### Borders

```css
/* ✅ DO: Sharp corners */
border-radius: var(--border-radius);  /* 0 */

/* ✅ DO: Circle exception */
border-radius: var(--border-radius-circle);  /* 50% for dots/spinners */

/* ❌ DON'T: Rounded corners */
border-radius: 4px;
border-radius: 8px;
```

### Transitions

```css
/* ✅ DO: Use transition tokens */
transition: var(--transition-normal);

/* ❌ DON'T: Hardcode timing */
transition: all 0.2s ease;
transition: 150ms;
```

### Z-Index

```css
/* ✅ DO: Use z-index tokens */
z-index: var(--z-modal);
z-index: var(--z-tooltip);

/* ❌ DON'T: Use arbitrary values */
z-index: 999;
z-index: 10000;
```

---

## Checklist for UI Changes

**A machine checks these — do not spend attention on them.** `npm run lint:css`,
which runs in the required `Lint` job:

- Colours use tokens; no raw hex outside `design-tokens.css`
- No bare `z-index`
- No `border-radius` other than `0` or `var(--border-radius-circle)`
- No retired token reaches `design/`

**Nobody checks these but you.** They are the ones that actually break for
people, and none of them is expressible as a lint rule:

- [ ] The focus ring is **visible** and reaches 3:1 — tab to it and look
- [ ] Every state has a non-colour cue as well as a colour one
- [ ] Anything that loops forever stops under `prefers-reduced-motion: reduce`
- [ ] Every interactive target is at least 24 x 24 (WCAG 2.2 SC 2.5.8)
- [ ] Any error is linked to its field with `aria-invalid` + `aria-describedby`
- [ ] A role you declare is a promise: `role="tree"` means arrow keys work
- [ ] It works keyboard-only, start to finish

---

## Quick Reference

**Token Source**: `src/renderer/src/styles/design-tokens.css`

**The rules**: [`design/index.html`](../design/index.html) — open it in a browser.

**Still here**: the [text selection policy](#text-selection-policy) and the
[migration guide](./ui-style-guide-reference.md#migration-guide).
