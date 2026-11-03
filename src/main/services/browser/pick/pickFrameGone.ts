// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A frame that goes while it holds the live highlight ends the highlight;
 * pick mode stays on (spec 025, 025-FR-029).
 *
 * The signals: `Page.frameDetached` on the top target (its `Page` domain is
 * on for page dialogs, ADR 0011) for a same-process frame – reason `swap`
 * only moved the frame to another process – and the detach of an
 * out-of-process frame's own target. On either, the highlighted node's frame
 * is looked up in its session's frame tree (`PickFrames.frameAlive`); no page
 * function runs.
 */
import { isRecord } from '../cdp/cdpTypes'
import type { PickCdp } from './pickCdp'
import type { PickFrames } from './pickFrames'
import type { HighlightRecord } from './pickHighlight'

/** A `Page.frameDetached` that only moved the frame to another process: the frame is still there. */
const isSwap = (params: unknown): boolean => isRecord(params) && params.reason === 'swap'

/**
 * Watch for frames going. `live` is the highlight that may end now (null
 * while none shows, or while a capture is held); `end` ends it, called only
 * when the same record is still live after the frame tree was read.
 *
 * @returns a function that stops watching
 */
export function watchFrameGone(cdp: PickCdp, frames: PickFrames, live: () => HighlightRecord | null, end: () => Promise<void>): () => void {
  const check = async (): Promise<void> => {
    const record = live()
    if (record === null) return
    if (await frames.frameAlive(record.node.sessionKey, record.node.frameId)) return
    if (live() === record) await end()
  }
  const offs = [
    cdp.on('protocolEvent', (event) => {
      if (event.method === 'Page.frameDetached' && !isSwap(event.params)) void check()
    }),
    cdp.on('targetDetached', () => void check())
  ]
  return () => {
    for (const off of offs) off()
  }
}
