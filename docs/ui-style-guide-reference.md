# UI Style Guide - Reference

> **Part of**: [UI Style Guide](./ui-style-guide.md)
> **Contents**: Component patterns, z-index scale, transitions, token gotchas

> **The patterns have moved to [`design/`](../design/index.html).** Component
> patterns, the z-index scale and the transition scale are now decided by cards
> that render them live. The sections below are stubs that keep their headings so
> existing links resolve.
>
> What is left is a short list of **token gotchas** from the v0.5.3 token
> migration.

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

As of v0.5.3, all CSS files use design tokens. The find-and-replace table from that migration was removed as a record of finished work; the gotchas below still apply.

### Common Gotchas

1. **Spacing token naming**: `--space-4` = 8px (not 4px). It's a scale step.
2. **Context menus**: Use `--z-context-menu` (100000), not `--z-modal`.
3. **Hover backgrounds**: Use `--color-bg-hover-solid` (#2a2d2e) for menus, `--color-bg-hover` for overlays.
4. **Local `:root` variables**: Remove component-specific `:root` definitions; import design tokens instead.
