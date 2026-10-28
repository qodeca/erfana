<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Comments in the HTML and Markdown previews

## Purpose

Everything about comments in the previews: one comment system for the HTML Preview and the
Markdown Preview, including comments on selected text. The written designs:

| File | What it covers |
| --- | --- |
| [`html-preview-comments.md`](html-preview-comments.md) | v1 – HTML Preview comments, as shipped in v0.23.1 |
| [`comments-v2.md`](comments-v2.md) | v2 – the plan of record for both previews, after the UX and UI review |
| [`markdown-preview-comments.md`](markdown-preview-comments.md) | Markdown Preview comments |
| [`selection-comments.md`](selection-comments.md) | Comments on selected text |

## Cards it builds on

Status as on each card's line 1, 2026-10-28. A `proposed` card is the direction of travel, not settled law.

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../design-system/system/components/permission-band/index.html) | `decided` | The comment tools in the HTML band, after Find |
| [Focus and keyboard](../../design-system/system/foundations/focus.html) | `decided` | The one ring – outward, offset `--space-1` – and Tab order, with the exceptions listed in [`html-preview-comments.md`](html-preview-comments.md) §10.11 |
| [Menu](../../design-system/system/components/menu/index.html) | `decided` | The comment menus. Where a disabled item's reason goes is not on this card; the Markdown screens propose a tooltip |
| [Rows and lists](../../design-system/system/components/row/index.html) | `decided` | The drawer's list of comments. The drawer's two Tab stops per active row are a recorded deviation – the card's [Exceptions](../../design-system/system/components/row/index.html#exceptions) row "HTML-preview comments drawer" |
| [Form controls](../../design-system/system/components/form/index.html) | `decided` | Borders, ring and error contract. The comment **textarea** (multi-line, counter, <kbd>⌘Enter</kbd> / <kbd>Ctrl+Enter</kbd>) is the card's *proposed addition*, not yet part of the decided card – it joins it when the comment window is promoted |
| [Writing](../../design-system/system/foundations/writing.html) | `proposed` | The comment glossary – comment, thread, reply, icon, underline, selection, comment mode ([#glossary](../../design-system/system/foundations/writing.html#glossary)) – the Markdown kind nouns ([#kind-nouns](../../design-system/system/foundations/writing.html#kind-nouns)) and shortcut notation ([#shortcuts](../../design-system/system/foundations/writing.html#shortcuts)) |
| [Text highlights](../../design-system/system/foundations/highlights.html) | `proposed` | The comment mark: `erf-comment`, `erf-comment-active` (same fill, double bar) and `erf-comment-changed`, the proposed `--color-comment-mark` tokens, the paint order under Find, and forced colours (`Mark` / `MarkText`) |
| [Buttons](../../design-system/system/components/button/index.html), [Toolbar](../../design-system/system/components/toolbar/index.html) | `proposed` | The Markdown toolbar's comment tools as `.erf-button--icon` and `--toggle` in `.erf-toolbar`; the Markdown toolbar keeps 32 × 28 tools and one Tab stop per control, as shipped |
| [Feedback](../../design-system/system/components/feedback/index.html) | `proposed` | Banners inside the window (`.erf-banner`) with the spoken severity word – which the shipped `CommentBanner` still lacks |
| [Badges, chips and keys](../../design-system/system/components/badge/index.html) | `proposed` | The open count and the needs-attention count (`.erf-counter`, `.erf-counter--attention`), the drawer's badge |
| [Tooltip](../../design-system/system/components/tooltip/index.html) | `proposed` | Tool names and shortcuts; the reason on a disabled menu item, tied by `aria-describedby` |
| [Empty, loading and error states](../../design-system/system/patterns/states/index.html) | `proposed` | The empty drawer (`.erf-state--inline`) |
| [Drawer](../../design-system/system/patterns/drawer/index.html) | `proposed` | The comments drawer's shell – flow sibling, width, header, controls band, one scroller |
| [Segmented control](../../design-system/system/components/segmented/index.html) | `proposed` | The drawer's Open / Resolved / Needs attention filter |
| [Colours](../../design-system/system/foundations/colors.html), [Layering](../../design-system/system/foundations/layering.html), [Motion](../../design-system/system/foundations/motion.html) | `proposed` | Colour pairings, the top-layer and dialog rungs, the one-shot flash |
| [Icons](../../design-system/system/components/icon/index.html), [Forced colours](../../design-system/system/foundations/forced-colors.html) | `proposed` | The registry glyphs (`<svg data-icon>`); how marks and the overlay look in forced colours |

## Screens

Plain HTML and CSS, no script. Open them in a browser.

| Folder | What it draws |
| --- | --- |
| [`html-comments/`](html-comments/index.html) | v1, as shipped: the overlay, comment window, drawer, toolbar and identity step. Decided screens – the app's code follows them |
| [`comments-v2/`](comments-v2/index.html) | The v2 overview and journey, the comment window, drawer, marks, menus and toolbar |
| [`markdown-comments/`](markdown-comments/index.html) | The Markdown journey, every Markdown state, and where comment blocks go in the source |
| [`selection-comments/`](selection-comments/index.html) | Comments on selected text in both previews |

The screens use the design system's tokens and shared CSS and run no JavaScript. Their numbers
are bake targets (`data-claim`, `data-contrast`) that `npm run design` fills from the code, so they
still come from the code. `npm run lint:css` checks them for the token rules,
`scripts/design-claims.test.mjs` checks their baked values and `@card` markers, and
`npm run design -- --check` runs the static-by-rule guard over them. The `html-comments/` screens were
interactive demos driven by a shared `demo.js`; they are now static snapshots of their default state.

## States

Drawn on the screens above: every state is its own static frame.

## Open decisions

None. The owner decisions OD-01…OD-08 are recorded in [`comments-v2.md`](comments-v2.md) §2.

## Developer handoff

[`comments-v2.md`](comments-v2.md) §3 lists every change (C-01…C-27) and the screen that draws it.

## Design review

The v2 UX and UI review and its resolutions R-01…R-20 are in [`comments-v2.md`](comments-v2.md) §7.
