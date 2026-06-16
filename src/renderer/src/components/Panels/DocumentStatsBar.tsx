// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DocumentStatsBar - Displays document statistics in a footer bar.
 *
 * Shows word count, character count, line count, and reading time.
 * When text is selected, also displays selection statistics.
 *
 * @module components/Panels/DocumentStatsBar
 */

import { TEST_IDS } from '../../constants/testids'
import './DocumentStatsBar.css'

/**
 * Document statistics calculated from content.
 */
export interface DocumentStats {
  /** Total number of words in the document */
  words: number
  /** Total number of characters in the document */
  characters: number
  /** Total number of lines in the document */
  lines: number
  /** Estimated reading time in minutes */
  readingTimeMinutes: number
}

/**
 * Props for the DocumentStatsBar component.
 */
export interface DocumentStatsBarProps {
  /**
   * Document statistics to display.
   * When null, the component renders nothing.
   */
  stats: DocumentStats | null
  /**
   * Currently selected text in the editor.
   * When non-empty, selection stats are shown.
   */
  selectedText: string
}

/**
 * Renders a footer bar displaying document statistics.
 *
 * Shows word count, character count, line count, and estimated reading time.
 * When text is selected in the editor, displays additional selection statistics
 * including character count of the selection.
 *
 * @param props - Component props
 * @returns Rendered stats bar or null if no stats available
 *
 * @example Basic usage
 * ```tsx
 * const stats = {
 *   words: 1250,
 *   characters: 7500,
 *   lines: 85,
 *   readingTimeMinutes: 5
 * }
 *
 * <DocumentStatsBar stats={stats} selectedText="" />
 * ```
 *
 * @example With selection
 * ```tsx
 * <DocumentStatsBar
 *   stats={stats}
 *   selectedText="Hello world"
 * />
 * // Displays: "Words: 1,250 | ... | Selected: 11 chars"
 * ```
 */
export function DocumentStatsBar({
  stats,
  selectedText
}: DocumentStatsBarProps): JSX.Element | null {
  // Don't render if no stats available
  if (!stats) {
    return null
  }

  return (
    <div className="document-stats-bar" data-testid={TEST_IDS.DOCUMENT_STATS_BAR}>
      <div className="stats-group">
        <span className="stat-item" data-testid={TEST_IDS.STATS_WORDS}>
          <span className="stat-label">Words:</span>
          <span className="stat-value">{stats.words.toLocaleString()}</span>
        </span>
        <span className="stat-separator">•</span>
        <span className="stat-item" data-testid={TEST_IDS.STATS_CHARACTERS}>
          <span className="stat-label">Characters:</span>
          <span className="stat-value">{stats.characters.toLocaleString()}</span>
        </span>
        <span className="stat-separator">•</span>
        <span className="stat-item" data-testid={TEST_IDS.STATS_LINES}>
          <span className="stat-label">Lines:</span>
          <span className="stat-value">{stats.lines.toLocaleString()}</span>
        </span>
        <span className="stat-separator">•</span>
        <span className="stat-item" data-testid={TEST_IDS.STATS_READING_TIME}>
          <span className="stat-label">Reading time:</span>
          <span className="stat-value">
            {stats.readingTimeMinutes} min
          </span>
        </span>
      </div>

      {/* Selection stats - only shown when text is selected */}
      {selectedText && (
        <div className="stats-group selection-stats">
          <span className="stat-separator">|</span>
          <span className="stat-item" data-testid={TEST_IDS.STATS_SELECTION}>
            <span className="stat-label">Selected:</span>
            <span className="stat-value">{selectedText.length} chars</span>
          </span>
        </div>
      )}
    </div>
  )
}
