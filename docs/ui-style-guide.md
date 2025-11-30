# Erfana UI Style Guide

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
7. [Do's and Don'ts](#dos-and-donts)
8. [Checklist for UI Changes](#checklist-for-ui-changes)
9. [Quick Reference](#quick-reference)
10. [Additional Resources](#additional-resources)

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

Git status indicators use brand colors for visual consistency:

| Token | Brand Color | Badge | UX Reasoning |
|-------|-------------|-------|--------------|
| `--color-git-modified` | Amber | M | Attention needed, file changed |
| `--color-git-untracked` | Lime | U | New/positive - untracked file |
| `--color-git-deleted` | Coral | D | Removed - file deleted |
| `--color-git-staged` | Violet | A | Ready/prepared - staged for commit |
| `--color-git-renamed` | Indigo | R | Transformed - file renamed |
| `--color-git-conflicted` | Magenta | ! | Urgent - needs resolution |

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

### Most Used Tokens

```css
/* Colors */
--color-text-primary      /* Main text */
--color-text-secondary    /* Muted text */
--color-bg-primary        /* Main background (Smoky Black) */
--color-bg-secondary      /* Panel background */
--color-border-default    /* Standard borders */
--color-accent-primary    /* Qodeca Violet */
--color-accent-secondary  /* Qodeca Lime (highlights, success) */

/* Spacing */
--space-4                 /* 8px - small */
--space-6                 /* 12px - medium */
--space-8                 /* 16px - large */
--space-12                /* 24px - section */

/* Typography */
--text-base               /* 13px - default */
--text-sm                 /* 11px - small */
--font-medium             /* 500 */
--font-semibold           /* 600 */

/* Effects */
--transition-normal       /* 0.15s ease */
--shadow-md               /* Standard shadow */
--border-radius           /* 0 */
```

---

## Additional Resources

For detailed component patterns, z-index scale, transitions, and migration guide, see:
**[UI Style Guide Reference](./ui-style-guide-reference.md)**
