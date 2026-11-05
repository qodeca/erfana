<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Clipboard

## Purpose

The central text-clipboard service: one main-process path for copy and paste, and one place that handles clipboard errors. And the clipboard actions on every surface (#463): Cut, Copy, Paste and Delete wherever they make sense, from the keyboard and the right-click menu, with the same labels and shortcut hints.

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Feedback – toasts](../../design-system/system/components/feedback/index.html#toast) | proposed | The clipboard error toast: stays until closed, never takes focus, a burst merges into one |
| [Writing – errors](../../design-system/system/foundations/writing.html#errors) | proposed | The toast's wording: what happened, why, what to do; en dashes |
| [Menu](../../design-system/system/components/menu/index.html) | decided | The keyboard contract of every menu below; disabled items still reached by the arrows; the danger Delete; hint glyphs (`⌘X`, `⌘⌫`, `Ctrl+V`) and their `aria-keyshortcuts` |

The shipped toast text and its open wording defect (an em dash) are quoted in [`issue-203-clipboard-service.md`](issue-203-clipboard-service.md#design-system-2026-10-28).

## Screens

| Screen | Status | What it shows |
| --- | --- | --- |
| [`clipboard-actions.html`](clipboard-actions.html) | proposed | The text-field menu (Windows with a selection, macOS without, a password field), the tree file-row menu on both platforms, the project root row without hints, the editor menu with Delete, the Markdown preview menu without a selection, and the HTML preview menu with words selected (macOS) and without (Windows) |

## Clipboard actions (#463)

One builder, `clipboardMenuItems` (`src/renderer/src/components/ContextMenu/clipboardMenuItems.tsx`), makes every Cut, Copy, Paste and Delete item, so the labels, icons (lucide `scissors`, `copy`, `clipboard-paste`, `trash`) and hints cannot drift apart. Hints come from `formatShortcut`.

### Surface by action

Each cell: **keyboard** · **menu**. Hints are shown as macOS / Windows and Linux.

| Surface | Cut | Copy | Paste | Delete |
| --- | --- | --- | --- | --- |
| Terminal | – (output is read-only) | ⌘C / Ctrl+C with a selection · **Copy** ⌘C / Ctrl+C | ⌘V / Ctrl+V, Ctrl+Shift+V, Shift+Insert · **Paste** with the key that works there (part 1) | – (the shell owns the keys) |
| Editor (Monaco) | ⌘X / Ctrl+X · **Cut** ⌘X / Ctrl+X | ⌘C / Ctrl+C · **Copy** ⌘C / Ctrl+C | ⌘V / Ctrl+V · **Paste** ⌘V / Ctrl+V | ⌫ / Delete · **Delete** ⌫ / Delete (new) |
| Markdown preview | – (read-only) | ⌘C / Ctrl+C · **Copy selection** ⌘C / Ctrl+C; the menu now opens without a selection, items disabled | – (read-only) | – (read-only) |
| HTML preview | – (read-only) | ⌘C / Ctrl+C inside the page (Chromium's own) · **Copy selection** ⌘C / Ctrl+C, last in the comment menu; disabled without a selection (new) | – (read-only) | – (read-only) |
| Project tree – folder row | ⌘X / Ctrl+X · **Cut** ⌘X / Ctrl+X | ⌘C / Ctrl+C · **Copy** ⌘C / Ctrl+C | ⌘V / Ctrl+V · **Paste** ⌘V / Ctrl+V (clipboard not empty) | ⌘⌫ or Delete / Delete, after confirmation (new) · **Delete** ⌘⌫ / Delete |
| Project tree – file row | ⌘X / Ctrl+X on the focused file (new) · **Cut** | ⌘C / Ctrl+C on the focused file (new) · **Copy** | ⌘V / Ctrl+V into the file's folder (new) · **Paste** into the file's folder (new) | ⌘⌫ or Delete / Delete, after confirmation (new) · **Delete** ⌘⌫ / Delete |
| Project tree – project root row | – | – | – | – (menu items without hints) |
| Prompt, file-name and diagram-chat dialogs | ⌘X / Ctrl+X · **Cut** ⌘X / Ctrl+X | ⌘C / Ctrl+C · **Copy** ⌘C / Ctrl+C | ⌘V / Ctrl+V · **Paste** ⌘V / Ctrl+V | ⌫ / Delete · **Delete** ⌫ / Delete (new) |
| Every other text field (Settings, search bar, comment boxes) | ⌘X / Ctrl+X · **Cut** (new menu) | ⌘C / Ctrl+C · **Copy** (new menu) | ⌘V / Ctrl+V · **Paste** (new menu) | ⌫ / Delete · **Delete** (new menu) |

Rules the table follows:

- Cut, Copy and Delete on text need a selection; without one they are disabled, never hidden. Paste is always enabled on an editable field.
- A read-only field offers Copy only; a password field never offers Cut or Copy.
- Delete on text removes the selection and leaves the clipboard alone. Delete on a tree item asks the menu's own confirmation and is the danger item.
- The tree keys act on the focused row and fall back to the clicked folder. The Delete key never fires while typing in a text field, never on the project root, and never on an auto-repeat.
- The Markdown preview keeps the label **Copy selection**: it pairs with **Comment on selection** (spec 024, C-16). The HTML preview uses the same label, icon and hint.
- The HTML preview's **Copy selection** asks main over `preview:copySelection` (panel id only, sender-gated, the sender's own window), and main runs the page's own Copy (`webContents.copy()`): the words go from the page to the clipboard and never reach the app renderer. It is in every comment menu, after a separator – in and out of comment mode – and disabled when the right-click was not on selected words. Choosing it returns focus to the page.

## Open decisions

| Decision | Why it is open | Assumed for now |
| --- | --- | --- |
| Copy selection on the HTML preview's menus without a selection | Spec 024's menu matrix lists comment items only for the HTML preview (M-01 – M-10), and hides the Markdown preview's Copy selection on a block menu (M-11). #463 asks for disabled, never hidden | Shown, disabled; the matrix rows want the owner's update |
| Label "Copy" vs "Copy selection" in the Markdown preview | The issue asks for identical labels; spec 024 C-16 pairs "Copy selection" with "Comment on selection" | "Copy selection" kept |
| macOS Delete key in the tree | A Mac laptop has no Delete key (its "delete" is Backspace); Finder uses ⌘⌫ | Delete and ⌘⌫ both delete; the hint shows ⌘⌫, as the Menu card draws it |

## Documents

| File | Title |
| --- | --- |
| [`issue-203-clipboard-service.md`](issue-203-clipboard-service.md) | Design: Central text-clipboard service (issue #203) – v2 (post lens-review) |
