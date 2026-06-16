// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ActivityBar Component
 *
 * Tests for panel filtering and rendering based on project state:
 * - Terminal panel hidden when no project loaded (projectPath = null)
 * - Terminal panel visible when project loaded (projectPath = "/some/path")
 * - Other panels not affected by projectPath
 * - Panel click handling
 * - Active panel indication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityBar } from './ActivityBar'
import * as config from './activityBarConfig'

// Mock activityBarConfig
vi.mock('./activityBarConfig', async () => {
  const actual = await vi.importActual<typeof config>('./activityBarConfig')
  return {
    ...actual,
    getPanelsBySide: vi.fn(actual.getPanelsBySide)
  }
})

// Mock ActivityBarItem component
vi.mock('./ActivityBarItem', () => ({
  ActivityBarItem: ({
    label,
    active,
    onClick,
    tooltip
  }: {
    label: string
    active: boolean
    onClick: () => void
    tooltip: string
  }) => (
    <button
      data-testid={`activity-bar-item-${label.toLowerCase()}`}
      data-active={active}
      onClick={onClick}
      title={tooltip}
    >
      {label}
    </button>
  )
}))

describe('ActivityBar', () => {
  const mockOnPanelClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Left sidebar rendering', () => {
    it('should render left panels when projectPath is null', () => {
      render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      // Project panel should be visible (no requiresProject)
      expect(screen.getByTestId('activity-bar-item-project')).toBeInTheDocument()
    })

    it('should render left panels when projectPath is provided', () => {
      render(
        <ActivityBar
          side="left"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      // Project panel should be visible
      expect(screen.getByTestId('activity-bar-item-project')).toBeInTheDocument()
    })

    it('should not render disabled panels', () => {
      render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      // Search panel is disabled, should not be rendered
      expect(screen.queryByTestId('activity-bar-item-search')).not.toBeInTheDocument()
    })
  })

  describe('Right sidebar rendering', () => {
    it('should NOT render terminal when projectPath is null', () => {
      render(
        <ActivityBar side="right" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      // Terminal has requiresProject: true, should be filtered out
      expect(screen.queryByTestId('activity-bar-item-terminal')).not.toBeInTheDocument()
    })

    it('should render terminal when projectPath is provided', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      // Terminal should be visible when project is loaded
      expect(screen.getByTestId('activity-bar-item-terminal')).toBeInTheDocument()
    })

    it('should return null (hide entire bar) when no project and terminal is only right panel', () => {
      const { container } = render(
        <ActivityBar side="right" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      // Should not render anything when no panels to show
      expect(container.querySelector('.activity-bar')).not.toBeInTheDocument()
      expect(container.querySelector('.activity-bar-items')).not.toBeInTheDocument()
      expect(screen.queryByTestId('activity-bar-item-terminal')).not.toBeInTheDocument()
    })
  })

  describe('Project path filtering', () => {
    it('should filter out panels with requiresProject when projectPath is null', () => {
      render(
        <ActivityBar side="right" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      const getPanelsBySideMock = vi.mocked(config.getPanelsBySide)
      expect(getPanelsBySideMock).toHaveBeenCalledWith('right')

      // Terminal should be filtered out
      expect(screen.queryByTestId('activity-bar-item-terminal')).not.toBeInTheDocument()
    })

    it('should include panels with requiresProject when projectPath is provided', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/Users/test/project"
        />
      )

      // Terminal should be visible
      expect(screen.getByTestId('activity-bar-item-terminal')).toBeInTheDocument()
    })

    it('should not filter panels without requiresProject regardless of projectPath', () => {
      // Test with null
      const { rerender } = render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )
      expect(screen.getByTestId('activity-bar-item-project')).toBeInTheDocument()

      // Test with path
      rerender(
        <ActivityBar
          side="left"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )
      expect(screen.getByTestId('activity-bar-item-project')).toBeInTheDocument()
    })
  })

  describe('Active panel indication', () => {
    it('should mark panel as active when activePanel matches', () => {
      render(
        <ActivityBar
          side="right"
          activePanel="terminal"
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      const terminalButton = screen.getByTestId('activity-bar-item-terminal')
      expect(terminalButton).toHaveAttribute('data-active', 'true')
    })

    it('should not mark panel as active when activePanel does not match', () => {
      render(
        <ActivityBar
          side="right"
          activePanel="other"
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      const terminalButton = screen.getByTestId('activity-bar-item-terminal')
      expect(terminalButton).toHaveAttribute('data-active', 'false')
    })

    it('should mark no panel as active when activePanel is null', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      const terminalButton = screen.getByTestId('activity-bar-item-terminal')
      expect(terminalButton).toHaveAttribute('data-active', 'false')
    })
  })

  describe('Panel click handling', () => {
    it('should call onPanelClick with panel id when clicked', async () => {
      const user = userEvent.setup()

      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      const terminalButton = screen.getByTestId('activity-bar-item-terminal')
      await user.click(terminalButton)

      expect(mockOnPanelClick).toHaveBeenCalledWith('terminal')
      expect(mockOnPanelClick).toHaveBeenCalledTimes(1)
    })

    it('should call onPanelClick for project panel', async () => {
      const user = userEvent.setup()

      render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      const projectButton = screen.getByTestId('activity-bar-item-project')
      await user.click(projectButton)

      expect(mockOnPanelClick).toHaveBeenCalledWith('project')
      expect(mockOnPanelClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('CSS classes', () => {
    it('should have activity-bar class', () => {
      const { container } = render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(container.querySelector('.activity-bar')).toBeInTheDocument()
    })

    it('should have activity-bar-left class for left side', () => {
      const { container } = render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(container.querySelector('.activity-bar-left')).toBeInTheDocument()
    })

    it('should have activity-bar-right class for right side', () => {
      const { container } = render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      expect(container.querySelector('.activity-bar-right')).toBeInTheDocument()
    })

    it('should have activity-bar-items class for items container', () => {
      const { container } = render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(container.querySelector('.activity-bar-items')).toBeInTheDocument()
    })
  })

  describe('Panel ordering', () => {
    it('should call getPanelsBySide with correct side', () => {
      const getPanelsBySideMock = vi.mocked(config.getPanelsBySide)

      render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(getPanelsBySideMock).toHaveBeenCalledWith('left')

      getPanelsBySideMock.mockClear()

      render(
        <ActivityBar side="right" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(getPanelsBySideMock).toHaveBeenCalledWith('right')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty projectPath string as falsy (hides terminal)', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath=""
        />
      )

      // Empty string is falsy, should filter out terminal
      expect(screen.queryByTestId('activity-bar-item-terminal')).not.toBeInTheDocument()
    })

    it('should handle projectPath with spaces', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/path/with spaces/project"
        />
      )

      // Should be treated as valid path
      expect(screen.getByTestId('activity-bar-item-terminal')).toBeInTheDocument()
    })

    it('should handle projectPath with special characters', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/path/with-special_chars.123/project"
        />
      )

      // Should be treated as valid path
      expect(screen.getByTestId('activity-bar-item-terminal')).toBeInTheDocument()
    })

    it('should re-render when projectPath changes from null to path', () => {
      const { rerender } = render(
        <ActivityBar side="right" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(screen.queryByTestId('activity-bar-item-terminal')).not.toBeInTheDocument()

      rerender(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      expect(screen.getByTestId('activity-bar-item-terminal')).toBeInTheDocument()
    })

    it('should re-render when projectPath changes from path to null', () => {
      const { rerender } = render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      expect(screen.getByTestId('activity-bar-item-terminal')).toBeInTheDocument()

      rerender(
        <ActivityBar side="right" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      expect(screen.queryByTestId('activity-bar-item-terminal')).not.toBeInTheDocument()
    })
  })

  describe('accessibility: icon-only buttons', () => {
    it('all icon-only buttons should have aria-label (left side)', () => {
      render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath="/some/path" />
      )

      const buttons = screen.getAllByRole('button')
      const iconOnlyButtons = buttons.filter(
        (button) => !button.textContent?.trim()
      )

      for (const button of iconOnlyButtons) {
        expect(button).toHaveAttribute('aria-label')
      }
    })

    it('all icon-only buttons should have aria-label (right side)', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      const buttons = screen.getAllByRole('button')
      const iconOnlyButtons = buttons.filter(
        (button) => !button.textContent?.trim()
      )

      for (const button of iconOnlyButtons) {
        expect(button).toHaveAttribute('aria-label')
      }
    })
  })

  describe('Tooltips', () => {
    it('should display tooltip for terminal panel', () => {
      render(
        <ActivityBar
          side="right"
          activePanel={null}
          onPanelClick={mockOnPanelClick}
          projectPath="/some/path"
        />
      )

      const terminalButton = screen.getByTestId('activity-bar-item-terminal')
      expect(terminalButton).toHaveAttribute('title', 'Terminal (⌘J)')
    })

    it('should display tooltip for project panel', () => {
      render(
        <ActivityBar side="left" activePanel={null} onPanelClick={mockOnPanelClick} projectPath={null} />
      )

      const projectButton = screen.getByTestId('activity-bar-item-project')
      expect(projectButton).toHaveAttribute('title', 'Project (⌘B)')
    })
  })
})
