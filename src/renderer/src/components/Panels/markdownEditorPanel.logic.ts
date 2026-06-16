// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic for MarkdownEditorPanel Component
 *
 * Extracted for unit testing without React rendering.
 * Functions are deterministic with consistent outputs for the same inputs.
 * Some functions interact with DOM elements (getBoundingClientRect) for
 * scroll position calculations but do not modify external state.
 *
 * @module markdownEditorPanel.logic
 */

import { getBasename } from '../../utils/fileUtils'

/**
 * Document statistics calculated from content
 */
export interface DocumentStats {
  /** Total word count */
  words: number
  /** Total character count including whitespace */
  characters: number
  /** Character count excluding whitespace */
  charactersNoSpaces: number
  /** Total number of lines */
  lines: number
  /** Estimated reading time in minutes (based on 200 WPM) */
  readingTimeMinutes: number
}

/**
 * Entry in the scroll synchronization map
 * Maps editor line positions to preview pixel offsets
 */
export interface ScrollMapEntry {
  /** Source line number from the editor */
  line: number
  /** Pixel offset from top in the editor */
  editorOffset: number
  /** Pixel offset from top in the preview */
  previewOffset: number
}

/**
 * Configuration for scroll map building
 */
export interface ScrollMapBuildConfig {
  /** Container's bounding client rect */
  containerRect: DOMRect
  /** Current scroll position of the container */
  containerScrollTop: number
}

/**
 * Result of processing a single DOM element for scroll mapping
 */
export interface ElementScrollData {
  /** Start line number */
  startLine: number
  /** End line number (same as start for single-line elements) */
  endLine: number
  /** Top offset relative to container */
  topOffset: number
  /** Bottom offset relative to container */
  bottomOffset: number
}

// ============================================================================
// Document Statistics
// ============================================================================

/**
 * Calculates document statistics from content string.
 *
 * Statistics include word count, character counts (with and without spaces),
 * line count, and estimated reading time based on 200 words per minute.
 *
 * @param content - The document content to analyze (handles null/undefined)
 * @returns Document statistics object
 *
 * @example
 * ```ts
 * const stats = calculateStats('Hello world!\nThis is a test.')
 * // { words: 5, characters: 29, charactersNoSpaces: 24, lines: 2, readingTimeMinutes: 1 }
 *
 * // Edge case: null/undefined returns zero stats
 * const emptyStats = calculateStats(null)
 * // { words: 0, characters: 0, charactersNoSpaces: 0, lines: 0, readingTimeMinutes: 0 }
 * ```
 */
export function calculateStats(content: string | null | undefined): DocumentStats {
  // Handle null/undefined input gracefully
  if (!content) {
    return {
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
      lines: 0,
      readingTimeMinutes: 0
    }
  }

  const lines = content.split('\n').length
  const characters = content.length
  const charactersNoSpaces = content.replace(/\s/g, '').length

  // Count words (split by whitespace and filter empty strings)
  const words = content
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length

  // Estimate reading time (average 200 words per minute)
  const readingTimeMinutes = Math.ceil(words / 200)

  return {
    words,
    characters,
    charactersNoSpaces,
    lines,
    readingTimeMinutes
  }
}

// ============================================================================
// Scroll Map Building
// ============================================================================

/**
 * Processes a DOM element with line attributes into scroll data.
 *
 * Extracts line start/end attributes and calculates offsets relative
 * to the container.
 *
 * @param element - DOM element with data-line-start attribute
 * @param config - Container configuration for offset calculation
 * @returns Scroll data or null if element has invalid attributes
 *
 * @example
 * ```ts
 * const element = document.querySelector('[data-line-start]')
 * const config = { containerRect, containerScrollTop: 0 }
 * const data = processElementForScrollMap(element, config)
 * // { startLine: 5, endLine: 10, topOffset: 120, bottomOffset: 180 }
 * ```
 */
