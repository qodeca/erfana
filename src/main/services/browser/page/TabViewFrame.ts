// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A browser tab's page view in its window (spec 025, 025-FR-007, 025-FR-012;
 * ADR 0011 decisions 3 and 6): shown, hidden and placed for the tab's width
 * preset.
 *
 * - **Pushes.** The renderer's `bounds` pushes carry a sequence number; one
 *   older than the last applied is dropped, as the preview does.
 * - **Hidden tabs keep their page** (025-FR-007): hidden – or a rectangle
 *   that clamps to nothing – takes the view out of the window; it is never
 *   destroyed.
 * - **The clipping parent** (ADR 0011 decision 6): the page view sits inside
 *   a parent `View` whose bounds are the page area, so a preset wider than
 *   the panel is cut at the panel's edges. Without one (unit tests), the page
 *   view goes straight into the window.
 * - **Presets** (025-FR-012): {@link TabViewFrame.setPreset} re-places the
 *   view at once from the last push, without waiting for the renderer.
 *
 * The page's top edge in DIP is tracked for the click guard: a move while
 * shown is reported (025-FR-047).
 */
import type { WidthPresetId } from '../../../../shared/browser/widthPresets'
import type { RectLike } from '../../preview/previewBoundsClamp'
import { placePageView, type PagePlacement, type PagePush } from './widthPresetLayout'

/** The part of an Electron `View` the frame places. */
export interface PlaceableView {
  setBounds(bounds: RectLike): void
}

/** The clipping parent: an Electron `View` that holds the page view. */
export interface ClipView extends PlaceableView {
  addChildView(view: never): void
}

/** The window the frame lives in. */
export interface FrameHost {
  isDestroyed(): boolean
  getContentBounds(): { width: number; height: number }
  readonly contentView: { addChildView(view: never): void; removeChildView(view: never): void }
  readonly webContents: { getZoomFactor(): number }
}

export interface TabViewFrameDeps {
  readonly host: FrameHost
  readonly view: PlaceableView
  /** The clipping parent; `null` puts the page view straight into the window. */
  readonly clip: ClipView | null
  /** The view went into (true) or out of (false) the window. */
  readonly onShown: (shown: boolean) => void
  /** A shown page's top edge moved (a row above it appeared or went). */
  readonly onPageMoved: () => void
}

export class TabViewFrame {
  private attached = false
  private lastSeq = -1
  private last: (PagePush & { readonly visible: boolean }) | null = null
  private preset: WidthPresetId = 'full'
  private placed: PagePlacement | null = null

  constructor(private readonly deps: TabViewFrameDeps) {
    deps.clip?.addChildView(deps.view as never)
  }

  /** The tab's width preset (025-FR-012). */
  get widthPreset(): WidthPresetId {
    return this.preset
  }

  /** Whether the view is in its window now. */
  isAttached(): boolean {
    return this.attached
  }

  /** Where the clipping parent and the page view are now, in DIP; `null` while hidden. */
  placement(): PagePlacement | null {
    return this.attached ? this.placed : null
  }

  /**
   * Apply the renderer's push. A push older than the last applied is
   * dropped.
   *
   * @returns whether the page is shown after the push, or `null` when the
   *   push was dropped (stale, or the window is gone)
   */
  push(push: PagePush, seq: number, visible: boolean): boolean | null {
    if (seq <= this.lastSeq) return null
    this.lastSeq = seq
    this.last = { bounds: push.bounds, clip: push.clip, visible }
    return this.apply()
  }

  /** Change the preset and re-place the view from the last push. */
  setPreset(preset: WidthPresetId): void {
    if (preset === this.preset) return
    this.preset = preset
    if (this.last !== null) this.apply()
  }

  /** Take the view out of the window; the page keeps running. */
  detach(): void {
    this.placed = null
    if (!this.attached) return
    this.attached = false
    this.deps.onShown(false)
    const host = this.deps.host
    if (!host.isDestroyed()) host.contentView.removeChildView(this.topView() as never)
  }

  private apply(): boolean | null {
    const host = this.deps.host
    const last = this.last
    if (last === null || host.isDestroyed()) return null
    const placed = last.visible
      ? placePageView(last, this.preset, host.getContentBounds(), host.webContents.getZoomFactor())
      : null
    if (placed === null) {
      this.detach()
      return false
    }
    const movedFrom = this.placed?.view.y ?? null
    this.placed = placed
    if (this.deps.clip === null) {
      this.deps.view.setBounds(placed.view)
    } else {
      this.deps.clip.setBounds(placed.clip)
      this.deps.view.setBounds(placed.viewInClip)
    }
    if (movedFrom !== null && movedFrom !== placed.view.y) this.deps.onPageMoved()
    if (!this.attached) {
      host.contentView.addChildView(this.topView() as never)
      this.attached = true
      this.deps.onShown(true)
    }
    return true
  }

  /** What goes into the window: the clipping parent, or the page view without one. */
  private topView(): PlaceableView {
    return this.deps.clip ?? this.deps.view
  }
}
