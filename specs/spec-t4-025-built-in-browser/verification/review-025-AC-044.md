# Review record: 025-AC-044 (user guide)

Reviewed 2026-11-03 on branch `feature/built-in-browser` at `5643b433`, with one uncommitted change in the working tree – the deny-rule notice text at `src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:266` – plus the user-guide fix described under "Gap found and fixed". This record replaces the one made at `b95ca4fc`, before `5643b433` moved each project's Chromium profile to Erfana's data folder (ADR 0009 decision 1 as amended, spec change S-36).

Requirement: 025-FR-044 – the user guide documents the browser and has a **Data handling** page (`specs/spec-t4-025-built-in-browser/requirements/02-requirements.md`, section "025-FR-044"). The acceptance text is in `specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md`, section "025-AC-044: User guide"; it also asks for statements that 025-FR-012, 025-FR-028 and 025-FR-061 send to the user guide.

Pages reviewed: `docs/user-guide/reference/built-in-browser.md` (the browser page) and `docs/user-guide/reference/browser-data-handling.md` (the Data handling page).

## Gap found and fixed

`browser-data-handling.md:26` named Erfana's data folder `~/Library/Application Support/Erfana`, `%APPDATA%\Erfana` and `~/.config/Erfana`. The browser profiles live under `app.getPath('sessionData')` (`src/main/services/browser/browserAppSetup.ts:251`), which Erfana never sets, so it is Electron's default, the user-data folder, named after the app name. `package.json` has no `productName` and `"name": "erfana"` (`package.json:2`), and the packaged 0.23.1 build's `app.asar` package.json has no `productName` either, so the folder is `erfana`. On this Mac it exists as `~/Library/Application Support/erfana`. macOS and Windows match names case-insensitively, but on Linux `~/.config/Erfana` is a different, absent folder.

The fix writes `erfana` for all three systems and adds claim `user-guide-reference-browser-data-handling/08` (status `fixed`, source `package.json:2`) to `docs/user-guide/claims.json`. `npm run -s check:claims` reports no drift after the change.

## What was checked

### Items the criterion lists

| Item | On the page | Evidence in code |
|---|---|---|
| A browser page exists | `built-in-browser.md`, linked to the Data handling page at line 8 | – |
| Data-flow table | `browser-data-handling.md:30-39`: context file, screenshot and crop, the capture before sending (memory only), cookies, local storage and cache, saved sign-ins, permission answers and certificate and pop-up exceptions, searches, logs; each with where it is stored, who receives it and how long it is kept | see "Factual claims" below |
| Which data is in the project folder and which in Erfana's data folder (S-36) | `browser-data-handling.md:23-28` (two-place list and why the engine's data cannot live in the project); table column "Where it is stored", lines 32-37 | `src/main/services/browser/browserProfileFolders.ts:7-19`, `:111`; `BrowserProfileService.ts:319` (`session.fromPath(folder.chromiumDir)`); `src/main/services/browser/site/signedProfileFile.ts:43-45` (Erfana's files under `.erfana/browser/profile/Erfana/`) |
| Agent transcripts and provider copies | `browser-data-handling.md:41` | – (outside Erfana) |
| Client-work checklist | `browser-data-handling.md:54-59`: AI sub-processors, a provider tier with a data-processing agreement, staging with test data | – |
| Risk: prompt injection, with an example agent deny rule | `browser-data-handling.md:45`, deny rule `"Read(./.erfana/browser/profile/**)"` under `permissions.deny` | the same rule in the in-app notice, `src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:266` (working-tree text: "Erfana's browser files in the project hold its saved sign-ins, site permissions and certificate exceptions"), which matches what the project folder still holds |
| Risk: client data goes as-is to the AI provider, including passwords and card numbers | `browser-data-handling.md:46` | – |
| Risk: full URLs in log files | `browser-data-handling.md:47` | `src/main/services/browser/page/loadFailureLog.ts:50` (URL logged), `:46` (search logged without text) |
| Risk: cookie-only encryption, and Windows | `browser-data-handling.md:48` | `scripts/fuses.js:710` (`EnableCookieEncryption`); saved sign-ins are encrypted separately, `src/main/services/browser/site/credentialStore.ts:10-12` |
| Risk: Erfana's own files in the project folder (sign-ins, permissions, certificate exceptions; agent, scripts, cloud sync, archives, Docker), and cookies, storage and cache in Erfana's data folder, still readable by any program running as the user | `browser-data-handling.md:49` | `site/credentialStore.ts:33`, `permissions/permissionStore.ts:39`, `site/certificateStore.ts:27`, `popups/popupExceptionStore.ts:27` (all `profileErfanaSegments`); `browserProfileFolders.ts:13-15` |
| Risk: `git clean -fdx` deletes Erfana's own files and the captures but keeps the sign-ins | `browser-data-handling.md:50` | `src/main/services/browser/browserProfilePaths.ts:13` (the folder's `.gitignore` is `*`); cookies are outside the project, `browserProfileFolders.ts:13-15` |
| Risk: Google sign-in | `browser-data-handling.md:52`; also `built-in-browser.md:118` | – |
| Framed or linked local pages: no storage, no module scripts | `browser-data-handling.md:19`; `built-in-browser.md:115` | `src/main/services/browser/local/localResponsePolicy.ts:17-21`, `:61-65` (`sandbox` policy without `allow-same-origin`, opaque origin) |
| A folder's local storage lasts one run | `browser-data-handling.md:19`; `built-in-browser.md:116` | `src/main/services/browser/local/LocalFolderServer.ts:4-10` (a port the system picks and a new random token per server) |
| The presets set width only | `built-in-browser.md:60` | `src/shared/browser/widthPresets.ts:22` (a preset holds a width and nothing else); a search of `src/main` for `setDeviceMetricsOverride`, `setTouchEmulation` and `setEmitTouchEventsForMouse` found no match |
| Pick mode keeps hover content open by click or shortcut | `built-in-browser.md:58` | both routes reach the one `start()` (`src/main/services/browser/pick/BrowserTabPick.ts:169-171`, `:235`), which turns focus emulation on for every frame (`src/main/services/browser/pick/pickModeSwitch.ts:47`, `:71-72`) |
| What the shell guard does not detect | `built-in-browser.md:60`: only the program in front is checked; any non-shell counts as an agent, even a dev server; a busy agent or one waiting on a permission question is not noticed | `src/main/services/browser/capture/BrowserTargetStatus.ts:31`, `:66-68` (`return 'agent'` for every name not in `SHELL_NAMES`) |

