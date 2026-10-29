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
| [Brand](../../design-system/system/foundations/brand.html) | `proposed` | The artwork rules – icon used as it ships, Cascadia Mono bold wordmark, no third-party name or mark, flat and square – and the light-surface rule: indigo is the accent, never lime or violet. The screen cites them and keeps only the banner geometry |
| [Colours](../../design-system/system/foundations/colors.html) | `proposed` | Every artwork colour is a token; each contrast ratio is a `data-contrast` cell with a `data-min` threshold, baked from the tokens |
| [Typography](../../design-system/system/foundations/type.html) | `proposed` | The font, weight (`--font-normal`, `--font-bold`) and leading (`--leading-none`, `--leading-snug`) tokens – the icon and wordmark sizes and the wordmark's `-0.02em` tracking deviate (image scale), see the screen's Exceptions |
| [Theme](../../design-system/system/foundations/theme.html#dark-only) | `proposed` | The dark-only stance – the light banner deviates, because GitHub has a light theme and the banner is a page asset, not app chrome ([Brand – a light variant without a light theme](../../design-system/system/foundations/brand.html#light-artwork)) |

## Screens

| Screen | What it draws |
| --- | --- |
| [`index.html`](index.html) | The dark banner, the light banner and the social preview at layout size, the social card's safe area (a doc-only diagram), the contrast table and Exceptions. A dashed outline marks each canvas edge on the page; it sits outside the artwork element, so the exported PNGs never contain it |

## States

None: the artwork is static images.

## Open decisions

None.

## Developer handoff

Change the screen, then run `npm run docs:brand` and `npm run design`. The `#gp-*` ids are the
contract `scripts/capture/brand.mjs` and its test read – rename them only with the script.

## Design review

Reviewed with #139; see [`../readme/README.md`](../readme/README.md).
