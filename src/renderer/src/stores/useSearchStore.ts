// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create } from 'zustand'
import type { SearchCapabilities, SearchCount } from '../providers/search/SearchProvider'

/**
 * Search options for controlling search behavior
 */
export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
}

/**
 * Full capabilities — the default before any provider is active.
 *
 * Chosen so the store behaves exactly like the pre-widening store when no
 * provider has synced its capabilities yet: `nextMatch`/`previousMatch` do the
 * modular index arithmetic and the label reads the match list. A count-only
 * provider overwrites this via `setCapabilities`.
 */
const DEFAULT_CAPABILITIES: SearchCapabilities = {
  randomAccess: true,
  matchList: true,
  wholeWord: true
}

/** A zero count — no matches, no active ordinal. */
const DEFAULT_COUNT: SearchCount = { total: 0, activeOrdinal: 0 }

/**
 * Represents a single search match result from a provider
 */
export interface SearchMatch {
  /** Provider-specific identifier for this match */
  id: string
  /** Zero-based line number (for Monaco) or element index (for DOM) */
  line: number
  /** Character offset within line (Monaco) or text offset (DOM) */
  startColumn: number
  endColumn: number
  /** Matched text content */
  text: string
  /** Provider-specific metadata for navigation */
  meta?: unknown
}

/**
 * Direction of the most recent relative-navigation request.
 *
 * Consumed by SearchBar's navToken effect to know which way to step a
 * count-only provider.
 */
export type NavDirection = 'next' | 'previous'

/**
 * Cached state for a search provider (for split mode pane switching).
 *
 * `count` and `capabilities` are optional so pre-existing callers that build a
 * bare `{ query, matches, currentIndex }` still typecheck; `cacheProviderState`
 * always writes them, and `restoreProviderState` falls back to defaults when a
 * cached entry omits them. Caching `capabilities` is what stops a restored
 * state from pairing one provider's matches with another's capabilities.
 */
interface ProviderState {
  query: string
  matches: SearchMatch[]
  currentIndex: number
  count?: SearchCount
  capabilities?: SearchCapabilities
}

/**
 * Search store state and actions
 */
export interface SearchState {
  // Core state
  isOpen: boolean
  query: string
  options: SearchOptions

  // Match state
  matches: SearchMatch[]
  currentIndex: number

  // Count-only providers push their totals here (matchList: false).
  count: SearchCount

  // Capabilities of the active provider; drives next/prev + label branching.
  capabilities: SearchCapabilities

  // Monotonic navigation counter (X15b). Replaces modular next/prev for
  // count-only providers, whose currentIndex must stay pinned at 0. SearchBar
  // diffs it against a ref to know how many relative steps to issue.
  navToken: number

  // Direction of the most recent next/prev request.
  navDirection: NavDirection

  // Active provider
  activeProviderId: string | null

  // Per-provider state cache (for split mode pane switching)
  providerStates: Map<string, ProviderState>

  // Focus restoration
  previousFocusElement: HTMLElement | null

  // Actions
  openSearch: (initialQuery?: string) => void
  closeSearch: () => void
  resetSearch: () => void
  updateQuery: (query: string) => void
  updateOptions: (options: Partial<SearchOptions>) => void
  setMatches: (matches: SearchMatch[]) => void
  setCount: (count: SearchCount) => void
  setCapabilities: (capabilities: SearchCapabilities) => void
  nextMatch: () => void
  previousMatch: () => void
  setActiveProvider: (id: string | null) => void
  savePreviousFocus: (element: HTMLElement | null) => void
  restoreFocus: () => void
  cacheProviderState: (providerId: string) => void
  restoreProviderState: (providerId: string) => void
}

const DEFAULT_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false
}

