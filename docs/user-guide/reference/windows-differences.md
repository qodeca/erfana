<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Use Erfana on Windows

The guide shows macOS first. Windows has the same project and document workflow with different modifier keys, native file-manager wording, capture pickers and local transcription availability.

**On this page**

- [Install and uninstall](#install-and-uninstall)
- [Keyboard and menus](#keyboard-and-menus)
- [Paths and file manager](#paths-and-file-manager)
- [Screen capture](#screen-capture)
- [Local transcription](#local-transcription)
- [Terminal and import](#terminal-and-import)

## Install and uninstall

**What it does:** The Windows download is a setup program named `erfana-<version>-setup.exe`. It installs Erfana for your Windows account only, not for every account on the PC. Setup always adds an **Erfana** shortcut to the desktop. **How to reach it:** Download the setup program from the [Releases](https://github.com/qodeca/erfana/releases/latest) page and run it. To update, run the setup program of the newer version. To uninstall, remove **Erfana** from the list of installed apps in Windows settings.

Related issues: [#387](https://github.com/qodeca/erfana/issues/387).

## Keyboard and menus

**What it does:** Every shortcut is written macOS first, then Windows: <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>. On Windows, <kbd>Ctrl</kbd> takes the place of <kbd>⌘</kbd>, <kbd>Alt</kbd> of <kbd>⌥</kbd> and <kbd>Shift</kbd> of <kbd>⇧</kbd>; HTML preview Back and Forward use <kbd>Alt+←</kbd> and <kbd>Alt+→</kbd>. **How to reach it:** See the [shortcut table](keyboard-shortcuts.md). **File > Exit** replaces the macOS app-menu Quit, and **Window > Close** closes the window.

The Erfana taskbar jump list also has **New Window**, which opens a separate instance.

## Paths and file manager

**What it does:** **Reveal in Explorer** opens the selected item in File Explorer. **How to reach it:** Right-click a tree item, or select **Open** beside **Logs folder** in Settings. When a file name printed in the terminal matches several files, a picker opens; press <kbd>Ctrl+C</kbd> there to copy the selected path.

## Screen capture

**What it does:** Windows capture offers an in-app window picker, a display picker when more than one display is connected, and an area overlay. **How to reach it:** Use the terminal header's capture controls. Choose the target in the picker; the resulting image path is inserted in the terminal. The macOS Screen Recording permission dialog does not apply.

## Local transcription

**What it does:** **Local (whisper.cpp)** runs offline on Windows x64. On Windows ARM64 the option is greyed out and reads **Local (macOS / Windows x64 only – ARM64 not supported)**. **How to reach it:** **Settings > Transcription > Backend**. OpenAI remains an option when configured with a key; it sends audio to the API. See [transcription settings](settings.md#transcription).

The local engine for Windows ships without the Microsoft Visual C++ runtime: its package holds only `whisper.exe` and the DLLs that whisper.cpp builds. If local transcription fails and the transcription dialog shows an error that starts with **Whisper process exited with code**, a missing Visual C++ 2015–2022 Redistributable (x64) is one cause reported in #398. Install the x64 redistributable from Microsoft's [Visual C++ downloads](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) page and transcribe again, or switch the backend to **OpenAI**.

Related issues: [#398](https://github.com/qodeca/erfana/issues/398).

## Terminal and import

**What it does:** A few terminal and import details differ on Windows. **How to reach it:** The terminal panel and **Settings > Import tools**.

- **Restart terminal** asks first while Claude Code runs or the terminal is still producing output, but Windows does not tell Erfana which program is running, so a silent program is ended without a question.
- Open the context menu of a tree row, a tab or the terminal with <kbd>Shift+F10</kbd> or the <kbd>Menu</kbd> key.
- When LibreOffice is missing, [Import tools](settings.md#import-tools) offers a **Download LibreOffice** button; install it in its default folder, then choose **Check again**. Erfana finds it by its install location and does not start it to check.
