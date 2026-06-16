// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for MermaidToolbar component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MermaidToolbar } from './MermaidToolbar'

// Mock panelUtils
vi.mock('../../../utils/panelUtils', () => ({
  executePromptTemplate: vi.fn().mockResolvedValue({ success: true })
}))

import { executePromptTemplate } from '../../../utils/panelUtils'

describe('MermaidToolbar', () => {
  const mockOnExpand = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render expand button for all chart types', () => {
      render(
        <MermaidToolbar
          code="pie\n  'Dogs': 386"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument()
    })

    it('should not render when loading', () => {
      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          isLoading={true}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    })

    it('should render toolbar with proper ARIA attributes', () => {
      render(
        <MermaidToolbar
          code="flowchart LR\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('toolbar')).toHaveAttribute(
        'aria-label',
        'Mermaid diagram toolbar'
      )
    })
  })

  describe('direction buttons for flowchart', () => {
    it('should show direction buttons for flowchart', () => {
      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('button', { name: /top to bottom/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /top down/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /bottom to top/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /left to right/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /right to left/i })).toBeInTheDocument()
    })

    it('should show direction buttons for graph', () => {
      render(
        <MermaidToolbar
          code="graph LR\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
    })

    it('should disable and highlight current direction', () => {
      render(
        <MermaidToolbar
          code="flowchart LR\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      const lrButton = screen.getByRole('button', { name: /left to right/i })
      expect(lrButton).toBeDisabled()
      expect(lrButton).toHaveClass('mermaid-direction-btn--active')
      expect(lrButton).toHaveAttribute('aria-pressed', 'true')
    })

    it('should enable non-current directions', () => {
      render(
        <MermaidToolbar
          code="flowchart LR\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      const tbButton = screen.getByRole('button', { name: /top to bottom/i })
      expect(tbButton).not.toBeDisabled()
      expect(tbButton).not.toHaveClass('mermaid-direction-btn--active')
    })

    it('should disable TB when no explicit direction (default)', () => {
      render(
        <MermaidToolbar
          code="flowchart\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      const tbButton = screen.getByRole('button', { name: /top to bottom/i })
      expect(tbButton).toBeDisabled()
      expect(tbButton).toHaveClass('mermaid-direction-btn--active')
    })
  })

  describe('direction buttons for state diagram', () => {
    it('should show direction buttons for stateDiagram', () => {
      render(
        <MermaidToolbar
          code="stateDiagram-v2\n  [*] --> State1"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('button', { name: /top to bottom/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /bottom to top/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /left to right/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /right to left/i })).toBeInTheDocument()
    })

    it('should NOT show TD button for stateDiagram', () => {
      render(
        <MermaidToolbar
          code="stateDiagram-v2\n  [*] --> State1"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.queryByRole('button', { name: /top down/i })).not.toBeInTheDocument()
    })

    it('should detect direction statement in stateDiagram', () => {
      render(
        <MermaidToolbar
          code={'stateDiagram-v2\n  direction LR\n  [*] --> State1'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      const lrButton = screen.getByRole('button', { name: /left to right/i })
      expect(lrButton).toBeDisabled()
      expect(lrButton).toHaveClass('mermaid-direction-btn--active')
    })
  })

  describe('additional supported chart types', () => {
    it('should show direction buttons for classDiagram', () => {
      render(
        <MermaidToolbar
          code={'classDiagram\n  class Animal'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
      // classDiagram uses standard directions (no TD)
      expect(screen.getByRole('button', { name: /top to bottom/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /bottom to top/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /left to right/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /right to left/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top down/i })).not.toBeInTheDocument()
    })

    it('should show direction buttons for erDiagram', () => {
      render(
        <MermaidToolbar
          code={'erDiagram\n  CUSTOMER ||--o{ ORDER : places'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
      // erDiagram uses standard directions (no TD)
      expect(screen.getByRole('button', { name: /top to bottom/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top down/i })).not.toBeInTheDocument()
    })

    it('should show direction buttons for gitGraph', () => {
      render(
        <MermaidToolbar
          code={'gitGraph\n  commit'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
      // gitGraph has LR (default), TB, BT - no TD, no RL
      expect(screen.getByRole('button', { name: /left to right/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /top to bottom/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /bottom to top/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top down/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /right to left/i })).not.toBeInTheDocument()
    })

    it('should highlight LR as default for gitGraph', () => {
      render(
        <MermaidToolbar
          code={'gitGraph\n  commit'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      // gitGraph defaults to LR (not TB like other diagrams)
      const lrButton = screen.getByRole('button', { name: /left to right/i })
      expect(lrButton).toBeDisabled()
      expect(lrButton).toHaveClass('mermaid-direction-btn--active')
    })
  })

  describe('unsupported chart types', () => {
    it('should NOT show direction buttons for sequenceDiagram', () => {
      render(
        <MermaidToolbar
          code={'sequenceDiagram\n  A->>B: Hello'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      // Group exists (contains expand button), but no direction buttons
      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top to bottom/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /left to right/i })).not.toBeInTheDocument()
    })

    it('should NOT show direction buttons for pie chart', () => {
      render(
        <MermaidToolbar
          code={"pie\n  'Dogs': 386"}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      // Group exists (contains expand button), but no direction buttons
      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top to bottom/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /left to right/i })).not.toBeInTheDocument()
    })

    it('should NOT show direction buttons for gantt', () => {
      render(
        <MermaidToolbar
          code={'gantt\n  title A Gantt Diagram'}
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      // Group exists (contains expand button), but no direction buttons
      expect(screen.getByRole('group', { name: /layout direction/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /top to bottom/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /left to right/i })).not.toBeInTheDocument()
    })
  })

  describe('expand button', () => {
    it('should call onExpand when clicked', async () => {
      const user = userEvent.setup()

      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      await user.click(screen.getByRole('button', { name: /fullscreen/i }))
      expect(mockOnExpand).toHaveBeenCalledTimes(1)
    })

    it('should be disabled when no SVG content', () => {
      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={false}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByRole('button', { name: /fullscreen/i })).toBeDisabled()
    })
  })

  describe('direction button click', () => {
    it('should execute prompt template when direction clicked', async () => {
      const user = userEvent.setup()

      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          filePath="/path/to/file.md"
          startLine={10}
          endLine={15}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      await user.click(screen.getByRole('button', { name: /left to right/i }))

      expect(executePromptTemplate).toHaveBeenCalledWith(
        'change-mermaid-direction',
        expect.objectContaining({
          filePath: '/path/to/file.md',
          startLine: 10,
          endLine: 15,
          lineRange: 'lines 10-15',
          fileRef: '@/path/to/file.md:10-15',
          targetDirection: 'LR',
          directionLabel: 'Left to Right'
        })
      )
    })

    it('should not execute prompt when no filePath', async () => {
      const user = userEvent.setup()

      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      await user.click(screen.getByRole('button', { name: /left to right/i }))

      expect(executePromptTemplate).not.toHaveBeenCalled()
    })

    it('should format single line range correctly', async () => {
      const user = userEvent.setup()

      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          filePath="/path/to/file.md"
          startLine={10}
          endLine={10}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      await user.click(screen.getByRole('button', { name: /left to right/i }))

      expect(executePromptTemplate).toHaveBeenCalledWith(
        'change-mermaid-direction',
        expect.objectContaining({
          lineRange: 'line 10',
          fileRef: '@/path/to/file.md:10-10'
        })
      )
    })

    it('should handle missing line numbers', async () => {
      const user = userEvent.setup()

      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          filePath="/path/to/file.md"
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      await user.click(screen.getByRole('button', { name: /left to right/i }))

      expect(executePromptTemplate).toHaveBeenCalledWith(
        'change-mermaid-direction',
        expect.objectContaining({
          lineRange: undefined,
          fileRef: '@/path/to/file.md'
        })
      )
    })
  })

  describe('tooltips', () => {
    it('should have proper title for direction buttons', () => {
      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByTitle('Top to Bottom')).toBeInTheDocument()
      expect(screen.getByTitle('Left to Right')).toBeInTheDocument()
    })

    it('should have proper title for expand button', () => {
      render(
        <MermaidToolbar
          code="flowchart TD\n  A --> B"
          hasSvgContent={true}
          isLoading={false}
          onExpand={mockOnExpand}
        />
      )

      expect(screen.getByTitle('View fullscreen')).toBeInTheDocument()
    })
  })
})
