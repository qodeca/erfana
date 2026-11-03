// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The engine side of turning pick mode on and off for one tab (spec 025,
 * 025-FR-025; ADR 0007 decisions 3 and 4; spec change S-11). Kept out of
 * `BrowserTabPick.ts`, which decides when.
 *
 * - **On**: `DOM`, `CSS` and `Overlay` enabled (a failure is logged; hover
 *   then finds nothing), focus emulation on every frame target so hover-only
 *   content stays open while focus is elsewhere, and the crosshair cursor on
 *   the top document (`insertCSS`, user origin – it does not reach frames,
 *   commit-8 probe).
 * - **Off**: the crosshair removed, focus emulation off, every pick handle
 *   released, the pick domains disabled and the isolated worlds forgotten.
 */
import { logger } from '../../LoggingService'
import type { PickCdp, PickReader } from './pickCdp'
import type { PickFrames } from './pickFrames'

/** The crosshair over the live top document (S-11). */
export const CROSSHAIR_CSS = '* { cursor: crosshair !important }'

/** The page `webContents` surface the switch needs. */
export interface ModeSwitchContents {
  isDestroyed(): boolean
  insertCSS(css: string, options?: { cssOrigin?: 'user' | 'author' }): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
}

export class PickModeSwitch {
  private crosshairKey: string | null = null

  constructor(
    private readonly cdp: PickCdp,
    private readonly reader: PickReader,
    private readonly frames: PickFrames,
    private readonly contents: ModeSwitchContents
  ) {}

  /** Turn the engine side on. `stillOn` is asked when the crosshair lands, which may be after an off. */
  async on(stillOn: () => boolean): Promise<void> {
    try {
      await this.cdp.enablePickDomains()
    } catch (error) {
      logger.warn('Browser pick: the pick domains could not be enabled', { error: String(error) })
    }
    for (const t of this.frames.frameTargets()) this.focusEmulation(t.sessionKey, true)
    this.contents
      .insertCSS(CROSSHAIR_CSS, { cssOrigin: 'user' })
      .then((key) => {
        if (stillOn()) this.crosshairKey = key
        else void this.contents.removeInsertedCSS(key).catch(() => undefined)
      })
      .catch(() => undefined)
  }

  /** Turn the engine side off. Never rejects for a tab that is going away. */
  async off(): Promise<void> {
    if (this.crosshairKey !== null && !this.contents.isDestroyed()) {
      await this.contents.removeInsertedCSS(this.crosshairKey).catch(() => undefined)
    }
    this.crosshairKey = null
    if (!this.cdp.attached) return
    for (const t of this.frames.frameTargets()) this.focusEmulation(t.sessionKey, false)
    await this.reader.releaseAll()
    await this.cdp.disablePickDomains()
    this.reader.reset()
  }

  /** Focus emulation on one frame target (a frame that attached while pick mode is on). */
  focusEmulation(sessionKey: string, enabled: boolean): void {
    this.reader.call('Emulation.setFocusEmulationEnabled', { enabled }, sessionKey).catch(() => undefined)
  }
}
