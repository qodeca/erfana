// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The native surface of the live pick outline (`pickBand.ts`; ADR 0007
 * decision 6, amended 2026-11-05): a borderless, transparent child window
 * of the page's window that holds {@link BAND_STRIP_COUNT} plain `View`s,
 * one per strip, each a solid colour. It has no `webContents`, so no
 * renderer process, no page and no script.
 *
 * - **No mouse input.** `setIgnoreMouseEvents(true)` is set before the
 *   window is first shown: Electron documents that "all mouse events
 *   happened in this window will be passed to the window below this
 *   window" (macOS, Windows, and X11 and Wayland on Linux). Hover, clicks
 *   and wheel over the band reach the page beneath it.
 * - **No keyboard input.** `focusable: false`, and it is only ever shown
 *   with `showInactive()`: it never takes focus, and the same Electron note
 *   says keys reach an ignoring window only while it has focus.
 * - **Why a child window, not views in the page's window.** Electron 44 has
 *   no way to let a `View` pass the mouse through (electron/electron#53841
 *   is still open), and a view drawn over the page view takes the mouse at
 *   its pixels; a plain view's background is drawn beneath the page's
 *   native surface (electron/electron#34329).
 * - **Not on Wayland.** A Wayland compositor places top-level windows
 *   itself, so a child window cannot be put over the element
 *   ({@link canPlaceBandWindow}); there the engine's one-colour outline is
 *   kept (`pickHighlight.ts`).
 */
import { BaseWindow, View } from 'electron'
import type { Box } from './pickGeometry'
import { BAND_STRIP_COUNT, type BandHostEvents, type BandStrip, type BandSurface } from './pickBand'
import type { OutlinePair } from './pickOutlineColours'

/** The window's colour where no strip is: fully transparent (`#AARRGGBB`). */
const TRANSPARENT = '#00000000'

/**
 * Whether a child window can be placed on this platform: not under a
 * Wayland compositor. `ozonePlatform` is the `--ozone-platform` switch
 * (empty when not given); without it, Electron's default `auto` picks Wayland
 * in a Wayland session (inferred from Electron's ozone-platform-hint default).
 */
export function canPlaceBandWindow(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>, ozonePlatform: string): boolean {
  if (platform !== 'linux') return true
  if (ozonePlatform === 'x11') return true
  if (ozonePlatform === 'wayland') return false
  return env.XDG_SESSION_TYPE !== 'wayland' && (env.WAYLAND_DISPLAY ?? '') === ''
}

/** The parent's events the surface follows. */
const MOVED = ['move', 'restore', 'show'] as const
const HIDDEN = ['minimize', 'hide'] as const

/**
 * Open the band's window over `parent`. It starts hidden; the band shows
 * it at its first draw.
 */
export function openBandWindow(parent: BaseWindow, events: BandHostEvents): BandSurface {
  const window = new BaseWindow({
    parent,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: TRANSPARENT,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    hiddenInMissionControl: true,
    title: ''
  })
  window.setIgnoreMouseEvents(true)
  const views: View[] = []
  for (let i = 0; i < BAND_STRIP_COUNT; i++) {
    const view = new View()
    view.setVisible(false)
    window.contentView.addChildView(view)
    views.push(view)
  }
  const listeners: Array<[string, () => void]> = [
    ...MOVED.map((name): [string, () => void] => [name, () => events.moved()]),
    ...HIDDEN.map((name): [string, () => void] => [name, () => events.hidden()]),
    ['closed', () => destroy()]
  ]
  for (const [name, listener] of listeners) parent.on(name as 'move', listener)
  let bounds: Box | null = null

  function destroy(): void {
    for (const [name, listener] of listeners.splice(0)) parent.removeListener(name as 'move', listener)
    if (!window.isDestroyed()) window.destroy()
    events.closed()
  }

  return {
    draw(next: Box, strips: readonly BandStrip[], colours: OutlinePair): void {
      if (window.isDestroyed()) return
      if (bounds === null || !sameBox(bounds, next)) {
        window.setBounds(next)
        bounds = next
      }
      views.forEach((view, i) => {
        const strip = strips[i]
        if (strip === undefined) return view.setVisible(false)
        view.setBackgroundColor(colours[strip.tone])
        view.setBounds(strip.rect)
        view.setVisible(true)
      })
      if (!window.isVisible()) window.showInactive()
    },
    hide(): void {
      if (!window.isDestroyed()) window.hide()
    },
    destroy
  }
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
