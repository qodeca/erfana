// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Monaco Editor search provider implementation.
 *
 * Uses Monaco's model.findMatches() for efficient text search and
 * deltaDecorations() for visual highlighting. Supports case sensitivity
 * and whole word search options.
 *
 * @see ADR-Spec001-001 - Unified search architecture
 * @see SearchProvider interface for contract documentation
 */

import type * as monaco from 'monaco-editor'
import type { SearchProvider, SearchOptions, SearchMatch } from './SearchProvider'
import type { MonacoEditorHandle } from '../../components/Editor/MonacoMarkdownEditor'
import { logger } from '../../utils/logger'

/**
 * Cached match data for navigation.
 * Stores the Monaco Range and matched text.
 */
interface CachedMatch {
  range: monaco.Range
  text: string
}

/**
 * Decoration options for regular (non-current) match highlighting.
 * Uses design token colors via CSS class.
 */
const MATCH_DECORATION: monaco.editor.IModelDecorationOptions = {
  isWholeLine: false,
  className: 'search-match-decoration',
  overviewRuler: {
    color: 'var(--color-brand-lime-muted)',
    position: 2 // monaco.editor.OverviewRulerLane.Center
  }
}

/**
 * Decoration options for current (focused) match highlighting.
 * Uses brighter design token color for visual distinction.
 */
const CURRENT_MATCH_DECORATION: monaco.editor.IModelDecorationOptions = {
  isWholeLine: false,
  className: 'search-match-current-decoration',
  overviewRuler: {
    color: 'var(--color-brand-lime)',
    position: 2 // monaco.editor.OverviewRulerLane.Center
  }
}

/**
 * Monaco Editor search provider.
 *
 * Implementation notes:
 * - Uses model.findMatches() for performant regex-based search
 * - Escapes special characters in query for literal search
 * - Uses deltaDecorations() for efficient highlight management
 * - Caches match data for navigation to avoid re-querying model
 */
export class MonacoSearchProvider implements SearchProvider {
  readonly id = 'monaco'
  readonly name = 'Monaco Editor'

  private editorRef: React.RefObject<MonacoEditorHandle | null>
  private decorations: string[] = []
  private cachedMatches: CachedMatch[] = []

  /**
   * Create a new Monaco search provider.
   *
   * @param editorRef - Ref to MonacoEditorHandle (from useRef)
   */
  constructor(editorRef: React.RefObject<MonacoEditorHandle | null>) {
    this.editorRef = editorRef
  }

  /**
   * Get the editor instance from the ref.
   * Returns null if ref is not set or editor is not mounted.
   */
  private getEditor(): monaco.editor.IStandaloneCodeEditor | null {
    return this.editorRef.current?.getEditor() ?? null
  }

  /**
   * Execute search against Monaco editor content.
   *
   * @param query - Search term (special chars will be escaped)
   * @param options - Search options (caseSensitive, wholeWord)
   * @returns Array of search matches
   */
  async search(query: string, options: SearchOptions): Promise<SearchMatch[]> {
    const editor = this.getEditor()

    if (!editor || !query) {
      this.cachedMatches = []
      return []
    }

    const model = editor.getModel()
    if (!model) {
      logger.warn('MonacoSearchProvider: No model available')
      return []
    }

    try {
      // Escape special regex characters for safe literal search
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      // Use Monaco's findMatches API
      // Parameters: searchString, searchOnlyEditableRange, isRegex, matchCase, wordSeparators, captureMatches
      const matches = model.findMatches(
        escapedQuery,
        true, // searchOnlyEditableRange
        false, // isRegex (false - we escaped special chars for literal search)
        options.caseSensitive,
        options.wholeWord ? 'boundary' : null, // wordSeparators
        false // captureMatches
      )

      // Cache matches for navigation
      this.cachedMatches = matches.map((m) => ({
        range: m.range,
        text: model.getValueInRange(m.range)
      }))

      logger.debug('MonacoSearchProvider: Search complete', {
        query,
        matchCount: matches.length
      })

      // Convert to SearchMatch format
      return matches.map((match, i) => ({
        id: `monaco-${i}`,
        line: match.range.startLineNumber,
        startColumn: match.range.startColumn,
        endColumn: match.range.endColumn,
        text: model.getValueInRange(match.range),
        meta: { range: match.range }
      }))
    } catch (error) {
      // Graceful degradation: log and return empty
      logger.error('MonacoSearchProvider.search error', error instanceof Error ? error : undefined, {
        query,
        options
      })
      this.cachedMatches = []
      return []
    }
  }

  /**
   * Navigate to a specific match.
   *
   * Sets selection to the match range and reveals it in the editor center.
   *
   * @param index - Zero-based match index
   * @param options - Navigation options
   * @param options.focusEditor - Whether to focus the editor after navigation.
   *                              Default: true. Set to false when called from
   *                              SearchBar to prevent stealing focus from input.
   */
  navigateTo(index: number, options?: { focusEditor?: boolean }): void {
    const editor = this.getEditor()

    if (!editor || index < 0 || index >= this.cachedMatches.length) {
      return
    }

    const match = this.cachedMatches[index]
    if (!match) return

    try {
      editor.setSelection(match.range)
      editor.revealLineInCenter(match.range.startLineNumber)
      // Only focus editor if explicitly requested (default: true for backward compatibility)
      // When called from SearchBar, focusEditor=false prevents stealing focus from search input
      if (options?.focusEditor !== false) {
        editor.focus()
      }
    } catch (error) {
      logger.error(
        'MonacoSearchProvider.navigateTo error',
        error instanceof Error ? error : undefined,
        { index }
      )
    }
  }

  /**
   * Clear all search decorations and cached matches.
   */
  clearHighlights(): void {
    const editor = this.getEditor()

    if (editor) {
      try {
        // Remove all decorations by passing empty array
        this.decorations = editor.deltaDecorations(this.decorations, [])
      } catch (error) {
        logger.error(
          'MonacoSearchProvider.clearHighlights error',
          error instanceof Error ? error : undefined
        )
      }
    }

    this.cachedMatches = []
  }

  /**
   * Update decorations to highlight current match differently.
   *
   * All matches get regular decoration, except the current one which
   * gets a brighter/distinct decoration.
   *
   * @param currentIndex - Index of the currently focused match
   */
  updateCurrentMatch(currentIndex: number): void {
    const editor = this.getEditor()

    if (!editor || this.cachedMatches.length === 0) {
      return
    }

    try {
      // Build decoration array: current match gets distinct style
      const newDecorations = this.cachedMatches.map((match, i) => ({
        range: match.range,
        options: i === currentIndex ? CURRENT_MATCH_DECORATION : MATCH_DECORATION
      }))

      // Apply decorations atomically
      this.decorations = editor.deltaDecorations(this.decorations, newDecorations)
    } catch (error) {
      logger.error(
        'MonacoSearchProvider.updateCurrentMatch error',
        error instanceof Error ? error : undefined,
        { currentIndex }
      )
    }
  }

  /**
   * Cleanup provider resources.
   *
   * Clears all decorations and resets internal state.
   */
  dispose(): void {
    this.clearHighlights()
    logger.debug('MonacoSearchProvider disposed')
  }
}
