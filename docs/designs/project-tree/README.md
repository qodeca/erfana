<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Project tree

## Purpose

The Project panel: its header, the tree toolbar row and the file filter. The first design here answers
[#452](https://github.com/qodeca/erfana/issues/452) – four controls whose icons do not say what they do
(Import, Import while busy, Show all files, Show only Markdown files).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Icons](../../design-system/system/components/icon/index.html) (`components/icon/index.html`) | `proposed` | Lucide glyphs as `data-icon` bake targets; a new glyph joins the registry first |
| [Buttons](../../design-system/system/components/button/index.html) (`components/button/index.html`) | `proposed` | The busy ring, the pressed signature (fill and lime edge), `aria-busy` with `aria-disabled` |
| [Segmented control](../../design-system/system/components/segmented/index.html) (`components/segmented/index.html`) | `proposed` | The filter choice, its checked state and its keyboard |
| [Badges, chips and keys](../../design-system/system/components/badge/index.html) (`components/badge/index.html`) | `proposed` | The outline chip that says “Markdown only” in the header |
| [Toolbar](../../design-system/system/components/toolbar/index.html) (`components/toolbar/index.html`) | `proposed` | The row, unchanged |
| [Motion](../../design-system/system/foundations/motion.html) (`foundations/motion.html`) | `proposed` | One spinner; nothing turns under reduced motion |

## Screens

| Screen | Status | What it draws |
| --- | --- | --- |
| [`toolbar-icons.html`](toolbar-icons.html) | `decided`, owner approved 2026-11-03 | The four controls as they ship beside two or three icon options each, every state, three ways to show the active filter, contrast and the names |

## States

Drawn on the screen: each Import option at rest, hover, pressed and focus; Import busy alone and together with
Refresh busy; the filter panel open with each choice checked, and closed with Markdown only on.

## Decisions

The owner approved every recommendation on 2026-11-03:

- Import a file: `file-input` (also on the Welcome panel's Import button).
- Import while busy: the busy ring in place of the glyph. The Buttons card's "an icon-only button never goes
  busy" line stays; `ProjectTree.css` records a deviation and the card lists it.
- Show all files and folders: `folder-tree`. Show only Markdown files: keep `file-text`.
- Which filter is on: option A – a labelled "Show" choice plus "Markdown only" in the header.

## Developer handoff

Built for #452 in `ProjectTree.tsx`, `FileFilterChoice.tsx`, `ProjectTree.css`, `ProjectPanel.tsx`,
`ProjectPanel.css` and `WelcomePanel.tsx`. The icons are pinned by `ProjectTree.toolbar.test.tsx`; the header
trigger and words by `ProjectPanel.test.tsx`.

## Design review

Owner approval, 2026-11-03.
