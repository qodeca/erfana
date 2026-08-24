// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Count-only search provider for the running HTML preview (Issue #74).
 *
 * The HTML preview renders inside a `WebContentsView` in its own process, so the
 * renderer has NO access to its DOM. Search therefore rides Chromium's native
 * find-in-page API over IPC (`window.api.preview.find` / `stopFind` /
 * `onFindResult`), which only ever reports two integers — how many matches and
 * which one is active — never the match list and never random access.
 *
 * That shapes the provider:
 * - `capabilities` is `{ randomAccess: false, matchList: false, wholeWord: false }`.
 * - `search()` returns `[]`; results arrive asynchronously via {@link onCountChange}.
 * - Navigation is relative (`nextMatch`/`previousMatch`), not by index.
 *
 * @see SearchProvider interface for the two-shape contract
 * @see design sd-074-html-preview.md §6
 */

import type { PreviewBridge } from '../../../../shared/ipc/preview-schema'
import type { PreviewFindResult } from '../../../../shared/ipc/preview-types'
import type { SearchProvider, SearchOptions, SearchMatch, SearchCapabilities, SearchCount } from './SearchProvider'
import { logger } from '../../utils/logger'

/** The slice of the preview bridge this provider needs (X15b: explicit ctor). */
type PreviewFindBridge = Pick<PreviewBridge, 'find' | 'stopFind' | 'onFindResult'>

/** A zero count, pushed on clear so the SearchBar label collapses to no-results. */
const ZERO_COUNT: SearchCount = { total: 0, activeOrdinal: 0 }

/**
 * Find-in-page search provider for the sealed HTML preview view.
 *
 * @example
 * ```ts
 * const provider = useMemo(
 *   () => new PreviewPageSearchProvider(panelId, window.api.preview),
 *   [panelId]
 * )
 * ```
 */
export class PreviewPageSearchProvider implements SearchProvider {
  readonly id = 'preview-page'
  readonly name = 'HTML Preview'

  /**
   * Count-only: Chromium's find-in-page yields counts, not a match list, and has
   * no whole-word option in Electron 39.8.9's `FindInPageOptions`.
   */
  readonly capabilities: SearchCapabilities = {
    randomAccess: false,
    matchList: false,
    wholeWord: false
  }

  private readonly panelId: string
  private readonly bridge: PreviewFindBridge

  /** Listeners registered via {@link onCountChange}. */
  private readonly countListeners = new Set<(count: SearchCount) => void>()

  /** Unsubscribe from the bridge's find-result stream, set in the constructor. */
  private readonly unsubscribeFindResult: () => void

  /** The current query; empty means "not searching". */
  private currentQuery = ''

  /** Case sensitivity of the active query, reused for relative navigation. */
  private matchCase = false

  /**
   * @param panelId - The preview panel whose find-in-page this drives
   * @param bridge - The preview IPC bridge (only find/stopFind/onFindResult used)
   */
  constructor(panelId: string, bridge: PreviewFindBridge) {
    this.panelId = panelId
    this.bridge = bridge

    // Chromium reports each found-in-page result asynchronously. Forward the
    // counts for OUR panel to subscribers; ignore results for other panels
    // (a single renderer can host at most one live preview, but the stream is
    // shared, so the panelId guard is load-bearing).
    this.unsubscribeFindResult = bridge.onFindResult((result: PreviewFindResult) => {
      if (result.panelId !== this.panelId) return
      this.pushCount({ total: result.matches, activeOrdinal: result.activeMatchOrdinal })
    })
  }

  /**
   * Begin a new find-in-page for the given query.
   *
   * A count-only provider returns no matches synchronously; the count arrives
   * later through {@link onCountChange}. An empty query clears the highlight.
   *
   * @param query - Search term
   * @param options - Search options (only `caseSensitive` is honored)
   * @returns Always an empty array (results are pushed, not returned)
   */
  async search(query: string, options: SearchOptions): Promise<SearchMatch[]> {
    this.currentQuery = query
    this.matchCase = options.caseSensitive

    if (!query) {
      // Empty query: clear rather than issue an invalid (min-length) find.
      this.clearHighlights()
      return []
    }

    try {
      // findNext:false starts a fresh find session for the new query.
      await this.bridge.find({
        panelId: this.panelId,
        text: query,
        forward: true,
        findNext: false,
        matchCase: this.matchCase
      })
    } catch (error) {
      logger.error(
        'PreviewPageSearchProvider.search error',
        error instanceof Error ? error : undefined,
        { panelId: this.panelId }
      )
    }

    return []
  }

  /**
   * Advance to the next match by re-issuing the active query with `findNext`.
   *
   * No-op when there is no active query (nothing to advance through).
   */
  nextMatch(): void {
    this.issueRelativeFind(true)
  }

  /**
   * Move to the previous match by re-issuing the active query backwards.
   */
  previousMatch(): void {
    this.issueRelativeFind(false)
  }

  /**
   * Issue a relative (findNext) find in the given direction.
   *
   * @param forward - `true` for next, `false` for previous
   */
  private issueRelativeFind(forward: boolean): void {
    if (!this.currentQuery) return

    this.bridge
      .find({
        panelId: this.panelId,
        text: this.currentQuery,
        forward,
        findNext: true,
        matchCase: this.matchCase
      })
      .catch((error: unknown) => {
        logger.error(
          'PreviewPageSearchProvider.issueRelativeFind error',
          error instanceof Error ? error : undefined,
          { panelId: this.panelId, forward }
        )
      })
  }

  /**
   * Subscribe to pushed match counts.
   *
   * @param listener - Called with each new count for this panel
   * @returns Unsubscribe function
   */
  onCountChange(listener: (count: SearchCount) => void): () => void {
    this.countListeners.add(listener)
    return () => {
      this.countListeners.delete(listener)
    }
  }

  /**
   * Clear the find highlight in the preview.
   *
   * Pushes a zero count to subscribers BEFORE issuing stop (design §6.2): the
   * SearchBar label must collapse to "no results" immediately, without waiting
   * for a find-result round-trip that stop does not produce.
   */
  clearHighlights(): void {
    this.currentQuery = ''
    this.pushCount(ZERO_COUNT)

    this.bridge.stopFind(this.panelId).catch((error: unknown) => {
      logger.error(
        'PreviewPageSearchProvider.clearHighlights error',
        error instanceof Error ? error : undefined,
        { panelId: this.panelId }
      )
    })
  }

  /**
   * Cleanup: unsubscribe from the find-result stream and drop listeners.
   */
  dispose(): void {
    this.unsubscribeFindResult()
    this.countListeners.clear()
    logger.debug('PreviewPageSearchProvider disposed', { panelId: this.panelId })
  }

  /**
   * Notify all count subscribers.
   *
   * @param count - The count to push
   */
  private pushCount(count: SearchCount): void {
    for (const listener of this.countListeners) {
      listener(count)
    }
  }
}
