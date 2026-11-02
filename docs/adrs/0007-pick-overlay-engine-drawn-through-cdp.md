# ADR 0007: Pick overlay drawn by the engine through the DevTools protocol

- **Status**: proposed
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-025 to 025-FR-029, 025-FR-033, 025-FR-038, 025-NFR-001, 025-NFR-004 · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 4, § 5 · [ADR 0005](./0005-sub-frame-preload-one-receive-channel.md) (the preload route this ADR does not take) · [ADR 0008](./0008-freeze-with-debugger-pause-after-capture.md) (shares the debugger session) · [design note](../designs/browser/README.md) § Pick overlay and label

## Context

The browser tab opens any site. Pick mode must outline the element under the mouse, show a label next to it, let the user refine to parent and child, and read the element's facts for the capture – in the top page and in every frame, including cross-site frames that run in another process, nested, `srcdoc`, `about:blank`-written and sandboxed frames (025-FR-029). 025-NFR-001 asks for **no Erfana code inside the page**: the browser view has no preload, and anything pick mode needs is driven from the main process; a preload is allowed only as a fallback, and then only send-only and frame-checked as in ADR 0005.

Two further rules shape the choice:

- **Hover must keep reaching the page in pick mode** (025-FR-025, 025-FR-028): the "click Pick element, hover the menu open, click the item" route depends on it. Only the press, release, click, context-menu and drag events are kept from the page.
- **The highlight must follow the mouse within 50 ms** at the 95th percentile (025-NFR-004).

Electron 44 gives the main process three tools that make a preload unnecessary:

