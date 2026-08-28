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
- **`hooks/`** — one concern each: `usePreviewLifecycle` (`preview:open`/`close`, the limit-reached/failed signals, and the re-open of a suspended preview when its tab becomes visible), `usePreviewEvents` (store updates), `usePreviewBounds` (ResizeObserver bounds pump), `usePreviewFindShortcuts` (forwarded accelerators).
- **`components/`** — presentational chrome only (`PreviewBanner`, `PreviewFallback`, `PreviewFailureBadge`).
- **`HtmlPreviewPanel.tsx`** — glue: wires hooks to chrome, holds no decision logic.

**Several previews are live at once** (sd-074b D5). `readLivePreviewPanelIds()` in `OverlayGuardService` returns EVERY non-idle, non-suspended panel, and the guard sends visibility per panel. Map iteration order no longer matters — the old "first non-idle panel IS the live preview" scan is gone.

The rule per panel is unchanged: `visible = (panel is the active tab) && !occluded`. That yields exactly one `true` only because dockview drag-and-drop is disabled (`EditorAreaSplitPanel.tsx`), which nothing enforces — so `recompute` logs in development if two panels ever compute visible at once. If you re-enable DnD, fix the guard first.

**Suspended is a fourth load state.** Beyond `PREVIEW.MAX_LIVE_VIEWS`, main tears the least recently active view down and emits `suspended`; the panel keeps showing its still frame, and `usePreviewLifecycle` re-opens it when the tab becomes visible again. A suspended panel has no `WebContentsView`, so it must never be sent visibility.

**Limit-reached now means "open in another window".** The refusal survives only for a cross-window panel-id collision (ids are path-derived, so two windows previewing one file mint the same id). It is not a "one preview at a time" message any more.

## Other gotchas

- **Stable empty-failures sentinel.** Falling back to a fresh `[]` INSIDE a `usePreviewStore` selector loops `useSyncExternalStore`. Select the stored array reference and fall back to a module-level `NO_FAILURES` constant OUTSIDE the selector (see `HtmlPreviewTab`); the panel does the same with `panels.get(panelId)` + `?? 'idle'`/`?? null` fallbacks.
- **Forwarded accelerators.** The native view swallows renderer keys, so main forwards `f`/`s`/`w`/`Escape` via `preview:forwardedShortcut`; `usePreviewFindShortcuts` routes them to panel actions. Forwarded Escape must run the provider's `clearHighlights()` + restore focus (matching `SearchBar.handleClose`), not just flip the store flag.
- **Empty-badge cleanup.** `PreviewFailureBadge` force-closes when `summary.count` hits 0, in an effect that runs BEFORE its `count === 0` early return — otherwise an open popover's `useOccluder('menu', open)` never releases and the view stays stuck behind its still frame. Keep that effect above the early return (hook ordering).
- **Placeholder colour** is `var(--color-brand-black)`, matching main's `setBackgroundColor('#FF161312')`, so the hidden-with-no-frame fallback is never a blank rectangle.
