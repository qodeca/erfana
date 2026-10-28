<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Clipboard

## Purpose

The central text-clipboard service: one main-process path for copy and paste, and one place that handles clipboard errors.

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Feedback – toasts](../../design-system/system/components/feedback/index.html#toast) | proposed | The clipboard error toast: stays until closed, never takes focus, a burst merges into one |
| [Writing – errors](../../design-system/system/foundations/writing.html#errors) | proposed | The toast's wording: what happened, why, what to do; en dashes |

The shipped toast text and its open wording defect (an em dash) are quoted in [`issue-203-clipboard-service.md`](issue-203-clipboard-service.md#design-system-2026-10-28).

## Documents

| File | Title |
| --- | --- |
| [`issue-203-clipboard-service.md`](issue-203-clipboard-service.md) | Design: Central text-clipboard service (issue #203) – v2 (post lens-review) |
