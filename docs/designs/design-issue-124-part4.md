<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Design – issue #124, part 4: open in default browser

Parent: [design-issue-124.md](design-issue-124.md). Covers P4-AC1 to P4-AC5 and UX spec §1.4, §2 and §7. Work items WI-21, WI-22 and WI-26.

## 4.1 The channel

- **Its own domain**, `browser:openFile` (invoke), in `src/shared/ipc/browser-channels.ts`. Not `shell:openExternal`: Markdown links feed arbitrary addresses into it (`MarkdownPreview.tsx:450`) and its allow-list must stay web-only. Not `preview:`: the tree also uses it, including when HTML execution is off.
- **Schema** (`browser-schema.ts`): request `{ filePath }`, a string of 1 to 4096 characters, `.strict()`; response `{ success: true, usedFallback: boolean }` or `{ success: false, errorCode, error }`, where `error` is the `ERROR_MESSAGES` text – no raw error crosses IPC.
- **Error codes** (`errors.ts`): `OPEN_IN_BROWSER_INVALID_REQUEST`, `_NO_PROJECT`, `_OUTSIDE_PROJECT`, `_NOT_HTML`, `_MISSING`, `_LAUNCH_FAILED`.
- **Handler** `src/main/ipc/browser-handlers.ts`, modelled on `image-export-handlers.ts`: `registerHandle` (behind the process-wide `isTrustedAppSender` gate in `registry.ts`) → `isTrustedSender(event)` **before** the payload is read → zod → `BrowserLaunchService.openFile(filePath, fileService.getProjectPath())` → a catch-all that logs with `redactedLogError` and refuses with `LAUNCH_FAILED`. Registered in `src/main/index.ts` next to `registerImageExportHandlers()` (`:417`).
- **Bridge**: `window.api.browser.openFile(filePath)` in `src/preload/index.ts`, typed in `index.d.ts`, shape pinned in `index.test.ts`.
- **The previewed page can never trigger it.** `previewPage.ts` has no `contextBridge` and sends two WebContents-scoped channels only; a sender on `erfana-preview://`, or any subframe, fails both sender gates. The handler test asserts both refusals.

## 4.2 The service – checks in order (`src/main/services/browserLaunch/BrowserLaunchService.ts`)

| # | Check | Refusal |
|---|---|---|
| 1 | a project is open | `NO_PROJECT` |
| 2 | the requested name ends `.html` or `.htm`, any case – on win32, a name that holds an NTFS alternate data stream (`C:\p\tool.exe:x.html` ends `.html` but names a stream of `tool.exe`) is refused as a stream, not a whole file (`namesAlternateDataStream`, `BrowserLaunchService.ts:59`, applied at `:139`; QG-7 S6) | `NOT_HTML` |
| 3 | lexically inside the project (`isLexicallyInside`) | `OUTSIDE_PROJECT` |
| 4 | `resolveInsideProject(filePath, projectPath)` – new helper beside `classifyConfinement` that also returns the real path | `missing` → `MISSING`; `outside` / `unverifiable` → `OUTSIDE_PROJECT` |
| 5 | the **real** name also ends `.html` / `.htm` (a symlink `a.html` → `x.sh` is refused), with the same win32 stream rule | `NOT_HTML` |
| 6 | the real path is a regular file (a folder named `x.html` is refused) | `MISSING` |
| 7 | `launcher.open(realPath)` | `LAUNCH_FAILED` |

- It launches the **real** path, so a symlink swapped between check and launch cannot redirect it to something that was never checked.
- Checks 5 and 6 are pinned by `BrowserLaunchService.test`: the symlink `a.html` → `x.sh` and a folder named `x.html`, each refused with its code (RX1).
- **Pinned (WI-23): a project opened through a link.** Check 3 compares text: the requested path must sit lexically inside the project path as it was opened. So when the project was opened through a symlinked folder, the same page named through the real folder (`/private/tmp/proj/a.html` for a project opened as `/tmp/proj`) is refused `OUTSIDE_PROJECT`. Known behaviour, kept: the renderer always sends project-space paths – the tree's, and `params.filePath`, which main reports in project space (part 3 §3.4). `BrowserLaunchService.integration.test.ts` pins it, beside a link inside such a project, which launches its target.
- The preview's excluded-folder and gitignore rules do not apply: the tree item shows for every `.html` / `.htm`, including gitignored files, excluded folders and HTML execution off (settled). The channel checks only the project root.
- **Accepted risk (RX1).** Because of that, a `.html` file the sealed preview refuses – inside `node_modules`, a dot-folder, or gitignored – is one click from running unsandboxed, with network, in a real browser. The user starts it from Erfana's own UI, never the page; the settled product decision stands, and `docs/security.md` records it in Phase 10. A confirm step for such paths was judged out of scope (it contradicts the settled assumption).
- No `#section` is passed on: the request carries a file path, never an address.
- Logs use `redactPath` (`src/main/utils/redactUserInput.ts`); toasts carry the full name (CLAUDE.md rule).

