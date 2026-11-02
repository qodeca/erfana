# ADR 0008: Freeze with `Debugger.pause`, after the capture and the source hints

- **Status**: proposed
- **Date**: 2026-11-02
- **Deciders**: Marcin Obel (owner, pending), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-013, 025-FR-028, 025-FR-053, 025-FR-056, 025-FR-065 · [ADR 0007](./0007-pick-overlay-engine-drawn-through-cdp.md) (the debugger session this reuses) · [ADR 0011](./0011-erfana-surfaces-over-the-page-and-main-process-key-routing.md) (the still image) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 6

## Context

A pick by the second Ctrl/Cmd+E is how a keyboard user picks hover-only content: the menu that the page opened on hover must stay as it is while Erfana's prompt-actions menu and dialog are open. 025-FR-028 defines **frozen**: the page's JavaScript and timers in every frame do not run; input that arrives while frozen is dropped, never replayed; the screen shows the still image taken at the pick; the hang monitor does not report a frozen page. 025-FR-053 fixes the order – the capture is taken at the pick while the page still runs, the source hints run from that moment for at most 750 ms, and the page freezes as soon as they finish. It leaves one question to this ADR: whether the React lookup of a refined element can still run while frozen. 025-FR-013 adds that resuming the page from the DevTools debugger counts as closing the menu or dialog without sending.

Three CDP mechanisms can stop a page:

