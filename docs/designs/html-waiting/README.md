<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Waiting for a page

## Purpose

What the HTML preview shows between opening a page and its first paint, when it starts saying it,
and who it says the preview is waiting for. The band in the screen ships; the waiting message and the
residual line do not. The residual line is the Permission band card's load status slot, decided by the
owner on 2026-10-28; this screen decides when it shows. The rest of the HTML preview is in [`../html-preview/`](../html-preview/README.md).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../design-system/system/components/permission-band/index.html) (`components/permission-band/index.html`) | `decided` | The band in every frame, its bar markup and CSS (`band.css`, `nav.css`); Surface B is the card's load status slot (`#load-status`, decided by the owner on 2026-10-28): "Still loading – part of the page has not arrived", "Stopped. The page may be missing parts." and Reload as a band tool, the line hidden below about 420px of bar |
| [Rows and lists](../../design-system/system/components/row/index.html) (`components/row/index.html`) | `decided` | The host primitive `.erf-host` (`host.css`) and the rule that a host is never cut |
| [States](../../design-system/system/patterns/states/index.html) (`patterns/states/index.html`) | `proposed` | Surface A is `.erf-state--inline` in the words-only and escalated loading forms (`#loading-time`, frames b and c), with Stop as `erf-state__action`; the announcement budget |
| [Toolbar](../../design-system/system/components/toolbar/index.html) (`components/toolbar/index.html`) | `proposed` | Surface B's line is `.erf-toolbar__status` (`toolbar.css`): shrinks and ends in an ellipsis before any control does, never wraps |
| [Icons](../../design-system/system/components/icon/index.html) (`components/icon/index.html`) | `proposed` | Registry icons as `data-icon` bake targets |
| [Focus](../../design-system/system/foundations/focus.html) (`foundations/focus.html`) | `decided` | Stop is never focused automatically; when it goes away focus moves to the chip |
| [Writing](../../design-system/system/foundations/writing.html) (`foundations/writing.html`) | `proposed` | Wording and en dashes |
| [Feedback](../../design-system/system/components/feedback/index.html) (`components/feedback/index.html`) | `proposed` | Reuse the band's one polite `role="status"` region |
| [Motion](../../design-system/system/foundations/motion.html) (`foundations/motion.html`) | `proposed` | No animation, so nothing for reduced motion to switch off |
| [Colours](../../design-system/system/foundations/colors.html) (`foundations/colors.html`) | `proposed` | Colour tokens and their pairings |
| [Theme](../../design-system/system/foundations/theme.html) (`foundations/theme.html`) | `proposed` | Dark only |

## Screens

| Screen | Status | What it draws |
| --- | --- | --- |
| [`index.html`](index.html) | `proposed`, reviewed 2026-09-01 | The timeline as a filmstrip, every state, the thresholds, the words, precedence, accessibility, deliberate differences and Exceptions |

## States

Drawn on the screen, one static frame each: quiet wait, explained (remote host), explained (nothing remote),
residual at 640, 460 and 300px, stopped at the same widths, settled, suppressed by the band, suppressed in an
inactive tab, and the reduced-motion twin of the remote case.

## Open decisions

- The timing thresholds are `proposed`; the screen's 600 ms show delay differs from the States pattern's proposed 400 ms.
- Surface B's place, words and look are settled: the owner decided the Permission band card's load status slot on 2026-10-28. When it shows (the thresholds above) is still this screen's proposal.
- The placeholder's `img` role pre-paint (`HtmlPreviewPanel.tsx:454-463`) must become `group` while Surface A shows.

## Developer handoff

Build nothing from the screen yet; it is `proposed`.

## Design review

None recorded yet.
