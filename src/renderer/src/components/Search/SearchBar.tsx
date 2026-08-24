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

/** A debounced function with a `cancel` for discarding a pending call. */
type Debounced<TArgs extends unknown[]> = ((...args: TArgs) => void) & {
  cancel: () => void
}

/**
 * Creates a debounced function that delays execution until after
 * the specified wait time has elapsed since the last call.
 *
 * The returned function exposes `cancel()` to drop a pending call – callers
 * must invoke it on unmount, otherwise a late callback applies search results
 * after the search bar is gone (the store is global, so the stale write would
 * land on whatever is mounted next).
 */
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): Debounced<Parameters<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>): void => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
    }, delay)
  }

  debounced.cancel = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
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
    count,
    capabilities,
    navToken,
    navDirection,
    closeSearch,
    updateQuery,
    updateOptions,
    nextMatch,
    previousMatch,
    setMatches,
    setCount,
    setCapabilities,
    restoreFocus
  } = useSearchStore()

  // (X15b) Track the navToken we last acted on so the count-only nav effect does
  // NOT fire on mount (navToken 0) or on a provider-identity change — only on a
  // genuine user next/prev, which increments the token.
  const lastHandledNavToken = useRef(useSearchStore.getState().navToken)

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

  // Drop any pending debounced search on unmount (or when the debounced
  // function is recreated) so a late result cannot write to the global store
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch])

  // Sync the active provider's capabilities into the store. The store branches
  // on these (setMatches count derivation, next/prev), and SearchBar reads them
  // for the label/nav/whole-word UI. A null provider keeps full defaults.
  useEffect(() => {
    setCapabilities(
      provider ? provider.capabilities : { randomAccess: true, matchList: true, wholeWord: true }
    )
  }, [provider, setCapabilities])

  // Count-only providers push their totals asynchronously; forward them to the
  // store so the label can render "N of M" without a match list.
  useEffect(() => {
    if (!provider?.onCountChange) return undefined
    return provider.onCountChange(setCount)
  }, [provider, setCount])

  // Navigate when currentIndex changes — FULL-MATCH providers only. Count-only
  // providers keep currentIndex pinned at 0 and navigate via the navToken effect
  // below; guarding here is what stops a naive rewrite from freezing Monaco's
  // "N of M" label. Pass focusEditor: false so Monaco does not steal input focus.
  useEffect(() => {
    if (matches.length > 0 && provider && provider.capabilities.randomAccess) {
      provider.navigateTo?.(currentIndex, { focusEditor: false })
      provider.updateCurrentMatch?.(currentIndex)
    }
  }, [currentIndex, matches, provider])

  // Relative navigation for count-only providers. Issues `navToken - lastHandled`
  // steps in navDirection, so it never fires on mount (token starts at the ref's
  // value) or on a provider swap (steps <= 0), only on a real next/prev.
  useEffect(() => {
    if (!provider || provider.capabilities.randomAccess) return
    const steps = navToken - lastHandledNavToken.current
    if (steps <= 0) {
      lastHandledNavToken.current = navToken
      return
    }
    for (let i = 0; i < steps; i++) {
      if (navDirection === 'next') {
        provider.nextMatch?.()
      } else {
        provider.previousMatch?.()
      }
    }
    lastHandledNavToken.current = navToken
  }, [navToken, navDirection, provider])

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

  // Label source depends on the provider shape:
  // - matchList providers own the list, so read it directly (currentIndex+1 of
  //   matches.length) — reading count.activeOrdinal here would freeze Monaco at
  //   "1 of N" because nextMatch never writes count.
  // - count-only providers have no list; read the pushed count.
  const total = capabilities.matchList ? matches.length : count.total
  const ordinal = capabilities.matchList ? currentIndex + 1 : count.activeOrdinal
  const hasMatches = total > 0
  const matchCountText = hasMatches ? `${ordinal} of ${total}` : query ? 'No results' : ''

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
          disabled={!capabilities.wholeWord}
          title={
            capabilities.wholeWord
              ? 'Whole word (Alt+W)'
              : 'Whole word (not supported by this view)'
          }
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
          disabled={!hasMatches}
          aria-label="Previous match (Shift+Enter)"
          data-testid={TEST_IDS.SEARCH_BAR_BTN_PREV}
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          className="search-nav-btn"
          onClick={nextMatch}
          disabled={!hasMatches}
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