| Mechanism | What stops | Main-world calls while stopped | Visible to the page |
|---|---|---|---|
| `Debugger.pause` | All JavaScript in that target's isolate: the next statement, timer callback, event handler or promise job breaks before it runs | Yes – `Runtime.evaluate`, `Runtime.callFunctionOn`, `DOM` and `CSS` keep working, as they do in DevTools while paused | No |
| `Emulation.setScriptExecutionDisabled` | New script execution; behaviour for already-queued timers and promise jobs is not documented | Not reliably | Pages can observe that scripts no longer run |
| `Page.setWebLifecycleState({ state: 'frozen' })` (experimental) | Freezable task queues (timers, loading callbacks) per the Page Lifecycle model | No – evaluation is queued behind the frozen queues (inferred) | Yes – the page receives a `freeze` event and runs its handler first; Chromium also marks the page hidden (inferred from Chromium's page handler) |

## Decision

1. **Freeze with `Debugger.pause` on every frame target of the view.** `BrowserFreeze` (new, `src/main/services/browser/cdp/browserFreeze.ts`) sends `Debugger.enable` and then `Debugger.pause` to the top target and every attached `iframe` target. Workers keep running; 025-FR-028 names frames only.
2. **The Debugger domain is on only while frozen.** It is enabled at the freeze and disabled (`Debugger.disable`, which also resumes) at the unfreeze, so a `debugger;` statement in a page never stops it while browsing, and no `scriptParsed` traffic flows the rest of the time. No `Overlay.setPausedInDebuggerMessage` is ever sent, so the engine draws no "Paused in debugger" banner.
3. **The order at a second-Ctrl/Cmd+E pick** (025-FR-053):
   1. Re-run the hit test at the last mouse position (ADR 0007).
   2. `Overlay.hideHighlight` on every session, then `webContents.capturePage()` – one retry when the image comes back empty (the macOS case that `PreviewStillFrameCache` already handles).
   3. Read the 025-FR-033 fields and snapshot the 025-FR-038 ring buffers.
   4. Hide the native view and show the still image with the menu (ADR 0011). Interval (a) of 025-NFR-005 ends here.
   5. Start the source hints (025-FR-037) with their 750 ms limit.
   6. When they finish or time out: `Debugger.enable` + `Debugger.pause` on every frame target. When every target has acknowledged the commands, main tells the renderer, and the "Page paused" chip appears (025-FR-065).
   A pick by click, Enter or **Pick this element** runs steps 1 to 5 and never step 6.
4. **Unfreeze** on every exit 025-FR-065 lists (Esc in the menu, Esc or Cancel in the dialog, a send, a navigation, hiding or closing the tab, a crash): `Debugger.resume` then `Debugger.disable` on every target, in that order, ignoring errors from targets that went away.
5. **DevTools resume ends the menu.** A `Debugger.resumed` event that Erfana did not cause while the freeze is on (the user pressed Resume in the DevTools window) is reported to the renderer as "closed without sending" (025-FR-013).
6. **Main-world calls while frozen are allowed.** Because `Debugger.pause` leaves evaluation working, refinement while frozen runs the full source-hint order of 025-FR-037, including the React lookup – the clause of 025-FR-053 that depends on this ADR resolves to "allowed". The lookup uses a fixed function and, where the protocol accepts it, `throwOnSideEffect: true`, so a page getter that writes state aborts the lookup instead of running (to be confirmed in commit 15's test; without it the lookup still runs, only reading fiber fields).
7. **Input while frozen is dropped twice over.** The native view is hidden behind the still image, so it receives no input; and `before-input-event` and `before-mouse-event` call `preventDefault` for a frozen view as a second guard (input is never queued, so nothing is replayed at resume).
8. **The hang probe skips a frozen view.** 025-FR-056 is served by Erfana's own probe (solution design § 6.4), which does not run while `BrowserFreeze` holds the view.

## Consequences

- **A pending pause on an idle page is still a freeze.** When no JavaScript is running, `Debugger.pause` breaks before the next statement; a timer that fires is stopped before its first statement. 025-AC-028's test drives a timer-based fixture and asserts that its counter does not advance.
- **"Page paused" means the commands were acknowledged**, not that a `Debugger.paused` event arrived – on an idle page that event only comes when JavaScript next tries to run.
- **CSS animations and video keep running** under the still image, as the spec allows.
- **The freeze shares the risk of ADR 0007 about DevTools.** If opening DevTools detaches Erfana's session, the freeze is lost with it; the same commit-11 probe decides, and a lost session while frozen is handled as "closed without sending".
- **A frame that attaches while frozen** (a frame the page was inserting at the pick) is paused at attach: `waitForDebuggerOnStart` holds it, and `BrowserFreeze` sends `Debugger.enable` + `Debugger.pause` before `Runtime.runIfWaitingForDebugger`.

## Alternatives considered

### `Emulation.setScriptExecutionDisabled`

- **Pros**: one call; no debugger domain.
- **Cons**: its effect on queued timers and promise jobs is not documented; the page can notice; no event tells Erfana when a DevTools user lifted it, so 025-FR-013's resume rule has no hook; main-world calls while disabled are unreliable.
- **Verdict**: rejected.

### `Page.setWebLifecycleState({ state: 'frozen' })`

- **Pros**: the Page Lifecycle "frozen" state is the web platform's own notion of a frozen page; timers and loading stop.
- **Cons**: the page sees a `freeze` event and runs code at the moment it is frozen; the page is marked hidden, which can close hover menus that listen to visibility – the opposite of what the second Ctrl/Cmd+E is for; evaluation for refinement would queue behind the frozen task queues; experimental.
- **Verdict**: rejected.

### Freeze first, capture after

- **Pros**: the capture and the frozen page agree exactly.
- **Cons**: the source hints need the page running (025-FR-053), and freezing before the screenshot adds the freeze round trips to interval (a) of 025-NFR-005.
- **Verdict**: rejected; capture, hints, then freeze, as 025-FR-053 orders.

## References

- [CDP Page domain definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl) – `setWebLifecycleState` is experimental, states `frozen` and `active`
- [Page Lifecycle API](https://developer.chrome.com/blog/page-lifecycle-api) – the `freeze` event a frozen page receives
- `src/main/services/preview/PreviewStillFrameCache.ts` – the empty-first-capture retry this reuses
