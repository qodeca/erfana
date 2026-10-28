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

## Screens

Plain HTML and CSS, no script. Open them in a browser.

| Folder | What it draws |
| --- | --- |
| [`html-comments/`](html-comments/index.html) | v1, as shipped: the overlay, comment window, drawer, toolbar and identity step. Decided cards – the app's code follows them |
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
