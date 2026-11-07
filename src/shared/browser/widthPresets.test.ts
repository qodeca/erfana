// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  WIDTH_PRESETS,
  isDeviceModeOverride,
  presetOverflowsPanel,
  presetViewWidth,
  widthPreset,
  widthPresetRecord,
  type WidthPresetId
} from './widthPresets'

describe('width presets (025-FR-012)', () => {
  it('025-AC-012 has the three labelled presets in toolbar order', () => {
    expect(WIDTH_PRESETS.map(p => p.label)).toEqual(['Phone width (390px)', 'Tablet width (768px)', 'Full width'])
    expect(Object.isFrozen(WIDTH_PRESETS)).toBe(true)
  })

  it('025-AC-012 sets 390 and 768 CSS px, and the panel width at Full width', () => {
    expect(presetViewWidth('phone', 1200)).toBe(390)
    expect(presetViewWidth('tablet', 1200)).toBe(768)
    expect(presetViewWidth('full', 1200)).toBe(1200)
  })

  it('025-AC-012 scrolls horizontally only when the panel is narrower than the preset', () => {
    expect(presetOverflowsPanel('phone', 389)).toBe(true)
    expect(presetOverflowsPanel('phone', 390)).toBe(false)
    expect(presetOverflowsPanel('full', 200)).toBe(false)
  })

  it('025-AC-012 records Full width, not none, at 125% zoom', () => {
    const page = { innerWidth: 960, innerHeight: 600, zoomFactor: 1.25 }
    expect(widthPresetRecord('full', page, 1200)).toEqual({ kind: 'preset', name: 'Full width' })
  })

  it('records none with the page size when DevTools device mode overrides it (025-FR-013)', () => {
    expect(widthPresetRecord('phone', { innerWidth: 412, innerHeight: 915, zoomFactor: 1 }, 1200)).toEqual({
      kind: 'none',
      width: 412,
      height: 915
    })
    expect(isDeviceModeOverride(391, 1, 390)).toBe(false)
    expect(isDeviceModeOverride(391.01, 1, 390)).toBe(true)
  })

  it('refuses an unknown preset id', () => {
    expect(() => widthPreset('watch' as WidthPresetId)).toThrow(/unknown width preset/)
  })
})
