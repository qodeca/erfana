// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import type { SearchProvider } from '../../providers/search'
import { useSearchStore, type SearchOptions } from '../../stores/useSearchStore'
import { TEST_IDS } from '../../constants/testids'
import './SearchBar.css'

/** Debounce delay for search execution in milliseconds */
const SEARCH_DEBOUNCE_MS = 100

/** Focus delay to ensure component is mounted */
const FOCUS_DELAY_MS = 10

/**
 * Creates a debounced function that delays execution until after
 * the specified wait time has elapsed since the last call.
 */
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
    }, delay)
  }
}

interface SearchBarProps {
  provider: SearchProvider | null
}

/**
 * SearchBar - Unified search overlay component for editor and preview panes.
 *
 * Features:
 * - Debounced search execution (100ms)
 * - Keyboard navigation (Enter=next, Shift+Enter=previous, Escape=close)
 * - Case sensitivity and whole word toggles
 * - Match count display
 * - Focus trap for Tab key
 * - Auto-focus on mount
 * - Accessible with ARIA labels and live regions
 */
export function SearchBar({ provider }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    isOpen,
    query,
    options,
    matches,
    currentIndex,
    closeSearch,
    updateQuery,
    updateOptions,
    nextMatch,
    previousMatch,
    setMatches,
    restoreFocus
  } = useSearchStore()

  // Create debounced search function with error handling (NFR-006)
  const debouncedSearch = useMemo(
    () =>
      debounce(async (q: string, opts: SearchOptions) => {
        if (!provider) return
        try {
          const results = await provider.search(q, opts)
          setMatches(results)
        } catch {
          // Graceful degradation: log and clear matches (per NFR-006)
          setMatches([])
        }
      }, SEARCH_DEBOUNCE_MS),
    [provider, setMatches]
  )

  // Execute search when query or options change
  useEffect(() => {
    if (query && provider) {
      debouncedSearch(query, options)
    } else if (!query && provider) {
      // Clear matches when query is empty
      setMatches([])
      provider.clearHighlights()
    }
  }, [query, options, provider, debouncedSearch, setMatches])

  // Navigate when currentIndex changes
  // Pass focusEditor: false to prevent Monaco from stealing focus from search input
  useEffect(() => {
    if (matches.length > 0 && provider) {
      provider.navigateTo(currentIndex, { focusEditor: false })
      provider.updateCurrentMatch(currentIndex)
    }
  }, [currentIndex, matches, provider])

  // Auto-focus input on mount
  useEffect(() => {
    if (!isOpen) return undefined

    const timer = setTimeout(() => {
      inputRef.current?.focus()
      // Select all text for easy replacement
      inputRef.current?.select()
    }, FOCUS_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isOpen])

  // Handle close with cleanup
  const handleClose = useCallback(() => {
    provider?.clearHighlights()
    closeSearch()
    restoreFocus()
  }, [provider, closeSearch, restoreFocus])

  // Keyboard handlers for input
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          previousMatch()
        } else {
          nextMatch()
        }
      }
    },
    [handleClose, nextMatch, previousMatch]
  )

  // Stop all keyboard events from bubbling to Monaco editor
  // This prevents Monaco from capturing keystrokes and triggering intellisense
  const stopPropagation = useCallback((e: React.KeyboardEvent | React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  // Focus trap handler - Tab cycles within SearchBar
  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Stop propagation to prevent Monaco from receiving keystrokes
      // Only stop for keys that Monaco might capture (not Space which triggers button clicks)
      if (e.key !== ' ') {
        e.stopPropagation()
      }

      if (e.key === 'Tab') {
        const focusableElements = containerRef.current?.querySelectorAll(
          'input, button:not([disabled])'
        )
        if (!focusableElements || focusableElements.length === 0) return

        const firstElement = focusableElements[0] as HTMLElement
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

        if (e.shiftKey) {
          // Shift+Tab from first element goes to last
          if (document.activeElement === firstElement) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          // Tab from last element goes to first
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    },
    []
  )

  // Handle toggle button Enter key (Space is handled natively by button click)
  const handleToggleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, type: 'caseSensitive' | 'wholeWord') => {
      if (e.key === 'Enter') {
        e.preventDefault()
        // Read current state directly from store to avoid stale closure
        const currentOptions = useSearchStore.getState().options
        updateOptions({ [type]: !currentOptions[type] })
      }
      // Space handled by native button click - do not duplicate
    },
    [updateOptions]
  )

  if (!isOpen) return null

  const matchCountText =
    matches.length > 0
      ? `${currentIndex + 1} of ${matches.length}`
      : query
        ? 'No results'
        : ''

  return (
    <div
      ref={containerRef}
      className="search-bar"
      role="search"
      aria-label="Find in document"
      onKeyDown={handleContainerKeyDown}
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      data-testid={TEST_IDS.SEARCH_BAR}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => updateQuery(e.target.value)}
        onKeyDown={(e) => {
          stopPropagation(e)
          handleInputKeyDown(e)
        }}
        placeholder="Search..."
        aria-label="Search in document"
        className="search-input"
        data-testid={TEST_IDS.SEARCH_BAR_INPUT}
      />

      <div className="search-toggles">
        <button
          type="button"
          className={`search-toggle-btn${options.caseSensitive ? ' active' : ''}`}
          onClick={() => updateOptions({ caseSensitive: !options.caseSensitive })}
          onKeyDown={(e) => handleToggleKeyDown(e, 'caseSensitive')}
          aria-pressed={options.caseSensitive}
          title="Case sensitive (Alt+C)"
          data-testid={TEST_IDS.SEARCH_BAR_TOGGLE_CASE}
        >
          Aa
        </button>
        <button
          type="button"
          className={`search-toggle-btn${options.wholeWord ? ' active' : ''}`}
          onClick={() => updateOptions({ wholeWord: !options.wholeWord })}
          onKeyDown={(e) => handleToggleKeyDown(e, 'wholeWord')}
          aria-pressed={options.wholeWord}
          title="Whole word (Alt+W)"
          data-testid={TEST_IDS.SEARCH_BAR_TOGGLE_WORD}
        >
          ab
        </button>
      </div>

      <span className="search-match-count" aria-live="polite" data-testid={TEST_IDS.SEARCH_BAR_COUNT}>
        {matchCountText}
      </span>

      <div className="search-navigation">
        <button
          type="button"
          className="search-nav-btn"
          onClick={previousMatch}
          disabled={matches.length === 0}
          aria-label="Previous match (Shift+Enter)"
          data-testid={TEST_IDS.SEARCH_BAR_BTN_PREV}
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          className="search-nav-btn"
          onClick={nextMatch}
          disabled={matches.length === 0}
          aria-label="Next match (Enter)"
          data-testid={TEST_IDS.SEARCH_BAR_BTN_NEXT}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <button
        type="button"
        className="search-close-btn"
        onClick={handleClose}
        aria-label="Close search (Escape)"
        data-testid={TEST_IDS.SEARCH_BAR_BTN_CLOSE}
      >
        <X size={16} />
      </button>
    </div>
  )
}