export function processElementForScrollMap(
  element: Element,
  config: ScrollMapBuildConfig
): ElementScrollData | null {
  const startAttr = element.getAttribute('data-line-start')
  const endAttr = element.getAttribute('data-line-end')

  if (!startAttr) return null

  const startLine = parseInt(startAttr, 10)
  const endLine = endAttr ? parseInt(endAttr, 10) : startLine

  if (isNaN(startLine)) return null

  const rect = (element as HTMLElement).getBoundingClientRect()
  const topOffset = rect.top - config.containerRect.top + config.containerScrollTop
  const bottomOffset = rect.bottom - config.containerRect.top + config.containerScrollTop

  return {
    startLine,
    endLine: isNaN(endLine) ? startLine : endLine,
    topOffset,
    bottomOffset
  }
}

/**
 * Aggregates scroll data from multiple elements into a line-to-offset map.
 *
 * For start lines, prefers the smallest (top-most) offset.
 * For end lines, prefers the largest (bottom-most) offset.
 *
 * @param elementsData - Array of processed element scroll data
 * @returns Map of line numbers to preview offsets
 *
 * @example
 * ```ts
 * const data = [
 *   { startLine: 1, endLine: 1, topOffset: 0, bottomOffset: 20 },
 *   { startLine: 5, endLine: 10, topOffset: 100, bottomOffset: 200 }
 * ]
 * const map = aggregateLineOffsets(data)
 * // Map { 1 => 0, 5 => 100, 10 => 200 }
 * ```
 */
export function aggregateLineOffsets(elementsData: ElementScrollData[]): Map<number, number> {
  const lineToPreviewOffset = new Map<number, number>()

  for (const data of elementsData) {
    // For the start line of a block, prefer the smallest (top-most) offset
    const existingStart = lineToPreviewOffset.get(data.startLine)
    if (existingStart == null || data.topOffset < existingStart) {
      lineToPreviewOffset.set(data.startLine, data.topOffset)
    }

    // If the block spans multiple lines, add an entry for the end line using the bottom
    if (data.endLine !== data.startLine) {
      const existingEnd = lineToPreviewOffset.get(data.endLine)
      // For the end line, prefer the largest (bottom-most) offset
      if (existingEnd == null || data.bottomOffset > existingEnd) {
        lineToPreviewOffset.set(data.endLine, data.bottomOffset)
      }
    }
  }

  return lineToPreviewOffset
}

/**
 * Converts a line-to-offset map to sorted scroll map entries.
 *
 * Uses the provided editor offset getter to map lines to editor positions.
 * Sorts entries by line number for monotonic scroll mapping.
 *
 * @param lineToOffset - Map of line numbers to preview offsets
 * @param getEditorOffset - Function to get editor offset for a line number
 * @returns Sorted array of scroll map entries
 *
 * @example
 * ```ts
 * const lineMap = new Map([[1, 0], [5, 100]])
 * const getOffset = (line) => line * 20
 * const entries = buildScrollMapEntries(lineMap, getOffset)
 * // [{ line: 1, editorOffset: 20, previewOffset: 0 }, ...]
 * ```
 */
export function buildScrollMapEntries(
  lineToOffset: Map<number, number>,
  getEditorOffset: (line: number) => number
): ScrollMapEntry[] {
  const map: ScrollMapEntry[] = []

  for (const [line, previewOffset] of lineToOffset.entries()) {
    const editorOffset = getEditorOffset(line)
    map.push({ line, editorOffset, previewOffset })
  }

  // Sort by line number to ensure source monotonicity
  map.sort((a, b) => a.line - b.line)

  return map
}

