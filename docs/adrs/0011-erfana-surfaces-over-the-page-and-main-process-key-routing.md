# ADR 0011: Erfana surfaces around and over the page view, and key routing in the main process

- **Status**: accepted (owner decision, 2026-11-03) – revised 2026-11-02 after the expert panel; decision 7 amended 2026-11-03 for the engine-probe results of commit 8 (native page dialogs in v1, owner decision Q6)
- **Date**: 2026-11-03
- **Deciders**: Marcin Obel (owner), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-011, 025-FR-012, 025-FR-014, 025-FR-019, 025-FR-030, 025-FR-031, 025-FR-047 to 025-FR-054, 025-FR-057, 025-FR-058, 025-FR-065 · [design note](../designs/browser/README.md) § Anatomy, § Key-routing states made visible · [Layering card](../design-system/system/foundations/layering.html) · [ADR 0007](./0007-pick-overlay-engine-drawn-through-cdp.md) · [ADR 0008](./0008-freeze-with-debugger-pause-after-capture.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 4, § 7

## Context

A `WebContentsView` is composited above the window's own renderer, so no Erfana DOM – toast, dialog, settings, context menu, command palette – can draw over a live page (Layering card). The HTML Preview solves this with `OverlayGuardService` (the single owner of preview show and hide, driven by the occluder store), `toastPlacement` (reads preview rectangles) and still frames. 025-FR-054 forbids drawing inside the page's document.

While the page has focus, keys go to the page's process; 025-FR-047 to 025-FR-052 define five routing states and 025-FR-054 requires routing in main with `before-input-event`. On macOS, Cmd+Q, Cmd+H, Cmd+Option+H and Cmd+M are application-menu roles.

## Decision

### Surfaces

1. **Three zones.** Above the page: Erfana DOM only (navigation row, reserved pick row, find row, strip rows). Page area: the native view inside a 4 px frame drawn in DOM in the gutter outside the view. Over the page area: only a still image.
2. **One guard for every native view** (before any browser UI ships). `OverlayGuardService` is generalised from preview views to all native views – preview and browser – with one visibility API per kind; `toastPlacement`'s `readPreviewRects` becomes `readNativeViewRects`; the drag freeze and the window-edge resize hold apply to browser views too. Any app overlay (toast, dialog, settings, context menu, command palette, full-screen image) therefore swaps the browser view for its still image exactly as for a preview. An e2e test opens Settings and a toast over a browser tab and checks both are visible.
3. **How the page leaves the screen.**
   - **Pick menu, instruction dialog, right-click menu, toolbar menus and suggestions that cross the page area**: the view is **moved off-screen** with `setBounds` (outside the window's content area) after the still image has painted, so the engine keeps it visible and focused – no `visibilitychange`, hover content stays open. Commit 8 probes that an off-screen view keeps `document.visibilityState === 'visible'` on all three platforms; if not, detach is used and the consequence is recorded. A toolbar menu over the page area must open within 100 ms including the capture (`bench`).
   - **Hidden tabs** (another editor tab active): the view is **detached** (`removeChildView`), never kept off-screen, so hidden tabs cost no compositing.
   - **Return**: the view is put back at its acked bounds and the still image is dropped after two presented frames (the delay is measured in commit 8), so there is no flash of an old frame.
4. **Strip rows push the view in one step**; main records each shift for the click guard. **While a pick menu or dialog is open, new site requests are held** and the pick row shows a "1 site request waiting" chip; they enter the strip when the menu or dialog closes (spec change S-28), so the page area never shifts under the still image.
5. **The pick row is always reserved**; Erfana pages (empty tab, certificate, load-error, crashed) are DOM in the page area with the view detached.
6. **Width presets wider than the panel**: the view sits inside a parent `View` whose bounds are the page area, which clips it; the view is offset by Erfana's horizontal scroll position and the Erfana scrollbar is DOM under the area. An e2e test checks that no page pixel is drawn outside the panel.
7. **Page dialogs – native in v1 (owner decision Q6, 2026-11-03).** The commit-8 probe showed Electron always opens its own box for `alert` and `confirm`, even when a CDP client answers the dialog through `Page.handleJavaScriptDialog`, and that `prompt()` throws with no event. Replacing the native dialogs would need a patched Electron, which adds a fork to the 14-day security duty (025-NFR-002). So v1 ships the native dialogs (spec change S-10, accepted). Erfana still turns `Page` on to learn that a dialog is open, so the hang probe is suspended and a page blocked on a dialog is never reported as "not responding"; `safeDialogs: true` gives the native box a "prevent more dialogs" checkbox (`src/main/services/browser/dialogs/pageDialogs.ts`). `beforeunload` goes through `will-prevent-unload` (Leave repeats the action with a one-shot `preventDefault`). Quitting Erfana does not ask (spec change S-31). `window.print` and the media-capture end signal have no route (spec change S-32, accepted).
8. **Full screen fills the page area**: `disableHtmlFullscreenWindowResize: true` in the view settings (spec change S-3). Not reachable in pick mode.
9. **Popups** are Erfana windows of their own **kind** (`browserPopup`), loading a separate renderer entry with a minimal preload; the IPC registry checks each channel against the allow-list of the sender's window kind (`main`, `screenshotOverlay`, `browserPopup`), so a popup host can reach only the `browser-tab:popup*` channels. The page view is created through `setWindowOpenHandler`'s `createWindow` (keeps `window.opener`) and has its own popup-kind CDP session. All page-requested `left`/`top` are ignored and `content-bounds-updated` is prevented and re-clamped (spec change S-22). The window gets a dark `backgroundColor`, shows on first paint, and grows by the strip's height so the requested content size is the page's.
10. **Focus rules.** While the dialog is open, the tab's other zones are `inert`; while the menu is open they stay live and a click there closes it. Strip rows do not take focus on arrival, with the two exceptions the design note fixes: the sign-in box after a navigation the user started, and the leave-page prompt (focus on **Stay**) because it answers the user's own action; page dialogs take focus only when their tab is active and focus is already in the page.

### Keys and mouse

11. **One router per page view in main** (`browserKeyRouter.ts`): per key-down, page / erfana / drop, from the tab's routing state, the frozen flag and the IME flag; matching by produced character with physical-code fallback, from `src/shared/browser/browserKeys.ts`. When a key-down is consumed or dropped, its **auto-repeats and matching key-up** are dropped too.
12. **macOS application roles from the page.** `setIgnoreMenuShortcuts(true)` while the view is focused; the router itself performs Cmd+C, V, X, A, Z, Shift+Z (`copy()` … `redo()`), Cmd+Q (the app's graceful quit path), Cmd+H (`app.hide()`), Cmd+Option+H (hide others) and Cmd+M (minimise the window).
13. **Menu, dialog and toolbar states** run in Erfana's renderer (`useBrowserKeys`). The renderer reports "toolbar focus in browser tab N" to main, and a `before-input-event` on Erfana's own window applies the browser keys there with `preventDefault`, so the app menu's reload or zoom never acts on Erfana while a browser toolbar has focus.
14. **Reserved keys** (tab switching, focus-panel shortcuts, F6) are forwarded to the renderer as named actions. A probe in commit 8 checks whether Tab from the page's last focusable element leaves the view; F6 is the documented route either way (tooltip and user guide).
15. **Esc in full screen or pointer lock** exits it and is consumed.
16. **Mouse.** `before-mouse-event` applies the 500 ms click guard after a row shift (press and its release dropped; in pick mode the note "The page moved – click again"). The **first-click rule** applies only when keyboard focus came from **outside the browser tab** (the renderer reports where focus came from), never from the tab's own toolbar; a click it drops shows the same note. The popup blocker's activation tracker counts only presses the page actually received.

## Consequences

- Toasts and app dialogs work over browser tabs from the first browser commit, through the same guard as previews.
- Off-screen views keep painting while a menu or dialog is open (cost while open only); hidden tabs cost nothing.
- Popup host windows reach only their own channels.
- Tested by 025-AC-014, 025-AC-061 to 025-AC-066, 025-AC-071, 025-AC-073 through the main-side input harness (solution design § 12).

## Alternatives considered

- **A transparent Erfana view above the page** (or a menu-sized overlay view) – takes the mouse in its rectangle and adds a trusted surface the page could imitate. Rejected.
- **Off-screen rendering** – far too slow for 025-NFR-004. Rejected.
- **Key routing in the renderer only** – with page focus the renderer never sees keys. Rejected.
- **Detach for pick menus** – the engine marks the page hidden, which can close hover content and fire `visibilitychange`. Kept as the fallback of decision 3.
- **Popup host as a full Erfana window** – would trust it on every channel. Rejected.

## References

- [Electron – webContents](https://www.electronjs.org/docs/latest/api/web-contents), [webPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)
- `src/renderer/src/services/preview/OverlayGuardService.ts`, `src/renderer/src/hooks/useOccluder.ts`, `src/renderer/src/components/Toast/toastPlacement.ts`, `src/renderer/src/stores/usePreviewViewportStore.ts`
- `src/main/services/preview/previewInputForward.ts`, `previewLiveBounds.ts`, `previewResizeHold.ts`, `PreviewStillFrameCache.ts`

## Probe results (commit 8, 2026-11-03)

Electron 44.9.3, macOS 27.2 (Darwin 27.2.0, arm64), `e2e/browser-engine-probes.e2e.ts`, 5 runs each, all consistent. Playwright is attached as a second CDP client to every page in these runs. Recorded for the owner's acceptance decision. On 2026-11-03 the owner accepted this ADR and decision 7 was amended to match (native dialogs, Q6). Linux and Windows are not yet probed.

| Probe | Result | Bears on |
|---|---|---|
| View moved off-screen with `setBounds` | Stays `visible`, keeps painting (10 frames), no `visibilitychange` | Decision 3 confirmed on macOS |
| View detached with `removeChildView` | **Also stays `visible` and keeps painting**, no `visibilitychange` | Decision 3's "hidden tabs cost no compositing" is not shown; a detached tab still runs animation frames |
| Still-image drop delay (re-attach → second animation frame, 25 samples) | 4–35 ms, worst 35 ms | Decision 3: two frames ≈ 35 ms worst case on this machine; rAF is a proxy for "presented" |
| Overlay highlight in `capturePage` | Present; gone after `hideHighlight` | Hide before every still image |
| Page dialogs with `Page.enable` | `alert`/`confirm` raise `Page.javascriptDialogOpening` with `hasBrowserHandler: true`; `handleJavaScriptDialog` answers the page, **but Electron also opens its own box** (macOS `sheet-begin` on the window, no `sheet-end` after the CDP answer). `prompt()` throws, with no event | Decision 7 cannot replace native dialogs: owner question Q6 applies |
| `window.print()` | Blocks the page's script; no `webContents` event, no sheet on the window | S-32: no route for Erfana; the hang probe must not report it as a hang |
| Camera capture stop (fake device, granted) | No `webContents` event at start or stop | S-32: no end signal; the in-use indicator ends at navigation or tab close |
| Tab from the last focusable element | Wraps to the first element **inside the page** (`blur`, window `blur`/`focus`, then focus on the first); focus never leaves the view | Decision 14: F6 is the only route out |

**Windows (2026-11-08).** Electron 44.9.3, Windows 11 Pro (x64), the same spec, 1 run: every probe passes. A view detached with `removeChildView` stays `visible` with no `visibilitychange`, but – as on Linux under xvfb – it draws no animation frame until it is attached again, so decision 3's "hidden tabs cost no compositing" holds on Windows. The page-dialog probe checks the window-sheet event on macOS only, so that part of its row is not probed here.