## 4.3 The launcher (`browserLauncher.ts`)

Seams injected: `getApplicationInfoForProtocol`, `execFile`, `openPath`, `platform`. Each default is a call-time lambda (for example `(url) => app.getApplicationInfoForProtocol(url)`), so a stub installed later by the e2e is seen.

| Platform | Default browser | Command | When the browser cannot be found |
|---|---|---|---|
| macOS | `app.getApplicationInfoForProtocol('https://example.com')` → e.g. `/Applications/Google Chrome.app` (S7; a `file://` lookup throws) | `execFile('/usr/bin/open', ['-a', appPath, realPath])` – `open` by full path, so no `PATH` entry can stand in for it; an argument array, no shell; `open` hands the file over and exits, so its exit code is the answer | `shell.openPath(realPath)`, `usedFallback: true` |
| Windows | the same call → the browser's executable (unverified on Windows; manual QA with Edge as default) | `execFile(exePath, [realPath])`; the default seam spawns it detached, with no shell, and settles once it has spawned – it never waits for the exit | same |
| Linux | not attempted (out of scope) | – | same, every time |

- The lookup is bounded by `withTimeout` (`src/main/utils/withTimeout.ts`, 3 s). **The fallback runs only when the lookup errors, times out or returns an empty or unusable path** (RX7) – unusable meaning not absolute or, on Windows, not an `.exe`.
- **Every launch step has a 10 s limit** (`BROWSER_LAUNCH_TIMEOUT_MS`): `open` on macOS, the spawn on Windows, `openPath` in the fallback, and the e2e seam.
- A failed launch (spawn error, non-zero exit, timeout) is `LAUNCH_FAILED` with a toast – it does **not** fall back, because the fallback app may be a code editor and the user asked for a browser. A non-empty `openPath` result is also `LAUNCH_FAILED`.
- **Windows does not wait for the browser (WI-21).** With no instance running, the spawned process *is* the browser and lives until the user closes it, so waiting for its exit would hold the busy state that long, and a timeout would kill the browser. It starts detached and the launch settles at spawn; a spawn error is still `LAUNCH_FAILED`, but a browser that starts and then fails is not reported. The Phase 11 Windows UAT covers it.
- **Failures as short codes (WI-21).** The launcher reports a failure as a stage (`argument`, `browser`, `fallback`) and a short cause (`ENOENT`, `exit 1`, `timeout`, `refused`), never as error text: a Node spawn error quotes the whole command line, file path included.
- **Argument safety.** The argument is always the confined real path – never a `file://` URL, never with `#` or a query (RX7). It is absolute – it starts with `/`, a drive letter or `\\` – so it can never be read as an option; it travels as one argv element, keeping spaces, non-ASCII characters and UNC paths intact. Whether Edge and Chrome accept a UNC path argument is a Windows QA item.
- `browserLauncher.test` pins each rule above per platform, including both timeouts.

## 4.4 The e2e seam – replaceable at runtime

- `resolveLauncher()` evaluates `app.isPackaged` **first**: a packaged build gets the real launcher at once, before the environment variable is read or the global is probed (RX6). Only when `!app.isPackaged && process.env.ERFANA_E2E_BROWSER_SEAM === '1'` and `typeof globalThis.__erfanaE2eBrowserLaunch === 'function'` does it call that function – with only `{ via: 'browser' | 'fallback', appPath, filePath }` – instead of `execFile` / `openPath`. This is the same unpackaged-only, environment-gated pattern as `ERFANA_E2E_FORCE_CRASH` (`src/main/index.ts:161`, design-issue-60 §2.8).
- The seam's argument type is `E2eBrowserLaunch`. It runs under the same 10 s limit, and a seam that throws is a failed launch (`LAUNCH_FAILED`).
- A unit test builds a packaged app with the variable and the global both set and asserts the real launcher runs.
- The e2e sets the function with `app.evaluate`, and forces the fallback by stubbing `app.getApplicationInfoForProtocol` to reject – Electron's `app` object is patchable from `app.evaluate`, `child_process` is not. On macOS a temp path resolves `/var` → `/private/var`, so the seam receives the `/private` form.
- `docs/security.md` gets a section for the seam in Phase 10.

## 4.5 Renderer

