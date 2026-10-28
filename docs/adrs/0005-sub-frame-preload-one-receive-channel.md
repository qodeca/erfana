# ADR 0005: Sub-frame preload with one receive channel

- **Status**: accepted
- **Date**: 2026-10-26
- **Deciders**: Marcin Obel, Claude Code (HTML Preview comments plan rev 3, phase P4)
- **Related**: [design](../designs/html-preview-comments.md) §4.2, §8, §9.2, §19 R3-2 – R3-7 · [spike results](../spikes/html-preview-comments.md) · [`src/preload/previewPage.ts`](../../src/preload/previewPage.ts) · [`src/preload/previewPageComments/`](../../src/preload/previewPageComments/index.ts) · [`previewSessionPolicy.ts`](../../src/main/services/preview/previewSessionPolicy.ts) · [`previewViewLifecycle.ts`](../../src/main/services/preview/previewViewLifecycle.ts) · [docs/security.md](../security.md) § Revised for in-page links

## Context

The HTML preview is a sealed box: the page runs in its own sandboxed process and in-memory session, and the only Erfana code inside it is the `previewPage` preload. Until now that preload ran in the main frame only (`nodeIntegrationInSubFrames: false`) and was **send-only** – it reported link clicks and CSP refusals and never listened to main. Its contract test pinned the absence of `ipcRenderer.on`.

HTML Preview comments need Erfana code inside the page that the sealed box did not have:

- **Inside frames.** A reviewer must be able to comment on an element of a same-project `<iframe>`. Capturing the served element tokens, drawing the outline and pins, and swallowing clicks in comment mode all have to happen in the frame's own document. Pointer events over a frame reach only the frame (spike S8).
- **A way to hear main.** The overlay must learn when comment mode is on, which pins to draw (keys, tokens, counts), the theme, which element to reveal, the scroll to restore and the frame's child-frame keys. Polling from the page, or re-injecting script per state change, would each be a larger surface than one listener.

Electron offers no "preload in frames" switch other than `nodeIntegrationInSubFrames`. Despite its name, with `sandbox: true` and `contextIsolation: true` it gives frames **no Node**: it makes Electron run the same sandboxed, isolated preload in every sub-frame.

## Decision

1. **Run the preload in sub-frames, behind the flag – and only install the overlay when asked.** `htmlPreview.comments.enabled`, read when a view is built, selects `PREVIEW_WEB_PREFERENCES_WITH_COMMENTS`: today's frozen literal with exactly two keys changed, `nodeIntegrationInSubFrames: true` and `additionalArguments: ['--erfana-hpc']`. The renderer argument is the kill switch: the preload installs the overlay only when it finds `--erfana-hpc` in its `process.argv` (sandboxed sub-frame preloads see it too), so with the flag off there is no state listener, no token capture and no hello – the preload is today's link and CSP reporter and nothing more. Flag off is today's literal exactly. A settings read that throws counts as off. A view keeps its policy for its whole life.
2. **One receive channel.** The preload's only listener is `ipcRenderer.on('preview-page:commentState', …)`, in `previewPageComments/index.ts`, with the channel written as a literal. The state carries mode, pin keys, element tokens, counts and theme values – never comment text, author names or emails (§9.1 S5). Main sends it to a specific frame (`WebFrameMain.send`).
3. **What the page sends only asks.** Hello (a document is ready / send the frame list again), picks (menu, open, pin click, Alt+↑ out of a frame, Esc) and pin visibility are heard on `webContents.ipc`-scoped listeners. None of them writes a file; Save stays a user gesture in Erfana's own UI (§4.1 B1). Electron also emits every renderer send on the global `ipcMain`: no global listener exists for a `preview-page:` channel (`src/main/ipc/noGlobalPreviewPageListener.test.ts`), and every global listener sits behind the `registry.ts` sender gate, whose `isTrustedAppSender` refuses every frame of a preview page, its main frame included.
4. **The link and CSP reporter stays main-frame-only.** `previewPage.ts` registers its click, auxclick and `securitypolicyviolation` listeners only when `window === window.top`. Frame CSP refusals keep reaching the permission band through `previewFrameCspConsole.ts`, as before.
5. **Existing channels fail closed.** Main's link, link-note and CSP handlers used to treat `senderFrame === undefined` as the main frame – safe only while frames had no preload. They now refuse any message whose sender frame is not the view's main frame, `undefined` and `null` included (SEC-27).
6. **The contract test was revisited on purpose.** `previewPage.contract.test.ts` now reads `previewPage.ts` and every module of `previewPageComments/` (comments found by the TypeScript parser, so a `//` inside a string never hides code), and pins: no `contextBridge`, `webFrame`, `postMessage`, `invoke` or `sendSync`; exactly one listener, on the literal state channel; `preventDefault` only in the comment-mode guard (`swallow` in `input.ts`); no markup or `<style>` writes; and imports limited to `ipcRenderer` from `electron` plus the overlay's own modules. `previewPage.ipcSurface.test.ts` checks the same at run time: with a recording stand-in for `electron`, the preload loads and works (hello, state, a pick, a keyboard step, a link, a CSP refusal) touching only `send` and one `on`, and sends only on channels main knows. `previewPageComments/contract.test.ts` pins every inlined constant to its main-side source.

## Consequences

**What the page can and cannot do**