- `webContents.debugger` – a DevTools-protocol (CDP) client in main. `sendCommand(method, params, sessionId)` takes a session id, so a flattened auto-attach session reaches child targets (out-of-process frames, workers) over the same connection ([Electron debugger API](https://www.electronjs.org/docs/latest/api/debugger)).
- `before-mouse-event` on `webContents` – emitted before the page receives a mouse event, with the event's type and view coordinates; `preventDefault` keeps that event from the page ([webContents events](https://www.electronjs.org/docs/latest/api/web-contents)).
- The CDP `Overlay` domain – `Overlay.highlightNode` with a `HighlightConfig` whose `showInfo` draws the engine's node-info label. The overlay is painted by the engine above the document, outside the DOM, so it changes no layout and no page script can see it. The domain is marked **experimental** in the protocol definition ([Overlay.pdl](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Overlay.pdl)).

## Decision

**Engine-drawn, main-driven picking with no preload.** One CDP session per browser view, owned by main, does the hit test, the highlight and the reads. The page and its frames run no Erfana code.

1. **One debugger session per view, attached before the first load.** `BrowserCdpSession` (new, `src/main/services/browser/cdp/`) calls `debugger.attach()` when the view is built, then `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`. Each new child target (iframe in another process, dedicated worker, service worker) gets its domains enabled and then `Runtime.runIfWaitingForDebugger`, and receives its own `Target.setAutoAttach`, so nested out-of-process frames attach too. Events are routed by the `sessionId` of the `message` event. The same session feeds the console and network log (025-FR-038) and the freeze (ADR 0008), so there is one CDP client per view.
2. **A fixed allow-list of CDP methods.** `cdpAllowList.ts` (new) is a frozen list of method names; `BrowserCdpSession.send` refuses any other name and a unit test pins the list (solution design § 5). `Runtime.evaluate` and `Runtime.callFunctionOn` take only fixed expressions from code (the hang probe and the React lookup of 025-FR-037), never a string built from page data.
3. **Hit test in main, from `before-mouse-event`.** In pick mode, each `mouseMove` that main sees is hit-tested with `DOM.getNodeForLocation` on the top target. When the hit is the owner element of a frame that runs in another process, main asks the frame's own session with the point moved into the frame's content box (`DOM.getBoxModel` of the owner), and repeats for nested frames. Only one hit test is in flight per view; the latest mouse position wins. The press, release, `contextMenu` and click events get `preventDefault` (the page never sees them, so drags never start); `mouseMove` and `mouseWheel` pass through, so hover content opens and stays and the wheel scrolls.
4. **Not `Overlay.setInspectMode`.** DevTools' inspect mode swallows mouse moves, so hover menus do not open under it (observed DevTools behaviour, to be confirmed by the first e2e test of commit 13), which breaks the pointer-only route of 025-FR-028. It also confirms on its own click, while 025-FR-053 needs Erfana to re-run the hit test at the click point.
5. **Highlight with `Overlay.highlightNode` on the session that owns the node.** `backendNodeId` plus a fixed `HighlightConfig`: `showInfo: true`, `showStyles: false`, `showAccessibilityInfo: false`, `showExtensionLines: false`, a translucent fill from `--color-accent-primary` (resolved at build time) for the content box and transparent padding, border and margin. `Overlay.hideHighlight` clears it. In a frame that runs in another process, the highlight is drawn in that frame's widget and clipped to the frame.
6. **The label is the engine's node-info label.** It shows the tag, `#id` and classes and the box size `W × H` in the engine's own format. The engine elides long class lists itself, so 025-FR-026's exact text ("first three classes, cut to 40 characters") cannot be produced by an engine-drawn label. **This needs an owner choice and a spec change before UI code merges** – see *Owner choice* below.
7. **Focus emulation while picking.** `Emulation.setFocusEmulationEnabled({ enabled: true })` on every frame target when pick mode starts, `false` when it ends (025-FR-025).
8. **The same reads serve refinement and capture.** Parent: `DOM.describeNode` on the node's parent; from a shadow root to its host; from a frame's root element to the owner `<iframe>` through `DOM.getFrameOwner` on the parent's session. The selector chain, frame chain, outer HTML, computed and matched styles, box and layout chain of 025-FR-033 are read with `DOM` and `CSS` methods on the owning session. No method needs page JavaScript except the React lookup.

### Frame kinds

| Frame kind | How it is reached | Supported |
|---|---|---|
| Top document, same-process frames, `srcdoc`, `about:blank` written by script, `<frame>` | Top target; `DOM.getNodeForLocation` returns the node and its `frameId` | Yes |
| Cross-site frame in another process, nested at any depth | Auto-attached `iframe` target, flattened session | Yes |
| Sandboxed frame without `allow-scripts` or `allow-same-origin` | Same as its process placement (in-process, or its own process under Chromium's sandboxed-frame isolation); the DOM and Overlay domains need no page script | Yes; origin recorded as `null` (025-FR-029). The React lookup reports "source not found" because the frame cannot run script |
| Element inside an open or closed shadow root | CDP sees through both | Yes; the closed-root rule of 025-FR-033 applies to the selector chain |
| Content of a plugin or PDF viewer in `<embed>` or `<object>` | Not a page document | **No** – the `<embed>` or `<object>` element itself is picked |
| Content of a `<fencedframe>` | A separate page, not offered as a frame target in the same way (inferred) | **No** – the `<fencedframe>` element itself is picked |
| `<canvas>`, WebGL, video frames | Pixels, not elements | The element is picked; the screenshot gets the crosshair of 025-FR-034 |

The last three rows are a spec change to 025-FR-029 (solution design § 10). Each "Yes" row has an e2e test in the static-site fixture.

### Owner choice: the label

| Option | What the user sees | Spec change |
|---|---|---|
| **A (recommended)** – engine label | Engine-drawn box tint and the engine's label next to the element, in the engine's format (`button.cta.primary.large…  176 × 32`) | 025-FR-026: the label shows the tag, id, classes and size **as the engine formats them**; the 40-character and three-class rules move to the still image, where Erfana draws the label itself |
| B – engine outline, Erfana label in the pick row | `Overlay.highlightQuad` with an accent `outlineColor` and no fill; the exact 025-FR-026 text in the pick row's status slot while hovering (the design's "status echo") | 025-FR-026: the label is shown in the pick row, not next to the element |

Option A keeps the label next to the element, where the eye already is, and matches DevTools, which the team uses daily. Option B keeps the exact text but moves it away from the element. Both keep the two-tone outline of the Element picker card on the still image only, because the engine cannot draw it; the live highlight is a recorded deviation on that card.

## Consequences

- **No Erfana code in the page.** No preload, no isolated-world script, no `webContents.ipc` listener for the browser view. The hostile-page suite (025-NFR-001) can assert that the page has no `window.electron`, no IPC path and no overlay DOM.
- **The engine owns the look of the live highlight.** The design's two-tone outline and its forced-colours lines apply on the still image only; the live highlight follows the engine. A `deviates:` marker on the browser component CSS and a row in the Element picker card's exceptions record it.
- **Dependence on an experimental CDP domain.** `Overlay`, `DOM.getNodeForLocation` and `Emulation.setFocusEmulationEnabled` can change between Chromium versions. Every Electron update (025-NFR-002) runs the pick e2e suite; a failure blocks that update until the session code is fixed.
- **One debugger per view, always attached.** It costs CDP traffic for every mouse move in pick mode and the log domains while browsing. It also means Chromium's own hung-renderer signal cannot be relied on while a client is attached (inferred from Chromium's `WebContentsImpl::RendererUnresponsive`, which returns early when a debugger is attached); 025-FR-056 therefore uses Erfana's own probe (solution design § 6.4).
- **Risk – DevTools and Erfana's debugger at once.** Electron's documentation says the debugger `detach` event fires "when DevTools is invoked for the attached webContents", and [electron/electron#14540](https://github.com/electron/electron/issues/14540) reports the session being dropped when DevTools opens. 025-FR-013 needs both at once. Commit 11 of the solution design starts with an e2e probe: open DevTools, then pick, read and freeze. If the session is detached, `BrowserCdpSession` re-attaches on `detach` (reason other than target closed) and the probe repeats. If re-attaching breaks DevTools, the owner chooses between disabling pick mode while DevTools is open (a spec change to 025-FR-013) and shipping with DevTools taking over the page until it closes.
- **The 50 ms budget is plausible but unmeasured.** Two to four CDP round trips per move on the same machine; the `bench` lane measures it (025-NFR-004). If it misses, the fallback is to hit-test on the top target only and descend into a frame only after the pointer rests for one frame.

## Alternatives considered

### An isolated preload in every frame (the ADR 0005 pattern)

- **Pros**: proven in the HTML Preview; full control over the outline and label look; hover and click handling in the page's own event loop.
- **Cons**: puts Erfana code in every frame of every site the user visits, where the preview only ever runs project files; `about:blank` and `javascript:` frames get no preload (ADR 0005 consequence), so 025-FR-029 could not be met for written frames; the overlay can be fought and erased by the page (`document.open()`); it adds an IPC path from every frame of an arbitrary site. 025-NFR-001 prefers the main-driven route.
- **Verdict**: rejected.

### `Overlay.setInspectMode` (DevTools' own inspect mode)

- **Pros**: the engine does the hit test and the highlight in one call, across frames.
- **Cons**: swallows mouse moves, so hover-only content cannot be opened while picking; confirms on its own click, bypassing Erfana's click guard and re-hit-test (025-FR-047, 025-FR-053).
- **Verdict**: rejected; Erfana does the hit test itself.

### A transparent native view above the page for the outline and label

- **Pros**: Erfana draws the exact look of the Element picker card.
- **Cons**: a native view above the page takes the mouse, so hover and wheel stop reaching the page; making it click-through needs a separate window (`setIgnoreMouseEvents` exists on windows, not views), which cannot be positioned on Wayland.
- **Verdict**: rejected.

## References

- [Electron – debugger](https://www.electronjs.org/docs/latest/api/debugger) – `sendCommand` with `sessionId`; `detach` when DevTools opens
- [Electron – webContents](https://www.electronjs.org/docs/latest/api/web-contents) – `before-mouse-event`, `before-input-event`
- [CDP Overlay domain definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Overlay.pdl) – `highlightNode`, `HighlightConfig.showInfo`, `setInspectMode`; experimental
- [electron/electron#14540](https://github.com/electron/electron/issues/14540) – debugger and DevTools at once
- `src/main/services/preview/previewInputForward.ts` – the existing `before-input-event` pattern this builds on
