<!-- SPDX-License-Identifier: GPL-3.0-only -->
# Use Erfana on Windows

The guide shows macOS first. Windows has the same project and document workflow with different modifier keys, native file-manager wording, capture pickers and local transcription availability.

## Keyboard and menus

**What it does:** Use <kbd>Ctrl</kbd> where a shortcut says <kbd>Cmd</kbd>; HTML preview Back and Forward use <kbd>Alt</kbd>+<kbd>←/→</kbd>. **How to reach it:** See the [shortcut table](keyboard-shortcuts.md). **File > Quit** replaces the macOS app-menu Quit; **Window > Close**, <kbd>Alt</kbd>+<kbd>F4</kbd>, and <kbd>F11</kbd> are Windows window controls. Some existing tooltip glyphs may still show the macOS symbol; see [#143](https://github.com/qodeca/erfana/issues/143).

## Paths and file manager

**What it does:** Project paths use Windows separators and **Reveal in File Explorer** opens the selected item. **How to reach it:** Right-click a tree item or select **Open** beside **Logs folder** in Settings. Copy a file path from the terminal link picker when a printed name matches multiple files.

## Screen capture

**What it does:** Windows capture offers a window picker, display picker and area overlay. **How to reach it:** Use the terminal header's capture controls. Choose the target in the picker; the resulting image path is inserted in the terminal. The macOS Screen Recording permission dialog does not apply.

## Local transcription

**What it does:** Local whisper.cpp runs offline on Windows x64, but is unavailable on Windows ARM64. **How to reach it:** **Settings > Transcription > Backend**. OpenAI remains an option when configured with a key; it sends audio to the API. See [transcription settings](settings.md#transcription).
