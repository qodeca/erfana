// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for MarkdownEditorPanel Pure Logic
 *
 * Tests extracted pure functions without React rendering.
 * All tests are synchronous and deterministic.
 */

import { describe, it, expect } from 'vitest'
import {
  // Types
  type ScrollMapEntry,
  type ScrollMapBuildConfig,
  type ElementScrollData,
  // Document Statistics
  calculateStats,
  // Scroll Map Building
  processElementForScrollMap,
  aggregateLineOffsets,
  buildScrollMapEntries,
  enforceMonotonicPreviewOffsets,
  // Scroll Position Interpolation
  binarySearchScrollMap,
  extrapolateBeforeFirst,
  extrapolateAfterLast,
  linearInterpolate,
  interpolateScrollPosition,
  // Utility Functions
  isSplitMode,
  extractFileName,
  extractBaseFileName,
  formatTabTitle,
  isMarkdownFile,
  getDefaultViewMode
} from './markdownEditorPanel.logic'

// ============================================================================
// Document Statistics Tests
// ============================================================================

describe('calculateStats', () => {
  it('should calculate basic statistics for simple content', () => {
    const content = 'Hello world'
    const stats = calculateStats(content)

    expect(stats.words).toBe(2)
    expect(stats.characters).toBe(11)
    expect(stats.charactersNoSpaces).toBe(10)
    expect(stats.lines).toBe(1)
    expect(stats.readingTimeMinutes).toBe(1)
  })

  it('should handle empty content', () => {
    const stats = calculateStats('')

    expect(stats.words).toBe(0)
    expect(stats.characters).toBe(0)
    expect(stats.charactersNoSpaces).toBe(0)
    expect(stats.lines).toBe(0) // Empty/null content returns 0 lines
    expect(stats.readingTimeMinutes).toBe(0)
  })

  it('should handle null content', () => {
    const stats = calculateStats(null)

    expect(stats.words).toBe(0)
    expect(stats.characters).toBe(0)
    expect(stats.charactersNoSpaces).toBe(0)
    expect(stats.lines).toBe(0)
    expect(stats.readingTimeMinutes).toBe(0)
  })

  it('should handle undefined content', () => {
    const stats = calculateStats(undefined)

    expect(stats.words).toBe(0)
    expect(stats.characters).toBe(0)
    expect(stats.charactersNoSpaces).toBe(0)
    expect(stats.lines).toBe(0)
    expect(stats.readingTimeMinutes).toBe(0)
  })

  it('should count multiple lines correctly', () => {
    const content = 'Line 1\nLine 2\nLine 3'
    const stats = calculateStats(content)

    expect(stats.lines).toBe(3)
    expect(stats.words).toBe(6)
  })

  it('should handle content with only whitespace', () => {
    const content = '   \n\t\n  '
    const stats = calculateStats(content)

    expect(stats.words).toBe(0)
    expect(stats.charactersNoSpaces).toBe(0)
    expect(stats.characters).toBe(8)
  })

  it('should calculate reading time for long content', () => {
    // 200 words = 1 minute, 400 words = 2 minutes, etc.
    const words = Array(250).fill('word').join(' ')
    const stats = calculateStats(words)

    expect(stats.words).toBe(250)
    expect(stats.readingTimeMinutes).toBe(2) // ceil(250/200) = 2
  })

  it('should calculate reading time rounding up', () => {
    const words = Array(201).fill('word').join(' ')
    const stats = calculateStats(words)

    expect(stats.readingTimeMinutes).toBe(2) // ceil(201/200) = 2
  })

  it('should handle special characters and punctuation', () => {
    const content = 'Hello, world! How are you?'
    const stats = calculateStats(content)

    expect(stats.words).toBe(5)
    expect(stats.characters).toBe(26)
  })

  it('should handle multiple consecutive spaces', () => {
    const content = 'word1    word2     word3'
    const stats = calculateStats(content)

    expect(stats.words).toBe(3)
  })

  it('should handle tabs and newlines in word count', () => {
    const content = 'word1\tword2\nword3'
    const stats = calculateStats(content)

    expect(stats.words).toBe(3)
  })

  it('should match original component output', () => {
    // Test case matching real-world usage
    const content = `# Heading

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const code = 'example';
\`\`\`
`
    const stats = calculateStats(content)

    expect(stats.lines).toBeGreaterThan(1)
    expect(stats.words).toBeGreaterThan(0)
    expect(stats.characters).toBeGreaterThan(0)
    expect(stats.readingTimeMinutes).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Scroll Map Building Tests
// ============================================================================

describe('processElementForScrollMap', () => {
  const createMockConfig = (
    containerTop: number = 0,
    scrollTop: number = 0
  ): ScrollMapBuildConfig => ({
    containerRect: { top: containerTop } as DOMRect,
    containerScrollTop: scrollTop
  })

  const createMockElement = (
    lineStart: string | null,
    lineEnd: string | null,
    top: number,
    bottom: number
  ): Element => {
    const element = {
      getAttribute: (attr: string) => {
        if (attr === 'data-line-start') return lineStart
        if (attr === 'data-line-end') return lineEnd
        return null
      },
      getBoundingClientRect: () => ({
        top,
        bottom,
        left: 0,
        right: 100,
        width: 100,
        height: bottom - top
      })
    } as unknown as Element
    return element
  }

  it('should return null for element without data-line-start', () => {
    const element = createMockElement(null, null, 0, 20)
    const config = createMockConfig()

    expect(processElementForScrollMap(element, config)).toBeNull()
  })

  it('should return null for element with invalid line number', () => {
    const element = createMockElement('invalid', null, 0, 20)
    const config = createMockConfig()

    expect(processElementForScrollMap(element, config)).toBeNull()
  })

  it('should process single-line element correctly', () => {
    const element = createMockElement('5', null, 100, 120)
    const config = createMockConfig(0, 0)

    const result = processElementForScrollMap(element, config)

    expect(result).toEqual({
      startLine: 5,
      endLine: 5,
      topOffset: 100,
      bottomOffset: 120
    })
  })

  it('should process multi-line element correctly', () => {
    const element = createMockElement('10', '20', 200, 400)
    const config = createMockConfig(0, 0)

    const result = processElementForScrollMap(element, config)

    expect(result).toEqual({
      startLine: 10,
      endLine: 20,
      topOffset: 200,
      bottomOffset: 400
    })
  })

  it('should account for container offset', () => {
    const element = createMockElement('1', null, 150, 170)
    const config = createMockConfig(100, 0) // Container starts at 100

    const result = processElementForScrollMap(element, config)

    expect(result?.topOffset).toBe(50) // 150 - 100
    expect(result?.bottomOffset).toBe(70) // 170 - 100
  })

  it('should account for scroll position', () => {
    const element = createMockElement('1', null, 50, 70)
    const config = createMockConfig(0, 100) // Scrolled 100px

    const result = processElementForScrollMap(element, config)

    expect(result?.topOffset).toBe(150) // 50 + 100
    expect(result?.bottomOffset).toBe(170) // 70 + 100
  })

  it('should handle invalid end line gracefully', () => {
    const element = createMockElement('5', 'invalid', 100, 120)
    const config = createMockConfig()

    const result = processElementForScrollMap(element, config)

    expect(result?.startLine).toBe(5)
    expect(result?.endLine).toBe(5) // Falls back to startLine
  })
})

describe('aggregateLineOffsets', () => {
  it('should return empty map for empty input', () => {
    const result = aggregateLineOffsets([])
    expect(result.size).toBe(0)
  })

  it('should create single entry for single-line element', () => {
    const data: ElementScrollData[] = [{ startLine: 5, endLine: 5, topOffset: 100, bottomOffset: 120 }]

    const result = aggregateLineOffsets(data)

    expect(result.size).toBe(1)
    expect(result.get(5)).toBe(100)
  })

  it('should create two entries for multi-line element', () => {
    const data: ElementScrollData[] = [{ startLine: 10, endLine: 20, topOffset: 100, bottomOffset: 300 }]

    const result = aggregateLineOffsets(data)

    expect(result.size).toBe(2)
    expect(result.get(10)).toBe(100)
    expect(result.get(20)).toBe(300)
  })

  it('should prefer smallest offset for start lines', () => {
    const data: ElementScrollData[] = [
      { startLine: 5, endLine: 5, topOffset: 200, bottomOffset: 220 },
      { startLine: 5, endLine: 5, topOffset: 100, bottomOffset: 120 } // Smaller offset
    ]

    const result = aggregateLineOffsets(data)

    expect(result.get(5)).toBe(100) // Smallest wins
  })

  it('should prefer largest offset for end lines', () => {
    const data: ElementScrollData[] = [
      { startLine: 1, endLine: 10, topOffset: 0, bottomOffset: 100 },
      { startLine: 5, endLine: 10, topOffset: 50, bottomOffset: 200 } // Larger bottom offset
    ]

    const result = aggregateLineOffsets(data)

    expect(result.get(10)).toBe(200) // Largest wins
  })

  it('should handle overlapping ranges', () => {
    const data: ElementScrollData[] = [
      { startLine: 1, endLine: 5, topOffset: 0, bottomOffset: 100 },
      { startLine: 3, endLine: 8, topOffset: 60, bottomOffset: 180 },
      { startLine: 6, endLine: 10, topOffset: 120, bottomOffset: 250 }
    ]

    const result = aggregateLineOffsets(data)

    expect(result.get(1)).toBe(0)
    expect(result.get(3)).toBe(60)
    expect(result.get(5)).toBe(100)
    expect(result.get(6)).toBe(120)
    expect(result.get(8)).toBe(180)
    expect(result.get(10)).toBe(250)
  })
})

describe('buildScrollMapEntries', () => {
  it('should return empty array for empty map', () => {
    const lineToOffset = new Map<number, number>()
    const getEditorOffset = (line: number) => line * 20

    const result = buildScrollMapEntries(lineToOffset, getEditorOffset)

    expect(result).toEqual([])
  })

  it('should create entries with correct editor offsets', () => {
    const lineToOffset = new Map([[1, 0], [5, 100], [10, 200]])
    const getEditorOffset = (line: number) => line * 20

    const result = buildScrollMapEntries(lineToOffset, getEditorOffset)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ line: 1, editorOffset: 20, previewOffset: 0 })
    expect(result[1]).toEqual({ line: 5, editorOffset: 100, previewOffset: 100 })
    expect(result[2]).toEqual({ line: 10, editorOffset: 200, previewOffset: 200 })
  })

  it('should sort entries by line number', () => {
    const lineToOffset = new Map([[10, 200], [1, 0], [5, 100]]) // Unordered
    const getEditorOffset = (line: number) => line * 20

    const result = buildScrollMapEntries(lineToOffset, getEditorOffset)

    expect(result[0].line).toBe(1)
    expect(result[1].line).toBe(5)
    expect(result[2].line).toBe(10)
  })
})

describe('enforceMonotonicPreviewOffsets', () => {
  it('should not modify already monotonic entries', () => {
    const entries: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 0 },
      { line: 5, editorOffset: 100, previewOffset: 50 },
      { line: 10, editorOffset: 200, previewOffset: 100 }
    ]

    const result = enforceMonotonicPreviewOffsets([...entries])

    expect(result[0].previewOffset).toBe(0)
    expect(result[1].previewOffset).toBe(50)
    expect(result[2].previewOffset).toBe(100)
  })

  it('should fix non-monotonic preview offsets', () => {
    const entries: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 100 },
      { line: 5, editorOffset: 100, previewOffset: 50 }, // Out of order
      { line: 10, editorOffset: 200, previewOffset: 200 }
    ]

    const result = enforceMonotonicPreviewOffsets(entries)

    expect(result[0].previewOffset).toBe(100)
    expect(result[1].previewOffset).toBe(100.1) // Adjusted to previous + epsilon
    expect(result[2].previewOffset).toBe(200)
  })

  it('should handle multiple consecutive non-monotonic entries', () => {
    const entries: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 100 },
      { line: 2, editorOffset: 20, previewOffset: 80 },
      { line: 3, editorOffset: 40, previewOffset: 60 },
      { line: 4, editorOffset: 60, previewOffset: 40 }
    ]

    const result = enforceMonotonicPreviewOffsets(entries)

    // Each should be slightly larger than the previous (use toBeCloseTo for floating-point)
    expect(result[0].previewOffset).toBe(100)
    expect(result[1].previewOffset).toBeCloseTo(100.1, 5)
    expect(result[2].previewOffset).toBeCloseTo(100.2, 5)
    expect(result[3].previewOffset).toBeCloseTo(100.3, 5)
  })

  it('should return empty array for empty input', () => {
    const result = enforceMonotonicPreviewOffsets([])
    expect(result).toEqual([])
  })

  it('should return single entry unchanged', () => {
    const entries: ScrollMapEntry[] = [{ line: 1, editorOffset: 0, previewOffset: 50 }]

    const result = enforceMonotonicPreviewOffsets(entries)

    expect(result[0].previewOffset).toBe(50)
  })
})

