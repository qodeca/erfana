// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Search provider interface for implementing view-specific search logic.
 *
 * Each view type (Monaco, Preview, future viewers) implements this interface.
 * The provider pattern enables consistent search behavior across different
 * rendering contexts while allowing view-specific optimizations.
 *
 * @see ADR-Spec001-001 - Unified search architecture
 */

import type { SearchMatch, SearchOptions } from '../../stores/useSearchStore'

/**
 * Search provider interface.
 *
 * Responsibilities:
 * - Execute search queries against view-specific content
 * - Manage visual highlighting of matches
 * - Handle navigation between matches
 * - Cleanup resources when disposed
 */
export interface SearchProvider {
  /** Unique provider identifier (e.g., 'monaco', 'preview') */
  readonly id: string

  /** Human-readable name for debugging and logging */
  readonly name: string

  /**
   * Execute search with given parameters.
   *
   * Should be called when query or options change. The provider
   * is responsible for any internal debouncing if needed.
   *
   * @param query - Search term (will be escaped for literal search)
   * @param options - Search modifiers (case sensitivity, whole word)
   * @returns Array of match results with position info
   */
  search(query: string, options: SearchOptions): Promise<SearchMatch[]>

  /**
   * Navigate to and highlight a specific match.
   *
   * Provider is responsible for:
   * - Scrolling the match into view
   * - Visually focusing the match (e.g., cursor position, selection)
   *
   * @param index - Zero-based match index
   * @param options - Navigation options
   * @param options.focusEditor - Whether to focus the editor after navigation.
   *                              Default: true. Set to false when called from
   *                              SearchBar to prevent stealing focus from input.
   */
  navigateTo(index: number, options?: { focusEditor?: boolean }): void

  /**
   * Clear all search highlights and reset internal state.
   *
   * Called when:
   * - Search is closed
   * - Query is cleared
   * - Provider is disposed
   */
  clearHighlights(): void

  /**
   * Update visual distinction between current and other matches.
   *
   * The current match should be visually distinct (brighter, different color)
   * from other matches.
   *
   * @param currentIndex - Currently focused match index
   */
  updateCurrentMatch(currentIndex: number): void

  /**
   * Cleanup resources.
   *
   * Called when:
   * - Component unmounts
   * - Provider is replaced
   * - Search context changes (e.g., file change)
   */
  dispose(): void
}

// Re-export types from store for convenience
export type { SearchOptions, SearchMatch } from '../../stores/useSearchStore'
