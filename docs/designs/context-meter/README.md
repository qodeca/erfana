<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Context meter

## Purpose

The Claude Code context-window meter and the per-terminal status bar: how the model and its context size are read, and how the meter stays correct after compaction.

## Cards it builds on

The status bar (#216) is the only part with a UI; the registry (#41) and the freeze fix (#47) change no screen.

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Colours – context meter](../../design-system/system/foundations/colors.html#context-meter) | proposed | The safe, amber and red fills (`--color-context-safe`, `--color-warning`, `--color-error`) and their contrast |
| [Badges, chips and keys](../../design-system/system/components/badge/index.html#chip) | proposed | The 200k / 1M window badge as a static chip |
| [Feedback – meter](../../design-system/system/components/feedback/index.html#meter) | proposed | The meter: `role="meter"`, `aria-valuetext` in real units, the `--space-2` track |
| [Tooltip](../../design-system/system/components/tooltip/index.html) | proposed | Nothing may live only in a tooltip; the shipped `title=` is recorded as drift |
| [Motion](../../design-system/system/foundations/motion.html#reduce) | proposed | The fill transition, stopped under reduced motion |
| [Typography](../../design-system/system/foundations/type.html#roles) | proposed | Text sizes and weights; the Status line role |
| [Status bar](../../design-system/system/components/status-bar/index.html) | proposed | The shared panel status-bar shape, collapse order and live-region rule |

Where the shipped bar differs from these cards is listed under "Known drift" at the top of [`216-claude-status-bar.md`](216-claude-status-bar.md).

## Documents

| File | Title |
| --- | --- |
| [`216-claude-status-bar.md`](216-claude-status-bar.md) | Design – Issue #216: Per-terminal Claude Code context status bar |
| [`41-model-capability-registry.md`](41-model-capability-registry.md) | Design – Issue #41: Shared model-id parser and context-window capability registry |
| [`47-context-meter-freeze.md`](47-context-meter-freeze.md) | SD-047 – Context-meter freeze after compaction (fallback-read bound + version guard) |