// ============================================================================
// Scroll Position Interpolation Tests
// ============================================================================

describe('binarySearchScrollMap', () => {
  const entries: ScrollMapEntry[] = [
    { line: 1, editorOffset: 0, previewOffset: 0 },
    { line: 5, editorOffset: 100, previewOffset: 150 },
    { line: 10, editorOffset: 200, previewOffset: 300 },
    { line: 20, editorOffset: 400, previewOffset: 600 }
  ]

  it('should find insertion point for value in middle', () => {
    const result = binarySearchScrollMap(entries, 150, 'editorOffset')
    expect(result).toBe(2) // Between index 1 (100) and 2 (200)
  })

  it('should return 0 for value before first entry', () => {
    const result = binarySearchScrollMap(entries, -50, 'editorOffset')
    expect(result).toBe(0)
  })

  it('should return length for value after last entry', () => {
    const result = binarySearchScrollMap(entries, 500, 'editorOffset')
    expect(result).toBe(3) // Points to last entry
  })

  it('should find exact match', () => {
    const result = binarySearchScrollMap(entries, 100, 'editorOffset')
    expect(result).toBe(1)
  })

  it('should work with previewOffset as source', () => {
    const result = binarySearchScrollMap(entries, 450, 'previewOffset')
    expect(result).toBe(3) // Between index 2 (300) and 3 (600)
  })
})