- **Tree.** `OpenInBrowserCommand` in `commands.tsx` (template: `OpenAsSourceCommand`, `:177`): label "Open in default browser", icon `ExternalLink` from `lucide-react` (a new import beside `FileCode`) at 14 px. `MenuContext` gains `openInBrowser?`; `FileContextMenuStrategy` shows it for `isHtmlFile(name)` (`fileUtils.ts:207`) under its own gate, after "Open as source", with the separator after the group whenever it holds at least one item. `strategies.test.tsx` keeps "Open as source" at index 0; the new item is index 1. `buildMenuContext` (`ProjectTree.tsx:1223`) wires it next to `openAsSource` (`:1248`; `openInBrowser` at `:1254`) (the file was 1 468 lines; +3 as built, recorded).
- **Toolbar.** A button in the trailing tools (`PreviewToolbarTools.tsx`, created in WI-3, reached through `PreviewChromeBand.tsx` and `HtmlPreviewPanel.tsx`), directly before Export to PDF behind the existing rule; `aria-label` and `title` "Open in default browser"; busy state with `aria-disabled="true"` plus `--opacity-disabled` from press to answer, further presses ignored, never the `disabled` attribute. It acts on the tab's current page, `params.filePath` (part 3 §3.4), which changes when the move is committed. As built (WI-22): there is no renderer timeout on the busy state – it relies on main's 10 s launch limit – and the busy look (`--opacity-disabled`) comes with WI-20's rule in `PreviewChromeBand.css`; the tree item has no busy state.
- **One action for both.** `previewOpenInBrowser.ts` calls `window.api.browser.openFile(params.filePath)` as the bridge defines it: success is silent; `usedFallback` raises the info toast; each error code maps to its UX §7 toast, and `NO_PROJECT`, `INVALID_REQUEST` and a rejected invoke use the "Launch failed, or unknown error" text (RU13). The launch-failure text names "Reveal in Finder", "Reveal in Explorer" or, on Linux, "Reveal in File Manager", via `isMacOS()` / `isWindows()`. The reply is checked against the shared `BrowserOpenFileResponseSchema`; one that does not match gets the same unknown-error text as a rejected invoke. Renderer logs carry the code only – or `INVOKE_REJECTED` / `INVALID_RESPONSE` when there was no usable answer.
- **As built (WI-22) – tests and size.** The default-slot and current-page tests are in `PreviewToolbarTools.test.tsx`; `createMockMenuContext` has no `openInBrowser`, so tree tests pass an override (a Phase 8 note). The band ends at 429 lines and the panel at 359, over their WI-3 targets (420, 340) and under 500 – recorded as debt.

## 4.6 How each criterion is met

| AC | Mechanism | Proof |
|---|---|---|
| P4-AC1 | tree strategy and command | `strategies.test.tsx` (`.html`, `.HTM` yes; `.md`, folders no; index 1), `commands.test.tsx`; e2e through the seam |
| P4-AC2 | toolbar button on the current page | unit (busy, no confirm); e2e: after a same-tab move the seam receives B's real path |
| P4-AC3 | §4.3 launcher and fallback | unit launcher table (editor-associated `.html` still launches the browser; lookup failure → fallback + info toast; launch failure → error toast; argument is the real path); manual macOS / Windows |
| P4-AC4 | §4.2 checks; sender gates | unit: outside, symlink escape, non-HTML requested and real name, a folder named `.html`, missing, untrusted and subframe senders; integration with real temp folders and symlinks; manual Windows drive and UNC paths |
| P4-AC5 | `shell:openExternal` and `file:revealInFileManager` untouched; `externalLinkConsent.ts` changed only in a log line (QG-8 J3: error name and code, no path or link), behaviour unchanged | existing tests and the links e2e stay green; `externalLinkConsent.test` re-pinned for the log line |

## 4.7 Risks specific to part 4

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Windows lookup returns something other than an executable | medium | medium | QA item; an unusable value (not absolute, not an `.exe`) → fallback plus notice |
| A page opened in a browser runs with no sandbox, no host approval and open network | certain | medium | accepted risk in the security doc; the user starts it from Erfana's own UI, never the page |
| A file the preview refuses (excluded, dot-path, gitignored) runs unsandboxed in one click | certain | medium | accepted risk (RX1), documented; settled product decision |
| Symlink swapped between check and launch | low | medium | launch the resolved real path; the extension re-checked on it |
| Launch hangs | low | low | a 10 s limit on every launch step; the Windows launch settles at spawn; the busy state clears on any answer |
| The busy state has no renderer timeout | low | low | main answers within the 10 s launch limit; recorded as technical debt |
| A Windows browser that starts and then fails goes unreported | low | low | the detached launch settles at spawn, and a spawn error is still reported; Phase 11 Windows UAT |
| The e2e seam reachable in a shipped build | low | high | `app.isPackaged` checked first; packaged-build unit test |
