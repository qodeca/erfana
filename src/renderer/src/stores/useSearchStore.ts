// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create } from 'zustand'

/**
 * Search options for controlling search behavior
 */
export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
}

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
 * Cached state for a search provider (for split mode pane switching)
 */
interface ProviderState {
  query: string
  matches: SearchMatch[]
  currentIndex: number
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
      currentIndex: 0
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
      activeProviderId: null,
      providerStates: new Map(),
      previousFocusElement: null
    }),

  updateQuery: (query) => set({ query, currentIndex: 0 }),

  updateOptions: (options) =>
    set((state) => ({
      options: { ...state.options, ...options }
    })),

  setMatches: (matches) => set({ matches }),

  nextMatch: () =>
    set((state) => ({
      currentIndex:
        state.matches.length > 0 ? (state.currentIndex + 1) % state.matches.length : 0
    })),

  previousMatch: () =>
    set((state) => ({
      currentIndex:
        state.matches.length > 0
          ? (state.currentIndex - 1 + state.matches.length) % state.matches.length
          : 0
    })),

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
    const { query, matches, currentIndex, providerStates } = get()
    const newCache = new Map(providerStates)
    newCache.set(providerId, { query, matches, currentIndex })
    set({ providerStates: newCache })
  },

  restoreProviderState: (providerId) => {
    const { providerStates } = get()
    const cached = providerStates.get(providerId)
    if (cached) {
      set({ query: cached.query, matches: cached.matches, currentIndex: cached.currentIndex })
    } else {
      // New provider, start fresh but keep search open
      set({ query: '', matches: [], currentIndex: 0 })
    }
  }
}))
