# Erfana UI Style Guide

<!-- Convention: new section headings use sentence case (project rule).
     Existing Title-Case headings are grandfathered to preserve anchor URLs
     referenced elsewhere; do not bulk-rename without coordinating links. -->

> **Version**: 2.0
> **Last Updated**: November 2025
> **Design System**: Qodeca brand with dark theme

This style guide documents all design decisions for the Erfana application. All new UI code **must** follow these guidelines and use the design tokens defined in `src/renderer/src/styles/design-tokens.css`.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing System](#spacing-system)
5. [Borders & Shadows](#borders--shadows)
6. [Interactive States](#interactive-states)
7. [Text selection policy](#text-selection-policy)
8. [Do's and Don'ts](#dos-and-donts)
9. [Checklist for UI Changes](#checklist-for-ui-changes)
10. [Quick Reference](#quick-reference)
11. [Additional Resources](#additional-resources)

---

## Design Philosophy

Erfana follows a **Qodeca-branded flat design** with these core principles:

1. **Brand Identity** - Qodeca Violet (#A0A8FF) as primary, Lime (#E3E829) as secondary accent.
2. **Sharp Corners** - No border-radius (except circles). Clean, professional aesthetic.
3. **Subtle Depth** - Use shadows sparingly to create hierarchy without being dramatic.
4. **Dark First** - Optimized for dark mode with Smoky Black (#161312) background.
5. **Consistency** - Same patterns everywhere. If unsure, check existing components.
6. **Accessibility** - Sufficient contrast (WCAG AA), focus indicators, keyboard navigation.

### Not Supported

- **Light Mode** - Erfana is dark-mode only. Do not add `prefers-color-scheme` queries.
- **Rounded Corners** - Use `--border-radius: 0` (flat design). Only exception: circles (`50%`).
- **Custom Scrollbars in Firefox** - Webkit-only. Firefox uses default scrollbars.

---

## Color System

### Qodeca Brand Palette

The primary brand colors that define Erfana's visual identity.

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-brand-violet` | `#A0A8FF` | **Primary accent** - Buttons, links, focus |
| `--color-brand-lime` | `#E3E829` | **Secondary accent** - Success, highlights, markdown files |
| `--color-brand-black` | `#161312` | **Brand black** - Main background (Smoky Black) |
| `--color-brand-white` | `#F8FAF8` | **Brand white** - Diagram backgrounds (Powder White) |

**Brand Variants (for interactive states):**

```css
/* Violet variants */
--color-brand-violet-hover: #8b94ff;   /* Hover state */
--color-brand-violet-active: #7680ff;  /* Pressed state */
--color-brand-violet-muted: rgba(160, 168, 255, 0.2);  /* Backgrounds */

/* Lime variants */
--color-brand-lime-hover: #d6d925;     /* Hover state */
--color-brand-lime-active: #c9cc21;    /* Pressed state */
--color-brand-lime-muted: rgba(227, 232, 41, 0.3);    /* Backgrounds */
```

### Secondary Accent Palette

Extended brand colors for UI variety (git status, tags, badges, etc.):

| Token | Hex | Name | Usage |
|-------|-----|------|-------|
| `--color-brand-amber` | `#FFA335` | **Qodeca Amber** | Warm orange - warnings, modified states |
| `--color-brand-coral` | `#FF626A` | **Qodeca Coral** | Soft red-pink - errors, deletions |
| `--color-brand-magenta` | `#FF3381` | **Qodeca Magenta** | Vivid pink - special highlights |
| `--color-brand-indigo` | `#3F3FBA` | **Qodeca Indigo** | Deep blue-violet - secondary actions |

### Git Status Colors

Git status indicators use brand colors for visual consistency with context-specific lightness:

| Status | Original Token | Light Variant Token | Hex (Light) | Usage Context |
|--------|---------------|-------------------|-------------|---------------|
| Modified (M) | `--color-git-modified` (Amber) | `--color-git-modified-light` | `#FFCC99` | Badges, file names, status bar counts |
| Untracked (U) | `--color-git-untracked` (Lime) | `--color-git-untracked-light` | `#F5F599` | Badges, file names, status bar counts |
| Deleted (D) | `--color-git-deleted` (Coral) | `--color-git-deleted-light` | `#FFB3B8` | Badges, file names, status bar counts |
| Staged (A) | `--color-git-staged` (Violet) | `--color-git-staged-light` | `#D4D9FF` | Badges, file names, status bar counts |
| Renamed (R) | `--color-git-renamed` (Indigo) | `--color-git-renamed-light` | `#8F8FE5` | Badges, file names, status bar counts (improved contrast) |
| Conflicted (!) | `--color-git-conflicted` (Magenta) | `--color-git-conflicted-light` | `#FF99BF` | Badges, file names, status bar counts |

**Color Strategy:**
- **Original colors** (vibrant brand colors): Used for folder dots (6px circles) - strong visual hierarchy
- **Light variants** (40-50% lighter, pastel-like): Used for badges, file names, and status bar - better readability
- **Indigo special case**: 100% lighter to fix poor contrast on dark backgrounds
- **Accessibility**: All light variants meet WCAG AA standard (4.5:1), most achieve AAA (7:1)

### Neutral Scale

The grayscale is the foundation of the UI. Use semantic tokens, not raw hex values.

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-white` | `#ffffff` | Emphasis text, active states |
| `--color-gray-100` | `#e8e8e8` | High contrast text |
| `--color-gray-200` | `#d4d4d4` | Light text |
| `--color-gray-300` | `#cccccc` | **Primary text** (most common) |
| `--color-gray-400` | `#b8b8b8` | Muted text |
| `--color-gray-500` | `#858585` | **Secondary text** (labels, hints) |
| `--color-gray-600` | `#6e6e6e` | Very muted, placeholders |
| `--color-gray-700` | `#454545` | Subtle borders |
| `--color-gray-800` | `#3c3c3c` | **Default borders** |
| `--color-gray-900` | `#2d2d30` | Panel backgrounds |
| `--color-gray-950` | `#252526` | Sidebar, tree backgrounds |
| `--color-gray-1000` | `#161312` | **Main app background** (Smoky Black) |
| `--color-black` | `#000000` | Overlays, deep shadows |

### Semantic Backgrounds

```css
/* Use these instead of raw colors */
background: var(--color-bg-primary);    /* Main content areas (Smoky Black) */
background: var(--color-bg-secondary);  /* Panels, cards, inputs */
background: var(--color-bg-tertiary);   /* Sidebar, project tree */
background: var(--color-bg-elevated);   /* Floating elements */
background: var(--color-bg-selected);   /* Selected items (violet-tinted) */
```

### Semantic Text

```css
color: var(--color-text-primary);    /* Default body text */
color: var(--color-text-secondary);  /* Labels, hints, metadata */
color: var(--color-text-muted);      /* Very subtle text */
color: var(--color-text-emphasis);   /* Headings, important text */
```

### Interactive Colors (Brand)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent-primary` | Violet (#A0A8FF) | **Primary** - Focus rings, buttons, CTAs |
| `--color-accent-secondary` | Lime (#E3E829) | **Secondary** - Success, highlights, markdown files |
| `--color-accent-tertiary` | Violet (#A0A8FF) | Tertiary accents |
| `--color-accent-drag` | Violet (#A0A8FF) | Drag-drop highlights |

### Link Colors (Brand)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-link` | Violet (#A0A8FF) | Default link color |
| `--color-link-hover` | Violet hover (#8b94ff) | Link hover state |
| `--color-link-visited` | `#9d7dd2` | Visited links (purple) |

### Button Colors (Brand)

```css
/* Primary button (Violet) */
background: var(--color-btn-primary-bg);      /* Qodeca Violet */
background: var(--color-btn-primary-hover);   /* Violet hover */
background: var(--color-btn-primary-active);  /* Violet active */

/* Secondary button (gray) */
background: var(--color-btn-secondary-bg);    /* #3c3c3c */
background: var(--color-btn-secondary-hover); /* #505050 */

/* Danger button (red - unchanged) */
background: var(--color-btn-danger-bg);       /* #c72e0f */
background: var(--color-btn-danger-hover);    /* #e03e18 */
```

### Status Colors (Brand + Unchanged)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | Lime (#E3E829) | Success messages, valid states |
| `--color-success-bg` | `rgba(227, 232, 41, 0.1)` | Success container background |
| `--color-success-border` | `rgba(227, 232, 41, 0.3)` | Success container border |
| `--color-warning` | `#cca700` | Warnings (unchanged) |
| `--color-error` | `#f48771` | Errors (unchanged) |
| `--color-info` | Violet (#A0A8FF) | Informational messages |

---

## Typography

### Font Stacks

| Token | Stack | Usage |
|-------|-------|-------|
| `--font-sans` | System fonts | **Default** for all UI text |
| `--font-mono` | SF Mono, Monaco... | Code, terminal, technical data |
| `--font-serif` | Charter, Georgia... | Markdown preview (reading mode) |

```css
/* Usage */
font-family: var(--font-sans);  /* Default - don't specify usually */
font-family: var(--font-mono);  /* Code blocks, character counts */
font-family: var(--font-serif); /* Markdown preview content */
```

### Font Sizes

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 10px | Tiny labels, hints |
| `--text-sm` | 11px | Small labels, metadata |
| `--text-base` | **13px** | Default body text |
| `--text-md` | 14px | Slightly larger body |
| `--text-lg` | 16px | Subheadings |
| `--text-xl` | 18px | Section headings |
| `--text-2xl` | 20px | Large headings |

```css
/* Most common usage */
font-size: var(--text-base);  /* 13px - default */
font-size: var(--text-sm);    /* 11px - labels */
font-size: var(--text-xs);    /* 10px - tiny text */
```

### Font Weights

| Token | Weight | Usage |
|-------|--------|-------|
| `--font-normal` | 400 | Default body text |
| `--font-medium` | 500 | Buttons, emphasized text |
| `--font-semibold` | 600 | Headings, strong labels |
| `--font-bold` | 700 | Markdown headings |

### Line Heights

| Token | Value | Usage |
|-------|-------|-------|
| `--leading-tight` | 1.25 | Headings, compact text |
| `--leading-normal` | 1.5 | Default body text |
| `--leading-relaxed` | 1.6 | Long-form reading |

---

## Spacing System

### 4px Base Grid

All spacing uses a 4px base grid. Use these tokens, never arbitrary values.

> **Note on Naming**: Token numbers represent scale steps, not pixel values.
> For example: `--space-4` = 8px (not 4px). This follows Tailwind-style naming.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 2px | Fine-tuning, micro adjustments |
| `--space-2` | 4px | Tight spacing, inline gaps |
| `--space-3` | 6px | Small gaps |
| `--space-4` | **8px** | Standard small spacing |
| `--space-5` | 10px | Medium-small spacing |
| `--space-6` | **12px** | Standard medium spacing |
| `--space-8` | **16px** | Large spacing |
| `--space-10` | 20px | Extra large spacing |
| `--space-12` | **24px** | Section spacing |
| `--space-16` | 32px | Major section breaks |

### Common Patterns

```css
/* Button padding */
padding: var(--space-5) var(--space-12);  /* 10px 24px */

/* Input padding */
padding: var(--space-6) var(--space-6);   /* 12px 12px */

/* Card padding */
padding: var(--space-8);                   /* 16px */

/* Dialog padding */
padding: var(--space-14);                  /* 28px */

/* Gap between buttons */
gap: var(--space-6);                       /* 12px */

/* Gap between form fields */
gap: var(--space-4);                       /* 8px */
```

---

## Borders & Shadows

### Border Radius

**Rule: No rounded corners** (flat design)

```css
/* ALWAYS */
border-radius: var(--border-radius);      /* 0 */

/* ONLY exception: circular elements */
border-radius: var(--border-radius-circle); /* 50% - for dots, spinners */
```

### Border Width

```css
border: var(--border-width) solid var(--color-border-default);  /* 1px */
border: var(--border-width-thick) solid ...;                    /* 2px - focus */
```

### Shadows

| Token | CSS | Usage |
|-------|-----|-------|
| `--shadow-sm` | `0 2px 4px rgba(0,0,0,0.2)` | Buttons, small cards |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.3)` | Dropdowns, tooltips |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.4)` | Modals, large cards |
| `--shadow-xl` | `0 12px 48px rgba(0,0,0,0.8)` | Dialogs |
| `--shadow-focus` | `0 0 0 3px rgba(160,168,255,0.25)` | Focus indicators (Qodeca Violet) |

```css
/* Primary button shadow */
box-shadow: var(--shadow-sm);

/* Dialog shadow (with edge highlight) */
box-shadow: var(--shadow-dialog);

/* Focus state (in addition to border) */
box-shadow: var(--shadow-focus);
```

---

## Interactive States

### Hover States (Opacity-Based)

Use white overlays with varying opacity for hover effects:

```css
/* Subtle hover (list items, tree nodes) */
background: rgba(255, 255, 255, var(--opacity-hover-subtle));  /* 0.05 */

/* Medium hover (buttons, tabs) */
background: rgba(255, 255, 255, var(--opacity-hover-medium));  /* 0.1 */

/* Strong hover (important actions) */
background: rgba(255, 255, 255, var(--opacity-hover-strong));  /* 0.15 */
```

### Active/Pressed State

```css
background: rgba(255, 255, 255, var(--opacity-active));  /* 0.2 */
```

### Focus State

All focusable elements must have visible focus indicators:

```css
/* Standard focus */
outline: 1px solid var(--color-border-focus);  /* Qodeca Violet */
outline-offset: 1px;

/* Enhanced focus (buttons, inputs) */
box-shadow: var(--shadow-focus);
```

### Disabled State

```css
opacity: var(--opacity-disabled);  /* 0.4 */
cursor: not-allowed;
pointer-events: none;  /* optional - prevents interaction */
```

---

## Text selection policy

`dockview-core` sets `user-select: none` on panel chrome, and that rule inherits into nested content – so without an explicit override, text inside panel content surfaces is silently non-selectable. This previously broke the markdown-preview prompt-template context menu (Explain / Modify / Ask / Visualize), which reads `window.getSelection().toString()` and silently does nothing when the result is empty. Treat selectability as a deliberate per-surface decision.

| Policy | When to use | Example surfaces | CSS |
|---|---|---|---|
| Selectable | Data-bearing text users would want to copy – markdown body, dialog messages, toasts, settings descriptions, paths, filenames, status data, log lines | MarkdownPreview, Dialog body + title, Toast, Settings descriptions, FilePicker filename + path, status bar token counts, chat bubbles | `user-select: text;` |
| Not selectable | Chrome where selection would interfere with click/drag affordances – tabs, tree nodes, toolbars, context menus, activity bar, drag handles, image-pan layers | EditorTab, ProjectTree node, Toolbar, ContextMenu, ActivityBar | `user-select: none;` (or rely on dockview's inherited `none`) |
| Self-managed | Components that own their selection model via canvas or library internals | Monaco editor, xterm terminal canvas | Do not override; the component owns it |

**Decision rule.** Would a user reasonably want to copy this text? If yes – add explicit selectable CSS. If it is a clickable or draggable label acting as chrome – leave `none`. If the component owns its own selection – do not interfere.

**Scope rule.** Opt in at the data-text element, not at a click-target or drag-target ancestor. A row container with both `cursor: pointer` and `user-select: text` creates a gesture conflict (drag-to-select competes with click-to-pick). FilePicker is the worked example – the override lives on `.file-picker-filename` and `.file-picker-path` (data), not on `.file-picker-item` (the clickable row). Use container scope (`.dialog-body`, `.markdown-preview-content`) only when no descendant is interactive. When a container has both selectable content and chrome children (welcome panel's recent-project rows mix data text with action buttons), enumerate the data selectors explicitly – do not blanket the container.

**Canonical override** lives in `src/renderer/src/styles/utilities.css`. To make a new surface selectable, add its selector to the grouped rule there (and add a row to `src/renderer/src/styles/userSelect.audit.test.ts`). Two CSS-module surfaces (`.metadataItem`, `.errorMessage` in `ImageViewerPanel.module.css`) declare the rule in-place because the build-time class-name hashing prevents the central selector from matching them at runtime — for any other new surface, add it to `utilities.css`, not to the component file.

```css
/* src/renderer/src/styles/utilities.css */
.markdown-preview-content,
.dialog-body,
/* ... */ {
  user-select: text;
}
```

The `-webkit-user-select` prefix is not needed; Erfana ships on Chromium 130+ via Electron 39 and unprefixed `user-select` has been honored in Chromium since v54.

**Cascade assumption.** These overrides rely on app stylesheets loading after `dockview-core/dist/styles/dockview.css` in the Vite bundle. Don't change CSS import order without re-running `src/renderer/src/styles/userSelect.audit.test.ts`, which asserts every audited selector still declares `user-select: text` in its source file.

See [#211](https://github.com/qodeca/erfana/issues/211) for the original audit and per-component policy decisions.

---

## Do's and Don'ts

> **More patterns**: See [UI Style Guide Reference](./ui-style-guide-reference.md) for component patterns (buttons, inputs, dialogs), z-index scale, transitions, and migration guide.

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

Before committing any UI changes, verify:

- [ ] All colors use design tokens (`var(--color-*)`)
- [ ] All spacing uses design tokens (`var(--space-*)`)
- [ ] All fonts use design tokens (`var(--font-*)`, `var(--text-*)`)
- [ ] No rounded corners (except `50%` for circles)
- [ ] Transitions use tokens (`var(--transition-*)`)
- [ ] Z-index uses tokens (`var(--z-*)`)
- [ ] Focus states are visible
- [ ] Disabled states have reduced opacity
- [ ] Hover states provide feedback
- [ ] Works in dark mode (only mode supported)

---

## Quick Reference

**Token Source**: `src/renderer/src/styles/design-tokens.css`

**Additional Resources**: Component patterns, z-index scale, transitions, migration guide:
**[UI Style Guide Reference](./ui-style-guide-reference.md)**