describe('extrapolateBeforeFirst', () => {
  it('should extrapolate linearly before first point', () => {
    const p1: ScrollMapEntry = { line: 1, editorOffset: 100, previewOffset: 50 }
    const p2: ScrollMapEntry = { line: 5, editorOffset: 200, previewOffset: 100 }

    // Slope: (100-50)/(200-100) = 0.5
    // At scrollTop=0: 0.5*0 + (50 - 0.5*100) = 0
    const result = extrapolateBeforeFirst(0, p1, p2, 'editorOffset', 'previewOffset')
    expect(result).toBe(0)
  })

  it('should handle zero dx (vertical line)', () => {
    const p1: ScrollMapEntry = { line: 1, editorOffset: 100, previewOffset: 50 }
    const p2: ScrollMapEntry = { line: 5, editorOffset: 100, previewOffset: 100 }

    const result = extrapolateBeforeFirst(0, p1, p2, 'editorOffset', 'previewOffset')
    expect(result).toBe(50) // Returns p1's target value
  })

  it('should extrapolate in reverse direction', () => {
    const p1: ScrollMapEntry = { line: 1, editorOffset: 0, previewOffset: 0 }
    const p2: ScrollMapEntry = { line: 5, editorOffset: 100, previewOffset: 200 }

    // Slope: 200/100 = 2
    // At scrollTop=-50: 2*(-50) + 0 = -100
    const result = extrapolateBeforeFirst(-50, p1, p2, 'editorOffset', 'previewOffset')
    expect(result).toBe(-100)
  })
})

