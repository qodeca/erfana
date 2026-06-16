// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview pane search provider implementation.
 *
 * Uses DOM TreeWalker for efficient text node traversal and CSS Custom
 * Highlight API for zero-DOM-mutation highlighting. Falls back to
 * ancestor class injection for browsers without Highlight API support.
 *
 * @see ADR-Spec001-001 - Unified search architecture
 * @see SearchProvider interface for contract documentation
 */

import type { SearchProvider, SearchOptions, SearchMatch } from './SearchProvider'
import { logger } from '../../utils/logger'

/**
 * Type guard for CSS Highlight API support.
 * The CSS Custom Highlight API is a modern feature not available in all browsers.
 */
function hasHighlightSupport(): boolean {
  return 'Highlight' in window && 'highlights' in CSS
}

/**
 * CSS Custom Highlight API is available in Chrome 105+, Safari 17.2+.
 * Types are provided by TypeScript's DOM lib (ES2022+).
 * See: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
 */

/** CSS class for fallback highlighting (non-current matches) */
const FALLBACK_CLASS = 'search-highlight-fallback'

/** CSS class for fallback highlighting (current match) */
const CURRENT_FALLBACK_CLASS = 'search-highlight-current-fallback'

/** CSS Highlight API name for all search results */
const HIGHLIGHT_NAME = 'search-results'

/** CSS Highlight API name for current match */
const CURRENT_HIGHLIGHT_NAME = 'search-current'

/**
 * DOM-based search provider for markdown preview pane.
 *
 * Implementation notes:
 * - Uses TreeWalker for performant text node traversal
 * - Skips SCRIPT, STYLE, NOSCRIPT elements
 * - Uses CSS Custom Highlight API when available (Chrome 105+, Safari 17.2+)
 * - Falls back to ancestor class injection (NOT DOM mutation with <mark>)
 * - Fallback is React-safe as it only adds/removes classes
 */
export class PreviewSearchProvider implements SearchProvider {
  readonly id = 'preview'
  readonly name = 'Markdown Preview'

  private containerRef: React.RefObject<HTMLDivElement | null>
  private highlightRanges: Range[] = []

  /**
   * Create a new Preview search provider.
   *
   * @param containerRef - Ref to the preview container element
   */
  constructor(containerRef: React.RefObject<HTMLDivElement | null>) {
    this.containerRef = containerRef
  }

