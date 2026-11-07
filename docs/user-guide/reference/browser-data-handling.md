<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Browser data handling

This page says what the [built-in browser](built-in-browser.md) stores, who receives it and how long it is kept. Read it before you use browser tabs for client work. Erfana has no built-in AI: a capture goes to the CLI agent you run in the terminal, and that agent sends it on to its AI provider.

**On this page**

- [Local files](#local-files)
- [Where data goes](#where-data-goes)
- [Risks](#risks)
- [Checklist for client work](#checklist-for-client-work)

## Local files

A `file://` page you open from the address bar or with **Open in browser tab** gets its folder's storage, such as local storage and IndexedDB, for this run of Erfana only; the storage is gone after a restart. A local page shown in a frame, or reached by a link from a local page, has no storage and runs no module scripts. A local app that needs them should run on a dev server, opened at its `http://localhost` address.

## Where data goes

The browser keeps each project's data in two places:

- **In the project, in `.erfana/browser/`:** Erfana's own files for the project – saved sign-ins, permission answers, exceptions, zoom levels and history – and the captures. That folder ignores itself in git.
- **In Erfana's own data folder, in `browser-profiles/`:** the browser engine's data – cookies, local storage and cache. Erfana's data folder is `~/Library/Application Support/erfana` on macOS, `%APPDATA%\erfana` on Windows and `~/.config/erfana` on Linux. Each project has its own folder there, named after the project's path the way Claude Code names its `~/.claude/projects/` folders – for example `-Users-you-Projects-shop` for `/Users/you/Projects/shop`. A `project.json` file in it names the project it belongs to.

The engine's data cannot live in the project: on macOS the browser engine is only allowed to write its cookie file inside Erfana's own data folder.

| Data | Where it is stored | Who receives it | How long it is kept |
| --- | --- | --- | --- |
| Context file (the element's markup, text, path and page facts) | `.erfana/browser/captures/` | The agent you send to, and its AI provider | Deleted after 7 days, or by **Clear browsing data…** (**Captures**) |
| Screenshot and crop | `.erfana/browser/captures/` | The agent you send to, and its AI provider | Deleted after 7 days, or by **Clear browsing data…** (**Captures**) |
| The capture before you send | Memory only | Nobody until you send | Until the pick ends |
| Cookies, local storage and cache | Erfana's data folder, `browser-profiles/<project>/chromium/` | The sites you visit | Until you clear or forget them |
| Saved sign-ins | `.erfana/browser/profile/`, encrypted with your system's keyring | The site they belong to | Until you clear or forget them; on Linux without a keyring, until Erfana closes |
| Permission answers, certificate and pop-up exceptions | `.erfana/browser/profile/` | Nobody | Until you clear or forget them (certificate exceptions: 7 days); on Linux without a keyring, until Erfana closes |
| Searches typed in the address bar | Not stored by Erfana | DuckDuckGo | DuckDuckGo's own terms |
| Logs | `~/.erfana/logs/` | Nobody, unless you send them for support | Seven days |

Your agent keeps its own transcripts of what you send, and its AI provider keeps copies under its own retention rules. Clearing Erfana's captures does not delete those.

## Risks

- **Page content can carry hidden instructions.** Text, markup and pictures from a page reach your agent. A page can hide text that tries to steer the agent (prompt injection). Erfana marks page text as data, but this is most dangerous when the agent runs without permission checks. Keep the agent's checks on, and deny it the browser profile – for Claude Code, add `"Read(./.erfana/browser/profile/**)"` to `permissions.deny` in the project's `.claude/settings.json`.
- **Captures send what the page shows, as it is.** Form values typed on the page, including passwords and card numbers, go to the agent's AI provider with the capture.
- **Logs record full browser URLs.** When a web page fails to load, Erfana's log file records its address with the query string, for support. A local file that fails to load is logged by its file name only; the folders above it are hidden. A failed search is logged without its text. Page titles, form data and console text are never logged.
- **Only cookies and saved sign-ins are encrypted on disk.** Local storage, cache and the rest are plain files. On Windows any program running as you can read the cookies too.
- **The project folder holds Erfana's own browser files.** Saved sign-ins, permissions and certificate exceptions are in `.erfana/browser/`, so your agent, project scripts, cloud sync, archives and Docker build contexts can read or copy them. Cookies, local storage and cache are in Erfana's data folder instead – out of the project, but any program running as you can still read them.
- **`git clean -fdx` deletes Erfana's own browser files and the captures**, because git ignores the folder: permission answers, exceptions, saved sign-ins, zoom levels and history are gone. Site sign-ins (cookies) stay, because they are in Erfana's data folder.
- **Moving or renaming a project starts its browser fresh.** The browser data belongs to the project's path. The old data stays in Erfana's data folder until you delete that project's folder there.
- **Google sign-in may not work** in a browser tab.

## Checklist for client work

- Confirm that the client allows AI sub-processors – your agent's provider sees what you send.
- Prefer a provider tier that comes with a data-processing agreement.
- Use a staging site with test data where you can.
- When the work ends, use **Forget this project's browser data…** in **More**.
