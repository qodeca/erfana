// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The outline flash after a send (spec 025, 025-FR-060, 025-AC-070): once
 * the still image goes, the sent element's outline shows on the live page
 * for {@link SENT_FLASH_MS}, when the element is still there. Drawn by the
 * engine like the hover outline (`pickHighlight.ts`, ADR 0007), so the page
 * sees nothing. The test hook reads the outline through the highlight's
 * record (asserted by the overlay's state, not by timing).
 *
 * Also the two small helpers `BrowserTabPick.ts` keeps here because it is at
 * its size limit.
 */
import type { Clock } from '../../../../shared/clock'
import type { PickNode } from './pickCdp'
import type { Point } from './pickGeometry'
import type { PickHighlight } from './pickHighlight'

/** How long the sent element's outline shows on the live page. */
export const SENT_FLASH_MS = 1000

/**
 * Flash `node`'s outline, then hide it – or just hide what is shown when
 * there is nothing to flash. When `restarted` turns true during the flash
 * (pick mode came back on), the outline is left to the new hover.
 *
 * @param highlight - The tab's highlight
 * @param node - The sent element, or `null` (no send: hide only)
 * @param clock - The app clock (the test clock in e2e)
 * @param restarted - Whether pick mode is on again
 * @returns Whether pick mode came back on meanwhile (the caller then keeps the pick domains on)
 */
export async function flashThenHide(
  highlight: Pick<PickHighlight, 'show' | 'hide'>,
  node: PickNode | null,
  clock: Pick<Clock, 'setTimeout'>,
  restarted: () => boolean
): Promise<boolean> {
  if (node !== null && (await highlight.show(node)) !== null) {
    await new Promise<void>((resolve) => clock.setTimeout(resolve, SENT_FLASH_MS))
    if (restarted()) return true
  }
  await highlight.hide()
  return restarted()
}

/** Whether two handles name the same node. */
export function sameNode(a: PickNode, b: PickNode): boolean {
  return a.sessionKey === b.sessionKey && a.backendNodeId === b.backendNodeId
}

/** The centre of `box`, or the origin without one. */
export function centre(box: { x: number; y: number; width: number; height: number } | null): Point {
  return box === null ? { x: 0, y: 0 } : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