  /**
   * Execute search against preview DOM content.
   *
   * @param query - Search term (special chars will be escaped)
   * @param options - Search options (caseSensitive, wholeWord)
   * @returns Array of search matches
   */
  async search(query: string, options: SearchOptions): Promise<SearchMatch[]> {
    // Clear previous highlights before starting new search
    this.clearHighlights()

    if (!this.containerRef.current || !query) {
      return []
    }

    const matches: SearchMatch[] = []
    const container = this.containerRef.current

    try {
      // Use TreeWalker for efficient DOM traversal
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // Skip script, style, and empty nodes
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_REJECT
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT
          }
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        }
      })

      // Build regex for search - escape special characters for safe literal search
      const flags = options.caseSensitive ? 'g' : 'gi'
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = options.wholeWord ? `\\b${escapedQuery}\\b` : escapedQuery
      const regex = new RegExp(pattern, flags)

      let node: Node | null
      let matchIndex = 0

      while ((node = walker.nextNode())) {
        const text = node.textContent || ''
        let match: RegExpExecArray | null

        // Reset regex lastIndex for each node (required for global regex)
        regex.lastIndex = 0

        while ((match = regex.exec(text)) !== null) {
          // Create Range for this match
          const range = document.createRange()
          try {
            range.setStart(node, match.index)
            range.setEnd(node, match.index + match[0].length)
          } catch {
            // Skip if range is invalid (e.g., text node changed)
            logger.warn('PreviewSearchProvider: Failed to create range', {
              index: match.index,
              length: match[0].length
            })
            continue
          }

          this.highlightRanges.push(range)

          matches.push({
            id: `preview-${matchIndex++}`,
            line: 0, // DOM doesn't have line numbers
            startColumn: match.index,
            endColumn: match.index + match[0].length,
            text: match[0],
            meta: { range }
          })
        }
      }

      // Apply highlights after collecting all ranges
      this.applyHighlights()

      logger.debug('PreviewSearchProvider: Search complete', {
        query,
        matchCount: matches.length,
        usingHighlightAPI: hasHighlightSupport()
      })

      return matches
    } catch (error) {
      // Graceful degradation: log and return empty
      logger.error(
        'PreviewSearchProvider.search error',
        error instanceof Error ? error : undefined,
        { query, options }
      )
      this.highlightRanges = []
      return []
    }
  }

  /**
   * Apply visual highlights to all found matches.
   * Uses CSS Custom Highlight API when available, falls back to classes.
   */
  private applyHighlights(): void {
    if (hasHighlightSupport()) {
      try {
        // Use CSS Custom Highlight API for zero-DOM-mutation highlighting
        const highlight = new Highlight(...this.highlightRanges)
        CSS.highlights.set(HIGHLIGHT_NAME, highlight)
      } catch (error) {
        logger.error(
          'PreviewSearchProvider: CSS Highlight API error, falling back',
          error instanceof Error ? error : undefined
        )
        this.applyFallbackHighlights()
      }
    } else {
      // Fallback for browsers without CSS Highlight API
      this.applyFallbackHighlights()
    }
  }

  /**
   * Fallback highlighting for browsers without CSS Highlight API.
   *
   * Instead of mutating the DOM with <mark> elements (which would break React),
   * we add a class to the nearest ancestor element and use CSS to highlight.
   * This is less precise but safe for React reconciliation.
   */
  private applyFallbackHighlights(): void {
    // Clear previous fallback highlights first
    this.clearFallbackHighlights()

    // Add highlight class to ancestor elements
    const highlightedElements = new Set<Element>()
    for (const range of this.highlightRanges) {
      const element = this.getAncestorElement(range.startContainer)
      if (element && !highlightedElements.has(element)) {
        element.classList.add(FALLBACK_CLASS)
        highlightedElements.add(element)
      }
    }
  }

  /**
   * Clear fallback highlight classes from elements.
   */
  private clearFallbackHighlights(): void {
    if (!this.containerRef.current) return

    const highlighted = this.containerRef.current.querySelectorAll(`.${FALLBACK_CLASS}`)
    highlighted.forEach((el) => el.classList.remove(FALLBACK_CLASS))

    const currentHighlighted = this.containerRef.current.querySelectorAll(
      `.${CURRENT_FALLBACK_CLASS}`
    )
    currentHighlighted.forEach((el) => el.classList.remove(CURRENT_FALLBACK_CLASS))
  }

  /**
   * Get the ancestor Element from a Node.
   * Handles TextNodes correctly by returning their parentElement.
   *
   * @param node - DOM node (may be TextNode)
   * @returns Element or null
   */
  private getAncestorElement(node: Node): Element | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.parentElement
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node as Element
    }
    return null
  }

  /**
   * Navigate to a specific match.
   *
   * Scrolls the match into view with smooth animation.
   *
   * @param index - Zero-based match index
   * @param _options - Navigation options (unused in preview, included for interface consistency)
   */
  navigateTo(index: number, _options?: { focusEditor?: boolean }): void {
    if (index < 0 || index >= this.highlightRanges.length) {
      return
    }

    const range = this.highlightRanges[index]
    if (!range) return

    try {
      // Get the element to scroll to (handle TextNode correctly)
      const element = this.getAncestorElement(range.startContainer)
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }
    } catch (error) {
      logger.error(
        'PreviewSearchProvider.navigateTo error',
        error instanceof Error ? error : undefined,
        { index }
      )
    }
  }

  /**
   * Clear all search highlights and cached ranges.
   */
  clearHighlights(): void {
    // Clear CSS Highlight API highlights
    if (hasHighlightSupport()) {
      try {
        CSS.highlights.delete(HIGHLIGHT_NAME)
        CSS.highlights.delete(CURRENT_HIGHLIGHT_NAME)
      } catch {
        logger.warn('PreviewSearchProvider: Error clearing CSS highlights')
      }
    }

    // Clear fallback highlights
    this.clearFallbackHighlights()

    // Clear cached ranges
    this.highlightRanges = []
  }

  /**
   * Update current match highlighting.
   *
   * Uses CSS Custom Highlight API for current match when available,
   * otherwise adds a distinct class to the ancestor element.
   *
   * @param currentIndex - Index of the currently focused match
   */
  updateCurrentMatch(currentIndex: number): void {
    if (currentIndex < 0 || currentIndex >= this.highlightRanges.length) {
      return
    }

    try {
      if (hasHighlightSupport()) {
        // CSS Highlight API path
        const currentRange = this.highlightRanges[currentIndex]
        if (currentRange) {
          const currentHighlight = new Highlight(currentRange)
          CSS.highlights.set(CURRENT_HIGHLIGHT_NAME, currentHighlight)
        }
      } else {
        // Fallback: add current class to ancestor element
        this.clearCurrentFallbackHighlight()
        const range = this.highlightRanges[currentIndex]
        if (range) {
          const element = this.getAncestorElement(range.startContainer)
          if (element) {
            element.classList.add(CURRENT_FALLBACK_CLASS)
          }
        }
      }
    } catch (error) {
      logger.error(
        'PreviewSearchProvider.updateCurrentMatch error',
        error instanceof Error ? error : undefined,
        { currentIndex }
      )
    }
  }

  /**
   * Clear current match fallback highlight class.
   */
  private clearCurrentFallbackHighlight(): void {
    if (!this.containerRef.current) return

    const currentHighlighted = this.containerRef.current.querySelectorAll(
      `.${CURRENT_FALLBACK_CLASS}`
    )
    currentHighlighted.forEach((el) => el.classList.remove(CURRENT_FALLBACK_CLASS))
  }

  /**
   * Cleanup provider resources.
   *
   * Clears all highlights and resets internal state.
   */
  dispose(): void {
    this.clearHighlights()
    logger.debug('PreviewSearchProvider disposed')
  }
}
