# ADR 0012: Local files open through a dedicated `erfana-local:` scheme

- **Status**: proposed – revised 2026-11-02 after the expert panel. **Not to be accepted before the commit-8 spike** settles whether `Sec-Fetch-Dest` reaches the handler; if it does not, the loopback-server option below replaces this decision (owner question Q4)
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-002, 025-FR-005, 025-FR-010, 025-FR-011, 025-NFR-001 · 025-CA-009 · [ADR 0009](./0009-browser-profile-in-the-project-folder.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 3.4

## Context

025-FR-005 rule 1: a local page shows its folder's images, styles, scripts, fonts, media and frames, and nothing else; it must not read any local file by `fetch`, XHR, a frame's document, a service worker, a listing **or a window it opens**; each folder is its own origin. `GrantFileProtocolExtraPrivileges` stays on because Erfana's window loads `file://`, so raw `file://` pages would get `fetch` over `file://`, service workers and universal access between `file://` frames ([Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)).

Options: (1) a `file:` handler on the browser session; (2) a dedicated scheme; (3) move Erfana off `file://` and turn the fuse off; (4) a per-folder loopback static server.

What is not known: whether Chromium sends `Sec-Fetch-Dest` to a custom-scheme handler (custom-scheme loaders may never add fetch metadata), and whether leaving out `supportFetchAPI` also blocks XHR. Without the header, the only script-read block left is a sandbox CSP that gives every document an opaque origin – which also breaks fonts and module scripts (both CORS-mode) from the same folder, close to dropping local files.

## Decision

**Option 2, conditional on the spike; option 4 is the planned replacement if the spike fails.**

1. **Spike first (commit 8, kept as a regression test).** A hostile local folder with a canary file tries: `fetch`, XHR (same origin), `<iframe>` document read, `window.open` + read, a new tab + read, a service worker, a directory listing, a font, a module script, and an include of an `erfana-local` file from an `https` page. The handler logs `Sec-Fetch-Dest`, `Sec-Fetch-Site` and `Origin` per request. The outcome is recorded here before this ADR is accepted.
2. **Registration.** `erfana-local` joins `erfana-preview` in the single `registerSchemesAsPrivileged` call (`registerAppSchemes()`), with `standard: true`, `secure: true` only.
3. **Handler on browser sessions only**, through `ses.protocol.handle`; `file:` itself answers 403 in browser sessions and is refused in navigation and `webRequest` filters, with UNC forms, the renderer entry, the resources folder and the dev-server origin.
4. **One origin per folder.** Host = 32 hex of HMAC-SHA-256(canonical folder path) with ADR 0009's per-user secret (Linux `basic_text`: the per-install salt). The host-to-folder map is filled only by Erfana's own open calls.
5. **Only Erfana-started top loads get a real origin.** `BrowserTab` arms a one-shot token for the exact URL it is about to load (address bar, **Open in browser tab**, Reload, Back, Forward of such an entry). The handler serves that document without a sandbox; every other document – a frame, a link the page follows, a page-started navigation – is served with `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-downloads` (opaque origin, no storage). Every document also carries `Cross-Origin-Opener-Policy: noopener-allow-popups`, so a window it opens has no handle back. Page-started new tabs and popups to `erfana-local` are refused in main (spec change S-7).
6. **Script reads refused** when the spike shows the header: serve only `Sec-Fetch-Dest` in `document`, `iframe`, `frame`, `script`, `style`, `image`, `font`, `audio`, `video`, `track`, `worker`, `manifest`; refuse `empty`, `serviceworker`, `sharedworker` and a missing header.
7. **No inclusion by other sites.** Every response: `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; a request whose `Sec-Fetch-Site` is not `same-origin` (or `none` for the armed top load) is refused.
8. **Path safety.** Decode once; refuse `..`, NUL, a `:` (Windows alternate data streams), `\\?\` and device paths, reserved Windows names, trailing dots or spaces in a segment, folders (no listing), anything under `.erfana/`; real path must stay under the folder's real path (`realPathWithin`); regular files only.
9. **Display.** The bar, history and tooltip show `file://<path>`; logs use `redactPath` for local pages.
10. **The fuse stays on**; moving Erfana's window off `file://` is a follow-up (owner question Q7).

### Option 4 – per-folder loopback server (replacement if the spike fails)

A static server in main bound to `127.0.0.1` on a random port per opened folder, every path prefixed by a 128-bit random token, serving the same confinement rules. Chromium sends fetch metadata to `http://127.0.0.1` (a potentially trustworthy origin), so decision 6 holds; fonts and modules work; each folder is its own origin. Costs: a listening socket other local processes can reach (token-guarded, loopback only), a port per folder for the session, and the bar must map `http://127.0.0.1:<port>/<token>/…` back to `file://`. Recommended over an opaque-origin fallback (Q4).

## Consequences

- A local page cannot read local files, open a window that can, or be included by another site.
- Multi-page local sites keep working, but pages reached by a link have no storage; the user guide says to use a dev server for local apps that need storage or `fetch`.
- One more privileged scheme in the process, dead outside browser sessions (unit test).
- Committed URLs differ from what the bar shows (spec change S-6).

## Alternatives considered

- **Option 1, `file:` handler** – the fuse's privileges follow the `file:` scheme in the renderer and all `file://` pages share one storage origin. Rejected; `file:` is refused.
- **Option 3, move the app off `file://`** – large unrelated migration; even then Chromium's `file://` loads any folder and shares one origin. Follow-up only.
- **Opaque origin for every local page** – fonts and module scripts break, no storage. Kept only if both the spike and option 4 fail.

## References

- [Electron – fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [protocol](https://www.electronjs.org/docs/latest/api/protocol)
- `src/main/services/preview/previewScheme.ts`, `PreviewProtocolHandler.ts`, `previewPathResolve.ts`
