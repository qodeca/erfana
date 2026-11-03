// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Freezing the page after a second-Ctrl/Cmd+E pick (spec 025, 025-FR-013,
 * 025-FR-028, 025-FR-053; ADR 0008 decisions 1, 4, 5, 7, 8 and its commit-8
 * probe results; spec change S-33).
 *
 * `Debugger.enable` then `Debugger.pause` on every frame target (workers keep
 * running); a frame that attaches while frozen is paused before its
 * `Runtime.runIfWaitingForDebugger`, which the session sends on a later task.
 * The hang probe is suspended (`frozen`) and the audio muted while frozen.
 * Unfreeze: `Debugger.resume`, then `Debugger.disable` – which also drops a
 * pause still pending on an idle page – errors from vanished targets ignored.
 *
 * **The probe's fallback** (ADR 0008 decision 3): on an idle page a pending
 * pause makes Erfana's own next page function the first script to run, so
 * that call pauses inside itself and never answers. The capture therefore
 * reads everything it may need – the facts of every element refinement can
 * reach and the source hints – *before* {@link PickFreeze.freeze}, and runs
 * no page function until {@link PickFreeze.unfreeze}. While frozen a refined
 * element's hints come from its source attributes only (025-FR-053's own
 * fallback): the React lookup reports "source not found".
 *
 * A `Debugger.resumed` Erfana did not cause – the user resumed from DevTools
 * – counts as closing the menu or dialog without sending (025-FR-013):
 * `onExternalResume`.
 */
import type { CdpTargetInfo } from '../cdp/cdpSessionTypes'
import { logger } from '../../LoggingService'
import { TOP_SESSION, type PickCdp, type PickReader } from './pickCdp'

/** The page `webContents` audio controls the freeze uses. */
export interface FreezeAudio {
  isAudioMuted(): boolean
  setAudioMuted(muted: boolean): void
  isDestroyed(): boolean
}

const isFrame = (t: CdpTargetInfo): boolean => t.sessionKey === TOP_SESSION || t.type === 'iframe'

export class PickFreeze {
  private frozen = false
  /** Erfana's own resume is in flight: its `Debugger.resumed` events are expected. */
  private resuming = false
  private mutedByUs = false
  private readonly unsubscribe: Array<() => void> = []

  constructor(
    private readonly cdp: PickCdp,
    private readonly reader: PickReader,
    private readonly audio: FreezeAudio,
    private readonly onExternalResume: () => void
  ) {
    this.unsubscribe.push(
      cdp.on('targetAttached', (target) => {
        if (this.frozen && isFrame(target)) this.pauseTarget(target.sessionKey)
      }),
      cdp.on('protocolEvent', (event) => {
        if (event.method !== 'Debugger.resumed' || !this.frozen || this.resuming) return
        logger.info('Browser pick: the page was resumed outside Erfana')
        this.onExternalResume()
      })
    )
  }

  get isFrozen(): boolean {
    return this.frozen
  }

  /** Pause every frame target; resolves when each has answered (or failed). */
  async freeze(): Promise<void> {
    if (this.frozen) return
    this.frozen = true
    this.cdp.hangProbe.suspend('frozen')
    if (!this.audio.isDestroyed() && !this.audio.isAudioMuted()) {
      this.audio.setAudioMuted(true)
      this.mutedByUs = true
    }
    await Promise.all(this.cdp.attachedTargets().filter(isFrame).map((t) => this.pauseTarget(t.sessionKey)))
  }

  /** Resume every frame target. Idempotent; never rejects. */
  async unfreeze(): Promise<void> {
    if (!this.frozen) return
    this.resuming = true
    try {
      const targets = this.cdp.attachedTargets().filter(isFrame)
      await Promise.all(
        targets.map(async (t) => {
          await this.reader.call('Debugger.resume', undefined, t.sessionKey).catch(() => undefined)
          await this.reader.call('Debugger.disable', undefined, t.sessionKey).catch(() => undefined)
        })
      )
    } finally {
      this.frozen = false
      this.resuming = false
      this.cdp.hangProbe.resume('frozen')
      if (this.mutedByUs && !this.audio.isDestroyed()) this.audio.setAudioMuted(false)
      this.mutedByUs = false
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe.splice(0)) off()
  }

  private pauseTarget(sessionKey: string): Promise<void> {
    // Sent back to back, never awaiting each: on a new frame both go out before the session's resume.
    const enable = this.reader.call('Debugger.enable', undefined, sessionKey)
    const pause = this.reader.call('Debugger.pause', undefined, sessionKey)
    return Promise.all([enable, pause]).then(
      () => undefined,
      (error: unknown) => logger.debug('Browser pick: a frame could not be paused', { error: String(error) })
    )
  }
}