### Factual claims on the Data handling page

| Claim | Evidence |
|---|---|
| Erfana's data folder is `erfana` under the system's application-data folder (after the fix) | `browserAppSetup.ts:251` (`app.getPath('sessionData')`); `package.json:2`; claim `/08` |
| Each project's folder is named after its path, Claude Code style, with a `project.json` naming the project | `browserProfileFolders.ts:96` (claim `/07`), `:156-157` |
| The engine's data cannot live in the project on macOS | `browserProfileFolders.ts:7-11` (ADR 0009 decision 1 as amended) |
| Cookies, local storage and cache are in `browser-profiles/<project>/chromium/` | `browserProfileFolders.ts:54-56`, `:111` (claim `/03`) |
| The project's `.erfana/browser/` folder ignores itself in git | `browserProfilePaths.ts:13` (claim `/01`) |
| Saved sign-ins, permissions, exceptions, zoom levels and history are Erfana's own files in the project | `site/signedProfileFile.ts:43-45`; `page/zoomStore.ts:27`; `page/historyStore.ts:30`; the four stores above |
| Captures are deleted after 7 days, or by **Clear browsing data…** (**Captures**) | `src/shared/browser/captureFiles.ts:13` (claim `/02`); `src/renderer/src/components/Panels/BrowserPanel/ClearDataDialog.tsx:31` |
| The capture before sending is held in memory until the pick ends | `pick/BrowserTabPick.ts:111`, `:227`, `:454` |
| Saved sign-ins are encrypted with the system keyring; without a keyring on Linux they last until Erfana closes | `site/credentialStore.ts:10-19` |
| Permission answers and certificate and pop-up exceptions are memory only without a keyring | `permissions/permissionStore.ts:86`, `site/certificateStore.ts:76`, `popups/popupExceptionStore.ts:64` (`signer.hasKey() ? 'saved' : 'session'`) |
| Certificate exceptions last 7 days | `site/certificateStore.ts:29` |
| Searches go to DuckDuckGo | `src/shared/browser/addressInput.ts:13` (claim `/04`) |
| Logs are in `~/.erfana/logs/` and kept seven days | `src/shared/constants.ts:38`; `src/main/services/LoggingService.ts:46`, `:462` |
| Page text is marked as data | `src/shared/browser/contextFile.ts:244`, `:285` (the untrusted block) |
| Page titles, form data and console text are never logged | proven against the log files by `e2e/browser-logging.e2e.ts:88-95` |
| Moving or renaming a project starts its browser fresh | the marker names the canonical path (`src/main/services/browser/browserProfileMarker.ts:10-17`); a mismatch sets both halves aside (`BrowserProfileService.ts:337-346`); the data-folder name comes from the path (`browserProfileFolders.ts:96`) |
| **Forget this project's browser data…** in **More** removes both halves | `src/renderer/src/components/Panels/BrowserPanel/browserDataActions.ts:18`; `BrowserProfileService.ts:232-237` (project half and data-folder half) |

## Result

With the fix, every item the criterion and 025-FR-044 list is on the browser page or the Data handling page, and each factual claim checked matches the code at `5643b433` plus the working-tree notice text.

## Limits of this review

- `browser-data-handling.md:48` reads "Only cookies and saved sign-ins are encrypted on disk", where 025-FR-044 says "only cookies are encrypted on disk". The page's wording is the accurate one – saved sign-ins are encrypted by Erfana itself (`credentialStore.ts:10-12`), and of the browser engine's storage only cookies are – so the criterion's "cookie-only encryption" item is judged met. The spec's wording was not changed.
- The data-folder name was confirmed for macOS on this machine and from the packaged 0.23.1 `app.asar`; Windows and Linux follow from Electron's default naming and were not checked on those systems.
- Claims about third parties (agent transcripts, provider retention, DuckDuckGo's terms, Windows DPAPI scope, Google's embedded-browser policy) are outside Erfana's code and were not verified here.
