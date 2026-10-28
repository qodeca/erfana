<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Approving a remote host

## Purpose

What happens when a previewed HTML page asks for a font, script or image from a remote host:
Erfana blocks it and asks the user, in one band instead of one pop-up per host. The rest of the
HTML preview is in [`../html-preview/`](../html-preview/README.md).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../design-system/system/components/permission-band/index.html) | `decided` | The band that asks, and its CSS (`band.css`) |
| [Rows and lists](../../design-system/system/components/row/index.html) | `decided` | The list of blocked and allowed hosts, and its CSS (`row.css`) |
| [Colours](../../design-system/system/foundations/colors.html) | `proposed` | Colour tokens and their pairings |
| [Typography](../../design-system/system/foundations/type.html) | `proposed` | Text sizes and weights |
| [Theme](../../design-system/system/foundations/theme.html) | `proposed` | Dark only |

## Screens

| Screen | What it draws |
| --- | --- |
| [`index.html`](index.html) | The whole journey – nine states, from a clean page to a page that will not yield – and the keyboard route |

## States

Drawn on the screen: every state is its own static frame.

## Open decisions

Revoking an approval is not built yet (#86); the screen shows the allowed list as read-only.

## Developer handoff

Build from the screen once it is `decided`; it is `proposed` today.

## Design review

None recorded yet.