/**
 * Enforces monotonic non-decreasing preview offsets to avoid scroll jitter.
 *
 * When a later entry has a smaller offset than a previous one, adjusts it
 * to be slightly larger (epsilon = 0.1) to maintain monotonicity.
 *
 * @param entries - Scroll map entries (must be sorted by line)
 * @returns Same array with adjusted preview offsets (mutates in place)
 *
 * @example
 * ```ts
 * const entries = [
 *   { line: 1, editorOffset: 0, previewOffset: 50 },
 *   { line: 2, editorOffset: 20, previewOffset: 40 } // out of order
 * ]
 * enforceMonotonicPreviewOffsets(entries)
 * // entries[1].previewOffset is now 50.1
 * ```
 */
export function enforceMonotonicPreviewOffsets(entries: ScrollMapEntry[]): ScrollMapEntry[] {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].previewOffset < entries[i - 1].previewOffset) {
      entries[i].previewOffset = entries[i - 1].previewOffset + 0.1 // epsilon
    }
  }
  return entries
}

// ============================================================================
// Scroll Position Interpolation
// ============================================================================

/**
 * Finds the insertion point in a sorted array using binary search.
 *
 * Returns the index where the target value would be inserted to maintain
 * sorted order. If target exists, returns its index.
 *
 * @param entries - Sorted scroll map entries
 * @param scrollTop - Target scroll position to find
 * @param sourceKey - Which offset to use for comparison ('editorOffset' or 'previewOffset')
 * @returns Index for insertion/interpolation
 *
 * @example
 * ```ts
 * const entries = [{ editorOffset: 0 }, { editorOffset: 100 }, { editorOffset: 200 }]
 * binarySearchScrollMap(entries, 150, 'editorOffset')
 * // Returns 2 (between index 1 and 2)
 * ```
 */
export function binarySearchScrollMap(
  entries: ScrollMapEntry[],
  scrollTop: number,
  sourceKey: 'editorOffset' | 'previewOffset'
): number {
  let left = 0
  let right = entries.length - 1

  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (entries[mid][sourceKey] < scrollTop) {
      left = mid + 1
    } else {
      right = mid
    }
  }

  return left
}

/**
 * Extrapolates scroll position before the first mapped point.
 *
 * Uses linear extrapolation through the first two points.
 * Formula: y = m*x + b where m = dy/dx
 *
 * @param scrollTop - Current scroll position
 * @param p1 - First scroll map entry
 * @param p2 - Second scroll map entry
 * @param sourceKey - Source offset key ('editorOffset' or 'previewOffset')
 * @param targetKey - Target offset key ('editorOffset' or 'previewOffset')
 * @returns Extrapolated target offset
 *
 * @example
 * ```ts
 * const p1 = { editorOffset: 100, previewOffset: 50 }
 * const p2 = { editorOffset: 200, previewOffset: 100 }
 * extrapolateBeforeFirst(50, p1, p2, 'editorOffset', 'previewOffset')
 * // Returns 25 (50 pixels before p1's preview offset)
 * ```
 */
export function extrapolateBeforeFirst(
  scrollTop: number,
  p1: ScrollMapEntry,
  p2: ScrollMapEntry,
  sourceKey: 'editorOffset' | 'previewOffset',
  targetKey: 'editorOffset' | 'previewOffset'
): number {
  const dx = p2[sourceKey] - p1[sourceKey]
  if (dx === 0) return p1[targetKey]

  const dy = p2[targetKey] - p1[targetKey]
  const m = dy / dx
  const b = p1[targetKey] - m * p1[sourceKey]
  return m * scrollTop + b
}

/**
 * Extrapolates scroll position after the last mapped point.
 *
 * Uses linear extrapolation through the last two points.
 * Formula: y = m*x + b where m = dy/dx
 *
 * @param scrollTop - Current scroll position
 * @param p1 - Second-to-last scroll map entry
 * @param p2 - Last scroll map entry
 * @param sourceKey - Source offset key ('editorOffset' or 'previewOffset')
 * @param targetKey - Target offset key ('editorOffset' or 'previewOffset')
 * @returns Extrapolated target offset
 *
 * @example
 * ```ts
 * const p1 = { editorOffset: 800, previewOffset: 400 }
 * const p2 = { editorOffset: 1000, previewOffset: 500 }
 * extrapolateAfterLast(1100, p1, p2, 'editorOffset', 'previewOffset')
 * // Returns 550 (50 pixels after p2's preview offset)
 * ```
 */
