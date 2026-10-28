<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Approving a remote host

## Purpose

What happens when a previewed HTML page asks for a font, script or image from a remote host:
Erfana blocks it and asks the user, in one band instead of one pop-up per host. The band ships
(`PreviewChromeBand`, `PreviewNavControls`, `PreviewToolbarTools`); the screen draws it as it ships.
The rest of the HTML preview is in [`../html-preview/`](../html-preview/README.md).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../design-system/system/components/permission-band/index.html) (`components/permission-band/index.html`) | `decided` | The band, its bar markup, keyboard contract and CSS (`band.css`, `nav.css`) |
| [Rows and lists](../../design-system/system/components/row/index.html) (`components/row/index.html`) | `decided` | The host primitive `.erf-host` (`host.css`); `row.css` is not loaded, as no `.erf-row` is drawn |
| [Focus](../../design-system/system/foundations/focus.html) (`foundations/focus.html`) | `decided` | Focus moves: to the chip after Confirm, Cancel or Esc; never to Confirm |
| [Writing](../../design-system/system/foundations/writing.html) (`foundations/writing.html`) | `proposed` | Wording, en dashes, and shortcut notation (<kbd>⌘F</kbd> / <kbd>Ctrl+F</kbd>); the em dash the app ships in “Not saved – list full” is its open defect |
| [Feedback](../../design-system/system/components/feedback/index.html) (`components/feedback/index.html`) | `proposed` | One polite `role="status"` live region for “Approving…”, “… is now allowed” and “Could not save …” |
| [States](../../design-system/system/patterns/states/index.html) (`patterns/states/index.html`) | `proposed` | The failed approval stays inline on its row, not a separate error surface |
| [Toolbar](../../design-system/system/components/toolbar/index.html) (`components/toolbar/index.html`) | `proposed` | The bar's tool order and separator |
| [Motion](../../design-system/system/foundations/motion.html) (`foundations/motion.html`) | `proposed` | The list opens in one step, never animated |
| [Colours](../../design-system/system/foundations/colors.html) (`foundations/colors.html`) | `proposed` | Colour tokens and their pairings |
| [Typography](../../design-system/system/foundations/type.html) (`foundations/type.html`) | `proposed` | Text sizes and weights |
| [Theme](../../design-system/system/foundations/theme.html) (`foundations/theme.html`) | `proposed` | Dark only |

The third-party page in every frame is the shared `.ds-foreign-page` stand-in from `ds.css`.

## Screens

| Screen | Status | What it draws |
| --- | --- | --- |
| [`index.html`](index.html) | `proposed`, reviewed 2026-09-01 | The whole journey – nine states, from a clean page to a page that will not yield – and the keyboard route |

## States

Drawn on the screen, one static frame each: nothing asked for, four blocked, list open, confirm step,
approved, failed with a reason (“Not saved – list full”), already approved, page will not yield, panel too short.

Drawn or described elsewhere:

| State | Where |
| --- | --- |
| An IPv6 host under “Cannot be allowed” | [Permission band](../../design-system/system/components/permission-band/index.html#states), frame A |
| Confirm busy (“Saving…”) | [Permission band](../../design-system/system/components/permission-band/index.html#confirm-ring) |
| The unencrypted-host (`http://`) warning in the confirm step | Not drawn; see [108 – http and IPv6 in the preview](../html-preview/108-http-and-ipv6-in-the-preview.md) |
| A truncated host list (“Only the first hosts are listed …”) | Not drawn; its em dash is a [Writing](../../design-system/system/foundations/writing.html#open-defects) open defect |

## Open decisions

- Revoking an approval is not built yet (#86); the screen shows the allowed list as read-only.
- The app ships two keyboard behaviours the decided Permission band card does not name: <kbd>↑</kbd> / <kbd>↓</kbd>
  between Allow buttons, and focus on the confirm box itself (not Cancel) when Allow opens it. The screen records
  them as shipped, pending an owner decision on whether the card adopts them.
- A long failure reason (“Not saved – list full”) is wider than the row's fixed middle track and runs under Allow –
  read from the synced `band.css`, not checked in the running app. It needs an app follow-up.

## Developer handoff

The feature ships; the screen is `proposed` because it documents, it does not decide. Build changes against the
decided Permission band card.

## Design review

None recorded yet.
