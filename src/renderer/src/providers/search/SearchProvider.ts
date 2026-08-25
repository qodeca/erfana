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
 * Declares what a search provider can actually do.
 *
 * The search system used to assume every provider returned the full list of
 * matches and could jump to any one of them by index. That is true for the
 * text-buffer providers (Monaco, the markdown-preview DOM) but NOT for a
 * count-only provider such as {@link PreviewPageSearchProvider}, which wraps
 * Chromium's `findInPage` and only ever learns "how many matches, which one is
 * active" — never the match list, never random access.
 *
 * The store and {@link SearchBar} branch on these flags so a count-only
 * provider works without regressing the full-match path. `assertProviderContract`
 * (dev-only) verifies the flags agree with the methods the provider implements.
 *
 * @see providerAssertions.ts for the runtime contract check
 */
export interface SearchCapabilities {
  /** `search()` returns the full match list and `navigateTo(index)` is real. */
  readonly randomAccess: boolean
  /** `search()`'s returned array is authoritative (vs. `onCountChange` pushes). */
  readonly matchList: boolean
  /** Whole-word matching is supported (Chromium `findInPage` has no such option). */
  readonly wholeWord: boolean
}

/**
 * A push-based match count for count-only providers.
 *
 * Emitted through {@link SearchProvider.onCountChange}. `activeOrdinal` is
 * 1-based (the ordinal Chromium's `found-in-page` reports); `0` means "no
 * active match".
 */
export interface SearchCount {
  /** Total number of matches for the current query. */
  total: number
  /** 1-based ordinal of the active match, or `0` when there is none. */
  activeOrdinal: number
}

/**
 * Search provider interface.
 *
 * Responsibilities:
 * - Execute search queries against view-specific content
 * - Manage visual highlighting of matches
 * - Handle navigation between matches
 * - Cleanup resources when disposed
 *
 * The interface has two shapes selected by {@link capabilities}:
 *
 * - **Full-match** (`randomAccess: true, matchList: true`): implements
 *   `navigateTo` and `updateCurrentMatch`; `search()` returns the match list.
 *   Monaco and the markdown-preview DOM providers are here.
 * - **Count-only** (`randomAccess: false, matchList: false`): implements
 *   `nextMatch`/`previousMatch` for relative navigation and `onCountChange` to
 *   push counts; `search()` returns `[]`. The find-in-page preview provider is
 *   here.
 */
export interface SearchProvider {
  /** Unique provider identifier (e.g., 'monaco', 'preview'). */
  readonly id: string

  /** Human-readable name for debugging and logging. */
  readonly name: string

  /** What this provider can do; drives store + SearchBar branching. */
  readonly capabilities: SearchCapabilities

  /**
   * Execute search with given parameters.
   *
   * Should be called when query or options change. The provider
   * is responsible for any internal debouncing if needed.
   *
   * A count-only provider (`matchList: false`) returns `[]` here and reports
   * its results asynchronously through {@link onCountChange} instead.
   *
   * @param query - Search term (will be escaped for literal search)
   * @param options - Search modifiers (case sensitivity, whole word)
   * @returns Array of match results with position info (empty for count-only)
   */
  search(query: string, options: SearchOptions): Promise<SearchMatch[]>

  /**
   * Navigate to and highlight a specific match.
   *
   * REQUIRED when `capabilities.randomAccess` is `true`; absent otherwise.
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
  navigateTo?(index: number, options?: { focusEditor?: boolean }): void

  /**
   * Update visual distinction between current and other matches.
   *
   * REQUIRED when `capabilities.matchList` is `true`; absent otherwise.
   *
   * The current match should be visually distinct (brighter, different color)
   * from other matches.
   *
   * @param currentIndex - Currently focused match index
   */
  updateCurrentMatch?(currentIndex: number): void

  /**
   * Advance to the next match (relative navigation).
   *
   * REQUIRED when `capabilities.randomAccess` is `false` — a count-only
   * provider cannot jump to an index, so navigation is relative.
   */
  nextMatch?(): void

  /**
   * Move to the previous match (relative navigation).
   *
   * REQUIRED when `capabilities.randomAccess` is `false`.
   */
  previousMatch?(): void

  /**
   * Subscribe to pushed match counts.
   *
   * REQUIRED when `capabilities.matchList` is `false` — the provider learns its
   * count asynchronously and pushes it here instead of returning it from
   * `search()`.
   *
   * @param listener - Called with each new count
   * @returns Unsubscribe function
   */
  onCountChange?(listener: (count: SearchCount) => void): () => void

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
