# UI Style Guide - Reference

> **Part of**: [UI Style Guide](./ui-style-guide.md)
> **Contents**: Component patterns, z-index scale, transitions, migration guide

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

## Migration Guide

As of v0.5.3, **all CSS files have been migrated** to use design tokens.

### Find-Replace Patterns

| Old Value | New Token | Context |
|-----------|-----------|---------|
| `#cccccc` | `var(--color-text-primary)` | Text color |
| `#858585` | `var(--color-text-secondary)` | Muted text |
| `#1e1e1e` | `var(--color-bg-primary)` | Main background (now Smoky Black) |
| `#2d2d30` | `var(--color-bg-secondary)` | Panel background |
| `#252526` | `var(--color-bg-tertiary)` | Sidebar background |
| `#3c3c3c` | `var(--color-border-default)` | Standard borders |
| `#454545` | `var(--color-border-subtle)` | Subtle borders |
| `#007fd4` | `var(--color-accent-primary)` | Old VS Code blue → now Qodeca Violet |
| `#A0A8FF` | `var(--color-accent-primary)` | Qodeca Violet (current) |
| `#E3E829` | `var(--color-accent-secondary)` | Qodeca Lime |
| `#0e639c` | `var(--color-btn-primary-bg)` | Primary button (now Qodeca Violet) |
| `0.15s ease` | `var(--transition-normal)` | Transitions |
| `border-radius: 4px` | `border-radius: var(--border-radius)` | Remove rounding |

### Common Gotchas

1. **Spacing token naming**: `--space-4` = 8px (not 4px). It's a scale step.
2. **Context menus**: Use `--z-context-menu` (100000), not `--z-modal`.
3. **Hover backgrounds**: Use `--color-bg-hover-solid` (#2a2d2e) for menus, `--color-bg-hover` for overlays.
4. **Local `:root` variables**: Remove component-specific `:root` definitions; import design tokens instead.
