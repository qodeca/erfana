// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ClaudeStatusBar (issue #216).
 *
 * Snapshots are driven through the real store via `setSnapshot`, then the
 * component is rendered for the matching terminalId.
 *
 * @module TerminalPanel/components/ClaudeStatusBar.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClaudeStatusBar } from './ClaudeStatusBar'
import { useClaudeStatusStore } from '../../../../stores/useClaudeStatusStore'
import { TEST_IDS } from '../../../../constants/testids'
import type { ClaudeStatusSnapshot } from '../../../../../../shared/ipc/claude-status-schema'

/** Build a green snapshot for a terminal, overridable per-test. */
function makeSnapshot(
  terminalId: string,
  overrides: Partial<ClaudeStatusSnapshot> = {}
): ClaudeStatusSnapshot {
  return {
    terminalId,
    modelId: 'claude-opus-4-8',
    friendlyName: 'Opus 4.8',
    windowSize: 200000,
    usedTokens: 84000,
    percent: 48,
    level: 'green',
    tooltip: '84k / 200k',
    ...overrides
  }
}

/** Push a snapshot into the store for the given terminal. */
function seed(terminalId: string, overrides: Partial<ClaudeStatusSnapshot> = {}): void {
  useClaudeStatusStore
    .getState()
    .setSnapshot({ terminalId, snapshot: makeSnapshot(terminalId, overrides) })
}

describe('ClaudeStatusBar', () => {
  beforeEach(() => {
    useClaudeStatusStore.getState().reset()
  })

  describe('hidden state', () => {
    it('renders nothing when there is no snapshot', () => {
      const { container } = render(<ClaudeStatusBar terminalId="absent" />)
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByTestId(TEST_IDS.CLAUDE_STATUS_BAR)).not.toBeInTheDocument()
    })

    it('renders nothing when the snapshot is explicitly null', () => {
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 't', snapshot: null })
      const { container } = render(<ClaudeStatusBar terminalId="t" />)
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('green snapshot', () => {
    beforeEach(() => seed('t'))

    it('renders name, badge and percent', () => {
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByText('Opus 4.8')).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BADGE)).toHaveTextContent('200k')
      expect(screen.getByText('48%')).toBeInTheDocument()
    })

    it('exposes data-level=green on the root', () => {
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BAR)).toHaveAttribute('data-level', 'green')
    })

    it('sets the fill width to the percent', () => {
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_FILL)).toHaveStyle({ width: '48%' })
    })
  })

  describe('color states', () => {
    it('applies amber level', () => {
      seed('t', { percent: 78, level: 'amber', usedTokens: 156000, tooltip: '156k / 200k' })
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BAR)).toHaveAttribute('data-level', 'amber')
    })

    it('applies red level', () => {
      seed('t', { percent: 95, level: 'red', usedTokens: 190000, tooltip: '190k / 200k' })
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BAR)).toHaveAttribute('data-level', 'red')
    })
  })

  describe('window badge', () => {
    it('shows 200k for the standard window', () => {
      seed('t', { windowSize: 200000 })
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BADGE)).toHaveTextContent('200k')
    })

    it('shows 1M for the extended window', () => {
      seed('t', { windowSize: 1000000, tooltip: '95k / 1M' })
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BADGE)).toHaveTextContent('1M')
    })
  })

  describe('accessibility', () => {
    it('exposes a meter role with valuemin/max/now', () => {
      seed('t')
      render(<ClaudeStatusBar terminalId="t" />)
      const meter = screen.getByRole('meter')
      expect(meter).toHaveAttribute('aria-valuemin', '0')
      expect(meter).toHaveAttribute('aria-valuemax', '100')
      expect(meter).toHaveAttribute('aria-valuenow', '48')
    })

    it('exposes exact counts via aria-valuetext', () => {
      seed('t')
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByRole('meter')).toHaveAttribute(
        'aria-valuetext',
        'Opus 4.8, 48% used, 84k of 200k tokens'
      )
    })

    it('gives the meter an accessible name (WCAG 4.1.2)', () => {
      seed('t')
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByRole('meter', { name: /Claude Code context/i })).toBeInTheDocument()
    })

    it('is a static meter, not a live region', () => {
      seed('t')
      const { container } = render(<ClaudeStatusBar terminalId="t" />)
      expect(container.querySelector('[aria-live]')).toBeNull()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('puts the exact-count tooltip on the row title', () => {
      seed('t')
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_BAR)).toHaveAttribute('title', '84k / 200k')
    })
  })

  describe('clamping', () => {
    it('clamps the fill width at 100% for percent=100', () => {
      seed('t', { percent: 100, level: 'red', usedTokens: 220000, tooltip: '220k / 200k' })
      render(<ClaudeStatusBar terminalId="t" />)
      expect(screen.getByTestId(TEST_IDS.CLAUDE_STATUS_FILL)).toHaveStyle({ width: '100%' })
      // Headline percent still reflects the snapshot value (already clamped in main).
      expect(screen.getByText('100%')).toBeInTheDocument()
    })
  })

  describe('per-terminal isolation', () => {
    it('reads only its own terminal slice', () => {
      seed('a', { friendlyName: 'Opus 4.8', percent: 10 })
      seed('b', { friendlyName: 'Sonnet 4.6', percent: 90, level: 'red' })
      render(<ClaudeStatusBar terminalId="b" />)
      expect(screen.getByText('Sonnet 4.6')).toBeInTheDocument()
      expect(screen.queryByText('Opus 4.8')).not.toBeInTheDocument()
    })
  })
})