describe('extrapolateAfterLast', () => {
  it('should extrapolate linearly after last point', () => {
    const p1: ScrollMapEntry = { line: 10, editorOffset: 200, previewOffset: 300 }
    const p2: ScrollMapEntry = { line: 20, editorOffset: 400, previewOffset: 600 }

    // Slope: (600-300)/(400-200) = 1.5
    // At scrollTop=500: 1.5*500 + (300 - 1.5*200) = 750 + 0 = 750
    const result = extrapolateAfterLast(500, p1, p2, 'editorOffset', 'previewOffset')
    expect(result).toBe(750)
  })

  it('should handle zero dx (vertical line)', () => {
    const p1: ScrollMapEntry = { line: 10, editorOffset: 400, previewOffset: 300 }
    const p2: ScrollMapEntry = { line: 20, editorOffset: 400, previewOffset: 600 }

    const result = extrapolateAfterLast(500, p1, p2, 'editorOffset', 'previewOffset')
    expect(result).toBe(600) // Returns p2's target value
  })
})

describe('linearInterpolate', () => {
  it('should interpolate at midpoint', () => {
    const before: ScrollMapEntry = { line: 1, editorOffset: 0, previewOffset: 0 }
    const after: ScrollMapEntry = { line: 10, editorOffset: 100, previewOffset: 200 }

    const result = linearInterpolate(50, before, after, 'editorOffset', 'previewOffset')
    expect(result).toBe(100) // Halfway
  })

  it('should interpolate at 25%', () => {
    const before: ScrollMapEntry = { line: 1, editorOffset: 0, previewOffset: 0 }
    const after: ScrollMapEntry = { line: 10, editorOffset: 100, previewOffset: 200 }

    const result = linearInterpolate(25, before, after, 'editorOffset', 'previewOffset')
    expect(result).toBe(50)
  })

  it('should interpolate at 75%', () => {
    const before: ScrollMapEntry = { line: 1, editorOffset: 0, previewOffset: 0 }
    const after: ScrollMapEntry = { line: 10, editorOffset: 100, previewOffset: 200 }

    const result = linearInterpolate(75, before, after, 'editorOffset', 'previewOffset')
    expect(result).toBe(150)
  })

  it('should handle zero source range', () => {
    const before: ScrollMapEntry = { line: 1, editorOffset: 100, previewOffset: 50 }
    const after: ScrollMapEntry = { line: 10, editorOffset: 100, previewOffset: 150 }

    const result = linearInterpolate(100, before, after, 'editorOffset', 'previewOffset')
    expect(result).toBe(50) // Returns before's target
  })

  it('should work with previewOffset as source', () => {
    const before: ScrollMapEntry = { line: 1, editorOffset: 0, previewOffset: 0 }
    const after: ScrollMapEntry = { line: 10, editorOffset: 100, previewOffset: 200 }

    const result = linearInterpolate(100, before, after, 'previewOffset', 'editorOffset')
    expect(result).toBe(50) // Halfway in editor
  })
})

