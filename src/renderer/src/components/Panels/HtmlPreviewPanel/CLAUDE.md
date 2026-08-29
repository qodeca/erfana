# HTML preview panel

The running HTML preview (issue #74): the page renders in a native Electron `WebContentsView` in its own process; this panel renders only the DOM chrome around it. Feature pipeline + threat model live in [docs/html-preview/README.md](../../../../../../docs/html-preview/README.md) and [docs/security.md](../../../../../../docs/security.md) — read those for the asset policy and eligibility rules; this file is the panel-specific gotchas only.

## Native view vs DOM chrome (the load-bearing fact)

The native `WebContentsView` paints ABOVE all sibling DOM in the panel, regardless of z-index. Any DOM that must appear over the running page is invisible unless the native view is hidden first. Two consequences that break if forgotten:

- **The failure badge lives on the tab, not the panel.** `PreviewFailureBadge` is mounted in `HtmlPreviewTab` (`../../Tabs/HtmlPreviewTab.tsx`) — always-DOM tab chrome the view never covers — and subscribes to `usePreviewStore` by `panelId`. Do NOT move it into the panel surface: it would be invisible while the page runs (tech-debt #37, resolved).
- **The badge popover portals to `#portal-root`** and registers a `menu` occluder while open, so the native view hides behind its still frame and the list is readable. Same class of transient DOM-over-preview as the shared `ContextMenu`.

## Occluder guard — never toggle the view directly

`OverlayGuardService` (`../../../services/preview/OverlayGuardService.ts`) is the SINGLE owner of preview show/hide and the ONLY renderer module allowed to call `api.preview.setVisibility` (ESLint-enforced). It computes, PER live preview, `visible = (that panel is the active tab) && !isOccluded()`. Overlays register via `useOccluder(kind, active)` (`../../../hooks/useOccluder.ts`) — kinds `dialog`/`settings`/`toast`/`menu`/`overlay`/`drag`. Opening a dialog, settings, toast, menu (the badge popover), a full-screen overlay, or switching to another tab all hide the view. Never call `setVisibility` or manipulate the view from a component.

- `BaseDialog` pushes the occluder count from its `isOpen` effect, NOT via `useOccluder` (it needs the raw stack length, not a boolean).
- Occluder counts publish on a `queueMicrotask` flush, so a synchronous unregister→register pair (e.g. a dialog z-index change) coalesces to one notification — no hide/show flap or wasted `capturePage`.

## Find bar insets the view — it is NOT hidden for find

When the search bar opens, the native view's bounds are inset from the top by `SEARCH_BAR_INSET_PX` (48, in `hooks/usePreviewBounds.ts`) so the DOM find bar sits in a strip the view never paints over AND native `findInPage` highlights stay visible in the (shorter) live view. Find deliberately does NOT register an occluder — a still frame can't show live highlights, so the view must stay live.

## Structure — glue panel, pure logic, single-purpose hooks

Mirrors the `ImageViewerPanel` split:

- **`htmlPreview.logic.ts`** — every decision as a pure function (`deriveBounds`, `selectPanelView`, `selectFallback`, `summarizeFailures`); no React, no `window.api`, no store. Unit-tested in isolation.
- **`hooks/`** — one concern each: `usePreviewLifecycle` (`preview:open`/`close`, the limit-reached/failed signals, and the re-open of a suspended preview when its tab becomes visible), `usePreviewEvents` (store updates), `usePreviewBounds` (bounds pump), `usePreviewFindShortcuts` (forwarded accelerators).
- **`components/`** — presentational chrome only (`PreviewBanner`, `PreviewFallback`, `PreviewFailureBadge`).
- **`HtmlPreviewPanel.tsx`** — glue: wires hooks to chrome, holds no decision logic.

**Several previews are live at once** (sd-074b D5). `readLivePreviewPanelIds()` in `OverlayGuardService` returns EVERY non-idle, non-suspended panel, and the guard sends visibility per panel. Map iteration order no longer matters — the old "first non-idle panel IS the live preview" scan is gone.

The rule per panel is unchanged: `visible = (panel is the active tab) && !occluded`. That yields exactly one `true` only because dockview drag-and-drop is disabled (`EditorAreaSplitPanel.tsx`), which nothing enforces — so `recompute` logs in development if two panels ever compute visible at once. If you re-enable DnD, fix the guard first.

**Suspended is a fourth load state.** Beyond `PREVIEW.MAX_LIVE_VIEWS`, main tears the least recently active view down and emits `suspended`; the panel keeps showing its still frame, and `usePreviewLifecycle` re-opens it when the tab becomes visible again. A suspended panel has no `WebContentsView`, so it must never be sent visibility.

**Limit-reached now means "open in another window".** The refusal survives only for a cross-window panel-id collision (ids are path-derived, so two windows previewing one file mint the same id). It is not a "one preview at a time" message any more.

## Bounds: the first rect is the one that bites

`openFileInPanel` calls dockview's `addPanel` and only then `setActive`, so `usePreviewBounds` first runs while the panel is still an INACTIVE tab — which has a 0x0 box. `deriveBounds` refuses a degenerate rect, so nothing is sent and the native view keeps the 1x1 fallback rect `preview:open` was called with: a view too small to see, sitting over a brand-black placeholder. The symptom is a black panel that only appears once you click around the tabs.

A second race compounds it: `preview:open` is still in flight while the hook mounts, and `PreviewViewService.setBounds` silently DROPS a rect for a panel with no view in the registry. A rect sent that early looks like success in the renderer and vanishes main-side.

The `ResizeObserver` is not a dependable second chance either: dockview re-parents an `always`-rendered panel rather than resizing it in place, so the 0x0 -> laid-out transition need not produce a resize callback at all. `usePreviewBounds` therefore runs an animation-frame pump, armed by `isVisible && isLive`, asking until one real rect goes out (bounded by `FIRST_RECT_FRAME_BUDGET`), then stands down and lets the observer own the steady state. `pushBounds` returns a boolean for exactly that reason. `isLive` is the store load state leaving `'idle'`, which main emits AFTER `registry.install` — the earliest point a rect is not thrown away, which is why the panel reads the store BEFORE calling the hook.

The hook owns EVERY push, including the become-visible one — do not add a `pushBounds()` effect back into the panel. Regression cover: `hooks/usePreviewBounds.test.ts`, plus an e2e test that asserts the real `WebContentsView` has a non-zero rect after an open with no user interaction (`e2e/html-preview-corpus.e2e.ts`). Every other preview test reads the preview's web contents, which loads and runs its scripts perfectly at 0x0 — only the rectangle assertion sees this class of bug.

## Other gotchas

- **Stable empty-failures sentinel.** Falling back to a fresh `[]` INSIDE a `usePreviewStore` selector loops `useSyncExternalStore`. Select the stored array reference and fall back to a module-level `NO_FAILURES` constant OUTSIDE the selector (see `HtmlPreviewTab`); the panel does the same with `panels.get(panelId)` + `?? 'idle'`/`?? null` fallbacks.
- **Forwarded accelerators.** The native view swallows renderer keys, so main forwards `f`/`s`/`w`/`Escape` via `preview:forwardedShortcut`; `usePreviewFindShortcuts` routes them to panel actions. Forwarded Escape must run the provider's `clearHighlights()` + restore focus (matching `SearchBar.handleClose`), not just flip the store flag.
- **Empty-badge cleanup.** `PreviewFailureBadge` force-closes when `summary.count` hits 0, in an effect that runs BEFORE its `count === 0` early return — otherwise an open popover's `useOccluder('menu', open)` never releases and the view stays stuck behind its still frame. Keep that effect above the early return (hook ordering).
- **Placeholder colour** is `var(--color-brand-black)`, matching main's `setBackgroundColor('#FF161312')`, so the hidden-with-no-frame fallback is never a blank rectangle.
