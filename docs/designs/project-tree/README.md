<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Project tree

## Purpose

The Project panel and its tree: the header, the tree toolbar row and the file filter, and how the tree shows,
finds and marks files. Two designs live here:

- [#452](https://github.com/qodeca/erfana/issues/452) – four controls whose icons do not say what they do
  (Import, Import while busy, Show all files, Show only Markdown files).
- [#453](https://github.com/qodeca/erfana/issues/453) – following the active tab in the tree.

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Icons](../../design-system/system/components/icon/index.html) (`components/icon/index.html`) | `proposed` | #452: Lucide glyphs as `data-icon` bake targets; a new glyph joins the registry first |
| [Buttons](../../design-system/system/components/button/index.html) (`components/button/index.html`) | `proposed` | #452: the busy ring, the pressed signature (fill and lime edge), `aria-busy` with `aria-disabled` |
| [Segmented control](../../design-system/system/components/segmented/index.html) (`components/segmented/index.html`) | `proposed` | #452: the filter choice, its checked state and its keyboard |
| [Badges, chips and keys](../../design-system/system/components/badge/index.html) (`components/badge/index.html`) | `proposed` | #452: the outline chip that says “Markdown only” in the header |
| [Toolbar](../../design-system/system/components/toolbar/index.html) (`components/toolbar/index.html`) | `proposed` | #452: the row, unchanged |
| [Rows and lists](../../design-system/system/components/row/index.html) | decided | #453: the row, indent, selected state, focus ring, cut, git badges and the keyboard contract (its Tab rule amended for #453) |
| [Active file in the tree](../../design-system/system/components/tree-active-file/index.html) | decided | #453: the new active-file mark (new card, added with this design) |
| [Tabs](../../design-system/system/components/tabs/index.html) | proposed | #453: the selected tab's lime underline, which the active-file mark repeats |
| [Form controls](../../design-system/system/components/form/index.html) | proposed | #453: the Settings checkbox |
| [Motion](../../design-system/system/foundations/motion.html#reduce) (`foundations/motion.html`) | `proposed` | #452: one spinner, nothing turns under reduced motion; #453: no new motion, instant expand and scroll |
| [Forced colours](../../design-system/system/foundations/forced-colors.html) | proposed | #453: every state keeps a shape in a contrast theme |

## Screens

| Screen | Status | What it draws |
| --- | --- | --- |
| [`toolbar-icons.html`](toolbar-icons.html) | `decided`, owner approved 2026-11-03 | #452: the four controls as they ship beside two or three icon options each, every state, three ways to show the active filter, contrast and the names |
| [`settings-row.html`](settings-row.html) | `decided`, owner approved 2026-11-03 | #453: Settings – follow the active tab |

## States

- #452, drawn on `toolbar-icons.html`: each Import option at rest, hover, pressed and focus; Import busy alone
  and together with Refresh busy; the filter panel open with each choice checked, and closed with Markdown only on.
- #453: the tree states are drawn on the [Active file in the tree](../../design-system/system/components/tree-active-file/index.html)
  card; the Settings states on [`settings-row.html`](settings-row.html).

## Decisions

#452 – the owner approved every recommendation on 2026-11-03:

- Import a file: `file-input` (also on the Welcome panel's Import button).
- Import while busy: the busy ring in place of the glyph. The Buttons card's "an icon-only button never goes
  busy" line stays; `ProjectTree.css` records a deviation and the card lists it.
- Show all files and folders: `folder-tree`. Show only Markdown files: keep `file-text`.
- Which filter is on: option A – a labelled "Show" choice plus "Markdown only" in the header.

#453 – the owner answered every question on 2026-11-03 ([`453-follow-active-tab.md`](453-follow-active-tab.md#owner-decisions)).

## Developer handoff

- #452: built in `ProjectTree.tsx`, `FileFilterChoice.tsx`, `ProjectTree.css`, `ProjectPanel.tsx`,
  `ProjectPanel.css` and `WelcomePanel.tsx`. The icons are pinned by `ProjectTree.toolbar.test.tsx`; the header
  trigger and words by `ProjectPanel.test.tsx`.
- #453: see [How it is built](453-follow-active-tab.md#how-it-is-built).

## Design review

Owner approval, 2026-11-03, for both designs.

## Documents

| File | Title |
| --- | --- |
| [`453-follow-active-tab.md`](453-follow-active-tab.md) | Design – Issue #453: show the active tab's file in the project tree |