export const useSearchStore = create<SearchState>((set, get) => ({
  // Initial state
  isOpen: false,
  query: '',
  options: { ...DEFAULT_OPTIONS },
  matches: [],
  currentIndex: 0,
  count: { ...DEFAULT_COUNT },
  capabilities: { ...DEFAULT_CAPABILITIES },
  navToken: 0,
  navDirection: 'next',
  activeProviderId: null,
  providerStates: new Map(),
  previousFocusElement: null,

  // Actions
  openSearch: (initialQuery?: string) => {
    // Save current focus before opening
    const activeElement = document.activeElement as HTMLElement | null
    set({
      isOpen: true,
      previousFocusElement: activeElement,
      query: initialQuery ?? ''
    })
  },

  closeSearch: () => {
    // Clear query and matches but preserve providerStates cache
    set({
      isOpen: false,
      query: '',
      matches: [],
      currentIndex: 0,
      count: { ...DEFAULT_COUNT }
    })
  },

  // Full reset for file changes - clears everything including provider cache
  resetSearch: () =>
    set({
      isOpen: false,
      query: '',
      options: { ...DEFAULT_OPTIONS },
      matches: [],
      currentIndex: 0,
      count: { ...DEFAULT_COUNT },
      capabilities: { ...DEFAULT_CAPABILITIES },
      navToken: 0,
      navDirection: 'next',
      activeProviderId: null,
      providerStates: new Map(),
      previousFocusElement: null
    }),

  updateQuery: (query) => set({ query, currentIndex: 0 }),

  updateOptions: (options) =>
    set((state) => ({
      options: { ...state.options, ...options }
    })),

  setMatches: (matches) =>
    set((state) => {
      // Derive count ONLY for matchList providers — for a count-only provider
      // the authoritative count arrives via setCount (onCountChange), and
      // matches is always []. Overwriting it here would clobber the pushed count.
      if (!state.capabilities.matchList) {
        return { matches }
      }
      return {
        matches,
        count: {
          total: matches.length,
          activeOrdinal: matches.length > 0 ? state.currentIndex + 1 : 0
        }
      }
    }),

  setCount: (count) => set({ count }),

  setCapabilities: (capabilities) => set({ capabilities }),

  nextMatch: () =>
    set((state) => {
      const base = {
        navToken: state.navToken + 1,
        navDirection: 'next' as const
      }
      // Full-match providers advance the index (modular wrap); the navToken bump
      // is harmless because SearchBar's token effect returns early for them.
      // Count-only providers leave currentIndex pinned and rely on navToken.
      if (state.capabilities.randomAccess) {
        return {
          ...base,
          currentIndex:
            state.matches.length > 0 ? (state.currentIndex + 1) % state.matches.length : 0
        }
      }
      return base
    }),

  previousMatch: () =>
    set((state) => {
      const base = {
        navToken: state.navToken + 1,
        navDirection: 'previous' as const
      }
      if (state.capabilities.randomAccess) {
        return {
          ...base,
          currentIndex:
            state.matches.length > 0
              ? (state.currentIndex - 1 + state.matches.length) % state.matches.length
              : 0
        }
      }
      return base
    }),

  setActiveProvider: (id) => {
    const state = get()
    // Cache current provider state before switching
    if (state.activeProviderId && state.isOpen) {
      state.cacheProviderState(state.activeProviderId)
    }
    set({ activeProviderId: id })
    // Restore new provider's state if cached
    if (id) {
      state.restoreProviderState(id)
    }
  },

  savePreviousFocus: (element) => set({ previousFocusElement: element }),

  restoreFocus: () => {
    const { previousFocusElement } = get()
    if (previousFocusElement && typeof previousFocusElement.focus === 'function') {
      previousFocusElement.focus()
    }
    set({ previousFocusElement: null })
  },

  cacheProviderState: (providerId) => {
    const { query, matches, currentIndex, count, capabilities, providerStates } = get()
    const newCache = new Map(providerStates)
    // Cache capabilities + count alongside matches so a later restore never
    // pairs one provider's matches with another's capabilities.
    newCache.set(providerId, { query, matches, currentIndex, count, capabilities })
    set({ providerStates: newCache })
  },

  restoreProviderState: (providerId) => {
    const { providerStates } = get()
    const cached = providerStates.get(providerId)
    if (cached) {
      set({
        query: cached.query,
        matches: cached.matches,
        currentIndex: cached.currentIndex,
        count: cached.count ?? { ...DEFAULT_COUNT },
        capabilities: cached.capabilities ?? { ...DEFAULT_CAPABILITIES }
      })
    } else {
      // New provider, start fresh but keep search open. Reset count, navToken
      // AND capabilities — otherwise the fresh matches would be read through the
      // previous provider's capabilities.
      set({
        query: '',
        matches: [],
        currentIndex: 0,
        count: { ...DEFAULT_COUNT },
        navToken: 0,
        capabilities: { ...DEFAULT_CAPABILITIES }
      })
    }
  }
}))
