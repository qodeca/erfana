<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Project tree

## Purpose

The project tree panel: how it shows, finds and marks files. First design: following the active tab ([#453](https://github.com/qodeca/erfana/issues/453)).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Rows and lists](../../design-system/system/components/row/index.html) | decided | The row, indent, selected state, focus ring, cut, git badges and the keyboard contract (its Tab rule amended for #453) |
| [Active file in the tree](../../design-system/system/components/tree-active-file/index.html) | decided | The new active-file mark (new card, added with this design) |
| [Tabs](../../design-system/system/components/tabs/index.html) | proposed | The selected tab's lime underline, which the active-file mark repeats |
| [Form controls](../../design-system/system/components/form/index.html) | proposed | The Settings checkbox |
| [Motion](../../design-system/system/foundations/motion.html#reduce) | proposed | No new motion: instant expand, instant scroll |
| [Forced colours](../../design-system/system/foundations/forced-colors.html) | proposed | Every state keeps a shape in a contrast theme |

## Screens

| File | Title |
| --- | --- |
| [`settings-row.html`](settings-row.html) | Settings – follow the active tab |

## States

The tree states are drawn on the [Active file in the tree](../../design-system/system/components/tree-active-file/index.html) card; the Settings states on [`settings-row.html`](settings-row.html).

## Open decisions

None – the owner answered every question on 2026-11-03 ([`453-follow-active-tab.md`](453-follow-active-tab.md#owner-decisions)).

## Developer handoff

Built in #453 – see [How it is built](453-follow-active-tab.md#how-it-is-built).

## Design review

Not reviewed yet.

## Documents

| File | Title |
| --- | --- |
| [`453-follow-active-tab.md`](453-follow-active-tab.md) | Design – Issue #453: show the active tab's file in the project tree |
