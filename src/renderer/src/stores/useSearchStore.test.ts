// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useSearchStore.test.ts
 *
 * Test coverage for unified search store
 *
 * Test groups:
 * - Initial state (7 tests)
 * - openSearch (6 tests)
 * - closeSearch (2 tests)
 * - resetSearch (2 tests)
 * - updateQuery (2 tests)
 * - updateOptions (4 tests)
 * - setMatches (1 test)
 * - nextMatch (3 tests)
 * - previousMatch (3 tests)
 * - setActiveProvider (4 tests)
 * - savePreviousFocus / restoreFocus (3 tests)
 * - Provider state caching (6 tests)
 * - Provider state restoration (3 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSearchStore } from './useSearchStore'
import type { SearchMatch } from './useSearchStore'

describe('useSearchStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSearchStore.setState({
      isOpen: false,
      query: '',
      options: { caseSensitive: false, wholeWord: false },
      matches: [],
      currentIndex: 0,
      activeProviderId: null,
      providerStates: new Map(),
      previousFocusElement: null
    })
  })

  describe('Initial state', () => {
    it('starts with isOpen=false', () => {
      const state = useSearchStore.getState()
      expect(state.isOpen).toBe(false)
    })

    it('starts with empty query', () => {
      const state = useSearchStore.getState()
      expect(state.query).toBe('')
    })

    it('starts with default options', () => {
      const state = useSearchStore.getState()
      expect(state.options).toEqual({
        caseSensitive: false,
        wholeWord: false
      })
    })

    it('starts with empty matches array', () => {
      const state = useSearchStore.getState()
      expect(state.matches).toEqual([])
    })

    it('starts with currentIndex=0', () => {
      const state = useSearchStore.getState()
      expect(state.currentIndex).toBe(0)
    })

    it('starts with null activeProviderId', () => {
      const state = useSearchStore.getState()
      expect(state.activeProviderId).toBeNull()
    })

    it('starts with empty providerStates Map', () => {
      const state = useSearchStore.getState()
      expect(state.providerStates).toBeInstanceOf(Map)
      expect(state.providerStates.size).toBe(0)
    })
  })

  describe('openSearch', () => {
    it('sets isOpen to true', () => {
      const store = useSearchStore.getState()
      store.openSearch()

      expect(useSearchStore.getState().isOpen).toBe(true)
    })

    it('saves current focus element', () => {
      // Create a test element and focus it
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()

      const store = useSearchStore.getState()
      store.openSearch()

      expect(useSearchStore.getState().previousFocusElement).toBe(button)

      // Cleanup
      document.body.removeChild(button)
    })

    it('sets query to empty string when no initialQuery provided', () => {
      useSearchStore.setState({ query: 'existing query' })

      const store = useSearchStore.getState()
      store.openSearch()

      expect(useSearchStore.getState().query).toBe('')
    })

    it('sets query to initialQuery when provided', () => {
      const store = useSearchStore.getState()
      store.openSearch('selected text')

      expect(useSearchStore.getState().query).toBe('selected text')
    })

    it('handles empty string initialQuery', () => {
      useSearchStore.setState({ query: 'existing query' })

      const store = useSearchStore.getState()
      store.openSearch('')

      expect(useSearchStore.getState().query).toBe('')
    })

    it('handles undefined initialQuery explicitly', () => {
      useSearchStore.setState({ query: 'existing query' })

      const store = useSearchStore.getState()
      store.openSearch(undefined)

      expect(useSearchStore.getState().query).toBe('')
    })
  })

  describe('closeSearch', () => {
    it('sets isOpen to false and clears query/matches', () => {
      useSearchStore.setState({
        isOpen: true,
        query: 'test',
        matches: [
          {
            id: 'test-1',
            line: 1,
            startColumn: 0,
            endColumn: 4,
            text: 'test'
          }
        ],
        currentIndex: 0
      })

      const store = useSearchStore.getState()
      store.closeSearch()

      const state = useSearchStore.getState()
      expect(state.isOpen).toBe(false)
      expect(state.query).toBe('')
      expect(state.matches).toEqual([])
      expect(state.currentIndex).toBe(0)
    })

    it('preserves providerStates cache', () => {
      const cachedState = new Map([
        ['monaco', { query: 'cached', matches: [], currentIndex: 0 }]
      ])
      useSearchStore.setState({
        isOpen: true,
        providerStates: cachedState
      })

      const store = useSearchStore.getState()
      store.closeSearch()

      expect(useSearchStore.getState().providerStates).toBe(cachedState)
    })
  })

  describe('resetSearch', () => {
    it('resets all state to initial values', () => {
      useSearchStore.setState({
        isOpen: true,
        query: 'test',
        options: { caseSensitive: true, wholeWord: true },
        matches: [{ id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }],
        currentIndex: 1,
        activeProviderId: 'monaco',
        providerStates: new Map([['monaco', { query: 'cached', matches: [], currentIndex: 0 }]]),
        previousFocusElement: document.createElement('div')
      })

      const store = useSearchStore.getState()
      store.resetSearch()

      const state = useSearchStore.getState()
      expect(state.isOpen).toBe(false)
      expect(state.query).toBe('')
      expect(state.options).toEqual({ caseSensitive: false, wholeWord: false })
      expect(state.matches).toEqual([])
      expect(state.currentIndex).toBe(0)
      expect(state.activeProviderId).toBeNull()
      expect(state.providerStates.size).toBe(0)
      expect(state.previousFocusElement).toBeNull()
    })

    it('clears provider cache unlike closeSearch', () => {
      useSearchStore.setState({
        providerStates: new Map([['monaco', { query: 'cached', matches: [], currentIndex: 0 }]])
      })

      const store = useSearchStore.getState()
      store.resetSearch()

      expect(useSearchStore.getState().providerStates.size).toBe(0)
    })
  })

  describe('updateQuery', () => {
    it('updates query and resets currentIndex to 0', () => {
      useSearchStore.setState({ currentIndex: 5 })

      const store = useSearchStore.getState()
      store.updateQuery('new search')

      const state = useSearchStore.getState()
      expect(state.query).toBe('new search')
      expect(state.currentIndex).toBe(0)
    })

    it('allows empty string', () => {
      useSearchStore.setState({ query: 'test' })

      const store = useSearchStore.getState()
      store.updateQuery('')

      expect(useSearchStore.getState().query).toBe('')
    })
  })

  describe('updateOptions', () => {
    it('updates caseSensitive option', () => {
      const store = useSearchStore.getState()
      store.updateOptions({ caseSensitive: true })

      expect(useSearchStore.getState().options.caseSensitive).toBe(true)
      expect(useSearchStore.getState().options.wholeWord).toBe(false)
    })

    it('updates wholeWord option', () => {
      const store = useSearchStore.getState()
      store.updateOptions({ wholeWord: true })

      expect(useSearchStore.getState().options.wholeWord).toBe(true)
      expect(useSearchStore.getState().options.caseSensitive).toBe(false)
    })

    it('allows partial updates', () => {
      useSearchStore.setState({
        options: { caseSensitive: true, wholeWord: true }
      })

      const store = useSearchStore.getState()
      store.updateOptions({ caseSensitive: false })

      const state = useSearchStore.getState()
      expect(state.options.caseSensitive).toBe(false)
      expect(state.options.wholeWord).toBe(true)
    })

    it('merges options correctly', () => {
      const store = useSearchStore.getState()
      store.updateOptions({ caseSensitive: true })
      store.updateOptions({ wholeWord: true })

      const state = useSearchStore.getState()
      expect(state.options).toEqual({ caseSensitive: true, wholeWord: true })
    })
  })

  describe('setMatches', () => {
    it('updates matches array', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: 'test-2', line: 2, startColumn: 5, endColumn: 9, text: 'test' }
      ]

      const store = useSearchStore.getState()
      store.setMatches(matches)

      expect(useSearchStore.getState().matches).toEqual(matches)
    })
  })

  describe('nextMatch', () => {
    it('increments currentIndex when matches exist', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: 'test-2', line: 2, startColumn: 5, endColumn: 9, text: 'test' },
        { id: 'test-3', line: 3, startColumn: 10, endColumn: 14, text: 'test' }
      ]
      useSearchStore.setState({ matches, currentIndex: 0 })

      const store = useSearchStore.getState()
      store.nextMatch()

      expect(useSearchStore.getState().currentIndex).toBe(1)
    })

    it('wraps around to 0 when at end of matches', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: 'test-2', line: 2, startColumn: 5, endColumn: 9, text: 'test' }
      ]
      useSearchStore.setState({ matches, currentIndex: 1 })

      const store = useSearchStore.getState()
      store.nextMatch()

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })

    it('stays at 0 when no matches', () => {
      useSearchStore.setState({ matches: [], currentIndex: 0 })

      const store = useSearchStore.getState()
      store.nextMatch()

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })
  })

  describe('previousMatch', () => {
    it('decrements currentIndex when matches exist', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: 'test-2', line: 2, startColumn: 5, endColumn: 9, text: 'test' }
      ]
      useSearchStore.setState({ matches, currentIndex: 1 })

      const store = useSearchStore.getState()
      store.previousMatch()

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })

    it('wraps around to last match when at index 0', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: 'test-2', line: 2, startColumn: 5, endColumn: 9, text: 'test' }
      ]
      useSearchStore.setState({ matches, currentIndex: 0 })

      const store = useSearchStore.getState()
      store.previousMatch()

      expect(useSearchStore.getState().currentIndex).toBe(1)
    })

    it('stays at 0 when no matches', () => {
      useSearchStore.setState({ matches: [], currentIndex: 0 })

      const store = useSearchStore.getState()
      store.previousMatch()

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })
  })

  describe('setActiveProvider', () => {
    it('sets active provider ID', () => {
      const store = useSearchStore.getState()
      store.setActiveProvider('monaco')

      expect(useSearchStore.getState().activeProviderId).toBe('monaco')
    })

    it('caches current provider state before switching', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      useSearchStore.setState({
        activeProviderId: 'monaco',
        isOpen: true,
        query: 'hello',
        matches,
        currentIndex: 0
      })

      const store = useSearchStore.getState()
      store.setActiveProvider('preview')

      const cachedState = useSearchStore.getState().providerStates.get('monaco')
      expect(cachedState).toEqual({
        query: 'hello',
        matches,
        currentIndex: 0
      })
    })

    it('does not cache if search is not open', () => {
      useSearchStore.setState({
        activeProviderId: 'monaco',
        isOpen: false,
        query: 'hello'
      })

      const store = useSearchStore.getState()
      store.setActiveProvider('preview')

      expect(useSearchStore.getState().providerStates.size).toBe(0)
    })

    it('restores new provider state if cached', () => {
      const cachedMatches: SearchMatch[] = [
        { id: 'cached-1', line: 5, startColumn: 0, endColumn: 4, text: 'cached' }
      ]
      useSearchStore.setState({
        providerStates: new Map([
          ['preview', { query: 'cached query', matches: cachedMatches, currentIndex: 2 }]
        ])
      })

      const store = useSearchStore.getState()
      store.setActiveProvider('preview')

      const state = useSearchStore.getState()
      expect(state.query).toBe('cached query')
      expect(state.matches).toEqual(cachedMatches)
      expect(state.currentIndex).toBe(2)
    })
  })

  describe('savePreviousFocus / restoreFocus', () => {
    it('savePreviousFocus stores element reference', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)

      const store = useSearchStore.getState()
      store.savePreviousFocus(button)

      expect(useSearchStore.getState().previousFocusElement).toBe(button)

      // Cleanup
      document.body.removeChild(button)
    })

    it('restoreFocus calls focus() on saved element', () => {
      const button = document.createElement('button')
      const focusSpy = vi.fn()
      button.focus = focusSpy
      document.body.appendChild(button)

      useSearchStore.setState({ previousFocusElement: button })

      const store = useSearchStore.getState()
      store.restoreFocus()

      expect(focusSpy).toHaveBeenCalled()
      expect(useSearchStore.getState().previousFocusElement).toBeNull()

      // Cleanup
      document.body.removeChild(button)
    })

    it('restoreFocus handles null element gracefully', () => {
      useSearchStore.setState({ previousFocusElement: null })

      const store = useSearchStore.getState()
      expect(() => store.restoreFocus()).not.toThrow()
    })
  })

  describe('Provider state caching', () => {
    it('cacheProviderState stores current search state', () => {
      const matches: SearchMatch[] = [
        { id: 'test-1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      useSearchStore.setState({
        query: 'test query',
        matches,
        currentIndex: 3
      })

      const store = useSearchStore.getState()
      store.cacheProviderState('monaco')

      const cached = useSearchStore.getState().providerStates.get('monaco')
      expect(cached).toEqual({
        query: 'test query',
        matches,
        currentIndex: 3
      })
    })

    it('cacheProviderState creates new Map instance', () => {
      const oldMap = new Map()
      useSearchStore.setState({ providerStates: oldMap })

      const store = useSearchStore.getState()
      store.cacheProviderState('monaco')

      expect(useSearchStore.getState().providerStates).not.toBe(oldMap)
    })

    it('cacheProviderState overwrites existing cache for provider', () => {
      useSearchStore.setState({
        query: 'old query',
        matches: [],
        currentIndex: 0,
        providerStates: new Map([['monaco', { query: 'old', matches: [], currentIndex: 0 }]])
      })

      const newMatches: SearchMatch[] = [
        { id: 'new-1', line: 1, startColumn: 0, endColumn: 3, text: 'new' }
      ]
      useSearchStore.setState({ query: 'new query', matches: newMatches, currentIndex: 1 })

      const store = useSearchStore.getState()
      store.cacheProviderState('monaco')

      const cached = useSearchStore.getState().providerStates.get('monaco')
      expect(cached?.query).toBe('new query')
      expect(cached?.currentIndex).toBe(1)
    })

    it('cacheProviderState preserves other provider caches', () => {
      useSearchStore.setState({
        providerStates: new Map([
          ['preview', { query: 'preview query', matches: [], currentIndex: 0 }]
        ])
      })

      const store = useSearchStore.getState()
      store.cacheProviderState('monaco')

      const cache = useSearchStore.getState().providerStates
      expect(cache.size).toBe(2)
      expect(cache.has('preview')).toBe(true)
      expect(cache.has('monaco')).toBe(true)
    })

    it('cacheProviderState works with empty matches', () => {
      useSearchStore.setState({
        query: '',
        matches: [],
        currentIndex: 0
      })

      const store = useSearchStore.getState()
      store.cacheProviderState('monaco')

      const cached = useSearchStore.getState().providerStates.get('monaco')
      expect(cached).toEqual({
        query: '',
        matches: [],
        currentIndex: 0
      })
    })

    it('cacheProviderState preserves match metadata', () => {
      const matchesWithMeta: SearchMatch[] = [
        {
          id: 'test-1',
          line: 1,
          startColumn: 0,
          endColumn: 4,
          text: 'test',
          meta: { customData: 'preserved' }
        }
      ]
      useSearchStore.setState({
        query: 'test',
        matches: matchesWithMeta,
        currentIndex: 0
      })

      const store = useSearchStore.getState()
      store.cacheProviderState('monaco')

      const cached = useSearchStore.getState().providerStates.get('monaco')
      expect(cached?.matches[0]?.meta).toEqual({ customData: 'preserved' })
    })
  })

  describe('Provider state restoration', () => {
    it('restoreProviderState loads cached state', () => {
      const cachedMatches: SearchMatch[] = [
        { id: 'cached-1', line: 10, startColumn: 0, endColumn: 6, text: 'cached' }
      ]
      useSearchStore.setState({
        providerStates: new Map([
          ['monaco', { query: 'cached query', matches: cachedMatches, currentIndex: 5 }]
        ])
      })

      const store = useSearchStore.getState()
      store.restoreProviderState('monaco')

      const state = useSearchStore.getState()
      expect(state.query).toBe('cached query')
      expect(state.matches).toEqual(cachedMatches)
      expect(state.currentIndex).toBe(5)
    })

    it('restoreProviderState starts fresh for uncached provider', () => {
      useSearchStore.setState({
        query: 'old query',
        matches: [{ id: 'old-1', line: 1, startColumn: 0, endColumn: 3, text: 'old' }],
        currentIndex: 2
      })

      const store = useSearchStore.getState()
      store.restoreProviderState('new-provider')

      const state = useSearchStore.getState()
      expect(state.query).toBe('')
      expect(state.matches).toEqual([])
      expect(state.currentIndex).toBe(0)
    })

    it('restoreProviderState does not modify provider cache', () => {
      const cachedState = new Map([
        ['monaco', { query: 'cached', matches: [], currentIndex: 0 }]
      ])
      useSearchStore.setState({ providerStates: cachedState })

      const store = useSearchStore.getState()
      store.restoreProviderState('monaco')

      expect(useSearchStore.getState().providerStates).toBe(cachedState)
      expect(useSearchStore.getState().providerStates.size).toBe(1)
    })
  })
})
