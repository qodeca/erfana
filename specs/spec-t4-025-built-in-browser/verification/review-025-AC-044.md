# Review record: 025-AC-044 (user guide)

Reviewed 2026-11-03 on branch `feature/built-in-browser` at `b95ca4fc`, plus the user-guide fix described under "Gap found and fixed". Requirement: 025-FR-044 – the user guide documents the browser and has a **Data handling** page. The acceptance text is in `specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md` (section "025-AC-044: User guide"); it also asks for statements that 025-FR-012, 025-FR-028 and 025-FR-061 send to the user guide.

Pages reviewed: `docs/user-guide/reference/built-in-browser.md` (the browser page) and `docs/user-guide/reference/browser-data-handling.md` (the Data handling page).

## Gap found and fixed

At `b95ca4fc` three statements the criterion requires were missing from the user guide: that the width presets set width only (025-FR-012), that pick mode keeps hover content open whether it starts by **Pick element** or by the shortcut (025-FR-025, 025-FR-028), and what the shell guard does not detect (025-FR-061). A search of `docs/user-guide/` for "hover", "width only", "busy", "permission question" and "device emulation" found none of them.

The fix adds them to the **Pick and send** section of `docs/user-guide/reference/built-in-browser.md` (lines 58 and 60) and adds claims `user-guide-reference-built-in-browser/46` to `/48` to `docs/user-guide/claims.json`, each tied to the code line below. `npm run -s check:claims` reports no drift after the change.

## What was checked

### Items the criterion lists

| Item | On the page | Evidence in code |
|---|---|---|
| A browser page exists | `built-in-browser.md`, linked to the Data handling page at line 8 | – |
| Data-flow table | `browser-data-handling.md:25-34`: context file, screenshot and crop, the capture before sending (in memory), cookies, local storage and cache, saved sign-ins, permission answers and certificate and pop-up exceptions, searches, logs; each with where it is stored, who receives it and how long it is kept | see "Factual claims" below |
| Agent transcripts and provider copies | `browser-data-handling.md:36` | – (outside Erfana) |
| Client-work checklist | `browser-data-handling.md:48-53`: AI sub-processors, a provider tier with a data-processing agreement, staging with test data | – |
| Risk: prompt injection, with an example agent deny rule | `browser-data-handling.md:40`, deny rule `"Read(./.erfana/browser/profile/**)"` under `permissions.deny` | same rule in the in-app notice, `src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:266` |
| Risk: client data goes as-is to the AI provider, including passwords and card numbers | `browser-data-handling.md:41` | – |
| Risk: full URLs in log files | `browser-data-handling.md:42` | `src/main/services/browser/page/loadFailureLog.ts:46`, `:50` |
| Risk: cookie-only encryption, and Windows | `browser-data-handling.md:43` | `scripts/fuses.js:710` (`EnableCookieEncryption`) |
| Risk: the whole profile in the project folder (credentials, permissions, certificate exceptions; agent, scripts, cloud sync, archives, Docker) | `browser-data-handling.md:44` | `src/main/services/browser/browserProfilePaths.ts:14` |
| Risk: `git clean -fdx` | `browser-data-handling.md:45` | `browserProfilePaths.ts:13` (the folder's `.gitignore` is `*`) |
| Risk: Google sign-in | `browser-data-handling.md:46`; also `built-in-browser.md:118` | – |
| Framed or linked local pages: no storage, no module scripts | `browser-data-handling.md:19`; `built-in-browser.md:115` | `src/main/services/browser/local/localResponsePolicy.ts:17-21`, `:65` (`sandbox` policy, opaque origin) |
| A folder's local storage lasts one run | `browser-data-handling.md:19`; `built-in-browser.md:116` | `src/main/services/browser/local/LocalFolderServer.ts:4-10` (a port the system picks and a new random token per server) |
| The presets set width only | `built-in-browser.md:60` (added) | `src/shared/browser/widthPresets.ts:7-8`, `:22` (a preset holds a width and nothing else); no touch, user-agent or device-metrics override is sent when a preset changes (search of `src/main` for `setDeviceMetricsOverride`, `setTouchEmulation`, `setEmitTouchEventsForMouse`: no match) |
| Pick mode keeps hover content open by click or shortcut | `built-in-browser.md:58` (added) | both routes call the one `start()` (`src/main/services/browser/pick/BrowserTabPick.ts:235-242`), which turns focus emulation on for every frame (`src/main/services/browser/pick/pickModeSwitch.ts:47`, `:71-73`) |
| What the shell guard does not detect | `built-in-browser.md:60` (added): only the program in front is checked; any non-shell counts as an agent, even a dev server; a busy agent or one waiting on a permission question is not noticed | `src/main/services/browser/capture/BrowserTargetStatus.ts:31-36`, `:63-69` (`return 'agent'` for every other name) |

### Factual claims on the Data handling page

| Claim | Evidence |
|---|---|
| The profile folder ignores itself in git | `src/main/services/browser/browserProfilePaths.ts:13` |
| Captures are deleted after 7 days, or by **Clear browsing data…** (**Captures**) | `src/shared/browser/captureFiles.ts:13`; `src/renderer/src/components/Panels/BrowserPanel/ClearDataDialog.tsx:31` |
| The capture before sending is held in memory until the pick ends | `src/main/services/browser/pick/BrowserTabPick.ts:111`, `:452-455` |
| Saved sign-ins are encrypted with the system keyring; without a keyring on Linux they last until Erfana closes | `src/main/services/browser/site/credentialStore.ts:12`, `:179-182` |
| Permission answers and certificate and pop-up exceptions are memory only without a keyring | `src/main/services/browser/permissions/permissionStore.ts:20`, `src/main/services/browser/site/certificateStore.ts:14`, `src/main/services/browser/popups/popupExceptionStore.ts:16` |
| Certificate exceptions last 7 days | `src/main/services/browser/site/certificateStore.ts:29` |
| Searches go to DuckDuckGo | `src/shared/browser/addressInput.ts:13` |
| Logs are in `~/.erfana/logs/` and kept seven days | `src/shared/constants.ts:38`; `src/main/services/LoggingService.ts:46`, `:517-522` |
| Page text is marked as data | `src/shared/browser/contextFile.ts:294` |
| Page titles, form data and console text are never logged | proven against the log files by `e2e/browser-logging.e2e.ts:88-95` |
| **Forget this project's browser data…** in **More** | `src/renderer/src/components/Panels/BrowserPanel/browserDataActions.ts:18`; claim `user-guide-reference-built-in-browser/14` |

## Result

With the fix, every item the criterion and 025-FR-044 list is on the browser page or the Data handling page, and each factual claim checked matches the code.

## Limits of this review

- `browser-data-handling.md:43` says "Only cookies are encrypted on disk … Local storage, cache and the rest are plain files", while line 31 of the same page says saved sign-ins are encrypted with the keyring, which the code does (`credentialStore.ts:12`). The sentence follows the wording of 025-FR-044 ("only cookies are encrypted on disk") and refers to the browser engine's storage, but read literally it contradicts the table. Left for the owner, because it would change spec-mandated words.
- Claims about third parties (agent transcripts, provider retention, DuckDuckGo's terms, Windows DPAPI scope, Google's embedded-browser policy) are outside Erfana's code and were not verified here.
- Vale (`npm run lint:docs:prose`) is not installed on this machine, so the prose lint was not run on the changed page. `markdownlint-cli2` passed on it (0 issues).
