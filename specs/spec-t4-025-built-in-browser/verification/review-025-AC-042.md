# Review record: 025-AC-042 (logging exception)

Reviewed 2026-11-03 on branch `feature/built-in-browser` at `b95ca4fc`. Requirement: 025-FR-042 – Erfana's log files record full browser URLs for load failures, as a deliberate exception to the `redactUserInput` convention, recorded in `docs/technical-debt.md` and at each logging site. The acceptance text is in `specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md` (section "025-AC-042: Logging exception"). The exception was added in commit `b25c655f`.

The criterion has three parts: a failed page load writes the full URL with its query string to the log file; the exception is recorded in `docs/technical-debt.md`; each site that logs a browser URL carries a comment pointing to it.

## What was checked

| Check | Result | Evidence |
|---|---|---|
| The exception is recorded in `docs/technical-debt.md` | Entry 68, "Browser URLs are logged in full, an exception to `redactUserInput`", names the reason (support), the risk (query strings can hold tokens or personal data), the limits of 025-FR-064 that stay in force, every site where it applies and its status | `docs/technical-debt.md:1131-1141` |
| A failed page load writes the URL with path and query | `logLoadFailure` logs the event, the error code and `failedRequestUrl(url)` | `src/main/services/browser/page/loadFailureLog.ts:44-51` |
| What `failedRequestUrl` keeps | Path and query are kept; userinfo and the fragment are dropped; the text is cut to 2,048 code units; a `data:` URL is cut to its media type | `src/main/services/browser/cdp/browserLogBuffer.ts:24`, `:68-85` |
| The log call is reached on a failed main-frame load | `did-fail-load` for the main frame calls `loadFailed`, which calls `logLoadFailure` | `src/main/services/browser/page/BrowserTabPage.ts:148-150`, `:279-285` |
| A failed search-fallback load logs no URL (025-FR-042 and 025-FR-064) | A DuckDuckGo host, or a subdomain of it, logs "search load failed" with the code only | `loadFailureLog.ts:28-35`, `:45-47` |
| Each URL-logging site carries the comment | The module comment, the log line and the one caller each point to entry 68 | `loadFailureLog.ts:7`, `loadFailureLog.ts:49`, `BrowserTabPage.ts:284` |
| No other site logs a browser URL | Every `logger.*` call in `src/main/services/browser/**`, `src/main/ipc/browser*`, `src/main/ipc/browserTab/**`, `src/renderer/src/components/Panels/BrowserPanel/**` and `src/renderer/src/services/browser/**` was read. None logs a URL field. Sites that handle a URL log something else: refused navigations log the source or frame kind and the reason (`src/main/services/browser/BrowserTab.ts:185-186`, `:398`, `:402`; `src/main/services/browser/popups/BrowserPopupWindow.ts:263`); a load rejected without a commit logs the errno only (`BrowserTab.ts:375`); the request filters log the resource type only (`src/main/services/browser/browserAppRequestFilter.ts:80`, `src/main/services/browser/site/siteRequestHooks.ts:54`); permission refusals log by name only (`src/main/services/browser/browserSessionPolicy.ts:178-180`); a terminal link logs no URL (`src/renderer/src/components/Panels/TerminalPanel/terminalLinks.ts:72-74`) | review search, 2026-11-03 |
| A unit test pins the fields | Full URL with path and query, userinfo and fragment absent; a search load logs no URL and no search text; an unparseable address is cut | `src/main/services/browser/page/loadFailureLog.test.ts:27-46`; `npx vitest run src/main/services/browser/page/loadFailureLog.test.ts` – 10 passed, 2026-11-03 |
| An end-to-end test proves it against the real log file | A load of `http://user:pw…@nowhere.example/path/to?token=QUERY…#FRAG…` writes "A browser tab page failed to load" with `http://nowhere.example/path/to?token=QUERY…` to `main.log`; no log file holds the fragment or the password; a typed search logs "search load failed" and not its text | `e2e/browser-logging.e2e.ts:79-95`; `npx playwright test --project=electron e2e/browser-logging.e2e.ts` – 1 passed, 2026-11-03, against the build in `out/` made after `b95ca4fc` |

## Result

All three parts are met. A failed page load writes its full URL, query string included, to the log file; the exception is recorded as technical-debt entry 68; and the only site that logs a browser URL carries the comment at the module, the log line and the caller.

## Limits of this review

- Userinfo (`user:password@`) and the fragment are dropped before logging. The criterion asks for "the full URL, including its query string"; 025-FR-042 says "path and query included". The review reads dropping credentials and the fragment as within the requirement, and entry 68 records it.
- A local file's failed load logs its served address (`http://127.0.0.1:<port>/<token>/<path below the folder>`). Entry 68 records this (`docs/technical-debt.md:1139`); the opened folder's own path is not in it.
- The search covered `logger.*` calls whose fields could hold a URL. Error messages passed through `redactedLogError` or `error.message` were not traced into Electron or the operating system; for example, the text of a `shell.openExternal` failure (`src/main/ipc/browser-tab-handlers.ts:207`) is the platform's. That text is not known to hold the URL, but this review did not prove it on every platform (inferred).
- The end-to-end run used the existing `out/` build; it was not rebuilt for this review.
