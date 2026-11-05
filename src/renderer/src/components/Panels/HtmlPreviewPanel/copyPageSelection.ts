// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Copy selection in the HTML preview's right-click menu (#463).
 *
 * The page runs in its own process, so this renderer cannot read what the
 * reader selected there: it asks main (`preview:copySelection`) to run the
 * page's own Copy command, and the text goes from the page straight to the
 * system clipboard. Nothing comes back but a flag.
 *
 * @module HtmlPreviewPanel/copyPageSelection
 */
import { previewGateway } from '../../../services/previewGateway'
import { logger } from '../../../utils/logger'

/**
 * Copy the text selected in a panel's page to the system clipboard.
 *
 * Never rejects. A refusal – the page closed or was suspended between the
 * right-click and the click on the item – and a failed invoke are logged; the
 * panel id is not, because it is derived from the file's path.
 *
 * @param panelId - The preview panel whose page holds the selection.
 * @returns Whether main ran the page's Copy command.
 */
export async function copyPageSelection(panelId: string): Promise<boolean> {
  try {
    const { ok } = await previewGateway.copySelection(panelId)
    if (!ok) logger.warn('HTML preview copy refused: no live page for this panel')
    return ok
  } catch (error) {
    logger.error('HTML preview copy failed', error instanceof Error ? error : undefined)
    return false
  }
}