describe('interpolateScrollPosition', () => {
  it('should return scrollTop for empty map', () => {
    const result = interpolateScrollPosition(100, [], 'editor')
    expect(result).toBe(100)
  })

  it('should return single entry target for single-entry map', () => {
    const map: ScrollMapEntry[] = [{ line: 1, editorOffset: 50, previewOffset: 100 }]

    expect(interpolateScrollPosition(0, map, 'editor')).toBe(100)
    expect(interpolateScrollPosition(0, map, 'preview')).toBe(50)
  })

  it('should interpolate between entries', () => {
    const map: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 0 },
      { line: 10, editorOffset: 100, previewOffset: 200 }
    ]

    const result = interpolateScrollPosition(50, map, 'editor')
    expect(result).toBe(100) // Halfway
  })

  it('should extrapolate before first entry', () => {
    const map: ScrollMapEntry[] = [
      { line: 1, editorOffset: 100, previewOffset: 200 },
      { line: 10, editorOffset: 200, previewOffset: 400 }
    ]

    // Slope: (400-200)/(200-100) = 2
    // At 0: 2*0 + (200 - 2*100) = 0
    const result = interpolateScrollPosition(0, map, 'editor')
    expect(result).toBe(0)
  })

  it('should extrapolate after last entry', () => {
    const map: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 0 },
      { line: 10, editorOffset: 100, previewOffset: 200 }
    ]

    // Slope: 200/100 = 2
    // At 150: 2*150 + 0 = 300
    const result = interpolateScrollPosition(150, map, 'editor')
    expect(result).toBe(300)
  })

  it('should work bidirectionally (preview to editor)', () => {
    const map: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 0 },
      { line: 10, editorOffset: 100, previewOffset: 200 }
    ]

    // At previewOffset 100, editorOffset should be 50
    const result = interpolateScrollPosition(100, map, 'preview')
    expect(result).toBe(50)
  })

  it('should handle real-world scroll map', () => {
    const map: ScrollMapEntry[] = [
      { line: 1, editorOffset: 0, previewOffset: 0 },
      { line: 10, editorOffset: 180, previewOffset: 240 },
      { line: 20, editorOffset: 360, previewOffset: 480 },
      { line: 50, editorOffset: 900, previewOffset: 1200 }
    ]

    // Scroll to line 15 (between entries 1 and 2)
    const editorPos = 270 // Between 180 and 360
    const result = interpolateScrollPosition(editorPos, map, 'editor')

    // Should be between 240 and 480
    expect(result).toBeGreaterThan(240)
    expect(result).toBeLessThan(480)
  })
})

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe('isSplitMode', () => {
  it('should return true for split mode', () => {
    expect(isSplitMode('split')).toBe(true)
  })

  it('should return true for split-horizontal mode', () => {
    expect(isSplitMode('split-horizontal')).toBe(true)
  })

  it('should return false for editor mode', () => {
    expect(isSplitMode('editor')).toBe(false)
  })

  it('should return false for preview mode', () => {
    expect(isSplitMode('preview')).toBe(false)
  })
})

