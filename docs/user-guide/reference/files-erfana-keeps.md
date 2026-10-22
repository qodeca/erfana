<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Find files Erfana keeps

Project documents stay in the folder you open. Erfana also keeps app settings and short-lived logs outside that folder; per-project settings live inside it.

**On this page**

- [Autosave](#autosave)
- [Global settings](#global-settings)
- [Project settings and lock](#project-settings-and-lock)
- [Logs](#logs)
- [New versions](#new-versions)
- [Install on Windows](#install-on-windows)

## Autosave

**What it does:** Markdown edits are saved two seconds after typing stops and at least every 30 seconds during continued editing. **How to reach it:** Edit a Markdown file; autosave runs automatically. There is no autosave setting. A close prompt protects an unsaved buffer, and a disk-change notice lets you choose the version to keep. See [editing](../how-to/edit-and-preview-markdown.md).

## Global settings

**What it does:** App-wide preferences persist between launches. **How to reach it:** Use the gear in the left activity bar; values are stored under `~/.erfana/settings.json`. The OpenAI API key is stored separately by the app's secure storage path; the settings JSON records only whether a key is stored.

## Project settings and lock

**What it does:** `.erfana/settings.json` in a project holds that project's watcher ignores, hidden tree patterns, and approved HTML remote hosts. Erfana also uses a project lock so opening a project already in another window focuses that window. **How to reach it:** The settings file is inside the project; the lock is handled automatically when you open a project. See [settings](settings.md#per-project-settings).

## Logs

**What it does:** Erfana writes logs under `~/.erfana/logs/` and keeps them for seven days. **How to reach it:** **Settings > Logging > Open** reveals the resolved folder. The log level defaults to **Info**.

## New versions

**What it does:** Erfana does not update itself automatically. **How to reach it:** Get new releases from [GitHub Releases](https://github.com/qodeca/erfana/releases) and install them using the release instructions.

## Install on Windows

**What it does:** Since v0.22.0 the Windows installer installs Erfana for all users of the PC, in `C:\Program Files\Erfana`, so it asks for administrator rights once (the Windows **User Account Control** prompt). Only an administrator can change files in that folder, which protects the app's own files. **How to reach it:** Run the setup `.exe` and select **Yes** in the prompt; uninstall from **Settings > Apps > Installed apps**, which asks again. **Upgrading from v0.21 or earlier:** the old copy in your user folder is removed and its shortcuts are replaced by new ones; your settings, projects, logs and `~/.erfana` stay. A taskbar pin to the old copy may stop working – pin Erfana again. Other Windows accounts on the same PC keep their old copy until they run the new installer.
