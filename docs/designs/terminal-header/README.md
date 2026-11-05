<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Terminal header

## Purpose

[#462](https://github.com/qodeca/erfana/issues/462): since the toolbar overflow of #451, the terminal panel header
moves three of its buttons into the "…" (More actions) menu at the **default** terminal width, so each needs an extra
click in the normal layout. This design measures what fits today and proposes two ways to keep the terminal's own
buttons in the row. The owner picks one; the approved option is then recorded in the Toolbar overflow card.

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Toolbar overflow](../../design-system/system/patterns/toolbar-overflow/index.html) (`patterns/toolbar-overflow/index.html`) | decided | Everything about what moves: rightmost first, raised buttons last, the title's reserve, rule 5 (never trade one button for …). Unchanged by either option |
| [Buttons](../../design-system/system/components/button/index.html) (`components/button/index.html`) | proposed | The 24 × 24 icon button; Option A's Capture is a menu button (`aria-haspopup`, `aria-expanded`, open fill) |
| [Menu](../../design-system/system/components/menu/index.html) (`components/menu/index.html`) | decided | The menu, separators, and the rule against submenus (Option A's group goes flat into …) |

## Facts (measured)

- **Default width.** The right (terminal) panel defaults to 300 px – `rightWidth: 300` in
  `src/renderer/src/stores/useActivityBarStore.ts` (baked on the screen as the `terminal-default-width-px` claim).
- **Platforms.** All eight buttons appear on macOS and Windows: `pickCapturer` in `src/main/services/ScreenshotService.ts`
  returns a real capturer for `darwin` and `win32` and the unsupported one elsewhere. Linux has five buttons (no
  screen capture) and they all fit at 300 px today.
- **The buttons, in toolbar order** (`headerActions` in `TerminalPanel.tsx`): Capture screen, Capture window, Capture
  area, Capture photo, Scroll to bottom, Restart terminal, Lock scroll to bottom, Maximize terminal (raised,
  `moveLast`).
- **The row** (`.terminal-panel .sidebar-panel-header`, `TerminalPanel.css`): padding `0 --space-6` (12 px), gap
  `--space-4` (8 px) between icon, title and the button group. Buttons and … are `.icon-btn`, `--icon-size-lg`
  (24 px). The button gap is `--erf-toolbar-overflow-gap`, which the terminal does not set, so it is the 8 px
  default (the Project row sets 4 px, the editor toolbars 2 px).
- **The title's text does not count.** `computeOverflow` reserves the title's `min-width` (`--space-16`, 32 px, from
  `.erf-toolbar-overflow__title`), not its text width. A shorter title therefore gains nothing; the issue's "shorter
  title" lever is a no-op.

### How it was measured

A calculation, not a run of the app: the widths above, read from the CSS, fed to the shipping
`computeOverflow` (`src/renderer/src/components/ToolbarOverflow/toolbarOverflow.logic.ts`) under Node. The real
Electron app was not launched. The result is robust to a pixel or two of panel chrome: the same three buttons move
for any header width from 272 to 303 px.

**Result at 300 px today:** buttons get 300 − 24 (padding) − 24 (icon + gap) − 40 (title reserve + gap) = **212 px**.
All eight need 248; seven plus … also need 248, and moving one alone is refused (rule 5); six plus … need 216; five plus
… need 184 and fit. So **three move**: Scroll to bottom, Restart terminal, Lock scroll to bottom. The row keeps the four
captures and Maximize.

## Options

| | Option A – one Capture menu button | Option B – terminal actions first, tighter gap |
| --- | --- | --- |
| Change | Screen, window, area and photo become one icon-only Capture button that opens a menu | Order: Scroll to bottom, Lock scroll, Capture screen, window, area, photo, Restart; Maximize stays raised. Button gap `--space-4` → `--space-3` (6 px) |
| In the row at 300 px | Capture, Scroll to bottom, Restart terminal, Lock scroll to bottom, Maximize terminal – no … | Scroll to bottom, Lock scroll to bottom, Capture screen, Capture window, Capture area, Maximize terminal, … |
| In the … menu at 300 px | Nothing | Capture photo, Restart terminal |
| Budget used / spare (of 212) | 152 / 60 | 204 / 8 |
| Next button moves below | 240 px | 292 px |
| Nothing moves from | 240 px | 322 px |
| Cost | Every capture is two clicks at every width (one today on a wide panel). A new menu button in a toolbar, and the rule that a moved group goes flat into … | Restart and Capture photo are two clicks at the default width; the title is down to its reserve ("TE…"); only 8 px of slack, so a future ninth button pushes another one out |
| Build size | Larger: a menu button in `ToolbarOverflow` (or the header), its busy state, and group-flattening when it moves | Small: reorder `headerActions`, set `--erf-toolbar-overflow-gap: var(--space-3)` on the terminal header |

Why that order in B: Scroll to bottom and the scroll lock act on what the agent is printing right now, so they are the
most-used and lead. Restart is placed to move first because it is rare and it ends whatever the agent is running – one
deliberate click away is a feature, not a cost. The captures keep their internal order. (Usage is judgement; Erfana has
no usage telemetry to check it against.)

## Recommendation

**Option B** – it fixes #462 for the three actions people press while an agent runs, keeps the three screenshot
buttons one click away (they are how a user hands the agent a picture), and changes only order and gap inside the
decided card's rules; Option A makes every capture slower to save room the default width does not need.

## Screens

| Screen | Status | What it draws |
| --- | --- | --- |
| [`terminal-header.html`](terminal-header.html) | `proposed` | Today at 300 px and its … menu; Option A at 300 px, its Capture menu, and at the dock minimum with … open; Option B at 300 px and its … menu; the budget table |

## States

- **Today, default width** – four captures and Maximize in the row; Scroll, Restart and Lock in ….
- **Option A, default width** – five buttons, no …; the Capture menu open; at the dock minimum the four captures as a
  flat group in ….
- **Option B, default width** – six buttons and …; Capture photo and Restart in the menu.
- Unchanged by both: hover, focus, pressed toggles, busy captures and the narrow states are the Toolbar overflow and
  Buttons cards' own.

## Open decisions

| Decision | Recommended | Alternative |
| --- | --- | --- |
| Which buttons stay in the row at the default width | Option B | Option A |

## Developer handoff

Not started – build nothing until the owner picks. Then:

- Record the approved option in the Toolbar overflow card (owner's edit: the card is decided) – its terminal order
  table and frames.
- **Acceptance test** (#462's third criterion), in `e2e/toolbar-overflow.e2e.ts` or a unit test of the header with a
  300 px row: at the default terminal width (do not drag the splitter), these buttons are in the row and not in the
  … menu –
  - Option B: Scroll to bottom, Lock scroll to bottom, Capture screen, Capture window, Capture area, Maximize
    terminal in the row; Capture photo and Restart terminal in the menu (assert their `-overflow-item` test ids).
  - Option A: Capture, Scroll to bottom, Restart terminal, Lock scroll to bottom, Maximize terminal in the row, and no
    … button.
  - On Linux (no screen capture), every button is in the row and there is no ….
- A `toolbarOverflow.logic.test.ts` case pins the arithmetic with the 212 px budget above, so a CSS change that
  shifts it fails fast.

## Design review

Not yet reviewed.