describe('extractFileName', () => {
  it('should extract file name from Unix path', () => {
    expect(extractFileName('/path/to/document.md')).toBe('document.md')
  })

  it('should handle simple file name', () => {
    expect(extractFileName('document.md')).toBe('document.md')
  })

  it('should return "(Untitled)" for empty path', () => {
    expect(extractFileName('')).toBe('(Untitled)')
  })

  it('should ignore a trailing slash and return the final segment', () => {
    expect(extractFileName('/path/to/')).toBe('to')
  })

  it('should handle deeply nested paths', () => {
    expect(extractFileName('/a/b/c/d/e/file.txt')).toBe('file.txt')
  })

  it('should extract the file name from a Windows backslash path', () => {
    expect(extractFileName('C:\\path\\to\\document.md')).toBe('document.md')
  })
})

describe('extractBaseFileName', () => {
  it('should remove .md extension', () => {
    expect(extractBaseFileName('/path/to/document.md')).toBe('document')
  })

  it('should remove .MD extension (case insensitive)', () => {
    expect(extractBaseFileName('/path/to/DOCUMENT.MD')).toBe('DOCUMENT')
  })

  it('should handle custom extension', () => {
    expect(extractBaseFileName('/path/to/readme.markdown', '.markdown')).toBe('readme')
  })

  it('should return "document" for empty result', () => {
    expect(extractBaseFileName('.md')).toBe('document')
  })

  it('should handle file without extension', () => {
    expect(extractBaseFileName('/path/to/README')).toBe('README')
  })
})

describe('formatTabTitle', () => {
  it('should return plain file name when not modified and not deleted', () => {
    expect(formatTabTitle('doc.md', false, false)).toBe('doc.md')
  })

  it('should add bullet when modified', () => {
    expect(formatTabTitle('doc.md', true, false)).toBe('● doc.md')
  })

  it('should add (deleted) suffix when deleted', () => {
    expect(formatTabTitle('doc.md', false, true)).toBe('doc.md (deleted)')
  })

  it('should prefer deleted over modified indicator', () => {
    expect(formatTabTitle('doc.md', true, true)).toBe('doc.md (deleted)')
  })
})

