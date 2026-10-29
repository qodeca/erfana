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
- [What runs when you open a folder](#what-runs-when-you-open-a-folder)
- [New versions](#new-versions)

## Autosave

**What it does:** Markdown edits are saved two seconds after typing stops and at least every 30 seconds during continued editing. Each save normally writes a temporary file first and swaps it in only when it is complete, so a crash or power cut during a save does not leave a half-written file. Symlinked files and some network drives are written in place instead. Autosave waits while a tab shows the file-changed-on-disk notice, and a save that failed is tried again on your next edit. **How to reach it:** Edit a Markdown file; autosave runs automatically. There is no autosave setting. Closing a tab with unsaved changes asks before it closes. The disk-change notice offers **Reload from Disk** or **Keep My Version**. See [editing](../how-to/edit-and-preview-markdown.md).

## Global settings

**What it does:** App-wide preferences persist between launches. **How to reach it:** Use the gear in the left activity bar; values are stored under `~/.erfana/settings.json`. The OpenAI API key is stored separately and always encrypted by the system's secure storage; the settings JSON records only whether a key is stored. If the settings file cannot be read at start-up, Erfana opens with default settings, says so, and keeps a copy of the old file before it ever replaces it.

## Project settings and lock

**What it does:** `.erfana/settings.json` in a project holds that project's watcher ignores, hidden tree patterns, [excluded folders](settings.md#excluded-folders), and approved HTML remote hosts. Erfana also uses a project lock, so opening a project that another Erfana window already has open focuses that window. **How to reach it:** The settings file is inside the project; the lock file is kept in Erfana's app data folder, not in the project, and is handled automatically. See [settings](settings.md#per-project-settings).

## Logs

**What it does:** Erfana writes logs under `~/.erfana/logs/` and keeps them for seven days, with at most five older files per log. Start-up problems and crashes are also written to `crash.log` in the same folder, with file paths and user names removed. Logs record terminal output only by its size, not its text. **How to reach it:** **Settings > Logging > Open** opens the logs folder. The log level defaults to **Info**.

**Log files:** `combined.log` holds every entry. `main.log` holds only the app's main process and `renderer.log` only the window. Older files are renamed `main.1.log`, `main.2.log` and so on, newest first.

**Line format:** Each entry is one line:

```text
[2026-10-29 14:03:12.481] [a1b2c3d4] [info] Instance started {"instanceId":"a1b2c3d4", …}
```

- The first bracket is the date and time, to the millisecond.
- The second is an 8-character id that is new each time Erfana starts, so you can tell two running copies apart.
- The third is the level: `error`, `warn`, `info`, `debug` or `verbose` (**Trace** entries are written as `verbose` and **Fatal** entries as `error`).
- The rest is the message, followed by any extra details as JSON. Errors add `| Error: …` and `| Stack: …`. Entries from the window start with `[RENDERER]`.

Line breaks inside a message are written as `\n`, so one entry never spans two lines. To list only errors, run `grep '\[error\]' ~/.erfana/logs/combined.log`.

Related issues: [#36](https://github.com/qodeca/erfana/issues/36).

## What runs when you open a folder

**What it does:** Erfana has no trust prompt or restricted mode. Every folder you open gets the same features. These are the outside programs Erfana runs by itself:

- **Git status.** In a git repository, Erfana runs `git status` to show changed files in the project tree. It runs again when files change. If no `git` program is installed, Erfana reads the repository with a built-in library instead.
- **Git change check.** As a fallback, Erfana checks the size and time of `.git/index` every five seconds and refreshes git status when they change.
- **Git ignore check.** Opening an `.html` or `.htm` file runs `git check-ignore`. A file git ignores opens as source, not as a running preview.
- **LibreOffice.** Erfana looks for LibreOffice to know whether Office documents can be imported. On macOS and Linux it runs LibreOffice with `--version` to confirm it works. It converts a file only when you import an Office document.

Each `git` run starts from a temporary folder outside the project, with a short list of environment variables. It switches off the repository's hooks, `core.fsmonitor` and include settings, to stop a cloned repository making git run its own commands. Erfana never runs a LibreOffice program found inside the open project or a temp folder.

**How to reach it:** These run automatically. **Settings > Git status > Enable polling fallback** turns off the five-second check; git status itself still runs.

Related issues: [#256](https://github.com/qodeca/erfana/issues/256).

## New versions

**What it does:** Erfana does not update itself automatically. **How to reach it:** Get new releases from [GitHub Releases](https://github.com/qodeca/erfana/releases) and install them using the release instructions.
