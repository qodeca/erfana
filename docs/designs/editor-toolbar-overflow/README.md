<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Editor toolbar overflow

## Purpose

[#461](https://github.com/qodeca/erfana/issues/461): the Markdown editor's toolbar and every Mermaid diagram's
toolbar cut buttons off when the panel (or the diagram) is narrow. #451 fixed that for the terminal and project
headers with a "More actions" (…) menu; this design applies the same rule to the editor's two toolbars, which carry
things the panel headers do not: separators, a flexible spacer, a live status region, a modified dot, a view-mode
group, export buttons disabled with a reason, and the comment tools.

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Toolbar overflow](../../design-system/system/patterns/toolbar-overflow/index.html) (`patterns/toolbar-overflow/index.html`) | decided | Everything: what moves and in which order (rightmost first), the … button, the menu's content, state in the menu, focus and the keyboard. Two recorded exceptions (below) |
| [Toolbar](../../design-system/system/components/toolbar/index.html) (`components/toolbar/index.html`) | proposed | The row, its groups and separators, the spacer, the pressed look of a view mode |
| [Menu](../../design-system/system/components/menu/index.html) (`components/menu/index.html`) | decided | The menu, unchanged: separators, the shortcut column, the reason line under a disabled item |
| [Buttons](../../design-system/system/components/button/index.html) (`components/button/index.html`) | proposed | The icon button and the toggle (`aria-pressed`) |

## Screens

| Screen | Status | What it draws |
| --- | --- | --- |
| [`toolbar-overflow.html`](toolbar-overflow.html) | `proposed` | The Markdown toolbar wide, medium and narrow with the menu open; the editor-only view's disabled exports in the menu; the preview view with the comment tools pinned; a narrow Mermaid diagram with its menu open |

## States

- **Wide** – every button in the row, no ….
- **Medium** – the rightmost buttons (the exports) moved with their separator; the live status region keeps its place.
- **Narrow, menu open** – the moved buttons in toolbar order, one separator between groups, the current view mode
  checked, shortcuts in the shortcut column.
- **Disabled with a reason** – in the editor-only view the exports are dim, reachable, and carry “Switch to preview
  or split mode” as the item's second line (the row keeps it in the tooltip).
- **Pinned content** – the comment tools, the modified dot and the live region never move.
- **Mermaid, narrow** – directions and fullscreen move into a … inside the “Layout direction” group; the current
  direction is checked and disabled.

## Open decisions

For the owner. Each has a recommendation; the build follows the recommendation until answered.

| Decision | Recommended | Alternatives |
| --- | --- | --- |
| Pin the comment tools (exception to the card's rule 4, “nothing is pinned”) | Pin them: they are a component (two stateful buttons with a count, busy text and a drawer), not one action a menu item can stand for | Split them into two menu-capable actions – a larger change in the comments code (spec 024) |
| View modes and directions in the menu (exception to rule 7, “a view-mode radio becomes a `menuitemradio`”) | Checked `menuitemcheckbox` now, and a follow-up adding a radio item to the shared `ContextMenu`; then make the row a `radiogroup` as the Toolbar card proposes | Add `menuitemradio` to `ContextMenu` in this change |
| Raise the view modes (move last), as the terminal raises Maximize | No – the card's plain right-to-left order; view modes leave before formatting | Raise them, so switching to the preview stays one click away longest |
| The row's view-mode state | `aria-pressed` added (the Toolbar card names class-only state as a defect) | Leave class-only until the radiogroup lands |

## Developer handoff

- The shared component grew three kinds of entry, all in `components/ToolbarOverflow/`: an action's
  `separatorBefore` (the separator renders inside the button's slot, so it moves with it; the menu separates groups –
  `menuSeparatorsBefore` in `toolbarOverflow.logic.ts`), `{ kind: 'pinned', content }` (never moves, measured as drawn,
  0 included, and observed for size changes of its own), and `{ kind: 'spacer' }` (fills the row, counted at its CSS
  `min-width`). An action also takes a `reason` for its menu item, and the row a `toolbarLabel` (`role="toolbar"`), a
  `groupLabel` (`role="group"` on the button group) and a `separatorClassName`.
- `MarkdownToolbar.tsx` and `MermaidToolbar.tsx` describe their buttons as entries; every row `data-testid` is kept,
  and a moved button's menu item is `${testId}-overflow-item`.
- The Mermaid row now spans the diagram's width (inset by `--space-4`) so it can measure it; only its button group
  takes the pointer.
- Tests: `toolbarOverflow.logic.test.ts`, `MarkdownToolbar.overflow.test.tsx`, `MermaidToolbar.overflow.test.tsx`,
  and `e2e/editor-toolbar-overflow.e2e.ts`.

## Design review

Not yet reviewed.
