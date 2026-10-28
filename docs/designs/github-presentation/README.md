<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# GitHub presentation

## Purpose

The README banner (dark and light), the wordmark and the repository's social preview. The screen is
their source: `npm run docs:brand` screenshots its artwork into `docs/assets/readme/`, so a token
change is one re-run away from a new banner. The redesign that introduced it is in
[`../readme/`](../readme/README.md) (#139).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Colours](../../design-system/system/foundations/colors.html) | `proposed` | Every artwork colour is a token; the contrast ratios are baked from the code |
| [Typography](../../design-system/system/foundations/type.html) | `proposed` | The font and weights – the icon and wordmark sizes deviate (image scale), see the screen's Exceptions |
| [Theme](../../design-system/system/foundations/theme.html#dark-only) | `proposed` | The dark-only stance – the light banner deviates, because GitHub has a light theme and the banner is a page asset, not app chrome |

## Screens

| Screen | What it draws |
| --- | --- |
| [`index.html`](index.html) | The dark banner, the light banner and the social preview at layout size, with their contrast table and Exceptions |

## States

None: the artwork is static images.

## Open decisions

None.

## Developer handoff

Change the screen, then run `npm run docs:brand` and `npm run design`. The `#gp-*` ids are the
contract `scripts/capture/brand.mjs` and its test read – rename them only with the script.

## Design review

Reviewed with #139; see [`../readme/README.md`](../readme/README.md).