describe('isMarkdownFile', () => {
  it('should return true for .md extension', () => {
    expect(isMarkdownFile('document.md')).toBe(true)
  })

  it('should return true for .MD extension (case insensitive)', () => {
    expect(isMarkdownFile('DOCUMENT.MD')).toBe(true)
  })

  it('should return true for .markdown extension', () => {
    expect(isMarkdownFile('readme.markdown')).toBe(true)
  })

  it('should return false for .js extension', () => {
    expect(isMarkdownFile('script.js')).toBe(false)
  })

  it('should return false for .txt extension', () => {
    expect(isMarkdownFile('notes.txt')).toBe(false)
  })

  it('should handle files with multiple dots', () => {
    expect(isMarkdownFile('file.test.md')).toBe(true)
    expect(isMarkdownFile('file.md.bak')).toBe(false)
  })
})

describe('getDefaultViewMode', () => {
  it('should return preview for markdown files', () => {
    expect(getDefaultViewMode('document.md')).toBe('preview')
    expect(getDefaultViewMode('readme.markdown')).toBe('preview')
  })

  it('should return editor for non-markdown files', () => {
    expect(getDefaultViewMode('script.js')).toBe('editor')
    expect(getDefaultViewMode('styles.css')).toBe('editor')
    expect(getDefaultViewMode('data.json')).toBe('editor')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration: Full scroll map workflow', () => {
  it('should build and use scroll map correctly', () => {
    // Simulate DOM elements with line attributes
    const elementsData: ElementScrollData[] = [
      { startLine: 1, endLine: 1, topOffset: 0, bottomOffset: 24 },
      { startLine: 3, endLine: 5, topOffset: 48, bottomOffset: 120 },
      { startLine: 8, endLine: 8, topOffset: 168, bottomOffset: 192 },
      { startLine: 10, endLine: 15, topOffset: 216, bottomOffset: 360 }
    ]

    // Step 1: Aggregate line offsets
    const lineMap = aggregateLineOffsets(elementsData)
    expect(lineMap.size).toBe(6) // Lines: 1, 3, 5, 8, 10, 15

    // Step 2: Build scroll map entries
    const getEditorOffset = (line: number) => (line - 1) * 20
    const entries = buildScrollMapEntries(lineMap, getEditorOffset)
    expect(entries.length).toBe(6)

    // Step 3: Enforce monotonicity
    const monotonic = enforceMonotonicPreviewOffsets(entries)
    for (let i = 1; i < monotonic.length; i++) {
      expect(monotonic[i].previewOffset).toBeGreaterThanOrEqual(monotonic[i - 1].previewOffset)
    }

    // Step 4: Interpolate scroll positions
    // At editor offset 40 (line 3), preview should be around 48
    const previewPos = interpolateScrollPosition(40, monotonic, 'editor')
    expect(previewPos).toBeGreaterThan(0)
    expect(previewPos).toBeLessThan(200)
  })
})

describe('Integration: Document stats for various content types', () => {
  it('should handle markdown with code blocks', () => {
    const content = '# Title\n\nSome text here.\n\n```javascript\nfunction hello() {\n  console.log(\'Hello\');\n}\n```\n\nMore text.'
    const stats = calculateStats(content)

    expect(stats.lines).toBe(11)
    expect(stats.words).toBeGreaterThan(5)
  })

  it('should handle markdown with tables', () => {
    const content = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |`

    const stats = calculateStats(content)

    expect(stats.lines).toBe(4)
  })

  it('should handle unicode content', () => {
    const content = 'Hello, world. Witaj swiecie.'

    const stats = calculateStats(content)

    expect(stats.words).toBe(4)
    expect(stats.characters).toBeGreaterThan(0)
  })
})
