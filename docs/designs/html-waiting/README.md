<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Waiting for a page

## Purpose

What the HTML preview shows between opening a page and its first paint, when it starts saying it,
and who it says the preview is waiting for. The rest of the HTML preview is in
[`../html-preview/`](../html-preview/README.md).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../design-system/system/components/permission-band/index.html) | `decided` | The band, when the wait is on a host approval, and its CSS (`band.css`) |
| [Rows and lists](../../design-system/system/components/row/index.html) | `decided` | Row CSS (`row.css`) |
| [Colours](../../design-system/system/foundations/colors.html) | `proposed` | Colour tokens and their pairings |
| [Typography](../../design-system/system/foundations/type.html) | `proposed` | Text sizes and weights |
| [Theme](../../design-system/system/foundations/theme.html) | `proposed` | Dark only |

## Screens

| Screen | What it draws |
| --- | --- |
| [`index.html`](index.html) | The timeline as a filmstrip, every state, the thresholds, the words, precedence, accessibility and Exceptions |

## States

Drawn on the screen: every state is its own static frame.

## Open decisions

The timing thresholds are still `proposed`; the screen explains why.

## Developer handoff

Build from the screen once it is `decided`; it is `proposed` today.

## Design review

None recorded yet.