export function extrapolateAfterLast(
  scrollTop: number,
  p1: ScrollMapEntry,
  p2: ScrollMapEntry,
  sourceKey: 'editorOffset' | 'previewOffset',
  targetKey: 'editorOffset' | 'previewOffset'
): number {
  const dx = p2[sourceKey] - p1[sourceKey]
  if (dx === 0) return p2[targetKey]

  const dy = p2[targetKey] - p1[targetKey]
  const m = dy / dx
  const b = p1[targetKey] - m * p1[sourceKey]
  return m * scrollTop + b
}

/**
 * Linearly interpolates between two scroll map entries.
 *
 * Calculates the proportional position between two known points
 * and maps it to the target coordinate space.
 *
 * @param scrollTop - Current scroll position
 * @param before - Entry before the current position
 * @param after - Entry after the current position
 * @param sourceKey - Source offset key ('editorOffset' or 'previewOffset')
 * @param targetKey - Target offset key ('editorOffset' or 'previewOffset')
 * @returns Interpolated target offset
 *
 * @example
 * ```ts
 * const before = { editorOffset: 100, previewOffset: 50 }
 * const after = { editorOffset: 200, previewOffset: 150 }
 * linearInterpolate(150, before, after, 'editorOffset', 'previewOffset')
 * // Returns 100 (halfway between 50 and 150)
 * ```
 */
export function linearInterpolate(
  scrollTop: number,
  before: ScrollMapEntry,
  after: ScrollMapEntry,
  sourceKey: 'editorOffset' | 'previewOffset',
  targetKey: 'editorOffset' | 'previewOffset'
): number {
  const sourceRange = after[sourceKey] - before[sourceKey]
  if (sourceRange === 0) return before[targetKey]

  const ratio = (scrollTop - before[sourceKey]) / sourceRange
  const targetRange = after[targetKey] - before[targetKey]

  return before[targetKey] + ratio * targetRange
}

/**
 * Interpolates scroll position between known mapping points.
 *
 * Uses binary search to find the surrounding points, then:
 * - Extrapolates linearly if before first or after last point
 * - Interpolates linearly between two surrounding points
 *
 * CRITICAL: Handles end-of-document scrolling by calculating proportional offset
 *
 * @param scrollTop - Current scroll position in source coordinate space
 * @param map - Array of scroll map entries (must be sorted by source key)
 * @param sourceType - Whether scrolling from 'editor' or 'preview'
 * @returns Corresponding scroll position in target coordinate space
 *
 * @example
 * ```ts
 * const map = [
 *   { line: 1, editorOffset: 0, previewOffset: 0 },
 *   { line: 10, editorOffset: 200, previewOffset: 300 },
 *   { line: 20, editorOffset: 400, previewOffset: 600 }
 * ]
 * interpolateScrollPosition(100, map, 'editor')
 * // Returns 150 (halfway between 0 and 300)
 * ```
 */
