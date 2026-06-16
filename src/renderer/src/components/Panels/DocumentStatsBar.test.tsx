// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DocumentStatsBar.test.tsx
 *
 * Test coverage for DocumentStatsBar component.
 *
 * Test groups:
 * - Rendering (3 tests)
 * - Statistics display (4 tests)
 * - Selection stats (3 tests)
 * - Number formatting (2 tests)
 * - Accessibility (2 tests)
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentStatsBar, type DocumentStats } from './DocumentStatsBar'

describe('DocumentStatsBar', () => {
  const mockStats: DocumentStats = {
    words: 1250,
    characters: 7500,
    lines: 85,
    readingTimeMinutes: 5
  }

  describe('Rendering', () => {
    it('renders when stats are provided', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(screen.getByText('Words:')).toBeInTheDocument()
    })

    it('renders nothing when stats is null', () => {
      const { container } = render(<DocumentStatsBar stats={null} selectedText="" />)

      expect(container.firstChild).toBeNull()
    })

    it('has correct class name', () => {
      const { container } = render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(container.querySelector('.document-stats-bar')).toBeInTheDocument()
    })
  })

  describe('Statistics display', () => {
    it('displays word count', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(screen.getByText('Words:')).toBeInTheDocument()
      expect(screen.getByText('1,250')).toBeInTheDocument()
    })

    it('displays character count', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(screen.getByText('Characters:')).toBeInTheDocument()
      expect(screen.getByText('7,500')).toBeInTheDocument()
    })

    it('displays line count', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(screen.getByText('Lines:')).toBeInTheDocument()
      expect(screen.getByText('85')).toBeInTheDocument()
    })

    it('displays reading time', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(screen.getByText('Reading time:')).toBeInTheDocument()
      expect(screen.getByText('5 min')).toBeInTheDocument()
    })
  })

  describe('Selection stats', () => {
    it('shows selection count when text is selected', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="Hello world" />)

      expect(screen.getByText('Selected:')).toBeInTheDocument()
      expect(screen.getByText('11 chars')).toBeInTheDocument()
    })

    it('does not show selection stats when no text is selected', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      expect(screen.queryByText('Selected:')).not.toBeInTheDocument()
    })

    it('shows selection stats for multi-line selection', () => {
      const multiLineText = 'Line 1\nLine 2\nLine 3'
      render(<DocumentStatsBar stats={mockStats} selectedText={multiLineText} />)

      expect(screen.getByText('Selected:')).toBeInTheDocument()
      expect(screen.getByText(`${multiLineText.length} chars`)).toBeInTheDocument()
    })
  })

  describe('Number formatting', () => {
    it('formats large numbers with locale separators', () => {
      const largeStats: DocumentStats = {
        words: 12500,
        characters: 75000,
        lines: 1500,
        readingTimeMinutes: 50
      }

      render(<DocumentStatsBar stats={largeStats} selectedText="" />)

      expect(screen.getByText('12,500')).toBeInTheDocument()
      expect(screen.getByText('75,000')).toBeInTheDocument()
      expect(screen.getByText('1,500')).toBeInTheDocument()
    })

    it('handles small numbers without separators', () => {
      const smallStats: DocumentStats = {
        words: 10,
        characters: 50,
        lines: 5,
        readingTimeMinutes: 1
      }

      render(<DocumentStatsBar stats={smallStats} selectedText="" />)

      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('50')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has semantic structure with stats groups', () => {
      const { container } = render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      const statsGroups = container.querySelectorAll('.stats-group')
      expect(statsGroups.length).toBeGreaterThanOrEqual(1)
    })

    it('uses descriptive labels for each stat', () => {
      render(<DocumentStatsBar stats={mockStats} selectedText="" />)

      // Each stat should have a descriptive label
      expect(screen.getByText('Words:')).toBeInTheDocument()
      expect(screen.getByText('Characters:')).toBeInTheDocument()
      expect(screen.getByText('Lines:')).toBeInTheDocument()
      expect(screen.getByText('Reading time:')).toBeInTheDocument()
    })
  })
})
