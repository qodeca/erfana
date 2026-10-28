<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Use Erfana on Windows

The guide shows macOS first. Windows has the same project and document workflow with different modifier keys, native file-manager wording, capture pickers and local transcription availability.

**On this page**

- [Keyboard and menus](#keyboard-and-menus)
- [Paths and file manager](#paths-and-file-manager)
- [Screen capture](#screen-capture)
- [Local transcription](#local-transcription)
- [Terminal and import](#terminal-and-import)

## Keyboard and menus

**What it does:** Use <kbd>Ctrl</kbd> where a shortcut says <kbd>Cmd</kbd>; HTML preview Back and Forward use <kbd>Alt</kbd>+<kbd>←/→</kbd>. **How to reach it:** See the [shortcut table](keyboard-shortcuts.md). **File > Exit** replaces the macOS app-menu Quit; **Window > Close**, <kbd>Alt</kbd>+<kbd>F4</kbd>, and <kbd>F11</kbd> are Windows window controls. The Windows tooltip-glyph correction was completed in [#143](https://github.com/qodeca/erfana/issues/143).

The Erfana taskbar jump list also has **New Window**, which opens a separate instance.

## Paths and file manager

**What it does:** Project paths use Windows separators and **Reveal in Explorer** opens the selected item. **How to reach it:** Right-click a tree item or select **Open** beside **Logs folder** in Settings. Copy a file path from the terminal link picker when a printed name matches multiple files.

## Screen capture

**What it does:** Windows capture offers a window picker, display picker and area overlay. **How to reach it:** Use the terminal header's capture controls. Choose the target in the picker; the resulting image path is inserted in the terminal. The macOS Screen Recording permission dialog does not apply.

## Local transcription

**What it does:** **Local (whisper.cpp)** runs offline on Windows x64, but is unavailable on Windows ARM64. **How to reach it:** **Settings > Transcription > Backend**. OpenAI remains an option when configured with a key; it sends audio to the API. See [transcription settings](settings.md#transcription).

## Terminal and import

**What it does:** A few terminal and import details differ on Windows. **How to reach it:** The terminal panel and **Settings > Import tools**.

- **Restart terminal** asks first while Claude Code runs or the terminal is still producing output, but Windows does not tell Erfana which program is running, so a silent program is ended without a question.
- Open a row or terminal menu with <kbd>Shift</kbd>+<kbd>F10</kbd> or the <kbd>Menu</kbd> key.
- When LibreOffice is missing, [Import tools](settings.md#import-tools) offers a **Download LibreOffice** button; install it in its default folder, then choose **Check again**. Erfana finds it by its install location and does not start it to check.
