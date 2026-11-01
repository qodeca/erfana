// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RevealDriver } from './overlayDriver'

/**
 * "Show in preview" ends on a visible target (plan step 10; I-6, K-22, P-F07):
 * one reveal step in both previews – open the folded part, scroll, flash.
 *
 * @param name - The preview, as every case title names it.
 * @param makeDriver - A fresh driver on a fixture with one target of each kind. Called once per test.
 */
export function runRevealSuite(name: string, makeDriver: () => RevealDriver | Promise<RevealDriver>): void {
  describe(`Show in preview – ${name}`, () => {
    let d: RevealDriver

    beforeEach(async () => {
      d = await makeDriver()
    })

    afterEach(async () => {
      await d.dispose()
    })

    it(`024-AC-001 (${name}) REV-01 a target in view scrolls in and flashes, and the flash goes by itself`, async () => {
      await d.show('plain')
      expect(d.scrolledTo()).toBe('plain')
      expect(d.flashed()).toBe('plain')
      await d.flashEnds()
      expect(d.flashed()).toBeNull()
    })

    it(`024-AC-001 (${name}) REV-02 a target in a closed section: the section opens, then the scroll and the flash`, async () => {
      expect(d.sectionOpen()).toBe(false)
      await d.show('folded')
      expect(d.sectionOpen()).toBe(true)
      expect(d.scrolledTo()).toBe('folded')
      expect(d.flashed()).toBe('folded')
    })

    it(`024-AC-001 (${name}) REV-03 a target that cannot show gets no flash`, async () => {
      await d.show('hidden')
      expect(d.flashed()).toBeNull()
    })
  })
}
