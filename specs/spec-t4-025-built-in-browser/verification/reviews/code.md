# Code review – spec 025

Reviewer: `erfana:code-reviewer` (independent agent, not an author), 2026-11-04, against `873a9e4a`.

Score: 8/10
Counts: critical 0, high 0, medium 1, low 7

I sampled these files in depth: the main-process tab, navigation, local-file, profile, pick, capture and input-routing code, the IPC handlers and the main BrowserPanel hooks.

- **Unit tests:** both suites pass.
  - `npx vitest run -c vitest.main.config.ts src/main/services/browser src/main/ipc/browserTab src/main/ipc/browser-tab-handlers`: Test Files 123 passed, Tests 1822 passed.
  - `npx vitest run -c vitest.renderer.config.ts src/renderer/src/components/Panels/BrowserPanel`: Test Files 39 passed, Tests 324 passed.
- **Lint:** `npx eslint` over all browser source paths exits 0.
- **Not run:** e2e tests, per the brief.

## Findings

### [medium] Hand-built path join in the renderer breaks the project's path-helper rule
`src/renderer/src/components/Panels/BrowserPanel/useBrowserPick.ts:98-101`
```ts
function underProject(root: string, relative: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${relative.replace(/[\\/]/g, sep)}`
}
```
- **Why it matters:** both `CODE_REVIEW.md` § Always check and `src/renderer/CLAUDE.md` say renderer path math goes through `utils/fileUtils.ts`, and that "a manual join passes lint and is still a finding".
- **How it breaks:** the separator is guessed from the root. A root that contains both `\` and `/` (for example a UNC path or a mixed path) is joined with `/`. The result feeds `openFileInPanel`, so a wrong path means "Open capture" fails or opens a different panel id.
- **Fix:** add a `joinPath(root, relative)` helper to `fileUtils.ts`, with tests for Windows and POSIX, and use it here. Another option is to have main return the absolute capture path alongside the relative one.

### [low] A page change clears the panel but keeps the typed instruction
`useBrowserPick.ts:160-167` (the effect that runs after a navigation) versus `useBrowserPick.ts:152-153`
```ts
// A hidden tab keeps the typed text for its next dialog (025-FR-052); every other close ends it.
if (reason !== 'tabHidden') setDraftText('')
```
- **What happens:** the effect that closes the panel after a navigation drops the capture and shows `pageChanged`, but never calls `setDraftText('')`.
- **Effect for the user:** text typed in a dialog, followed by Back to the panel and then a navigation, reappears in the next capture's dialog. That contradicts the comment's own rule ("every other close ends it").
- **Fix:** call `setDraftText('')` in that effect, and add a test.

### [low] The sign-in box can stay on "Signing in…" for good
- **The code:**
  - `StripRow.tsx:119` – `if (row.kind === 'signIn' && given === 'signIn') setBusy(true)`
  - `browser-tab-handlers.ts:285-287` throws away the `AnswerResult`.
  - `StripRows.tsx:88-92` only logs a failed call.
- **What happens:** `busy` is cleared only when a new row (new `requestId` key) replaces the old one. That does not happen if main answers `'guarded'`, `'invalid'` or `'unknown'` (`tabStrip.ts:75`), or if the call fails. The submit button then stays `aria-disabled` with "Signing in…" until the user dismisses the row.
- **Fix:** return the `AnswerResult` from `browser-tab:answerStrip`. When the answer is not `'accepted'`, or the call rejects, reset `busy` (pass an `onAnswerFailed` callback down, or let `answer` return a promise).

### [low] The 32-server cap on local folders can be exceeded under parallel opens
`src/main/services/browser/local/LocalFileServers.ts:236`
```ts
if (this.entries.size >= MAX_LOCAL_SERVERS) {
```
- **What happens:** the cap is checked before `await server.start()` (line 247), but the entry is only added at line 258. Several `open` calls for different folders running at the same time can each pass the check and start more than `MAX_LOCAL_SERVERS` servers. The deduplication in `starting` only applies to the same folder.
- **Fix:** count pending starts, for example `this.entries.size + this.starting.size >= MAX`, or reserve a slot before the await.

### [low] "Open in system browser" falls back to the shortened, display-only address
- **The code:**
  - `browser-tab-handlers.ts:202` – `const url = systemBrowserUrl(target.data.url ?? target.tab.state().committedUrl)`
  - `BrowserTab.ts:133` – `return shown.length > BROWSER_URL_MAX_CHARS ? shown.slice(0, BROWSER_URL_MAX_CHARS) : shown`
- **What happens:** `state()` is the renderer's view of the address: the user name and password are removed and it is cut at 8192 characters. An address longer than that opens cut short, so the wrong page opens in the system browser.
- **Fix:** take the page's real address (`tab.contents.getURL()` after `withoutUserInfo`), not the display state.

### [low] A focus report on a closed page can throw an error
`src/main/services/browser/input/BrowserTabInput.ts:210-211`
```ts
if (!this.deps.contents.isDestroyed() && this.deps.contents.isFocused()) this.deps.focusWindow?.()
if (!this.deps.contents.isFocused()) this.dispatch({ type: 'focusToolbar' })
```
- **What happens:** line 211 calls `isFocused()` without first checking `isDestroyed()`. Electron throws on a destroyed `webContents`. The handler's `guarded` wrapper catches it, but it is logged as `logger.error('Browser tab request failed')` – noise during a tab close.
- **Fix:** read `isDestroyed()` once and return early.

### [low] Each popup keeps its activation tracker until its tab closes
`src/main/services/browser/popups/TabWindowOpen.ts:139` (`this.trackers.push(tracker)`); the only removal is `:158` in `detach()`.
- **What happens:** every popup's window-open handler adds an `ActivationTracker`. Trackers are only released when the opener tab closes. A long-lived tab that opens many popups keeps a growing list (small objects; their listeners are on popups that are already destroyed).
- **Fix:** return a `dispose` from `handlerFor`, and call it from `BrowserPopupWindow`'s `onClosed`.

### [low] Comments that still describe the build in commit order are now out of date
- **The comments:**
  - `useBrowserBounds.ts:24-25`: "width presets wider than the panel (ADR 0011 decision 6) come with commit 18". Presets are built in main (`page/TabViewFrame.ts`).
  - `browserNavigationPolicy.ts:139`: "until certificates are tracked (commit 12c)". Certificate state now overrides it (`BrowserTab.ts:338`).
  - `BrowserTabInput.ts:31-34`: "Reducer effects this commit does not perform…".
- **Why it matters:** readers cannot tell what is still pending.
- **Fix:** rewrite them to say what the code does now, and drop the commit numbers.

## What is strong
- **Race handling at async boundaries:**
  - `BrowserTabService.openLocalFile` re-checks that the tab still exists after the await and releases the folder server (`BrowserTabService.ts:219-222`).
  - `create` re-checks the window and that the project has not changed (`:167-171`).
  - `LocalFileServers.entryFor` makes sure only one start runs per folder (`:222-233`).
  - `ensureBrowserTab` sends one `create` per panel and closes a tab whose panel went before main answered (`browserTabLifecycle.ts:51-66`).
- **Functions that never reject do what their docs say:** `sendCapture` (`browserSend.ts:84-116`), `PickFreeze.unfreeze` (`pickFreeze.ts:83-101`), `CaptureExpiry.sweep` (`CaptureStore.ts:217-226`). The renderer's `.then` calls without a `.catch` are therefore safe.
- **IPC handlers follow one pattern:** each checks the sender, then parses a strict zod schema, then resolves the window from the sender and never from the payload, then runs inside `guarded` (`browser-tab-handlers.ts:138-178`). The navigate sources are limited to user sources by `NavigateSourceSchema` (`browser-tab-schema.ts:73`).
- **The local file server checks requests in the documented order:** Host check, method, token compared in constant time, fetch metadata, path parse, real-path confinement (`LocalFolderServer.ts:107-134`). Its logs carry no path or request data.
- **Capture writes are all-or-nothing:** each file is created exclusively without following links, its real path is re-checked, and a failure rolls back only the files this write created (`CaptureStore.ts:83-130`).
- **React state is mostly derived rather than copied:** `surface` and `dialogAction` are computed in render, and dialog state is keyed by `captureId` (`useBrowserPick.ts:128-134`). The latest-ref pattern prevents stale closures in `useBrowserKeys`. All four `exhaustive-deps` suppressions say why they are there and are justified (`SignInBox.tsx:62`, `StripRow.tsx:103,113`, `useOriginFit.ts:97`).
- **Little type unsafety:** no `any` or `@ts-ignore` in the browser source. The 18 `as unknown as` casts sit at the Electron-to-seam boundaries (popup wiring, and `listen` helpers that note "asserted at this one place").
- **Re-runs are safe:** session hardening skips a session it has already hardened (`browserSessionPolicy.ts:225`), so retrying a failed profile open does not attach duplicate listeners.

## Owner-pending items seen (not scored)
- **Item 26 / 025-AC-077 (one terminal):** `useBrowserTarget.ts:24` fixes `TERMINAL_NAME = 'Terminal'` and follows `activeTerminalId` only.
- **Item 18 (React 19 file:line):** the source-hint fallback in `pickFreeze.ts:20-22` and `capture/sourceHints.ts` reports "source not found" when no hint points to a project file.
- **Item 16 / 27 (live pick outline contrast, Retina):** the engine outline in `pick/pickHighlight` is single-colour, as recorded.
- **Item 30 (`openedBy` on the popup strip):** `TabWindowOpen.ts:61-66` (`openingOrigin`).

## Score rationale
I found no critical or high defects in the Code lens; I checked each candidate against the code before keeping it. There is one medium finding: a convention breach that stays in one file and has a clear fix. The other seven are low edge cases or comment drift, each with a one-line or one-function fix. That matches the rubric's 8, "Ready to ship… medium findings are few, local and have a clear fix". A 9 needs no finding above low, so the manual path join keeps the score at 8.

**Not checked:** the CDP allow-list and session policy (Security lens); CSS and design tokens (UI lens); BrowserCdpSession, downloads, certificates and credential stores beyond the call sites above; e2e behaviour.

**Recommendations, in impact order:** fix the path join (developer); return `AnswerResult` to the strip row; take the real address for "Open in system browser"; then the remaining low items. Add unit tests for the draft-clearing and sign-in recovery paths (test writer).
