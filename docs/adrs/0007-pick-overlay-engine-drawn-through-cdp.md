# ADR 0007: Pick overlay drawn by the engine through the DevTools protocol

- **Status**: proposed – revised 2026-11-02 after the expert panel (`.local/panel/design-025-adr/`); acceptance waits for the engine-probe commit (solution design § 13, commit 8)
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-025 to 025-FR-029, 025-FR-033, 025-FR-038, 025-NFR-001, 025-NFR-004 · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 4, § 5, § 11 Q1–Q2 · [ADR 0005](./0005-sub-frame-preload-one-receive-channel.md) · [ADR 0008](./0008-freeze-with-debugger-pause-after-capture.md) · [design note](../designs/browser/README.md) § Pick overlay and label

## Context

Pick mode must outline the element under the mouse, label it, refine to parent and child, and read its facts – in the top page and in every frame, including cross-site frames in another process, nested, `srcdoc`, `about:blank`-written and sandboxed frames (025-FR-029). 025-NFR-001 asks for no Erfana code inside the page. Hover must keep reaching the page in pick mode (025-FR-025, 025-FR-028), and the highlight must follow the mouse within 50 ms at p95 (025-NFR-004).

Electron 44 gives main three tools:

- `webContents.debugger` – a CDP client; `sendCommand(method, params, sessionId)` reaches flattened child sessions ([Electron debugger](https://www.electronjs.org/docs/latest/api/debugger)). Its `detach` event fires "when DevTools is invoked for the attached webContents".
- `before-mouse-event` – emitted before the page receives a mouse event; `preventDefault` keeps the event from the page. Its `MouseInputEvent` carries view `x`/`y` and screen `globalX`/`globalY` ([webContents](https://www.electronjs.org/docs/latest/api/web-contents)).
- The CDP `Overlay` domain, **experimental** ([Overlay.pdl](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Overlay.pdl)): `highlightNode` with `showInfo`, and `highlightQuad` / `highlightRect` with a fill and an outline colour.

## Decision

**Engine-drawn, main-driven picking with no preload**, one CDP session per view.

1. **Session.** `BrowserCdpSession` attaches when the view is built and sends `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })` (fixed parameters). Each child target gets its always-on domains sent **without awaiting each reply**, then `Runtime.runIfWaitingForDebugger`, and its own `setAutoAttach` for nested frames. Popups get a session of the **popup kind**, which has no pick, overlay or freeze methods (§ 5 of the solution design).
2. **Domains only when needed.** Always on, every target: `Runtime` (console, exceptions, hang probe) and `Log`; `Network` only if the commit-8 probe shows `Log.entryAdded` (source `network`) cannot carry 025-FR-038's failed requests, and then with a bounded request-id map and zero body buffers. `DOM`, `CSS` and `Overlay` are enabled when pick mode starts and disabled when it ends; `Page` only where dialogs need it (ADR 0011). Console objects are released (`Runtime.releaseObjectGroup`, `Runtime.discardConsoleEntries`) after each entry is copied into the log buffer.
3. **Flood budget.** Per target, at most 200 events and 1 MB of event payload per second; over budget, `Runtime` and `Log` are disabled for that target until the next navigation and the capture notes "logs truncated" (spec change S-14). `DOM.getDocument` is never called with `depth: -1`. Outer HTML is read by `Runtime.callFunctionOn` in an **isolated world** (`Page.createIsolatedWorld`) with a fixed function that cuts the string in the page to 20,001 UTF-16 units before it crosses the protocol (spec change S-14).
4. **Hit test in main, from screen coordinates.** `before-mouse-event` may fire per frame widget, so an out-of-process frame's events can carry frame-local `x`/`y` (inferred). Main therefore uses `globalX`/`globalY` minus the view's screen origin, then `DOM.getNodeForLocation({ x, y, ignorePointerEventsNone: false })` on the top target – the element the user's click would hit – descending into out-of-process frames through the owner's content quad (`DOM.getContentQuads`, so transformed iframes work). One hit test in flight; the latest position wins. Outside pick mode the mouse router returns at once except for the click guard and the activation tracker.
5. **Not `Overlay.setInspectMode`** – it swallows mouse moves (hover menus would not open) and confirms on its own click. Commit 8 keeps a probe that shows this.
6. **The live highlight.** `Overlay.highlightNode` on the owning session, fixed `HighlightConfig`: `showInfo: true`, `showStyles: false`, `showAccessibilityInfo: false`, `showExtensionLines: false`, a low-alpha accent content fill and an opaque contrasting padding and margin band. In forced-colours mode (`nativeTheme.inForcedColorsMode`) the colours come from the system highlight colour. The engine cannot draw the Element picker card's two-tone outline; whether the decided Focus card allows a fill for the live highlight is owner question Q2.
7. **The label (owner question Q1).** Recommended (the UX panel's view): option A – the engine label next to the element, **plus** the exact 025-FR-026 text from `src/shared/browser/elementLabel.ts` echoed in the pick row's status slot when it has room, replacing the banner's later clauses while hovering. The engine label scales with page zoom, not with Erfana's own zoom, and the engine places it; the echo is the stable, exact form and is what tests assert (a hook returns the requested node and box; one `capturePage` pixel check proves the live paint).
8. **Crosshair.** Commit 8 probes `webContents.insertCSS('* { cursor: crosshair !important }', { cssOrigin: 'user' })` and whether it reaches frames; if it does not, the crosshair shows over the frame and still image only (spec change S-11).
9. **Focus emulation** (`Emulation.setFocusEmulationEnabled`) on every frame target while pick mode is on, turned off at **every** pick end.
10. **Reads.** Refinement and the 025-FR-033 facts use `DOM` and `CSS` on the owning session; the React lookup is the only main-world call (`Runtime.callFunctionOn`, fixed function identity, `userGesture: false`, `awaitPromise: false`, `throwOnSideEffect: true`).
11. **DevTools coexistence** is proved by the commit-8 probe, not assumed. If opening DevTools detaches Erfana's session and re-attaching breaks DevTools, the recommended answer to Q5 is: pick mode is unavailable while DevTools is open, with the note "Close DevTools to pick", and a pick in progress ends with "DevTools took over – nothing was sent" (spec change S-9, screen change).

### Frame kinds

| Frame kind | Supported |
|---|---|
| Top document, same-process frames, `srcdoc`, script-written `about:blank`, `<frame>` | Yes |
| Cross-site frame in another process, nested, transformed | Yes (auto-attach; owner quad) |
| Sandboxed without `allow-scripts` / `allow-same-origin` | Yes; origin `null`; React lookup reports "source not found" |
| Open or closed shadow root | Yes; closed-root rule of 025-FR-033 |
| Plugin or PDF content in `<embed>` / `<object>`; `<fencedframe>` content | No – the host element is picked (spec change S-2) |
| `<canvas>`, WebGL, video | The element; crosshair in the screenshot |

## Consequences

- No Erfana code in the page except fixed read functions run by CDP in an isolated world or, for React, in the main world – both main-driven (S-14 records it in the spec).
- The live highlight follows the engine's look; the card's two-tone outline is drawn on the still image only (Q2).
- `Overlay`, `DOM.getFrameOwner`, `DOM.getContentQuads` and `Emulation.setFocusEmulationEnabled` are experimental (`DOM.getNodeForLocation` is not); the probes of commit 8 stay as regression tests and run on every Electron update pull request.
- `Runtime.enable` is detectable by pages (a known automation tell), which can lower the odds of 025-FR-024's best-effort Google sign-in; accepted, since 025-FR-038 needs console events.
- Chromium's hung-renderer signal is suppressed while a debugger is attached (inferred); 025-FR-056 uses Erfana's probe.

## Alternatives considered

- **Isolated preload in every frame (ADR 0005 pattern)** – full control of the look, but Erfana code in every frame of every site, no preload in `about:blank` frames, and a page can fight or erase it. Rejected.
- **`Overlay.setInspectMode`** – swallows hover and confirms by itself. Rejected.
- **Outline-only via `highlightQuad` / `highlightRect` (no engine label)** – gives an outline that fits the Focus card but no label next to the element; kept as option B of Q2.
- **A transparent native view above the page** – takes the mouse from the page; a click-through window cannot be positioned on Wayland. Rejected.

## References

- [Electron – debugger](https://www.electronjs.org/docs/latest/api/debugger), [webContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [CDP Overlay](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Overlay.pdl)
- [electron/electron#14540](https://github.com/electron/electron/issues/14540) – debugger and DevTools at once
- `src/main/services/preview/previewInputForward.ts` – the `before-input-event` pattern
