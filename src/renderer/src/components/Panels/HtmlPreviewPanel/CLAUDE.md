# HTML preview panel

The running HTML preview (issue #74): the page renders in a native Electron `WebContentsView` in its own process; this panel renders only the DOM chrome around it. Feature pipeline + threat model live in [docs/html-preview/README.md](../../../../../../docs/html-preview/README.md) and [docs/security.md](../../../../../../docs/security.md) — read those for the asset policy and eligibility rules; this file is the panel-specific gotchas only.

## Native view vs DOM chrome (the load-bearing fact)

The native `WebContentsView` paints ABOVE all sibling DOM in the panel, regardless of z-index. Any DOM that must appear over the running page is invisible unless the native view is hidden first. Two consequences that break if forgotten:

- **The failure badge lives on the tab, not the panel.** `PreviewFailureBadge` is mounted in `HtmlPreviewTab` (`../../Tabs/HtmlPreviewTab.tsx`) — always-DOM tab chrome the view never covers — and subscribes to `usePreviewStore` by `panelId`. Do NOT move it into the panel surface: it would be invisible while the page runs.
- **The badge popover portals to `#portal-root`** and registers a `menu` occluder while open, so the native view hides behind its still frame and the list is readable. Same class of transient DOM-over-preview as the shared `ContextMenu`.

## Occluder guard — never toggle the view directly

`OverlayGuardService` (`../../../services/preview/OverlayGuardService.ts`) is the SINGLE owner of preview show/hide and the ONLY renderer module allowed to call `api.preview.setVisibility` (ESLint-enforced). It computes, PER live preview, `visible = (that panel is the active tab) && !isOccluded()`. Overlays register via `useOccluder(kind, active)` (`../../../hooks/useOccluder.ts`) — kinds `dialog`/`settings`/`toast`/`menu`/`overlay`/`drag`. Opening a dialog, settings, a menu (the badge popover), a full-screen overlay, or switching to another tab all hide the view. Never call `setVisibility` or manipulate the view from a component.

**A toast is the one exception, and it is deliberate** — see "Toasts move, the page does not" below.

**The hide must be SYNCHRONOUS, main-side.** `PreviewLiveView.setVisibility(false)` calls `view.setVisible(false)` in the same tick it is invoked, and starts NO capture at all — still frames are taken while the view is DRAWN (`captureWhileVisible`, off `did-finish-load`), never on the way out. `PreviewViewService.setVisibility` is a pass-through to it for the same reason: there is nothing there to await. A native view takes pointer input over its own rectangle whatever the DOM says, so any wait before the hide leaves an overlay drawn on screen that cannot be clicked. Two sibling tests in `src/main/services/preview/PreviewViewService.test.ts` pin both halves: the hide asserts `expect(capture).not.toHaveBeenCalled()`, and the next one asserts the frame IS captured once the page is ready, while the view is drawn. **Never put I/O in front of `setVisible(false)`.** The ONE legitimate wait is eviction, which hides, then awaits `whenCaptureSettled()` before destroying the `webContents` — otherwise a suspended panel wakes with no picture. **"Never on the way out" is about STARTING a capture, not finishing one.** A capture started while drawn can still settle after the hide and may store its result when the panel has no frame yet (on macOS the first `capturePage` at `'ready'` is always empty, so the 250 ms retry is the only one that produces pixels). The `shouldKeep` veto applies wherever a frame already exists.

**The permission band is a second input to the guard, and it is per panel.** `usePreviewChromeGate` publishes a reason into `stores/usePreviewChromeGateStore.ts`; the guard reads it as a third term (`visible = activeTab && !occluded && gate === null`) and reports `chrome-unconfirmed` / `chrome-too-short`. It is deliberately NOT the occluder store: that one is global, so it would blank the other preview in a split view for a reason belonging to one panel.

- `BaseDialog` calls `useOccluder('dialog', isOpen)` for the occluder count; its separate `isOpen` effect pushes dialog-stack membership (`registerOpenDialog`), which is what needs the raw stack length.
- Occluder counts publish on a `queueMicrotask` flush, so a synchronous unregister→register pair (e.g. a dialog z-index change) coalesces to one notification — no hide/show flap or wasted `capturePage`.

## Find bar insets the view — it is NOT hidden for find

When the search bar opens, the native view's bounds are inset from the top by `SEARCH_BAR_INSET_PX` (48, in `hooks/usePreviewBounds.ts`) so the DOM find bar sits in a strip the view never paints over AND native `findInPage` highlights stay visible in the (shorter) live view. Find deliberately does NOT register an occluder — a still frame can't show live highlights, so the view must stay live.

## Multiple live previews

**Several previews are live at once** (sd-074b D5). `readLivePreviewPanelIds()` in `OverlayGuardService` returns EVERY non-idle, non-suspended panel, and the guard sends visibility per panel, so map iteration order carries no meaning. Never single out "the" live preview by scanning for a first non-idle panel — there is no such thing.

The rule is per panel and has three terms: `visible = (panel is the active tab) && !occluded && gate === null`. It yields at most one `true` only because dockview drag-and-drop is disabled (`EditorAreaSplitPanel.tsx`), which nothing enforces — so `recompute` logs in development if two panels ever compute visible at once. If you re-enable DnD, fix the guard first.

**Suspended is a fourth load state.** Beyond `PREVIEW.MAX_LIVE_VIEWS`, main tears the least recently active view down and emits `suspended`; the panel keeps showing its still frame, and `usePreviewLifecycle` re-opens it when the tab becomes visible again. A suspended panel has no `WebContentsView`, so it must never be sent visibility.

**Limit-reached means "this file is already previewing in another window"**, never "one preview at a time". It is the one surviving refusal, and it exists for a cross-window panel-id collision: ids are derived from the path, so two windows previewing one file mint the same id. That property survives the length budget — a digest-shortened id is still a pure function of the same path, so the two windows still collide.

## Bounds: the first rect is the one that bites

`openFileInPanel` calls dockview's `addPanel` and only then `setActive`, so `usePreviewBounds` first runs while the panel is still an INACTIVE tab — which has a 0x0 box. `deriveBounds` refuses a degenerate rect, so nothing is sent and the native view keeps the 1x1 fallback rect `preview:open` was called with: a view too small to see, sitting over a brand-black placeholder. The symptom is a black panel that only appears once you click around the tabs.

A second race compounds it: `preview:open` is still in flight while the hook mounts, and `PreviewViewService.setBounds` silently DROPS a rect for a panel with no view in the registry. A rect sent that early looks like success in the renderer and vanishes main-side.

The `ResizeObserver` is not a dependable second chance either: dockview re-parents an `always`-rendered panel rather than resizing it in place, so the 0x0 -> laid-out transition need not produce a resize callback at all. `usePreviewBounds` therefore runs an animation-frame pump, armed by `isVisible && isLive`, asking until one real rect goes out (bounded by `FIRST_RECT_FRAME_BUDGET`), then stands down and lets the observer own the steady state. `pushBounds` returns a boolean for exactly that reason. `isLive` is the store load state leaving `'idle'`, which main emits AFTER `registry.install` — the earliest point a rect is not thrown away, which is why the panel reads the store BEFORE calling the hook.

The hook owns EVERY push, including the become-visible one — do not add a `pushBounds()` effect back into the panel. Regression cover: `hooks/usePreviewBounds.test.ts`, plus an e2e test that asserts the real `WebContentsView` has a non-zero rect after an open with no user interaction (`e2e/html-preview-corpus.e2e.ts`). Every other preview test reads the preview's web contents, which loads and runs its scripts perfectly at 0x0 — only the rectangle assertion sees this class of bug.

Every `html-preview-*` e2e spec drives the preview through `HtmlPreviewPage` (`e2e/pages/html-preview.page.ts`) — the corpus spec, the approval spec (`e2e/html-preview-approval.e2e.ts`), the eviction spec (`e2e/html-preview-eviction.e2e.ts`), links and perf. Do NOT re-roll `open()` / `eval()` as a private copy in a new spec. A placeholder is looked up through the panel that owns it (`aria-label="HTML preview of <basename>"`), so an assertion names one preview whether one or four are open.

## Other gotchas

- **Stable empty-failures sentinel.** Falling back to a fresh `[]` INSIDE a `usePreviewStore` selector loops `useSyncExternalStore`. Select the stored array reference and fall back to a module-level `NO_FAILURES` constant OUTSIDE the selector (see `HtmlPreviewTab`); the panel does the same with `panels.get(panelId)` + `?? 'idle'`/`?? null` fallbacks.
- **Forwarded accelerators.** The native view swallows renderer keys, so main forwards exactly `f`/`s`/`w`/`Escape` via `preview:forwardedShortcut`; `usePreviewFindShortcuts` routes them to panel actions. Forwarded Escape must run the provider's `clearHighlights()` + restore focus (matching `SearchBar.handleClose`), not just flip the store flag. **Zoom keys are deliberately NOT forwarded** — the View menu owns them (see below). `PREVIEW_FORWARDED_SHORTCUTS` and `PreviewForwardedShortcutSchema` restate the same vocabulary in two layers and are pinned equal by a test in `previewInputForward.test.ts`.
- **Zoom means the page, not the rectangle.** Host zoom is applied geometrically (`clampAndZoomBounds` multiplies the CSS rect), so without `PreviewViewService` calling `setZoomLevel` on the preview's own webContents, Cmd/Ctrl-+ grows the preview *box* while the text stays at 100% — i.e. the text gets relatively smaller. **The View menu is the only route**: `menu.ts` -> `previewZoomHandler` -> `zoomFocused` picks the focused preview and falls through to the host window otherwise; levels are held per panel in `PreviewViewService` and re-applied after `registry.install`, so a zoom survives suspend/resume. Do not also forward the zoom keys — both paths would fire for one keypress and zoom twice.
- **The external-link consent dialog belongs to the window that asked.** `src/main/ipc/preview/externalLinkConsent.ts` parents the question on the asking window and gates it PER WINDOW. An unowned dialog is not modal, is not raised with the app, and on Windows can sit behind it — a consent question the reader cannot see is a link that silently does nothing. A second activation while a question is open is REFUSED, not queued (a burst of clicks must not become a burst of sequential modals), and so is a click whose window has gone. Every refusal arrives here as a `blocked-link` badge, as does an OS hand-off the shell rejects (no registered handler for `mailto:` / `tel:` — the ordinary Windows outcome).
- **A refusal label comes from `confinePath`'s reason; `rawHref` only refines the label, never the decision.** Chromium collapses `../` past the root BEFORE main sees `href`, so a link that climbed out of the project arrives as a clean in-root path that is merely `missing` — the raw attribute is what separates `path-escape` from `missing-local-file`. Because it is only a label, `previewLinkBridge` caps `rawHref` at 2048 with `.catch(undefined)`: an over-long one is DROPPED and the activation still routes on the confined path. Never promote it to an input of the decision.
- **Empty-badge cleanup.** `PreviewFailureBadge` force-closes when `summary.count` hits 0, in an effect that runs BEFORE its `count === 0` early return — otherwise an open popover's `useOccluder('menu', open)` never releases and the view stays stuck behind its still frame. Keep that effect above the early return (hook ordering).
- **The preview toolbar.** `.erf-band` (`components/PreviewChromeBand.tsx`) is always-DOM and sits ABOVE `.html-preview-page-area` as a flow sibling in a flex column, never absolute, and its height is never restated as a constant in `usePreviewBounds.ts`. Layout subtracts it: the placeholder's own box already excludes the bar at whatever height it happens to be, which is what lets it grow (the permission band opening its list) with no code change. Keep it that way — an absolute bar means two numbers only a comment keeps in step. The find bar keeps `SEARCH_BAR_INSET_PX` because it is still an overlay *inside* the page area. It is styled as a toolbar, matching `.markdown-toolbar` — 1px `var(--color-border-default)` under it, carrying Find and the permission chip, and no provenance label or accent seam (owner decision; `docs/security.md` residual risk 8 records the widened residual). What is load-bearing is structural: the bar renders unconditionally (never gated on something being blocked), it never scrolls with the page, and it stays a flow sibling above the page area — that is what keeps Erfana's own security question ("Approve this host?") in a region the page provably cannot paint, given that a toast leaves an untrusted page on screen while the question is asked.

## The backdrop is a state machine, not a constant

**The invariant: the DOM placeholder's background and the native view's `setBackgroundColor` always carry the same value.** Break either half and the seam flashes at the view's edge on every bounds update. The state machine itself, and why one constant cannot serve, is documented in `src/main/services/preview/previewBackdrop.ts`.

Three things here look like they could be simplified and cannot:

- **`did-stop-loading`, never `did-finish-load`.** Chromium scopes start/stop loading to *any* document in the frame tree but `did-finish-load` to the *primary main frame's* `onload`. Pair them and one lazily-loaded `<iframe>` flips the backdrop back to chrome with nothing to flip it forward: unreadable for good. `did-stop-loading` also covers a failed or cancelled load, which matters because `window.stop()` is page-callable.
- **A reload must NOT repaint chrome.** `setBackgroundColor` is not deferred to the next paint. During a reload the old document is still on screen, so repainting dark under it flashes the page dark on every autosave. Only the first load has nothing to lose.
- **Page colour, not forced white.** White breaks any page shipping `color-scheme: dark` — light text on white, the same bug mirrored.

The listeners are siblings of `did-finish-load` in `previewViewLifecycle.ts`, **outside `schedulePipeline()`** on purpose: that pipeline is rate-limited and drops events during a save burst, which would strand the backdrop in the chrome phase.

## Toasts move, the page does not

A toast moves out of a live preview's way instead of hiding it, and that is not cosmetic: `ToastContext` forces `duration: 0` on an actionable toast, so a toast that hid previews would hide them **indefinitely** for the preview's own blocked-host prompt ("Approve this host?") — a toast raised by the preview, hiding the preview, with no auto-dismiss.

`usePreviewBounds` publishes each live view's CSS-pixel rect into `stores/usePreviewViewportStore.ts`, and the pure `Toast/toastPlacement.ts` picks the first position clear of them (stay put → slide right → slide left → rise above). `ToastNotification` applies the offset as a `transform`.

- **`useOccluder('toast', …)` lives in `ToastNotification`, not `ToastContext`, and registers only when placement returns `blocked`.** That keeps the guard kind-blind and needs no `isOccluded({ except })`, and it **fails safe**: nothing fits ⇒ hide every preview, so a consent prompt can never sit under an untrusted page.
- **The published rect is keyed on visible + live, NOT on occlusion.** Occlusion is the guard's output and placement is one of its inputs; keying on visibility would make the toast hide the view, the hidden view withdraw its rect, the toast unhide the view, every frame.
- **Measure at decision time.** `.toast-container` is `position: fixed`, so a window resize moves it without changing its box and no `ResizeObserver` fires. Read `getBoundingClientRect()` when computing, and recompute on `window.resize` too.
- **Clear the rect on hide and on unmount.** A rect left behind permanently displaces every toast — which looks exactly like the bug this machinery exists to fix.

## The permission band, and the fail-safe under it

`components/PreviewChromeBand.tsx` is where a host permission is asked: it is both the preview's chrome bar and its approve prompt, and there is no separate approve toast. Read `design/system/components/permission-band/index.html` (`status="decided"`) before changing it — the stylesheet lives in `components/PreviewChromeBand.css` and is synced back into `design/` by `scripts/design-sync.mjs`, so **edit the `src/` copy**.

**Never draw a button a page could be sitting on top of.** The previewed page paints above all sibling DOM and takes input over its own rectangle whatever the DOM says. Opening the host list claims space the page held a frame ago, so:

1. The list renders at its **full height with the rows `visibility: hidden`**. Layout reserved, nothing painted, nothing hit-testable, nothing in the a11y tree.
2. That growth moves the placeholder, so the bounds pump pushes with `{ ack: true }`.
3. `PreviewLiveView.confirmRepaint` answers from isolated world 997 (a page cannot shadow `rAF`).
4. On the ack the rows become visible. `visibility` changes no layout, so there is no second push and no loop.
5. On a 300 ms timeout the page is **hidden** and the band says why.

Three traps, each of which looks like a simplification:

- **`display: none` or conditional rendering instead of `visibility: hidden`** removes the height — which removes the growth the page is meant to react to. No rows, no growth, nothing to prove, no rows. `opacity: 0` keeps the height but still hit-tests, so a click lands on an invisible control that grants a permission.
- **Asking a hidden page to prove anything.** A hidden page never repaints, so it can never ack. `provenInset()` returns `Infinity` while hidden for exactly this reason.
- **Re-arming the deadline per push.** A resize drag pushes every frame, so a per-push timer would postpone the fail-safe for as long as the mouse is held. The epoch keys on the *inset*; its deadline is absolute.

`unconfirmed` is **sticky** until the reader collapses the list. A page that yields at 310 ms would otherwise un-pause and re-pause, a flap whose timing the untrusted page controls.

**A permission is an ORIGIN — scheme, host and port.** `parsePreviewOrigin`
(`src/shared/ipc/preview-settings-schema.ts`) is the single canonicaliser AND the
definition of validity: a value is valid exactly when it already is what that
function returns. Never build one from `URL.origin` —
`new URL('blob:https://evil.com/1').origin` is a clean-looking `https://evil.com`
with an empty hostname, and `.origin` silently drops userinfo. The accessible
name of a row always carries the whole origin.

**A row without an Allow button states its reason, and the reason is DERIVED**
from the origin (`describeRefusal`), never assumed.

There is no policy refusal (#108): `localhost`, IP literals, `.local` and
single-label names are all approvable. Do not add one back. Exactly two shapes
reach a buttonless row, both mechanical rather than policy: an IPv6 literal (a
CSP host-source cannot express one) and a name that is not a valid host name.

**A trailing dot is part of the origin**, not noise to normalise away: a CSP
host-source matches only its own spelling, so `evil.com.` and `evil.com` are two
separate grants that never match each other. The dot is kept by the canonicaliser
and DRAWN by `HostName`, because two grants that render identically in a
permission list is a spoof. Rationale and measurements:
`docs/designs/108-http-and-ipv6-in-the-preview.md`.

**The blocked-host list is bounded main-side**, at `PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW` (50, matching the CSP bridge), with a per-hostname sub-cap of `PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST` (5). Without the sub-cap a page fetching `http://localhost:1..50` exhausts the budget before main reports the real blocked CDN — dropped, not merely buried. `PreviewViewService.onBlocked` also returns when `mergeBlockedKinds` reports no change — without that, a page pulling forty assets from one host sent forty identical events. The dedupe ledger is **cleared by `applyApprovedHosts`**: the reload after an approval refuses the remaining hosts all over again, and a ledger that survived it would swallow every one of them while the failure log they would have appeared in has just been emptied.
