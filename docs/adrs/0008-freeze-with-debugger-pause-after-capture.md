# ADR 0008: Freeze with `Debugger.pause`, after the capture and the source hints

- **Status**: accepted (owner decision, 2026-11-03) – revised 2026-11-02 after the expert panel; decision 3 amended 2026-11-03 for the engine-probe results of commit 8 (it uses its fallback)
- **Date**: 2026-11-03
- **Deciders**: Marcin Obel (owner), Claude Code
- **Related**: [spec 025](../../specs/spec-t4-025-built-in-browser/requirements/02-requirements.md) 025-FR-013, 025-FR-028, 025-FR-053, 025-FR-056, 025-FR-065 · [ADR 0007](./0007-pick-overlay-engine-drawn-through-cdp.md) · [ADR 0011](./0011-erfana-surfaces-over-the-page-and-main-process-key-routing.md) · [solution design](../../specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md) § 6

## Context

A pick by the second Ctrl/Cmd+E keeps hover-only content as it is while Erfana's menu and dialog are open. 025-FR-028 defines frozen: no JavaScript or timers in any frame, input dropped and never replayed, the still image on screen, no hang report. 025-FR-053 orders capture, then source hints (≤ 750 ms), then freeze, and asks whether the React lookup can run while frozen. 025-FR-013: resuming from the DevTools debugger counts as closing without sending.

| Mechanism | Stops | Main-world calls while stopped | Page can tell |
|---|---|---|---|
| `Debugger.pause` | All JS in the target's isolate, before the next statement | Not on an idle page: the first call pauses inside itself (commit-8 probe); only after `Debugger.paused` has arrived | No |
| `Emulation.setScriptExecutionDisabled` | New script runs; queued timers undocumented | Unreliable | Yes |
| `Page.setWebLifecycleState('frozen')` (experimental) | Freezable task queues | No (queued, inferred) | Yes – `freeze` event; page marked hidden (inferred) |

## Decision

1. **`Debugger.pause` on every frame target** of the view; workers keep running. `Debugger` is enabled only at the freeze and disabled at the unfreeze, so page `debugger;` statements never stop browsing; no `Overlay.setPausedInDebuggerMessage` is sent.
2. **Order** at a second-Ctrl/Cmd+E pick: confirm the highlighted node (re-hit-test only after a row shift – spec change S-29); hide the highlight and take the screenshot; show the menu over the still image (solution design § 6.1 stage budget); run the source hints for ≤ 750 ms; then `Debugger.enable` + `Debugger.pause` on every frame target. "Page paused" appears when every target has acknowledged.
3. **No page function runs while frozen (the fallback, decided 2026-11-03).** Commit 8's probe paused an idle page and then ran `Runtime.callFunctionOn`: it **hangs** in both worlds, because Erfana's call is the first script to run and pauses inside itself (`Debugger.paused` arrives with it). The fallback therefore applies: the capture reads everything it may need – the facts of every element that Up and Down can reach, and the source hints – **before** `Debugger.pause`, and Erfana calls no page function until the unfreeze. While frozen, a refined element's hints come from its source attributes only and the React lookup reports "source not found" (025-FR-053's own fallback; its clause "unless ADR 0008's freeze mechanism allows main-world calls while frozen" resolves to "not allowed"). Once a `Debugger.paused` event has arrived, a further call answers in under 1 ms (probe), but Erfana does not rely on that. Every page function uses `throwOnSideEffect: true`, so a page getter that writes state aborts the lookup. Code: `src/main/services/browser/pick/pickFreeze.ts`, `cdp/cdpPickFunctions.ts`.
4. **Unfreeze** on every exit of 025-FR-065: `Debugger.resume`, then `Debugger.disable`, errors from vanished targets ignored.
5. **DevTools resume** – a `Debugger.resumed` that Erfana did not cause ends the menu or dialog without sending (025-FR-013). If DevTools is open while frozen, its Sources panel jumps to the paused location; accepted and noted in the user guide.
6. **Input while frozen** is dropped twice: the view is off-screen behind the still image (ADR 0011) and both input routers `preventDefault` for a frozen view, including the matching key-up and release.
7. **Audio is muted while frozen** (`webContents.setAudioMuted(true)`, restored after), so a paused page under a still image is silent (additive behaviour, spec note S-33).
8. **The hang probe** skips a frozen view, a view with a JavaScript dialog or `beforeunload` pending, and hidden tabs (ADR 0011).
9. **Shared renderer processes.** Chromium can put same-site tabs and popups in one renderer process; pausing one view's isolate then also stops those pages (inferred). The e2e suite opens a same-site popup and records what happens; the spec notes it (S-25).

## Consequences

- A pending pause on an idle page is a freeze; "Page paused" means the commands were acknowledged.
- CSS animations and video keep running under the still image, muted.
- The freeze shares ADR 0007's DevTools risk; a lost session while frozen is "closed without sending".
- A frame attaching while frozen is paused before `runIfWaitingForDebugger`.

## Alternatives considered

- **`Emulation.setScriptExecutionDisabled`** – undocumented for queued work, observable, no resume hook. Rejected.
- **`Page.setWebLifecycleState('frozen')`** – the page runs a `freeze` handler and may close the hover menu on hide; evaluation queues. Rejected.
- **Freeze before capture** – the hints need a running page, and it adds round trips to the 500 ms interval. Rejected.

## References

- [CDP Page](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl) – `setWebLifecycleState` experimental
- [Page Lifecycle API](https://developer.chrome.com/blog/page-lifecycle-api)
- `src/main/services/preview/PreviewStillFrameCache.ts` – empty-first-capture retry

## Probe results (commit 8, 2026-11-03)

Electron 44.9.3, macOS 27.2 (Darwin 27.2.0, arm64), `e2e/browser-engine-probes.e2e.ts`, 5 runs each, all consistent. Playwright is attached as a second CDP client to every page in these runs. Recorded for the owner's acceptance decision. On 2026-11-03 the owner accepted this ADR and decision 3 was amended to use its fallback.

| Probe | Result | Bears on |
|---|---|---|
| Idle page, `Debugger.pause` pending, then `Runtime.callFunctionOn` | **Hangs in either world** (main and isolated): Erfana's call is the first script to run and pauses inside itself; `Debugger.paused` arrives with it | Decision 3: "a pending pause on an idle page" is not enough – the first lookup triggers the pause |
| Same page once `Debugger.paused` has arrived | A further `callFunctionOn` answers in 0.3–0.4 ms | Decision 3's 100 ms budget holds once actually paused |
| Timer page, after `Debugger.paused` | Main world 0.4–0.5 ms, isolated world 0.2–0.3 ms | Decision 3 holds |
| Outer-HTML cut with `throwOnSideEffect: true` | Passes, main and isolated world | Decision 3's "every call uses `throwOnSideEffect`" is workable for this read |
| `window.print` (see ADR 0011) | Blocks the page; the hang probe's `Runtime.evaluate('0')` gets no answer | Decision 8: a print in progress reads as a hang |
