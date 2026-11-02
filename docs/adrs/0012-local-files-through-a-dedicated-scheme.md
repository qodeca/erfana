# ADR 0012: Local files open through a dedicated `erfana-local:` scheme

- **Status**: proposed
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-002, 025-FR-005, 025-FR-010, 025-NFR-001 · [05-notes](../../specs/spec-t4-025-built-in-browser/requirements/05-notes.md) 025-CA-009 · [ADR 0009](./0009-browser-profile-in-the-project-folder.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 3.4

## Context

025-FR-005 rule 1 lets a browser tab show a local HTML file with its images, styles, scripts, fonts, media and frames from the file's folder and below – and nothing else. The page must not read the content of any local file (in its folder or elsewhere) by `fetch`, `XMLHttpRequest`, reading a frame's document, a service worker or a directory listing, whatever the process-wide fuses allow; each opened file's folder is its own origin, so two project HTML files in different folders cannot read each other's storage. No browser tab may load a local file until this holds.

The obstacle is 025-CA-009: `scripts/fuses.js` keeps `GrantFileProtocolExtraPrivileges: true` because Erfana's window loads from `file://` (`src/main/index.ts`, `mainWindow.loadFile`). Per [Electron's fuse documentation](https://www.electronjs.org/docs/latest/tutorial/fuses), with that fuse on, `file://` pages can `fetch` other `file://` assets, register service workers, and get universal access to child `file://` frames. Fuses apply to the whole process, so a raw `file://` page in a browser tab would get the same powers.

Three mechanisms were named in the spec:

1. A browser-session protocol handler for `file:` that confines requests to the folder.
2. A dedicated local scheme.
3. Move Erfana's window to a custom protocol and turn the fuse off.

One more fact, found while reading the code: every IPC trust predicate today trusts a sender **by its URL** – `isTrustedAppSender` accepts the bundled `file://…/renderer/index.html` (`src/main/ipc/senderValidation.ts`), and four more copies do the same. A browser tab that loaded that file would pass the gate. 025-FR-005 rule 3 refuses that load, and 025-NFR-001 moves the gate to `webContents` identity (solution design commit 1); this ADR's scheme never serves anything outside the opened folder, so the app entry cannot be reached through it either.

## Decision

**Option 2: serve local files through a dedicated, privileged custom scheme, `erfana-local:`, registered only on browser sessions; refuse `file:` itself in browser sessions.**

1. **Registration.** `erfana-local` joins the existing `erfana-preview` entry in the one `protocol.registerSchemesAsPrivileged` call before `app.whenReady()` (Electron requires this call before ready, and it is made once – `registerPreviewScheme()` in `previewScheme.ts` becomes `registerAppSchemes()`). Privileges: `standard: true` and `secure: true` only. **Not** `supportFetchAPI`, `corsEnabled`, `allowServiceWorkers`, `bypassCSP` or `stream`, so `fetch()` to the scheme fails and no service worker can register.
2. **Handler on browser sessions only.** `ses.protocol.handle('erfana-local', …)` is attached by `BrowserProfileService` to each browser session; the app's default session and the preview sessions have no handler, so the scheme is dead there ([Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol): a handler is registered per session).
3. **One origin per folder.** Opening `<folder>/index.html` (from the address bar as `file://…`, or **Open in browser tab**, 025-FR-010) maps the folder's canonical real path to a host: the first 32 hex characters of HMAC-SHA-256(folder path) keyed with the ADR 0009 per-user secret. The tab loads `erfana-local://<host>/index.html`. Two folders get two hosts, so two origins and separate storage; the same folder gets the same host after a restart, so its local storage persists (025-FR-005 rule 1).
4. **Confinement in the handler** (`browserLocalScheme.ts`, new). The handler keeps a per-session map from host to folder (filled only by Erfana's own open calls, never by a URL a page writes). For each request it decodes the path, resolves it under the folder, refuses `..`, takes the real path, requires it to stay under the folder's real path (the `realPathWithin` rule `previewPathResolve.ts` already uses), refuses folders (no listings), symlinks leaving the folder and anything under `.erfana/`, and serves the file with a MIME type from its extension and `X-Content-Type-Options: nosniff`.
5. **No reads by script.** On top of the missing `supportFetchAPI`:
   - The handler serves a request only when its `Sec-Fetch-Dest` header is one of `document`, `iframe`, `frame`, `script`, `style`, `image`, `font`, `audio`, `video`, `track`, `worker`, `manifest`; `empty` (fetch, XHR, beacon), `serviceworker`, `sharedworker` and a missing header are refused with 403.
   - Every document served into a **frame** carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads` (no `allow-same-origin`), so the frame has an opaque origin and the parent cannot read its document, nor can it read its parent's.
   - Whether Chromium sends `Sec-Fetch-Dest` on requests to a custom secure scheme, and whether Electron passes it to the handler, is **unverified**. Commit 9 of the solution design starts with the hostile-page probe (fetch, XHR, frame-document read, service worker, directory listing, each with a canary file). If the header is absent, the fallback is to serve the **top document too** with the sandbox CSP above: every local page then has an opaque origin, nothing can be read, and local pages lose `localStorage` – which changes the "own origin per folder" rule of 025-FR-005 into "no storage for local pages" (owner choice, solution design § 11).
6. **`file:` itself is refused in browser sessions.** `ses.protocol.handle('file', () => 403)` on every browser session (intercepting a built-in scheme is supported by `protocol.handle`, which replaced `interceptFileProtocol`), plus `will-navigate`, `will-frame-navigate` and `will-redirect` refusals and a `webRequest.onBeforeRequest` filter that cancels any `file:` URL, any `file:` URL with a host, `\\host\share` and `file:////host` forms (025-FR-005 rule 2), Erfana's renderer entry and resources folder, and – in development builds – the dev-server origin (rule 3). The filter uses `onBeforeRequest` only; 025-FR-038's logs come from CDP, so this listener does not compete with them.
7. **What the user sees.** The address bar, history and tab tooltip show a local page as `file://<path>` through the origin formatter; `erfana-local://` never reaches the user. Typing a `file://` address is the same as **Open in browser tab** for that file. Links inside the page between files of the same folder work because they are relative URLs on the same `erfana-local://<host>/` origin.
8. **The fuse stays on for now.** Turning `GrantFileProtocolExtraPrivileges` off is the right end state, but it needs Erfana's own window and its preview frames off `file://`; that is filed as a follow-up, independent of this feature.

## Consequences

- **A local page cannot read local files** in its folder or elsewhere, whatever the fuse says, because it never runs on `file:`.
- **Local apps that `fetch` their own JSON** (a common static-site pattern) do not work in the browser tab; they work when served by a dev server on `localhost`. The user guide says so. This is what 025-FR-005 rule 1 asks for.
- **Module scripts and fonts** load: they are same-origin requests with an allowed destination.
- **Storage per folder persists** across restarts in the project profile and is cleared by **Clear browsing data**; it is tied to the per-user HMAC secret, so a copied project starts with empty local-page storage, as with cookies.
- **One more privileged scheme in the process.** It has no handler outside browser sessions; a unit test asserts the scheme's privilege set and that the default session answers it with an error.
- **Committed URLs differ from what the bar shows** for local pages – a spec clarification of 025-FR-002 (solution design § 10).

## Alternatives considered

### Option 1 – a `file:` protocol handler on the browser session

- **Pros**: the page keeps a real `file://` URL; no new scheme.
- **Cons**: the fuse's privileges are granted by URL scheme in the renderer, not by the handler: frames on `file://` get universal access to each other, and all `file://` pages share one storage origin, which fails "each folder its own origin". The handler cannot tell an `<img>` load from a `fetch` without the same `Sec-Fetch-Dest` question, and gains nothing for it.
- **Verdict**: rejected; `file:` is refused instead.

### Option 3 – move Erfana's window to a custom protocol and turn the fuse off

- **Pros**: removes the fuse's extra privileges for everyone; the end state Electron recommends.
- **Cons**: changes how the app window, the screenshot overlays and the preview frames load; every trust predicate, the CSP, deep links and the packaged-build tests move with it; and even with the fuse off, `file://` pages in Chromium can load subresources from any folder and share one storage origin, so a confining handler and per-folder origins would still be needed. A large, unrelated migration on the critical path of this feature.
- **Verdict**: rejected for this feature; filed as a follow-up (turn the fuse off once nothing loads from `file://`).

### Opaque origin for every local page from the start

- **Pros**: simplest proof that nothing can be read.
- **Cons**: no `localStorage` or IndexedDB for local pages, which breaks many static prototypes and fails 025-FR-005's per-folder origin.
- **Verdict**: kept as the fallback of decision 5 only.

## References

- [Electron – fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) – `grantFileProtocolExtraPrivileges`: fetch over `file://`, service workers, universal access for child frames; recommends custom protocols
- [Electron – protocol](https://www.electronjs.org/docs/latest/api/protocol) – `registerSchemesAsPrivileged`, `protocol.handle`, per-session registration
- `src/main/services/preview/previewScheme.ts`, `PreviewProtocolHandler.ts`, `previewPathResolve.ts` – the existing privileged scheme, handler and real-path containment this reuses
- `src/main/ipc/senderValidation.ts` – the URL-based gate that must move to identity
