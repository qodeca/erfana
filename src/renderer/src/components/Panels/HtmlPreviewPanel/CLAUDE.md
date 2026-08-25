# HTML preview panel

The running HTML preview (issue #74): the page renders in a native Electron `WebContentsView` in its own process; this panel renders only the DOM chrome around it. Feature pipeline + threat model live in [docs/html-preview/README.md](../../../../../../docs/html-preview/README.md) and [docs/security.md](../../../../../../docs/security.md) — read those for the asset policy and eligibility rules; this file is the panel-specific gotchas only.

## Native view vs DOM chrome (the load-bearing fact)

The native `WebContentsView` paints ABOVE all sibling DOM in the panel, regardless of z-index. Any DOM that must appear over the running page is invisible unless the native view is hidden first. Two consequences that break if forgotten:

- **The failure badge lives on the tab, not the panel.** `PreviewFailureBadge` is mounted in `HtmlPreviewTab` (`../../Tabs/HtmlPreviewTab.tsx`) — always-DOM tab chrome the view never covers — and subscribes to `usePreviewStore` by `panelId`. Do NOT move it into the panel surface: it would be invisible while the page runs (tech-debt #37, resolved).
- **The badge popover portals to `#portal-root`** and registers a `menu` occluder while open, so the native view hides behind its still frame and the list is readable. Same class of transient DOM-over-preview as the shared `ContextMenu`.

## Occluder guard — never toggle the view directly

`OverlayGuardService` (`../../../services/preview/OverlayGuardService.ts`) is the SINGLE owner of preview show/hide and the ONLY renderer module allowed to call `api.preview.setVisibility` (ESLint-enforced). It computes `visible = (live preview is the active tab) && !isOccluded()`. Overlays register via `useOccluder(kind, active)` (`../../../hooks/useOccluder.ts`) — kinds `dialog`/`settings`/`toast`/`menu`/`overlay`/`drag`. Opening a dialog, settings, toast, menu (the badge popover), a full-screen overlay, or switching to another tab all hide the view. Never call `setVisibility` or manipulate the view from a component.

- `BaseDialog` pushes the occluder count from its `isOpen` effect, NOT via `useOccluder` (it needs the raw stack length, not a boolean).
- Occluder counts publish on a `queueMicrotask` flush, so a synchronous unregister→register pair (e.g. a dialog z-index change) coalesces to one notification — no hide/show flap or wasted `capturePage`.

## Find bar insets the view — it is NOT hidden for find

When the search bar opens, the native view's bounds are inset from the top by `SEARCH_BAR_INSET_PX` (48, in `hooks/usePreviewBounds.ts`) so the DOM find bar sits in a strip the view never paints over AND native `findInPage` highlights stay visible in the (shorter) live view. Find deliberately does NOT register an occluder — a still frame can't show live highlights, so the view must stay live.

## Structure — glue panel, pure logic, single-purpose hooks

Mirrors the `ImageViewerPanel` split:

- **`htmlPreview.logic.ts`** — every decision as a pure function (`deriveBounds`, `selectPanelView`, `selectFallback`, `summarizeFailures`); no React, no `window.api`, no store. Unit-tested in isolation.
- **`hooks/`** — one concern each: `usePreviewLifecycle` (`preview:open`/`close` + limit-reached/failed signals), `usePreviewEvents` (store updates), `usePreviewBounds` (ResizeObserver bounds pump), `usePreviewFindShortcuts` (forwarded accelerators).
- **`components/`** — presentational chrome only (`PreviewBanner`, `PreviewFallback`, `PreviewFailureBadge`).
- **`HtmlPreviewPanel.tsx`** — glue: wires hooks to chrome, holds no decision logic.

**Single-live-view invariant**: only one preview is ever live. `readLivePreviewPanelId()` (in `OverlayGuardService`) returns the first non-`idle` panel in `usePreviewStore` — correct only under this invariant; a future multi-preview change must not rely on `Map` iteration order there.

## Other gotchas

- **Stable empty-failures sentinel.** Falling back to a fresh `[]` INSIDE a `usePreviewStore` selector loops `useSyncExternalStore`. Select the stored array reference and fall back to a module-level `NO_FAILURES` constant OUTSIDE the selector (see `HtmlPreviewTab`); the panel does the same with `panels.get(panelId)` + `?? 'idle'`/`?? null` fallbacks.
- **Forwarded accelerators.** The native view swallows renderer keys, so main forwards `f`/`s`/`w`/`Escape` via `preview:forwardedShortcut`; `usePreviewFindShortcuts` routes them to panel actions. Forwarded Escape must run the provider's `clearHighlights()` + restore focus (matching `SearchBar.handleClose`), not just flip the store flag.
- **Empty-badge cleanup.** `PreviewFailureBadge` force-closes when `summary.count` hits 0, in an effect that runs BEFORE its `count === 0` early return — otherwise an open popover's `useOccluder('menu', open)` never releases and the view stays stuck behind its still frame. Keep that effect above the early return (hook ordering).
- **Placeholder colour** is `var(--color-brand-black)`, matching main's `setBackgroundColor('#FF161312')`, so the hidden-with-no-frame fallback is never a blank rectangle.
