// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Decides – asynchronously and double-click-safely – which kind of panel a
 * file should open in.
 *
 * `openFileInPanel` routes synchronously from the extension (image vs editor).
 * A `.html` file is different: whether it may open as a *running preview* is a
 * main-side decision (`preview:checkEligibility` runs the five ordered checks of
 * design §1.5 – global toggle, extension, project confinement, excluded
 * directory, gitignore). This resolver is the single place that bridges that
 * async gap and hands `openFileInPanel` a concrete {@link FilePanelKind}.
 *
 * **Double-click safety.** A per-path in-flight promise map collapses two rapid
 * clicks on the same file into ONE resolution. Without it, both clicks would
 * fire their own `checkEligibility` round-trip and then both call
 * `openFileInPanel` before either panel was registered, racing two `addPanel`
 * calls with the same id (design §1.4/§5(a)). The map entry is removed once the
 * resolution settles, so a later click re-resolves (the file may have been
 * git-ignored or the toggle flipped in between).
 *
 * @module resolvePanelKind
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import type { FilePanelKind } from './openFileInPanel'
import { isHtmlFile } from './fileUtils'
import { isImageFile } from './imageUtils'
import { logger } from './logger'

/**
 * In-flight resolutions keyed by absolute file path.
 *
 * Module-level on purpose: the guarantee is "one concurrent resolution per
 * path across the whole renderer", so every caller (project tree, terminal)
 * must share the same map.
 */
const inFlightResolutions = new Map<string, Promise<FilePanelKind>>()

/**
 * Computes the panel kind for a path, doing the async eligibility round-trip
 * only for HTML files.
 *
 * Non-HTML paths resolve without any IPC – an image is an image and everything
 * else is editor source – so the common case pays no round-trip cost. Only a
 * `.html`/`.htm` path asks the main process whether it may run.
 *
 * @param filePath - Absolute path to the file.
 * @returns The resolved panel kind.
 */
async function computePanelKind(filePath: string): Promise<FilePanelKind> {
  // Fast, synchronous verdicts first – no needless IPC (§5(a)).
  if (isImageFile(filePath)) return 'image'
  if (!isHtmlFile(filePath)) return 'editor'

  // HTML: the running preview is gated on the main-side eligibility check.
  // Any failure – ineligible, IPC error, or the bridge being unavailable –
  // degrades to opening the file as source, never blocks the open.
  try {
    const result = await window.api.preview.checkEligibility(filePath)
    return result.eligible ? 'preview' : 'editor'
  } catch (error) {
    logger.warn('Preview eligibility check failed; opening as source', {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    })
    return 'editor'
  }
}

/**
 * Resolves which {@link FilePanelKind} a file should open in.
 *
 * Images resolve to `'image'`; a `.html`/`.htm` file that passes the main-side
 * `preview:checkEligibility` gate resolves to `'preview'`, otherwise `'editor'`;
 * everything else resolves to `'editor'`. Concurrent calls for the same path
 * share a single resolution (see the module note).
 *
 * @param filePath - Absolute path to the file to open.
 * @returns A promise for the resolved panel kind.
 *
 * @example Route a project-tree click
 * ```ts
 * const kind = await resolvePanelKind(filePath)
 * if (kind === 'preview') {
 *   openFileInPanel(api, filePath, { kind: 'preview', renderer: 'always' })
 * } else {
 *   openFileInPanel(api, filePath, { kind })
 * }
 * ```
 */
export function resolvePanelKind(filePath: string): Promise<FilePanelKind> {
  const existing = inFlightResolutions.get(filePath)
  if (existing) return existing

  const resolution = computePanelKind(filePath).finally(() => {
    inFlightResolutions.delete(filePath)
  })

  inFlightResolutions.set(filePath, resolution)
  return resolution
}