export function interpolateScrollPosition(
  scrollTop: number,
  map: ScrollMapEntry[],
  sourceType: 'editor' | 'preview'
): number {
  if (map.length === 0) return scrollTop
  if (map.length === 1) {
    return map[0][sourceType === 'editor' ? 'previewOffset' : 'editorOffset']
  }

  const sourceKey = sourceType === 'editor' ? 'editorOffset' : 'previewOffset'
  const targetKey = sourceType === 'editor' ? 'previewOffset' : 'editorOffset'

  const insertionPoint = binarySearchScrollMap(map, scrollTop, sourceKey)

  // Handle edge cases
  if (insertionPoint === 0) {
    // Before first entry: extrapolate using line through first two points
    return extrapolateBeforeFirst(scrollTop, map[0], map[1], sourceKey, targetKey)
  }

  if (insertionPoint >= map.length) {
    // After last entry: extrapolate using line through last two points
    return extrapolateAfterLast(
      scrollTop,
      map[map.length - 2],
      map[map.length - 1],
      sourceKey,
      targetKey
    )
  }

  // Linear interpolation between two points
  return linearInterpolate(scrollTop, map[insertionPoint - 1], map[insertionPoint], sourceKey, targetKey)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Determines if the view mode is a split mode (either vertical or horizontal).
 *
 * @param viewMode - Current view mode
 * @returns true if split mode, false otherwise
 *
 * @example
 * ```ts
 * isSplitMode('split') // true
 * isSplitMode('split-horizontal') // true
 * isSplitMode('editor') // false
 * isSplitMode('preview') // false
 * ```
 */
export function isSplitMode(
  viewMode: 'split' | 'split-horizontal' | 'editor' | 'preview'
): boolean {
  return viewMode === 'split' || viewMode === 'split-horizontal'
}

/**
 * Extracts file name from a file path.
 *
 * @param filePath - Full file path
 * @returns File name without directory, or '(Untitled)' if path is empty/invalid
 *
 * @example
 * ```ts
 * extractFileName('/path/to/document.md') // 'document.md'
 * extractFileName('document.md') // 'document.md'
 * extractFileName('') // '(Untitled)'
 * ```
 */
export function extractFileName(filePath: string): string {
  return getBasename(filePath) || '(Untitled)'
}

/**
 * Extracts base file name without extension.
 *
 * @param filePath - Full file path
 * @param extension - Extension to remove (default: .md)
 * @returns File name without extension
 *
 * @example
 * ```ts
 * extractBaseFileName('/path/to/document.md') // 'document'
 * extractBaseFileName('/path/to/readme.markdown', '.markdown') // 'readme'
 * ```
 */
export function extractBaseFileName(filePath: string, extension: string = '.md'): string {
  const fileName = extractFileName(filePath)
  const regex = new RegExp(`${extension}$`, 'i')
  return fileName.replace(regex, '') || 'document'
}

/**
 * Formats tab title based on file state.
 *
 * @param fileName - Base file name
 * @param modified - Whether file has unsaved changes
 * @param deleted - Whether file was deleted externally
 * @returns Formatted title string
 *
 * @example
 * ```ts
 * formatTabTitle('doc.md', false, false) // 'doc.md'
 * formatTabTitle('doc.md', true, false) // '● doc.md'
 * formatTabTitle('doc.md', false, true) // 'doc.md (deleted)'
 * formatTabTitle('doc.md', true, true) // 'doc.md (deleted)'
 * ```
 */
export function formatTabTitle(fileName: string, modified: boolean, deleted: boolean): string {
  if (deleted) {
    return `${fileName} (deleted)`
  }
  if (modified) {
    return `● ${fileName}`
  }
  return fileName
}

/**
 * Determines if a file is a markdown file based on extension.
 *
 * @param filePath - File path to check
 * @returns true if markdown file, false otherwise
 *
 * @example
 * ```ts
 * isMarkdownFile('document.md') // true
 * isMarkdownFile('readme.markdown') // true
 * isMarkdownFile('script.js') // false
 * ```
 */
export function isMarkdownFile(filePath: string): boolean {
  const extension = filePath.toLowerCase().split('.').pop()
  return extension === 'md' || extension === 'markdown'
}

/**
 * Determines the default view mode based on file type.
 *
 * @param filePath - File path to check
 * @returns 'preview' for markdown files, 'editor' for others
 *
 * @example
 * ```ts
 * getDefaultViewMode('document.md') // 'preview'
 * getDefaultViewMode('script.js') // 'editor'
 * ```
 */
export function getDefaultViewMode(
  filePath: string
): 'split' | 'split-horizontal' | 'editor' | 'preview' {
  return isMarkdownFile(filePath) ? 'preview' : 'editor'
}
