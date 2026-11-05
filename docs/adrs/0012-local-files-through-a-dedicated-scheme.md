# ADR 0012: Local files open through a per-folder loopback server

- **Status**: accepted (owner decision, 2026-11-03) – revised 2026-11-02 after the expert panel; rewritten 2026-11-03 after the commit-8 spike failed: the owner chose the per-folder loopback server (owner question Q4) in place of the `erfana-local:` scheme. The file name keeps the original title; **amended 2026-11-04** (owner, option 1): the tab's pending top-level load also opens its folder to that tab until it commits – see [Amendment 2026-11-04](#amendment-2026-11-04-the-pending-top-level-load); first consequence reworded 2026-11-05 (owner decision)
- **Date**: 2026-11-03
- **Deciders**: Marcin Obel (owner), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-002, 025-FR-005, 025-FR-010, 025-FR-011, 025-NFR-001 · 025-CA-009 · [ADR 0009](./0009-browser-profile-in-the-project-folder.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 3.4, § 11 Q4

## Context

025-FR-005 rule 1: a local page shows its folder's images, styles, scripts, fonts, media and frames, and nothing else; it must not read any local file by `fetch`, XHR, a frame's document, a service worker, a listing **or a window it opens**; each folder is its own origin. `GrantFileProtocolExtraPrivileges` stays on because Erfana's window loads `file://`, so raw `file://` pages would get `fetch` over `file://`, service workers and universal access between `file://` frames ([Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)).

Options: (1) a `file:` handler on the browser session; (2) a dedicated scheme (`erfana-local:`); (3) move Erfana off `file://` and turn the fuse off; (4) a per-folder loopback static server.

Option 2 depended on whether Chromium sends `Sec-Fetch-Dest` to a custom-scheme handler. The commit-8 spike (Probe results below) showed it sends no fetch metadata at all, so the only script-read block left was a sandbox CSP that gives every document an opaque origin – which breaks fonts and module scripts from the same folder.

## Decision

**Option 4: a static HTTP server per opened folder, bound to `127.0.0.1`.** Chromium sends fetch metadata to `http://127.0.0.1` (a potentially trustworthy origin), fonts and module scripts work, and each folder is its own origin because each server has its own port. Code: `src/main/services/browser/local/` (`LocalFileServers.ts`, `LocalFolderServer.ts`, `localResponsePolicy.ts`, `localRequestPath.ts`, `localConfinedFile.ts`).

1. **Spike (commit 8, kept as a regression test).** Its outcome is recorded under Probe results; it decided the choice of option 4.
2. **The server.** One `LocalFolderServer` per project and folder, listening on `127.0.0.1` and a port the operating system assigns, `exclusive`. Every path is prefixed by a 128-bit random token, new for every server: the committed address is `http://127.0.0.1:<port>/<token>/<path>`. The server serves `GET` and `HEAD` only, and refuses a request whose `Host` is not exactly `127.0.0.1:<port>` (DNS rebinding). Servers are started on first use, shared by the tabs that opened a file in that folder, at most 32 at once, and closed when the last tab that holds one closes, on project switch or close, and on quit.
3. **The folder.** The served folder is the parent of the opened file's real path. Refused: a missing file or a folder, a file in a dot-folder (below the project root when inside it, anywhere otherwise) or a dot-file, a volume root or a system folder (such as `/tmp`, `/var`, `/private`, from `isSystemDirectory`) as the served folder, and Erfana's own files (the renderer entry and the resources folder).
4. **`file:` stays refused.** `file:` answers nothing in browser sessions: the session's request filter cancels every `file:` subresource and frame and every `file:` URL with a host (UNC forms included), and the navigation policy refuses a main-frame `file:` URL (`browserAppRequestFilter.ts`, `browserNavigationPolicy.ts`). The `erfana-local:` scheme stays registered by `registerAppSchemes()` and is dead: Erfana's own session answers every request to it with 403 (`browserLocalScheme.ts`).
5. **Only Erfana-started top loads get a real origin.** `BrowserTab` arms a one-shot token for the exact address it is about to load (address bar, history row, **Open in browser tab**, and Reload, Back and Forward of such an entry); an arm lapses after 30 seconds. The server serves that document without a sandbox. Every other document is served with `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-downloads`, which gives it an opaque origin and no storage: a frame, and **a page reached by a link from a local page** (it opens in the same tab, sandboxed – it is not refused). Every document carries `Cross-Origin-Opener-Policy: noopener-allow-popups`, so a window it opens has no handle back. A new tab or a popup that a page opens to a served folder is refused (spec change S-7).
6. **Script reads refused by fetch metadata.** The server serves only `Sec-Fetch-Dest` in `document`, `iframe`, `frame`, `script`, `style`, `image`, `font`, `audio`, `video`, `track`, `worker`, `manifest`; it refuses `empty` (`fetch`, XHR), `serviceworker`, `sharedworker`, `object`, `embed` and a missing header. A worker is served only with `Sec-Fetch-Site: same-origin`, and a subresource never with `none`.
7. **No inclusion by other sites – the session filter, not fetch metadata.** The first plan (a `Sec-Fetch-Site` check and `Cross-Origin-Resource-Policy: same-origin`) is replaced. A sandboxed document's own requests are `cross-site` (its origin is opaque) and every loopback port is the same site, so `Sec-Fetch-Site` cannot separate an inclusion by another page; and Chromium applies `Cross-Origin-Resource-Policy` to the opaque origin of a sandboxed document too, so a frame's own images and styles would not load. Instead the browser session's request filter (`webRequest.onBeforeRequest`, `browserAppRequestFilter.ts`) asks `LocalFileServers.allowsRequest` about every request: a request to a served folder goes ahead only when the requesting tab's **top-level page** is on the same server, or – for a top-level load – when its exact address is armed, or (amended 2026-11-04) – for a subresource or a frame – when the folder is the requesting tab's pending top-level load. A web page, a page of another folder, a page-opened tab or popup, and a page's navigation from elsewhere never reach a folder. Outside the browser session, the unguessable token is the guard. Every response carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (the token never leaves in a `Referer`).
8. **Path safety.** Decode once; refuse `..`, NUL, a `:` (Windows alternate data streams), `\\?\` and device paths, reserved Windows names, trailing dots or spaces in a segment, folders (no listing), anything under `.erfana/`; the real path must stay under the folder's real path; regular files only (`localRequestPath.ts`, `localConfinedFile.ts`).
9. **Display.** The bar, history and tooltip show `file://<path>` (spec change S-6); the committed address is the loopback address. Logs use `redactPath` for local pages and never carry a path from a request.
10. **Storage lasts one run.** The origin includes the port, and the port changes every launch, so a folder's `localStorage`, IndexedDB and cookies do not survive an Erfana restart. Framed and linked local pages have no storage and run no module scripts (opaque origin; the user guide says so and points to a dev server for local apps that need either).
11. **The fuse stays on**; moving Erfana's window off `file://` is a follow-up (owner question Q7).

## Amendment 2026-11-04: the pending top-level load

**Found.** Decision 7 reads the requesting tab's top-level page from `webContents.getURL()`. That answers the last *committed* page in the main process, and the new page's renderer commits and asks for its first images, scripts and frames before the main process has handled the commit. Those first requests were judged against the previous page and refused – a local page's own `canary.js`, and sometimes its image, in 2 of 10 Linux e2e runs (`e2e/browser-hostile-pages.e2e.ts`, "images and frames settled").

**Decided (owner, option 1).** Each tab tells the served folders its pending top-level load into a folder: one Erfana starts and arms (decision 5), or the page's own top-level navigation that the gate lets start from its committed page – a navigation within its folder. Until that load commits, a subresource or a frame from **that tab** to **that folder** goes ahead; a top-level load still needs an arm or the committed page. The record is cleared on commit (`did-navigate`), on the load's own failure (`did-fail-load` for its address – the failure of an older load it replaced does not clear it), on Stop, at the end of loading (`did-stop-loading`), on any newer top-level navigation, when the tab is destroyed and when the folder's server closes. After the commit only decision 7's committed-page rule applies. Code: `LocalFileServers.setPendingLoad` and `endPendingLoad`, `local/tabLocalLoad.ts`; the session filter and the navigation guard pass the tab's `webContents` id.

**Residual risk.** For the moment between the start of the load and its commit, the previous page – still running in that tab – can reach the pending folder too, with the same limits as the folder's own pages (fetch metadata, decision 6). Only the folder the user or that folder's own page is opening, only that tab, only until the commit. A reload of the same address while it is still loading may lose the record to the older load's failure; the cost is the original refusal, never a wider reach.

## Consequences

- A local page cannot fetch or XHR local files, open a window that can, or be included by another site. It is never served from the home folder or an OS user folder (Downloads, Desktop, Documents and the like) itself, nor from a folder that holds one. It can still load and read the images, style sheets, scripts and media of its own served folder (amended 2026-11-05, owner decision; `LocalFileServers.ts`). A listening socket exists, reachable by other local processes only with the token and the exact `Host`.
- Fonts, module scripts and per-folder storage work for the page the user opened; pages reached by a link or in a frame have no storage and no module scripts.
- A port per served folder while a tab holds it; at most 32.
- Committed URLs differ from what the bar shows (spec change S-6); `127.0.0.1` must be excluded from the test host-resolver map (see 04-acceptance).
- `erfana-local:` stays registered, dead outside browser sessions (unit test).

## Alternatives considered

- **Option 2, the `erfana-local:` scheme** – the spike showed no fetch metadata reaches the handler, so decisions 6 and 7 of the first plan could not be built, and XHR is not blocked by leaving out `supportFetchAPI`. Rejected (kept registered but dead).
- **Option 1, `file:` handler** – the fuse's privileges follow the `file:` scheme in the renderer and all `file://` pages share one storage origin. Rejected; `file:` is refused.
- **Option 3, move the app off `file://`** – large unrelated migration; even then Chromium's `file://` loads any folder and shares one origin. Follow-up only (Q7).
- **Opaque origin for every local page** – fonts and module scripts break, no storage. Rejected.

## References

- [Electron – fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [protocol](https://www.electronjs.org/docs/latest/api/protocol)
- `src/main/services/browser/local/`, `src/main/services/browser/browserAppRequestFilter.ts`, `src/main/services/browser/browserLocalScheme.ts`
- `e2e/browser-local-files.e2e.ts` – measures the header choices of decision 7

## Probe results (commit 8, 2026-11-03)

Electron 44.9.3, macOS 27.2 (Darwin 27.2.0, arm64), `e2e/browser-engine-probes.e2e.ts`, 5 runs each, all consistent. Playwright is attached as a second CDP client to every page in these runs. The production handler arrives with commit 11, so a **test-only** handler on a probe session (scheme registered `standard`, `secure`) served a fixture folder and recorded each request's headers. On 2026-11-03 the owner accepted this ADR with the loopback server (option 4) in place of the scheme, as the failed spike required.

| Probe | Result | Bears on |
|---|---|---|
| `Sec-Fetch-Dest`, `-Site`, `-Mode` on every request (document, style, classic and module script, image, frame, XHR, worker, font, an include from an `http` page) | **Absent on all of them**. `Origin` only on the module script and the font | The scheme could not enforce the script-read block: option 4 replaces it (Q4) |
| `fetch` of a same-folder file | Fails (`TypeError`) | No `supportFetchAPI` blocks `fetch` |
| `XMLHttpRequest` of a same-folder file | **Succeeds (200)** | Leaving out `supportFetchAPI` does **not** block XHR |
| Service worker registration | Fails (`TypeError`) | As intended |
| Dedicated worker, classic and module script | Run | As intended |
| Font from the same folder | Request reached the handler in CORS mode; outcome not tested (no font file in the fixture) | Open for the scheme; moot under option 4 |
| `<img>` of an `erfana-local` file from an `http` page | Request reaches the handler, with no fetch metadata to refuse it by | The first plan's `Sec-Fetch-Site` check was not possible; decision 7 uses the session filter |
