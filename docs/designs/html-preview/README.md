<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# HTML preview

## Purpose

The HTML preview: running a page's CSS and JavaScript, link navigation and preview tabs, and what Chromium does with `http://` and IPv6. The multi-page preview (#124) is in [`multi-page/`](multi-page/README.md). Comments in the preview are in [`../comments/`](../comments/README.md); approving a remote host and the loading states are drawn in [`../html-approval/`](../html-approval/README.md) and [`../html-waiting/`](../html-waiting/README.md).

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../design-system/system/components/permission-band/index.html) | decided | The bar above the page: the blocked-host chip, approve and confirm, the fail-safe |
| [Toolbar](../../design-system/system/components/toolbar/index.html) | proposed | The preview toolbar's groups, tool heights and keyboard |
| [Feedback](../../design-system/system/components/feedback/index.html#band-or-banner) | proposed | Failure and stale-content messages as a band under the toolbar; toast placement beside a live preview |
| [Layering](../../design-system/system/foundations/layering.html#decision) | proposed | The native view sits above every z-index; overlays hide it or stay outside its rectangle |
| [Empty, loading and error states](../../design-system/system/patterns/states/index.html) | proposed | The panel's error state when nothing is left to show; the page placeholder while it loads |
| [Focus and keyboard](../../design-system/system/foundations/focus.html) | decided | The focus ring, including the placeholder's top-edge-only ring |
| [Writing](../../design-system/system/foundations/writing.html#shortcuts) | proposed | Shortcut notation in these notes (`⌘F / Ctrl+F`) and the UI copy |

Section 1.8 and 1.8a of [`sd-074-html-preview.md`](sd-074-html-preview.md) say which rules moved onto these cards. Loading states are drawn in [`../html-waiting/`](../html-waiting/README.md) and host approval in [`../html-approval/`](../html-approval/README.md).

## Documents

| File | Title |
| --- | --- |
| [`108-http-and-ipv6-in-the-preview.md`](108-http-and-ipv6-in-the-preview.md) | What Chromium actually does with `http://` and IPv6 in a preview |
| [`sd-074-html-preview.md`](sd-074-html-preview.md) | Design: HTML preview with CSS and JavaScript execution |
| [`sd-074b-preview-navigation-and-multiview.md`](sd-074b-preview-navigation-and-multiview.md) | Design: HTML preview – in-page link navigation + independent preview tabs |
