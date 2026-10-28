<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Multi-page HTML preview (#124)

## Purpose

The preview keeps a site of several pages inside its panel: frames, same-tab links and opening a page in the default browser. Start with [`design-issue-124.md`](design-issue-124.md); the parts, planned files and the as-built log follow it.

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Permission band](../../../design-system/system/components/permission-band/index.html) | decided | The band, its Back button and link-mode toggle, and the narrow-width tiers (#124 sections on the card) |
| [Toolbar](../../../design-system/system/components/toolbar/index.html) | proposed | The trailing tools (Open in default browser, Export to PDF) and the "a role is a promise" rule |
| [Dialog](../../../design-system/system/patterns/dialog/index.html) | proposed | The unsaved-changes dialog: Save focused, Don't save set apart on the start edge (part 3 §3.6) |
| [Feedback](../../../design-system/system/components/feedback/index.html#toast) | proposed | The open-in-browser and frame toasts; the failure badge's messages |
| [Focus and keyboard](../../../design-system/system/foundations/focus.html) | decided | Keyboard entry into the page and the placeholder's top-edge-only focus ring |
| [Writing](../../../design-system/system/foundations/writing.html#shortcuts) | proposed | Shortcut notation (`⌘[ / Alt+←`, `⌘F / Ctrl+F`) and button verbs |

These notes are the as-built record of #124; the cards are the rules today. Where a note and a card disagree, the card wins.

## Documents

| File | Title |
| --- | --- |
| [`design-issue-124-files-g6g7.md`](design-issue-124-files-g6g7.md) | Design – issue #124: planned files, G6 and G7 |
| [`design-issue-124-files.md`](design-issue-124-files.md) | Design – issue #124: planned files |
| [`design-issue-124-impl.md`](design-issue-124-impl.md) | Design – issue #124: Phase 5 as built – deviations log |
| [`design-issue-124-part1.md`](design-issue-124-part1.md) | Design – issue #124, part 1: the preview stays inside its panel |
| [`design-issue-124-part2.md`](design-issue-124-part2.md) | Design – issue #124, part 2: frames show pages from the same project |
| [`design-issue-124-part3.md`](design-issue-124-part3.md) | Design – issue #124, part 3: links can open in the same tab |
| [`design-issue-124-part4.md`](design-issue-124-part4.md) | Design – issue #124, part 4: open in default browser |
| [`design-issue-124.md`](design-issue-124.md) | Design – issue #124: multi-page HTML preview |
