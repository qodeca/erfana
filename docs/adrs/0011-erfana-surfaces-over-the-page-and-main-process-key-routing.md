# ADR 0011: Erfana surfaces around and over the page view, and key routing in the main process

- **Status**: proposed
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-011, 025-FR-014, 025-FR-019, 025-FR-030, 025-FR-031, 025-FR-047 to 025-FR-054, 025-FR-057, 025-FR-058, 025-FR-065 · [design note](../designs/browser/README.md) § Anatomy, § Key-routing states made visible, § ADRs and follow-ups · [Layering card](../design-system/system/foundations/layering.html) · [ADR 0007](./0007-pick-overlay-engine-drawn-through-cdp.md) · [ADR 0008](./0008-freeze-with-debugger-pause-after-capture.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 4, § 7

## Context

A browser tab's page is a `WebContentsView` added to the window's `contentView`. A native child view is composited above the window's own renderer, so no DOM element of Erfana's interface – whatever its `z-index` – can draw over the live page; the Layering card already states this, and the HTML Preview works around it with still frames (`PreviewStillFrameCache`). 025-FR-054 also forbids drawing any Erfana surface inside the page's document.

Keys raise a second question. While the page has keyboard focus, key events go to the page's process, not to Erfana's renderer; Erfana's renderer can neither see nor stop them. 025-FR-047 to 025-FR-052 define five routing states, a fixed set of browser keys and reserved keys, and a rule that every other key goes to the page while browsing and to no one while picking. 025-FR-054 requires the routing to be enforced in the main process with `before-input-event`, before the page receives a key.

The design note asks this ADR to settle: the still image for every popup over the page; the reserved pick row; the frame gutter; strip rows pushing the view down in one step; the click guard after a shift; the first click after focus returns; page-dialog focus rules; popup minimum size and position; full screen confined to the page area; `inert` zones while the dialog is open.

## Decision

### Surfaces

1. **Three zones that never mix.** Above the page: Erfana DOM only (navigation row, the always-reserved pick row, the find row, strip rows). The page area: the native view inside a 4 px frame that Erfana draws in DOM **outside** the view's rectangle (the gutter), so the frame changes colour without resizing the viewport. Over the page area: only a still image, never the live page.
2. **Still image for anything that would cross the page area.** Before Erfana shows the prompt-actions menu, the instruction dialog, the page right-click menu, address suggestions, or a toolbar menu that drops into the page area, main captures the view (or reuses the pick capture), the renderer draws the image in the page area, and main detaches the view from the window (`contentView.removeChildView`) once the image has painted (an acknowledged bounds push, the HTML Preview's existing `ack` pattern). Closing reverses the order: attach the view, wait one frame, drop the image. The page keeps running under a toolbar-menu image; the pick capture and freeze follow ADR 0008.
3. **Strip rows push the view in one step.** A strip row appearing or leaving changes the page area's height; the renderer pushes new bounds once, after layout, with a sequence number, and main applies them in one `setBounds` (no animation, as the Motion card says). Main records the time of each shift for the click guard.
4. **The pick row is always reserved**, so pick mode, the send notice and the target never move the page (the load-bearing choice of the design note).
5. **Erfana pages share the page area.** The empty tab, the certificate warning, the load-error and the crashed page are Erfana DOM drawn in the page area with the view detached.
6. **The page's own dialogs become strip rows.** `alert`, `confirm` and `prompt` are taken from the CDP `Page.javascriptDialogOpening` event and answered with `Page.handleJavaScriptDialog`; `beforeunload` uses Electron's `will-prevent-unload` (left alone, the leave is cancelled and Erfana shows "Leave this page?"; on **Leave** Erfana repeats the action with a one-shot `preventDefault` on the next `will-prevent-unload`). Whether Electron 44 still shows its own message box for `alert` and `confirm` while a CDP client handles the dialog is **unverified**: commit 10f of the solution design starts with that probe; if Electron's box cannot be suppressed, the owner chooses between accepting native dialogs (spec change to 025-FR-058) and an Electron patch.
7. **Full screen fills the page area only.** `BROWSER_WEB_PREFERENCES` gains `disableHtmlFullscreenWindowResize: true` ([webPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)): the page element fills the view, the window does not resize, and Erfana's rows stay visible (owner decision OD-4). This is a spec change to the frozen literal (solution design § 10). Starting full screen in pick mode is not reachable – pick mode keeps press events from the page, and `requestFullscreen` needs a user activation – so the design's "full screen while picking" frame is dropped (M-18).
8. **Popup windows** are Erfana `BrowserWindow`s that load Erfana's renderer entry on a `#browser-popup` route (as the screenshot overlay windows load it with a hash) and hold the page in a `WebContentsView` created through `setWindowOpenHandler`'s `createWindow`, so `window.opener` is kept. The popup's own strip is Erfana DOM, read-only for its origin and certificate rows. Size: the requested content size clamped to the work area, at least 320 px and at least the width the origin strip needs; a requested position over the opener's navigation, pick or strip rows is dropped.
9. **`inert` and focus.** While the instruction dialog is open, the tab's other zones are `inert` in DOM (only their icons dimmed); while the prompt-actions menu is open, they stay live and a click there closes the menu (025-FR-049). Page dialogs take focus only when their tab is active and focus is already in the page; strip rows never take focus otherwise (design note, Security rule 9).

### Key routing

10. **One router per view in main.** `browserKeyRouter.ts` (new, `src/main/services/browser/input/`) listens to `before-input-event` on every browser view and popup page. It reads the routing state that main holds for the tab (browsing or pick mode; whether the view is frozen; the IME composition flag) and decides, per key-down, one of: **page** (no `preventDefault`), **erfana** (`preventDefault` and act, or forward the action to the renderer), **drop** (`preventDefault`, nothing). Matching uses the produced character first and the physical `code` as fallback (025-FR-014), through one shared table, `src/shared/browser/browserKeys.ts`, which the renderer's toolbar handler reads too.
11. **Menu and dialog states are handled in the renderer.** While the menu or the dialog is open, the view is detached behind the still image, so keyboard focus is in Erfana's renderer and the page cannot receive a key; the renderer's handler implements 025-FR-049 and 025-FR-050. Toolbar focus (025-FR-051) is likewise renderer-side. Main tells the renderer when the view gains or loses focus (`focus` and `blur` on the view's `webContents`).
12. **Reserved keys from the page.** Erfana's editor-tab switching, focus-panel shortcuts and F6 / Shift+F6 are forwarded to the renderer as named actions (the HTML Preview's `onForwardedShortcut` pattern). F6 from the page focuses Erfana's `webContents` and asks the renderer to focus the address bar. Operating-system keys are never seen by the page or by Erfana.
13. **Application-menu shortcuts do not fire from the page, except the edit roles on macOS.** While a browser view is focused, its `webContents` has `setIgnoreMenuShortcuts(true)`, so a key bound to an Erfana menu reaches the page instead of the menu (025-FR-047). On macOS the router handles Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+Z and Cmd+Shift+Z itself by calling `copy()`, `paste()`, `cut()`, `selectAll()`, `undo()` and `redo()` on the view's `webContents`, so they act in the page without the menu.
14. **Esc during full screen or pointer lock** exits it and is consumed (`preventDefault`), whatever the state.
15. **Mouse routing next to keys.** `before-mouse-event` (ADR 0007) applies, in every state, the 500 ms click guard after a row shift (press and release dropped while the pointer is over the page area; in pick mode the renderer shows "The page moved – click again"), and the first-click rule: a press that arrives while the view is not focused and pick mode is on only focuses the view.

## Consequences

- **One source of truth per key.** A key the page has focus for is decided in main; a key Erfana's renderer has focus for is decided in the renderer; the shared table keeps both on one list of browser keys.
- **Popups over the page cost one capture.** A toolbar menu that drops into the page area costs a `capturePage` (tens of milliseconds) before it opens; menus that stay within the rows do not.
- **The page sees the view detached** while the menu or dialog is open (it becomes hidden to the engine). `document.visibilityState` may change to `hidden` for a moment, which a page can observe; a hover menu that closes on `visibilitychange` would close. The second-Ctrl/Cmd+E route captures before detaching, so the still image still shows it open. If the e2e hover fixture shows this closes menus the user expected to stay, the alternative is to keep the view attached and move it off-screen with `setBounds`, which keeps it "visible" to the engine (to be measured in commit 14).
- **IME**: the router passes every key to the page while `before-input-event` reports a composition (025-FR-014); the renderer does the same for its own fields.
- **Tested by** 025-AC-061 to 025-AC-066, 025-AC-071 and 025-AC-073 with the sentinel-key rule of the acceptance file.

## Alternatives considered

### A transparent Erfana view stacked above the page

- **Pros**: Erfana could draw the menu over the live page; no capture.
- **Cons**: the overlay view takes every mouse event in its rectangle (views cannot be click-through), adds a second trusted renderer per tab, and a page-sized transparent Erfana surface is exactly what Security rule 7 guards against imitating.
- **Verdict**: rejected.

### Off-screen rendering of the page

- **Pros**: Erfana paints the page itself, so anything can sit on top.
- **Cons**: software paint path, frame copies through main, input forwarded by hand; far too slow for 025-NFR-004 and a large new attack surface.
- **Verdict**: rejected.

### Key routing in the renderer only

- **Pros**: one place, near the UI.
- **Cons**: with page focus the renderer never sees the keys; the page would get every key first and Erfana could not stop it. 025-FR-054 requires main.
- **Verdict**: rejected.

### `setIgnoreMenuShortcuts` without the macOS edit-role handling

- **Pros**: one call.
- **Cons**: on macOS copy, paste and undo in a web page go through the Edit menu roles; ignoring menu shortcuts would leave them dead (inferred from how Electron dispatches edit roles; checked by 025-AC-061 on macOS).
- **Verdict**: rejected.

## References

- [Electron – webContents](https://www.electronjs.org/docs/latest/api/web-contents) – `before-input-event`, `before-mouse-event`, `setIgnoreMenuShortcuts`, `will-prevent-unload`, `setWindowOpenHandler`
- [Electron – webPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences) – `disableHtmlFullscreenWindowResize`, `safeDialogs`
- `src/main/services/preview/previewInputForward.ts`, `previewLiveBounds.ts`, `PreviewStillFrameCache.ts` – the HTML Preview's forwarding, acknowledged bounds and still frames this builds on
- `docs/design-system/system/foundations/layering.html` – the native view above every `z-index`
