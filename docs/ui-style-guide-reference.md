# UI Style Guide - Reference

> **Part of**: [UI Style Guide](./ui-style-guide.md)
> **Contents**: Component patterns, z-index scale, transitions, migration guide

> **The patterns have moved to [`design/`](../design/index.html).** Component
> patterns, the z-index scale and the transition scale are now decided by cards
> that render them live. The sections below are stubs that keep their headings so
> existing links resolve.
>
> What is left is the **migration guide** — a historical find-and-replace table
> from the v0.5.3 token migration. It is a record of work already done, not a
> rule, which is why it is not a card.

---

## Component Patterns

> **Decided by [`design/system/components/button/index.html`](../design/system/components/button/index.html).** Buttons, inputs and dialogs, each rendered live with every state. See also the Form controls and Permission band cards.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Z-Index Scale

> **Decided by [`design/system/foundations/layering.html`](../design/system/foundations/layering.html).** The ladder, plus the rung above it that no z-index can reach - the native preview view.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

## Transitions & Animations

> **Decided by [`design/system/foundations/motion.html`](../design/system/foundations/motion.html).** The duration scale, the missing easing scale, one spinner, and the reduced-motion contract.
>
> This section is a stub. It keeps its heading so existing links still
> resolve, and it holds no rule, so it cannot contradict the card.

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
