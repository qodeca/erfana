// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Viewport width presets (spec 025, 025-FR-012, 025-FR-013, 025-FR-033;
 * naming contract "Width presets").
 *
 * A preset sets the page view's width in CSS pixels at 100% zoom; it never
 * turns on device emulation. Full width follows the panel. The context file
 * records the preset's name, or `none` when DevTools device mode overrides
 * the page size (025-FR-013).
 */

export type WidthPresetId = 'phone' | 'tablet' | 'full'

export interface WidthPreset {
  readonly id: WidthPresetId
  /** The toolbar label (naming contract). */
  readonly label: string
  /** The name the context file records. */
  readonly recordName: 'Phone width' | 'Tablet width' | 'Full width'
  /** Width in CSS pixels, or `null` for the panel's width. */
  readonly width: number | null
}

/** The presets in toolbar order. */
export const WIDTH_PRESETS: readonly WidthPreset[] = Object.freeze([
  Object.freeze({ id: 'phone', label: 'Phone width (390px)', recordName: 'Phone width', width: 390 }),
  Object.freeze({ id: 'tablet', label: 'Tablet width (768px)', recordName: 'Tablet width', width: 768 }),
  Object.freeze({ id: 'full', label: 'Full width', recordName: 'Full width', width: null })
] as const)

export const DEFAULT_WIDTH_PRESET: WidthPresetId = 'full'

/** The tolerance of the device-mode check, in CSS pixels (025-FR-013). */
export const DEVICE_MODE_TOLERANCE_PX = 1

export function widthPreset(id: WidthPresetId): WidthPreset {
  const preset = WIDTH_PRESETS.find(p => p.id === id)
  if (preset === undefined) throw new Error(`unknown width preset: ${String(id)}`)
  return preset
}

/** The page view's width in CSS pixels for a preset in a panel `panelWidth` wide. */
export function presetViewWidth(id: WidthPresetId, panelWidth: number): number {
  return widthPreset(id).width ?? panelWidth
}

/** True when the panel is narrower than the preset, so the panel scrolls horizontally. */
export function presetOverflowsPanel(id: WidthPresetId, panelWidth: number): boolean {
  return presetViewWidth(id, panelWidth) > panelWidth
}

/**
 * True when DevTools device mode overrides the page size: the page's
 * `innerWidth` times the zoom factor differs by more than 1 px from the width
 * Erfana set (025-FR-013).
 */
export function isDeviceModeOverride(innerWidth: number, zoomFactor: number, setWidth: number): boolean {
  return Math.abs(innerWidth * zoomFactor - setWidth) > DEVICE_MODE_TOLERANCE_PX
}

/** What the context file records for the preset (025-FR-033). */
export type WidthPresetRecord =
  | { readonly kind: 'preset'; readonly name: WidthPreset['recordName'] }
  | { readonly kind: 'none'; readonly width: number; readonly height: number }

/**
 * The preset record for the context file: the preset's name, or `none` with
 * the size the page reports when device mode overrides it.
 */
export function widthPresetRecord(
  id: WidthPresetId,
  page: { readonly innerWidth: number; readonly innerHeight: number; readonly zoomFactor: number },
  panelWidth: number
): WidthPresetRecord {
  const setWidth = presetViewWidth(id, panelWidth)
  if (isDeviceModeOverride(page.innerWidth, page.zoomFactor, setWidth)) {
    return { kind: 'none', width: page.innerWidth, height: page.innerHeight }
  }
  return { kind: 'preset', name: widthPreset(id).recordName }
}
