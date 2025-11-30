# Erfana UI Style Guide

> **Version**: 1.0
> **Last Updated**: November 2025
> **Design System**: VS Code-inspired dark theme

This style guide documents all design decisions for the Erfana application. All new UI code **must** follow these guidelines and use the design tokens defined in `src/renderer/src/styles/design-tokens.css`.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing System](#spacing-system)
5. [Borders & Shadows](#borders--shadows)
6. [Interactive States](#interactive-states)
7. [Component Patterns](#component-patterns)
8. [Z-Index Scale](#z-index-scale)
9. [Transitions & Animations](#transitions--animations)
10. [Do's and Don'ts](#dos-and-donts)
11. [Migration Guide](#migration-guide)

---

## Design Philosophy

Erfana follows a **VS Code-inspired flat design** with these core principles:

1. **Sharp Corners** - No border-radius (except circles). Clean, professional aesthetic.
2. **Subtle Depth** - Use shadows sparingly to create hierarchy without being dramatic.
3. **Dark First** - Optimized for dark mode. Reduces eye strain during extended use.
4. **Consistency** - Same patterns everywhere. If unsure, check existing components.
5. **Accessibility** - Sufficient contrast, focus indicators, keyboard navigation.

### Not Supported

- **Light Mode** - Erfana is dark-mode only. Do not add `prefers-color-scheme` queries.
- **Rounded Corners** - Use `--border-radius: 0` (flat design). Only exception: circles (`50%`).
- **Custom Scrollbars in Firefox** - Webkit-only. Firefox uses default scrollbars.

---

## Color System

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
| `--color-gray-1000` | `#1e1e1e` | **Main app background** |
| `--color-black` | `#000000` | Overlays, deep shadows |

### Semantic Backgrounds

```css
/* Use these instead of raw colors */
background: var(--color-bg-primary);    /* Main content areas */
background: var(--color-bg-secondary);  /* Panels, cards, inputs */
background: var(--color-bg-tertiary);   /* Sidebar, project tree */
background: var(--color-bg-elevated);   /* Floating elements */
background: var(--color-bg-selected);   /* Selected items (#094771) */
```

### Semantic Text

```css
color: var(--color-text-primary);    /* Default body text */
color: var(--color-text-secondary);  /* Labels, hints, metadata */
color: var(--color-text-muted);      /* Very subtle text */
color: var(--color-text-emphasis);   /* Headings, important text */
```

### Interactive Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-accent-primary` | `#007fd4` | Focus rings, active tabs |
| `--color-accent-secondary` | `#4ec9b0` | Success indicators, teal highlights |
| `--color-accent-tertiary` | `#4fc3f7` | Light blue accents |

### Link Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-link` | `#007fd4` | Default link color |
| `--color-link-hover` | `#4fc3f7` | Link hover state |
| `--color-link-visited` | `#9d7dd2` | Visited links (purple) |

### Button Colors

```css
/* Primary button (blue) */
background: var(--color-btn-primary-bg);      /* #0e639c */
background: var(--color-btn-primary-hover);   /* #1177bb */

/* Secondary button (gray) */
background: var(--color-btn-secondary-bg);    /* #3c3c3c */
background: var(--color-btn-secondary-hover); /* #505050 */

/* Danger button (red) */
background: var(--color-btn-danger-bg);       /* #c72e0f */
background: var(--color-btn-danger-hover);    /* #e03e18 */
```

### Status Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#4ec9b0` | Success messages, valid states |
| `--color-warning` | `#cca700` | Warnings, approaching limits |
| `--color-error` | `#f48771` | Errors, validation failures |
| `--color-info` | `#4fc3f7` | Informational messages |

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
| `--shadow-focus` | `0 0 0 3px rgba(0,127,212,0.15)` | Focus indicators |

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
outline: 1px solid var(--color-border-focus);  /* #007fd4 */
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

## Component Patterns

### Buttons

```css
/* Base button */
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--btn-height-md);           /* 32px */
  padding: 0 var(--space-12);             /* 0 24px */
  font-size: var(--text-md);              /* 14px */
  font-weight: var(--font-semibold);      /* 600 */
  border: none;
  border-radius: var(--border-radius);    /* 0 */
  cursor: pointer;
  transition: var(--transition-normal);   /* 0.15s ease */
}

/* Primary button */
.btn-primary {
  background: var(--color-btn-primary-bg);
  color: var(--color-white);
  box-shadow: var(--shadow-sm);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-btn-primary-hover);
}

/* Secondary button */
.btn-secondary {
  background: transparent;
  color: var(--color-text-secondary);
  border: var(--border-width) solid var(--color-border-default);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-btn-secondary-bg);
}
```

### Inputs

```css
.input {
  width: 100%;
  height: var(--input-height-md);         /* 36px */
  padding: 0 var(--space-6);              /* 0 12px */
  font-size: var(--text-md);              /* 14px */
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: var(--color-bg-input);
  border: var(--border-width) solid var(--color-border-default);
  border-radius: var(--border-radius);    /* 0 */
  transition: var(--transition-normal);
}

.input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus);
}

.input::placeholder {
  color: var(--color-text-placeholder);
}
```

### Dialogs

```css
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: var(--z-dialog);
}

.dialog {
  background: var(--color-bg-primary);
  border: var(--border-width) solid var(--color-border-default);
  border-radius: var(--border-radius);    /* 0 */
  padding: var(--space-14);               /* 28px */
  min-width: var(--dialog-min-width);     /* 400px */
  max-width: var(--dialog-max-width);     /* 800px */
  box-shadow: var(--shadow-dialog);
}
```

### Tooltips

```css
.tooltip {
  padding: var(--space-4) var(--space-6);  /* 8px 12px */
  font-size: var(--text-sm);               /* 11px */
  background: var(--color-bg-elevated);
  border: var(--border-width) solid var(--color-border-default);
  border-radius: var(--border-radius);     /* 0 */
  box-shadow: var(--shadow-md);
  z-index: var(--z-tooltip);
}
```

---

## Z-Index Scale

Use these tokens for proper layer stacking:

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | 0 | Default layer |
| `--z-dropdown` | 100 | Dropdown menus |
| `--z-sticky` | 200 | Sticky headers |
| `--z-fixed` | 500 | Fixed elements |
| `--z-modal-backdrop` | 900 | Modal backdrops |
| `--z-modal` | 1000 | Modals, overlays |
| `--z-popover` | 2000 | Popovers |
| `--z-tooltip` | 3000 | Tooltips |
| `--z-toast` | 9000 | Toast notifications |
| `--z-blocker` | 9999 | UI blockers |
| `--z-dialog` | 10000 | Top-level dialogs |
| `--z-context-menu` | 100000 | Context menus (above dialogs) |

---

## Transitions & Animations

### Standard Timing

**Always use `--transition-normal` (0.15s ease)** unless there's a specific reason.

| Token | Duration | Usage |
|-------|----------|-------|
| `--transition-fast` | 0.1s ease | Quick feedback (hover colors) |
| `--transition-normal` | **0.15s ease** | Default for everything |
| `--transition-slow` | 0.2s ease | Larger elements, dialogs |
| `--transition-slower` | 0.3s ease | Complex animations |

```css
/* Good - uses token */
transition: var(--transition-normal);

/* Also good - specific properties */
transition: background-color var(--transition-normal),
            color var(--transition-normal);

/* Bad - hardcoded */
transition: all 0.2s ease-in-out;
```

---

## Do's and Don'ts

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
--color-bg-primary        /* Main background */
--color-bg-secondary      /* Panel background */
--color-border-default    /* Standard borders */
--color-accent-primary    /* VS Code blue */

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

## Migration Guide

This system is designed for **new code only**. Existing CSS files have not been migrated.

### When Migrating Existing CSS

Use these find-replace patterns:

| Old Value | New Token | Context |
|-----------|-----------|---------|
| `#cccccc` | `var(--color-text-primary)` | Text color |
| `#858585` | `var(--color-text-secondary)` | Muted text |
| `#1e1e1e` | `var(--color-bg-primary)` | Main background |
| `#2d2d30` | `var(--color-bg-secondary)` | Panel background |
| `#252526` | `var(--color-bg-tertiary)` | Sidebar background |
| `#3c3c3c` | `var(--color-border-default)` | Standard borders |
| `#454545` | `var(--color-border-subtle)` | Subtle borders |
| `#007fd4` | `var(--color-accent-primary)` | VS Code blue |
| `#0e639c` | `var(--color-btn-primary-bg)` | Primary button |
| `0.15s ease` | `var(--transition-normal)` | Transitions |
| `border-radius: 4px` | `border-radius: var(--border-radius)` | Remove rounding |

### Common Gotchas

1. **Spacing token naming**: `--space-4` = 8px (not 4px). It's a scale step.
2. **Context menus**: Use `--z-context-menu` (100000), not `--z-modal`.
3. **Hover backgrounds**: Use `--color-bg-hover-solid` (#2a2d2e) for menus, `--color-bg-hover` for overlays.
4. **Local `:root` variables**: Remove component-specific `:root` definitions; import design tokens instead.