- The page's own JavaScript still cannot see or reach the preload: no `contextBridge`, separate worlds. Every overlay object lives in the isolated world; the overlay draws in a closed shadow root styled only through constructable sheets and `el.style`. One exception, accepted: comment mode's crosshair cursor is a constructable sheet in `document.adoptedStyleSheets`, which the page can read, edit or drop. It is cosmetic – nothing of the overlay depends on it – and owning the cursor from inside the overlay would mean covering the page with a hit-testable layer, which breaks hover and wheel scrolling.
- A hostile page can **forge** nothing that counts: every listener ignores untrusted events (SEC-03, SEC-29), and a token counts only on its first sighting before the preload's `DOMContentLoaded` (R3-2). Tokens are not authoritative: main re-validates against the file at Save.
- A hostile page can **fight** the overlay – remove, move, restyle or hide its host. Each is repaired, at most 3 times a second, whether the repair comes from the host's own watch or from the next render finding it gone; past that the overlay gives up for the document and main hears `overlay: 'unavailable'` (SEC-28, SEC-31). The host's popover events never reach the page: the input guards stop `beforetoggle` and `toggle` on the host in the window's capture phase, ahead of any page listener, so a page cannot cancel the host's `showPopover()`; a show that still did not take is retried on the same budget.
- A page can **erase** the preload's listeners with `document.open()` – it removes every listener of the window and the document, the isolated world's included. The preload notices the replaced `<html>` (its mutation observers survive), puts its guards, the host's listener and the redraw listeners back, and tells main the overlay is unavailable for that load: a script in the written markup can register its own capture listeners before the guards are back, so comment mode is no longer guaranteed to see clicks first.

**Accepted costs**

- **A Chromium or V8 compromise in a frame now has the same IPC path the main frame already had.** Before, a compromised frame had none. It reaches only what main listens for. On the view's `webContents.ipc` the handlers are frame-aware: the old channels accept only the main frame, and the comment handlers (P5) will validate the sender frame against the view's frame tree. On the global `ipcMain`, where Electron also delivers every renderer send, every listener is behind the `registry.ts` sender gate, which refuses every frame of a preview page.
- **A second preload copy per frame.** Each frame of a commented page pays the preload's start-up cost (one module, no network). Pages over 50 frames are already refused by the frame guard.
- **`about:blank` and `javascript:` frames get no preload** (spike S1a), so the overlay cannot reach inside them. The parent draws a transparent click-shield over every non-commentable `<iframe>` and `<frame>` instead (R3-3) – and over every frame that shows inline content, whatever main's frame list says: the list can be stale (a page that navigates a project frame to `about:blank` keeps its window and its `src`).
- **A page `<dialog>` or popover shown later sits above the host in the top layer**, and while a page modal is open the pins cannot be clicked (spike S5, documented limit).

## Alternatives considered

### Keep the preload main-frame-only and reach frames from the parent

- **Pros**: no change to `WebPreferences`.
- **Cons**: the parent's isolated world cannot touch a frame's document (separate world, often a separate process); pointer events over a frame never reach the parent (S8). Tokens in frames could not be stripped before the frame's scripts run.
- **Verdict**: rejected – comments inside frames would be impossible, and the overlay could not swallow clicks there.

### Inject the overlay per frame from main (`WebFrameMain.executeJavaScript`)

- **Pros**: no preload in frames.
- **Cons**: runs in the page's main world unless isolated worlds are managed by hand; arrives after the frame's scripts have run, too late for token capture (R3-2); and a per-frame inject on every navigation is more moving parts than one preload.
- **Verdict**: rejected – too late for the token rule, and a weaker isolation story.

### Two-way bridge with `ipcRenderer.invoke`

- **Pros**: the page side could ask main for state on demand.
- **Cons**: an `invoke` lets the page wait on main's answers – a request/response channel the sealed box has never had. Push-only state is enough for everything the overlay needs.
- **Verdict**: rejected – `invoke` stays banned by the contract test.

### A `MessagePort` per frame

- **Pros**: a private channel per frame, closed with the frame.
- **Cons**: the port must be handed over through the preload anyway; transferring it is more code on both sides than one listener; and it would bypass the `webContents.ipc` scoping the other channels use.
- **Verdict**: rejected for v1.

## References

- `src/preload/previewPage.contract.test.ts` – SEC-01, SEC-02, SEC-22 source rules over both preload sources
- `src/preload/previewPage.frame.test.ts` – SEC-22 in a frame: overlay installed, link and CSP reporters off
- `src/main/services/preview/previewSessionPolicy.test.ts` – SEC-22 policy freeze, both variants
- `src/main/services/preview/previewViewLifecycle.test.ts` – SEC-27 sender-frame gate
- `src/preload/previewPage.ipcSurface.test.ts` – SEC-01 at run time: every property the preload touches on `electron` and `ipcRenderer`
- `src/main/ipc/noGlobalPreviewPageListener.test.ts` – no global `ipcMain` listener for a `preview-page:` channel
- `e2e/html-preview-comments-preload.e2e.ts` – tokens stripped before inline, defer and module scripts; pin drawn for a pre-seeded block; in real Chromium, the host re-attached and given up on (SEC-28), re-shown after `hidePopover()` (SEC-31) and after a page `beforetoggle` that cancels (L1), and the guards back after `document.open()` (M1)
- `e2e/html-preview-comments-instrument.e2e.ts` – the preload running in a same-project frame: its tokens stripped there, and a pick in the frame naming the frame's own block
