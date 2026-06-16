// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * SearchBar.test.tsx
 *
 * Test coverage for SearchBar component
 *
 * Test groups:
 * - Rendering (3 tests)
 * - Structure and elements (7 tests)
 * - Search execution (5 tests)
 * - Navigation controls (6 tests)
 * - Options toggles (7 tests) - includes regression test for stale closure fix
 * - Keyboard interactions (6 tests)
 * - Focus management (3 tests)
 * - Match count display (4 tests)
 * - Provider integration (4 tests)
 * - Accessibility (6 tests)
 *
 * Total: 53 tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from './SearchBar'
import { useSearchStore } from '../../stores/useSearchStore'
import type { SearchProvider } from '../../providers/search'
import type { SearchMatch } from '../../stores/useSearchStore'

// Mock search provider
const createMockProvider = (): SearchProvider => ({
  id: 'mock',
  name: 'Mock Provider',
  search: vi.fn(async () => []),
  navigateTo: vi.fn(),
  clearHighlights: vi.fn(),
  updateCurrentMatch: vi.fn(),
  dispose: vi.fn()
})

describe('SearchBar', () => {
  let mockProvider: SearchProvider

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store
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

    // Create mock provider
    mockProvider = createMockProvider()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders when isOpen is true', () => {
      useSearchStore.setState({ isOpen: true })
      render(<SearchBar provider={mockProvider} />)

      expect(screen.getByRole('search')).toBeInTheDocument()
    })

    it('does not render when isOpen is false', () => {
      useSearchStore.setState({ isOpen: false })
      render(<SearchBar provider={mockProvider} />)

      expect(screen.queryByRole('search')).not.toBeInTheDocument()
    })

    it('renders even when provider is null (search disabled)', () => {
      useSearchStore.setState({ isOpen: true })
      render(<SearchBar provider={null} />)

      // SearchBar still renders for UI consistency, but search won't execute
      expect(screen.getByRole('search')).toBeInTheDocument()
    })
  })

  describe('Structure and elements', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('has search input field', () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'text')
    })

    it('has case sensitive toggle button', () => {
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveTextContent('Aa')
    })

    it('has whole word toggle button', () => {
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Whole word (Alt+W)')
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveTextContent('ab')
    })

    it('has previous match button', () => {
      render(<SearchBar provider={mockProvider} />)

      const button = screen.getByRole('button', { name: /previous match/i })
      expect(button).toBeInTheDocument()
    })

    it('has next match button', () => {
      render(<SearchBar provider={mockProvider} />)

      const button = screen.getByRole('button', { name: /next match/i })
      expect(button).toBeInTheDocument()
    })

    it('has close button', () => {
      render(<SearchBar provider={mockProvider} />)

      const button = screen.getByRole('button', { name: /close search/i })
      expect(button).toBeInTheDocument()
    })

    it('has match count display area', () => {
      render(<SearchBar provider={mockProvider} />)

      const matchCount = screen.getByLabelText(/find in document/i).querySelector(
        '[aria-live="polite"]'
      )
      expect(matchCount).toBeInTheDocument()
    })
  })

  describe('Search execution', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('executes search when query changes', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...') as HTMLInputElement

      // Wait for auto-focus (FOCUS_DELAY_MS = 10ms) so the first keystroke is
      // never dropped under CPU contention.
      await waitFor(() => {
        expect(document.activeElement).toBe(input)
      })

      await user.type(input, 'test')

      // Wait for debounce (100ms) + scheduler jitter
      await waitFor(
        () => {
          expect(mockProvider.search).toHaveBeenCalledWith('test', {
            caseSensitive: false,
            wholeWord: false
          })
        },
        { timeout: 500 }
      )
    })

    it('debounces search execution', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...') as HTMLInputElement

      // Wait for auto-focus before typing to avoid first-keystroke drop.
      await waitFor(() => {
        expect(document.activeElement).toBe(input)
      })

      await user.type(input, 'abc')

      // Should not call search immediately
      expect(mockProvider.search).not.toHaveBeenCalled()

      // Wait for debounce
      await waitFor(
        () => {
          expect(mockProvider.search).toHaveBeenCalledTimes(1)
        },
        { timeout: 500 }
      )
    })

    it('updates query in store when typing', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...') as HTMLInputElement

      // Wait for auto-focus timeout (FOCUS_DELAY_MS = 10ms) + select to complete
      await waitFor(() => {
        expect(document.activeElement).toBe(input)
      })

      // Type after focus/select has stabilized
      await user.type(input, 'hello')

      await waitFor(() => {
        expect(useSearchStore.getState().query).toBe('hello')
      })
    })

    it('clears matches when query is empty', async () => {
      const user = userEvent.setup()
      useSearchStore.setState({ query: 'test', matches: [{ id: '1' } as SearchMatch] })

      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.clear(input)

      await waitFor(() => {
        expect(mockProvider.clearHighlights).toHaveBeenCalled()
      })
    })

    it('does not search when provider is null', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={null} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(mockProvider.search).not.toHaveBeenCalled()
    })
  })

  describe('Navigation controls', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('calls nextMatch when next button clicked', async () => {
      const user = userEvent.setup()
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      useSearchStore.setState({ matches })

      render(<SearchBar provider={mockProvider} />)

      const nextButton = screen.getByRole('button', { name: /next match/i })
      await user.click(nextButton)

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })

    it('calls previousMatch when previous button clicked', async () => {
      const user = userEvent.setup()
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      useSearchStore.setState({ matches })

      render(<SearchBar provider={mockProvider} />)

      const prevButton = screen.getByRole('button', { name: /previous match/i })
      await user.click(prevButton)

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })

    it('disables navigation buttons when no matches', () => {
      useSearchStore.setState({ matches: [] })
      render(<SearchBar provider={mockProvider} />)

      const nextButton = screen.getByRole('button', { name: /next match/i })
      const prevButton = screen.getByRole('button', { name: /previous match/i })

      expect(nextButton).toBeDisabled()
      expect(prevButton).toBeDisabled()
    })

    it('enables navigation buttons when matches exist', async () => {
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]

      const { rerender } = render(<SearchBar provider={mockProvider} />)

      useSearchStore.setState({ matches })
      rerender(<SearchBar provider={mockProvider} />)

      await waitFor(() => {
        const nextButton = screen.getByRole('button', { name: /next match/i })
        const prevButton = screen.getByRole('button', { name: /previous match/i })

        expect(nextButton).not.toBeDisabled()
        expect(prevButton).not.toBeDisabled()
      })
    })

    it('calls provider.navigateTo when currentIndex changes', async () => {
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: '2', line: 2, startColumn: 0, endColumn: 4, text: 'test' }
      ]

      const { rerender } = render(<SearchBar provider={mockProvider} />)

      act(() => {
        useSearchStore.setState({ matches, currentIndex: 0 })
      })
      rerender(<SearchBar provider={mockProvider} />)

      // Wait for initial render and navigation
      await waitFor(() => {
        expect(mockProvider.navigateTo).toHaveBeenCalledWith(0, { focusEditor: false })
      })

      vi.clearAllMocks()

      // Change currentIndex
      act(() => {
        useSearchStore.setState({ currentIndex: 1 })
      })
      rerender(<SearchBar provider={mockProvider} />)

      await waitFor(() => {
        expect(mockProvider.navigateTo).toHaveBeenCalledWith(1, { focusEditor: false })
      })
    })

    it('calls provider.updateCurrentMatch when currentIndex changes', async () => {
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      useSearchStore.setState({ matches, currentIndex: 0 })

      render(<SearchBar provider={mockProvider} />)

      await waitFor(() => {
        expect(mockProvider.updateCurrentMatch).toHaveBeenCalledWith(0)
      })
    })
  })

  describe('Options toggles', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('toggles caseSensitive option when button clicked', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')
      await user.click(toggle)

      expect(useSearchStore.getState().options.caseSensitive).toBe(true)
    })

    it('toggles wholeWord option when button clicked', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Whole word (Alt+W)')
      await user.click(toggle)

      expect(useSearchStore.getState().options.wholeWord).toBe(true)
    })

    it('applies active class to caseSensitive button when enabled', () => {
      useSearchStore.setState({ options: { caseSensitive: true, wholeWord: false } })
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')
      expect(toggle).toHaveClass('active')
    })

    it('applies active class to wholeWord button when enabled', () => {
      useSearchStore.setState({ options: { caseSensitive: false, wholeWord: true } })
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Whole word (Alt+W)')
      expect(toggle).toHaveClass('active')
    })

    it('triggers search when options change', async () => {
      const user = userEvent.setup()
      useSearchStore.setState({ query: 'test' })

      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')
      await user.click(toggle)

      await waitFor(
        () => {
          expect(mockProvider.search).toHaveBeenCalledWith('test', {
            caseSensitive: true,
            wholeWord: false
          })
        },
        { timeout: 200 }
      )
    })

    it('handles Enter key on toggle buttons', () => {
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')

      // Use fireEvent.keyDown to directly test the keyboard handler
      fireEvent.keyDown(toggle, { key: 'Enter' })
      expect(useSearchStore.getState().options.caseSensitive).toBe(true)

      // Toggle back with Enter
      fireEvent.keyDown(toggle, { key: 'Enter' })
      expect(useSearchStore.getState().options.caseSensitive).toBe(false)
    })

    it('handles Space key on toggle buttons via click', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')

      // Space on buttons triggers click - test via direct click
      await user.click(toggle)
      expect(useSearchStore.getState().options.caseSensitive).toBe(true)

      await user.click(toggle)
      expect(useSearchStore.getState().options.caseSensitive).toBe(false)
    })

    // Regression test: Stale closure fix in handleToggleKeyDown
    // Prior to the fix, pressing Enter twice rapidly would read stale state
    // from closure, causing toggle to set the same value twice (true → true)
    // instead of toggling correctly (true → false)
    it('handles rapid Enter key presses without stale closure issues', () => {
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')

      // First Enter: false → true
      fireEvent.keyDown(toggle, { key: 'Enter' })
      expect(useSearchStore.getState().options.caseSensitive).toBe(true)

      // Second Enter immediately after: true → false (not true → true with stale closure)
      fireEvent.keyDown(toggle, { key: 'Enter' })
      expect(useSearchStore.getState().options.caseSensitive).toBe(false)

      // Third Enter: false → true (verify toggle still works)
      fireEvent.keyDown(toggle, { key: 'Enter' })
      expect(useSearchStore.getState().options.caseSensitive).toBe(true)
    })
  })

  describe('Keyboard interactions', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('closes search on Escape key', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      input.focus()

      await user.keyboard('{Escape}')

      expect(useSearchStore.getState().isOpen).toBe(false)
    })

    it('navigates to next match on Enter key', async () => {
      const user = userEvent.setup()
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: '2', line: 2, startColumn: 0, endColumn: 4, text: 'test' }
      ]

      const { rerender } = render(<SearchBar provider={mockProvider} />)

      useSearchStore.setState({ matches, currentIndex: 0 })
      rerender(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      input.focus()

      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(useSearchStore.getState().currentIndex).toBe(1)
      })
    })

    it('navigates to previous match on Shift+Enter', async () => {
      const user = userEvent.setup()
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: '2', line: 2, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      useSearchStore.setState({ matches, currentIndex: 1 })

      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      input.focus()

      await user.keyboard('{Shift>}{Enter}{/Shift}')

      expect(useSearchStore.getState().currentIndex).toBe(0)
    })

    it('prevents default on Escape key', async () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      })
      const preventDefaultSpy = vi.spyOn(escapeEvent, 'preventDefault')

      input.dispatchEvent(escapeEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('prevents default on Enter key', async () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      })
      const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault')

      input.dispatchEvent(enterEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('implements focus trap with Tab key wrapping forward', () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      const closeButton = screen.getByRole('button', { name: /close search/i })
      const container = screen.getByRole('search')

      // Focus the close button directly (last focusable element when nav buttons disabled)
      closeButton.focus()
      expect(closeButton).toHaveFocus()

      // Dispatch Tab keydown event on container (where the handler is attached).
      // Uses direct KeyboardEvent dispatch (matching the Shift+Tab test below)
      // instead of userEvent.keyboard('{Tab}') because userEvent's Tab
      // simulation relies on jsdom's tabindex walk, which is platform-dependent
      // and unreliable on Windows CI runners.
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
      container.dispatchEvent(tabEvent)

      // Tab from last element should wrap to first (input)
      expect(input).toHaveFocus()
    })

    it('implements focus trap with Shift+Tab wrapping backward', () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      const closeButton = screen.getByRole('button', { name: /close search/i })
      const container = screen.getByRole('search')

      // Focus the input (first focusable element)
      input.focus()
      expect(input).toHaveFocus()

      // Dispatch Shift+Tab keydown event on container (where the handler is attached)
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
      container.dispatchEvent(shiftTabEvent)

      // Shift+Tab from first element should wrap to last (close button)
      expect(closeButton).toHaveFocus()
    })
  })

  describe('Focus management', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('auto-focuses input on mount', async () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')

      await waitFor(
        () => {
          expect(input).toHaveFocus()
        },
        { timeout: 100 }
      )
    })

    it('selects all text on focus', async () => {
      useSearchStore.setState({ query: 'existing text' })
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...') as HTMLInputElement

      await waitFor(
        () => {
          expect(input.selectionStart).toBe(0)
          expect(input.selectionEnd).toBe('existing text'.length)
        },
        { timeout: 100 }
      )
    })

    it('restores previous focus on close', async () => {
      const user = userEvent.setup()

      // Create a test button
      const testButton = document.createElement('button')
      testButton.textContent = 'Test'
      document.body.appendChild(testButton)
      testButton.focus()

      useSearchStore.setState({ previousFocusElement: testButton })

      render(<SearchBar provider={mockProvider} />)

      const closeButton = screen.getByRole('button', { name: /close search/i })
      await user.click(closeButton)

      await waitFor(() => {
        expect(document.activeElement).toBe(testButton)
      })

      // Cleanup
      document.body.removeChild(testButton)
    })
  })

  describe('Match count display', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('shows "1 of N" format when matches exist', async () => {
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: '2', line: 2, startColumn: 0, endColumn: 4, text: 'test' },
        { id: '3', line: 3, startColumn: 0, endColumn: 4, text: 'test' }
      ]

      const { rerender } = render(<SearchBar provider={mockProvider} />)

      useSearchStore.setState({ matches, currentIndex: 0 })
      rerender(<SearchBar provider={mockProvider} />)

      await waitFor(() => {
        expect(screen.getByText('1 of 3')).toBeInTheDocument()
      })
    })

    it('updates match count when currentIndex changes', async () => {
      const matches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' },
        { id: '2', line: 2, startColumn: 0, endColumn: 4, text: 'test' }
      ]

      const { rerender } = render(<SearchBar provider={mockProvider} />)

      useSearchStore.setState({ matches, currentIndex: 0 })
      rerender(<SearchBar provider={mockProvider} />)

      await waitFor(() => {
        expect(screen.getByText('1 of 2')).toBeInTheDocument()
      })

      useSearchStore.setState({ currentIndex: 1 })
      rerender(<SearchBar provider={mockProvider} />)

      await waitFor(() => {
        expect(screen.getByText('2 of 2')).toBeInTheDocument()
      })
    })

    it('shows "No results" when query exists but no matches', () => {
      useSearchStore.setState({ query: 'notfound', matches: [] })

      render(<SearchBar provider={mockProvider} />)

      expect(screen.getByText('No results')).toBeInTheDocument()
    })

    it('shows empty string when no query', () => {
      useSearchStore.setState({ query: '', matches: [] })

      render(<SearchBar provider={mockProvider} />)

      const matchCount = screen.getByLabelText(/find in document/i).querySelector(
        '[aria-live="polite"]'
      )
      expect(matchCount?.textContent).toBe('')
    })
  })

  describe('Provider integration', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('sets matches from provider search results', async () => {
      const user = userEvent.setup()
      const mockMatches: SearchMatch[] = [
        { id: '1', line: 1, startColumn: 0, endColumn: 4, text: 'test' }
      ]
      vi.mocked(mockProvider.search).mockResolvedValue(mockMatches)

      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      await waitFor(
        () => {
          expect(useSearchStore.getState().matches).toEqual(mockMatches)
        },
        { timeout: 200 }
      )
    })

    it('clears highlights on close', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const closeButton = screen.getByRole('button', { name: /close search/i })
      await user.click(closeButton)

      expect(mockProvider.clearHighlights).toHaveBeenCalled()
    })

    it('does not call provider methods when provider is null', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={null} />)

      const closeButton = screen.getByRole('button', { name: /close search/i })
      await user.click(closeButton)

      expect(mockProvider.clearHighlights).not.toHaveBeenCalled()
    })

    it('handles async search errors gracefully', async () => {
      const user = userEvent.setup()
      vi.mocked(mockProvider.search).mockRejectedValue(new Error('Search failed'))

      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      // Should not crash
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(screen.getByRole('search')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    beforeEach(() => {
      useSearchStore.setState({ isOpen: true })
    })

    it('has role="search" on container', () => {
      render(<SearchBar provider={mockProvider} />)

      const container = screen.getByRole('search')
      expect(container).toBeInTheDocument()
    })

    it('has aria-label on container', () => {
      render(<SearchBar provider={mockProvider} />)

      const container = screen.getByRole('search')
      expect(container).toHaveAttribute('aria-label', 'Find in document')
    })

    it('has aria-label on search input', () => {
      render(<SearchBar provider={mockProvider} />)

      const input = screen.getByLabelText('Search in document')
      expect(input).toBeInTheDocument()
    })

    it('has aria-pressed on toggle buttons', () => {
      render(<SearchBar provider={mockProvider} />)

      const caseToggle = screen.getByTitle('Case sensitive (Alt+C)')
      const wordToggle = screen.getByTitle('Whole word (Alt+W)')

      expect(caseToggle).toHaveAttribute('aria-pressed', 'false')
      expect(wordToggle).toHaveAttribute('aria-pressed', 'false')
    })

    it('updates aria-pressed when toggle is activated', async () => {
      const user = userEvent.setup()
      render(<SearchBar provider={mockProvider} />)

      const toggle = screen.getByTitle('Case sensitive (Alt+C)')
      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })

    it('has aria-live region for match count', () => {
      render(<SearchBar provider={mockProvider} />)

      const matchCount = screen.getByLabelText(/find in document/i).querySelector(
        '[aria-live="polite"]'
      )
      expect(matchCount).toBeInTheDocument()
    })
  })
})
