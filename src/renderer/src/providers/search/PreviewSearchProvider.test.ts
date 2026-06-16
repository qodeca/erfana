// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSearchProvider.test.ts
 *
 * Test coverage for Preview pane search provider
 *
 * Test groups:
 * - Constructor and initialization (2 tests)
 * - search() - basic functionality (7 tests)
 * - search() - TreeWalker filtering (4 tests)
 * - search() - special character escaping (3 tests)
 * - search() - options handling (3 tests)
 * - search() - error handling (4 tests)
 * - navigateTo() (4 tests)
 * - clearHighlights() - CSS Highlight API (3 tests)
 * - clearHighlights() - fallback mode (2 tests)
 * - updateCurrentMatch() - CSS Highlight API (2 tests)
 * - updateCurrentMatch() - fallback mode (3 tests)
 * - dispose() (2 tests)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PreviewSearchProvider } from './PreviewSearchProvider'
import { logger } from '../../utils/logger'

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Type for CSS Highlight API
interface HighlightRegistry extends Map<string, Highlight> {
  set(name: string, highlight: Highlight): this
  delete(name: string): boolean
  clear(): void
}

// Global Highlight API mock
let mockHighlights: HighlightRegistry

describe('PreviewSearchProvider', () => {
  let provider: PreviewSearchProvider
  let containerRef: React.RefObject<HTMLDivElement | null>
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()

    // Create container
    container = document.createElement('div')
    container.innerHTML = `
      <p>This is a test paragraph.</p>
      <p>Another test here.</p>
      <script>console.log('should be ignored')</script>
      <style>.test { color: red; }</style>
      <p>Final test content.</p>
    `
    document.body.appendChild(container)

    // Create ref
    containerRef = { current: container }

    // Mock CSS Highlight API
    mockHighlights = new Map() as HighlightRegistry
    ;(window as any).Highlight = class Highlight {
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
      ranges: Range[]
    }
    ;(CSS as any).highlights = mockHighlights

    // Create provider
    provider = new PreviewSearchProvider(containerRef)
  })

  afterEach(() => {
    document.body.removeChild(container)
    delete (window as any).Highlight
    delete (CSS as any).highlights
  })

  describe('Constructor and initialization', () => {
    it('creates provider with correct id and name', () => {
      expect(provider.id).toBe('preview')
      expect(provider.name).toBe('Markdown Preview')
    })

    it('stores container ref', () => {
      expect(containerRef.current).toBe(container)
    })
  })

  describe('search() - basic functionality', () => {
    it('returns matches when query is found', async () => {
      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toMatchObject({
        id: expect.stringContaining('preview-'),
        line: 0,
        text: 'test'
      })
    })

    it('returns multiple matches for repeated text', async () => {
      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      // "test" appears in: "test paragraph", "Another test", "Final test"
      expect(results.length).toBe(3)
    })

    it('returns empty array when no matches found', async () => {
      const results = await provider.search('zzzznonexistent', {
        caseSensitive: false,
        wholeWord: false
      })

      expect(results).toEqual([])
    })

    it('returns empty array when query is empty', async () => {
      const results = await provider.search('', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('returns empty array when container is null', async () => {
      containerRef.current = null

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('includes Range in match metadata', async () => {
      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results[0]?.meta).toHaveProperty('range')
      expect(results[0]?.meta?.range).toBeInstanceOf(Range)
    })

    it('logs debug message with match count', async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(logger.debug).toHaveBeenCalledWith(
        'PreviewSearchProvider: Search complete',
        expect.objectContaining({
          query: 'test',
          matchCount: 3,
          usingHighlightAPI: true
        })
      )
    })
  })

  describe('search() - TreeWalker filtering', () => {
    it('skips SCRIPT elements', async () => {
      const results = await provider.search('console', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('skips STYLE elements', async () => {
      const results = await provider.search('color', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('skips empty text nodes', async () => {
      container.innerHTML = `<p>   </p><p>text</p>`

      const results = await provider.search('text', { caseSensitive: false, wholeWord: false })

      expect(results).toHaveLength(1)
      expect(results[0]?.text).toBe('text')
    })

    it('searches through nested elements', async () => {
      container.innerHTML = `
        <div>
          <p><strong>bold test</strong></p>
          <ul><li>list test</li></ul>
        </div>
      `

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results).toHaveLength(2)
    })
  })

  describe('search() - special character escaping', () => {
    it('escapes regex special characters in query', async () => {
      container.innerHTML = `<p>Test with dots...</p>`

      const results = await provider.search('dots...', { caseSensitive: false, wholeWord: false })

      expect(results).toHaveLength(1)
      expect(results[0]?.text).toBe('dots...')
    })

    it('escapes brackets and parentheses', async () => {
      container.innerHTML = `<p>Function call()</p>`

      const results = await provider.search('call()', { caseSensitive: false, wholeWord: false })

      expect(results).toHaveLength(1)
      expect(results[0]?.text).toBe('call()')
    })

    it('escapes dollar signs and backslashes', async () => {
      container.innerHTML = `<p>$100 cost</p>`

      const results = await provider.search('$100', { caseSensitive: false, wholeWord: false })

      expect(results).toHaveLength(1)
      expect(results[0]?.text).toBe('$100')
    })
  })

  describe('search() - options handling', () => {
    it('respects caseSensitive option', async () => {
      container.innerHTML = `<p>Test and test</p>`

      const caseSensitiveResults = await provider.search('Test', {
        caseSensitive: true,
        wholeWord: false
      })
      const caseInsensitiveResults = await provider.search('Test', {
        caseSensitive: false,
        wholeWord: false
      })

      expect(caseSensitiveResults).toHaveLength(1) // Only "Test"
      expect(caseInsensitiveResults).toHaveLength(2) // "Test" and "test"
    })

    it('respects wholeWord option', async () => {
      container.innerHTML = `<p>test testing tester</p>`

      const wholeWordResults = await provider.search('test', {
        caseSensitive: false,
        wholeWord: true
      })
      const partialResults = await provider.search('test', {
        caseSensitive: false,
        wholeWord: false
      })

      expect(wholeWordResults).toHaveLength(1) // Only "test"
      expect(partialResults).toHaveLength(3) // "test", "testing", "tester"
    })

    it('combines caseSensitive and wholeWord options', async () => {
      container.innerHTML = `<p>Test testing TEST tester</p>`

      const results = await provider.search('Test', { caseSensitive: true, wholeWord: true })

      expect(results).toHaveLength(1) // Only "Test" (exact match, whole word)
      expect(results[0]?.text).toBe('Test')
    })
  })

  describe('search() - error handling', () => {
    it('returns empty array on search error', async () => {
      // Force an error by making createTreeWalker unavailable
      const originalCreateTreeWalker = document.createTreeWalker
      document.createTreeWalker = (() => {
        throw new Error('TreeWalker error')
      }) as any

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
      document.createTreeWalker = originalCreateTreeWalker
    })

    it('logs error when search fails', async () => {
      const error = new Error('TreeWalker error')
      const originalCreateTreeWalker = document.createTreeWalker
      document.createTreeWalker = (() => {
        throw error
      }) as any

      await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(logger.error).toHaveBeenCalledWith(
        'PreviewSearchProvider.search error',
        error,
        { query: 'test', options: { caseSensitive: false, wholeWord: false } }
      )
      document.createTreeWalker = originalCreateTreeWalker
    })

    it('logs warning for invalid range and continues', async () => {
      container.innerHTML = `<p>test content</p>`

      // Mock Range.setStart to throw on first call
      const originalSetStart = Range.prototype.setStart
      let callCount = 0
      Range.prototype.setStart = function (...args: any[]) {
        callCount++
        if (callCount === 1) {
          throw new Error('Invalid range')
        }
        return originalSetStart.apply(this, args as any)
      }

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(logger.warn).toHaveBeenCalled()
      expect(results).toEqual([]) // First match failed, no other matches
      Range.prototype.setStart = originalSetStart
    })

    it('clears highlight ranges on error', async () => {
      // First, populate with successful search
      await provider.search('test', { caseSensitive: false, wholeWord: false })

      // Now trigger error
      const originalCreateTreeWalker = document.createTreeWalker
      document.createTreeWalker = (() => {
        throw new Error('TreeWalker error')
      }) as any

      await provider.search('error', { caseSensitive: false, wholeWord: false })

      // navigateTo should not work because ranges were cleared
      const scrollIntoViewSpy = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewSpy

      provider.navigateTo(0)
      expect(scrollIntoViewSpy).not.toHaveBeenCalled()

      document.createTreeWalker = originalCreateTreeWalker
    })
  })

  describe('navigateTo()', () => {
    beforeEach(async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })
    })

    it('scrolls element into view', () => {
      const scrollIntoViewSpy = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewSpy

      provider.navigateTo(0)

      expect(scrollIntoViewSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center'
      })
    })

    it('does nothing for invalid index (negative)', () => {
      const scrollIntoViewSpy = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewSpy

      provider.navigateTo(-1)

      expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    it('does nothing for invalid index (out of bounds)', () => {
      const scrollIntoViewSpy = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewSpy

      provider.navigateTo(999)

      expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    it('logs error on navigation failure', () => {
      Element.prototype.scrollIntoView = () => {
        throw new Error('Scroll error')
      }

      provider.navigateTo(0)

      expect(logger.error).toHaveBeenCalledWith(
        'PreviewSearchProvider.navigateTo error',
        expect.any(Error),
        { index: 0 }
      )
    })
  })

  describe('clearHighlights() - CSS Highlight API', () => {
    it('removes highlights from CSS.highlights registry', async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(mockHighlights.has('search-results')).toBe(true)

      provider.clearHighlights()

      expect(mockHighlights.has('search-results')).toBe(false)
      expect(mockHighlights.has('search-current')).toBe(false)
    })

    it('clears highlight ranges', async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })

      provider.clearHighlights()

      // navigateTo should not work after clear
      const scrollIntoViewSpy = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewSpy

      provider.navigateTo(0)
      expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    it('handles missing highlights gracefully', () => {
      // Clear without searching first
      expect(() => provider.clearHighlights()).not.toThrow()
    })
  })

  describe('clearHighlights() - fallback mode', () => {
    beforeEach(() => {
      // Disable CSS Highlight API
      delete (window as any).Highlight
      delete (CSS as any).highlights
    })

    it('removes fallback classes from elements', async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })

      const highlightedElements = container.querySelectorAll('.search-highlight-fallback')
      expect(highlightedElements.length).toBeGreaterThan(0)

      provider.clearHighlights()

      const remainingHighlights = container.querySelectorAll('.search-highlight-fallback')
      expect(remainingHighlights).toHaveLength(0)
    })

    it('removes current fallback classes', async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })
      provider.updateCurrentMatch(0)

      const currentElements = container.querySelectorAll('.search-highlight-current-fallback')
      expect(currentElements.length).toBeGreaterThan(0)

      provider.clearHighlights()

      const remainingCurrent = container.querySelectorAll('.search-highlight-current-fallback')
      expect(remainingCurrent).toHaveLength(0)
    })
  })

  describe('updateCurrentMatch() - CSS Highlight API', () => {
    beforeEach(async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })
    })

    it('creates current highlight in registry', () => {
      provider.updateCurrentMatch(0)

      expect(mockHighlights.has('search-current')).toBe(true)
    })

    it('does nothing for invalid index', () => {
      const initialSize = mockHighlights.size

      provider.updateCurrentMatch(-1)
      provider.updateCurrentMatch(999)

      expect(mockHighlights.size).toBe(initialSize)
    })
  })

  describe('updateCurrentMatch() - fallback mode', () => {
    beforeEach(async () => {
      // Disable CSS Highlight API
      delete (window as any).Highlight
      delete (CSS as any).highlights

      await provider.search('test', { caseSensitive: false, wholeWord: false })
    })

    it('adds current class to ancestor element', () => {
      provider.updateCurrentMatch(0)

      const currentElements = container.querySelectorAll('.search-highlight-current-fallback')
      expect(currentElements).toHaveLength(1)
    })

    it('removes previous current class before adding new one', () => {
      provider.updateCurrentMatch(0)
      const first = container.querySelector('.search-highlight-current-fallback')

      provider.updateCurrentMatch(1)
      const current = container.querySelector('.search-highlight-current-fallback')

      expect(first).not.toBe(current)
      expect(container.querySelectorAll('.search-highlight-current-fallback')).toHaveLength(1)
    })

    it('logs error on update failure', () => {
      // Force error by making querySelectorAll throw
      const originalQuerySelectorAll = container.querySelectorAll
      container.querySelectorAll = (() => {
        throw new Error('Query error')
      }) as any

      provider.updateCurrentMatch(0)

      expect(logger.error).toHaveBeenCalled()

      container.querySelectorAll = originalQuerySelectorAll
    })
  })

  describe('dispose()', () => {
    it('clears highlights on dispose', async () => {
      await provider.search('test', { caseSensitive: false, wholeWord: false })

      provider.dispose()

      expect(mockHighlights.size).toBe(0)
    })

    it('logs debug message', () => {
      provider.dispose()

      expect(logger.debug).toHaveBeenCalledWith('PreviewSearchProvider disposed')
    })
  })
})
