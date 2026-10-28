<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Large projects

## Purpose

Keeping Erfana working on very large projects: the renderer crash (black window) and the Windows file watcher.

## Cards it builds on

Only the crash fix (#60) has a UI – the panel and full-window fallbacks. The Windows watcher (#211) changes no screen.

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Empty, loading and error states](../../design-system/system/patterns/states/index.html#error) | proposed | The panel error (`PanelErrorBoundary`) and the crash screen (`RootErrorBoundary`, the card's reference implementation); meta and stack text in `--color-text-secondary` on `--color-bg-primary` |
| [Buttons](../../design-system/system/components/button/index.html) | proposed | Restart, Copy error details and Open logs folder; pending Restart as `aria-disabled`, never `disabled` |
| [Focus and keyboard](../../design-system/system/foundations/focus.html) | decided | The one focus ring on the fallback's buttons and on the scrollable details region |
| [Writing](../../design-system/system/foundations/writing.html#errors) | proposed | Errors say what happened and what to do; en dashes; `…` on a running status |
| [Colours](../../design-system/system/foundations/colors.html#text) | proposed | Muted, disabled and placeholder text are forbidden on the crash surface |

## Documents

| File | Title |
| --- | --- |
| [`211-large-project-windows-watcher.md`](211-large-project-windows-watcher.md) | Design – Issue #211: large projects on Windows (native watcher, exclude list, watcher after first read) |
| [`design-issue-60.md`](design-issue-60.md) | Design – issue #60: renderer crash on very large projects (black window) |
