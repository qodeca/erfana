// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Git Status Badge Component
 * ======================================
 * Visual indicator for git file/folder status
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitStatusBadge } from './GitStatusBadge'
import type { GitDisplayStatus } from '../../../../shared/ipc/git-schema'

describe('GitStatusBadge', () => {
  describe('file variant (default)', () => {
    it('should render "M" badge for modified status', () => {
      render(<GitStatusBadge status="modified" />)
      expect(screen.getByText('M')).toBeInTheDocument()
    })

    it('should render "U" badge for untracked status', () => {
      render(<GitStatusBadge status="untracked" />)
      expect(screen.getByText('U')).toBeInTheDocument()
    })

    it('should render "D" badge for deleted status', () => {
      render(<GitStatusBadge status="deleted" />)
      expect(screen.getByText('D')).toBeInTheDocument()
    })

    it('should render "A" badge for staged status', () => {
      render(<GitStatusBadge status="staged" />)
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should render "R" badge for renamed status', () => {
      render(<GitStatusBadge status="renamed" />)
      expect(screen.getByText('R')).toBeInTheDocument()
    })

    it('should render "!" badge for conflicted status', () => {
      render(<GitStatusBadge status="conflicted" />)
      expect(screen.getByText('!')).toBeInTheDocument()
    })

    it('should return null for unmodified status', () => {
      const { container } = render(<GitStatusBadge status="unmodified" />)
      expect(container.firstChild).toBeNull()
    })

    it('should have git-status-badge class', () => {
      render(<GitStatusBadge status="modified" />)
      const badge = screen.getByText('M')
      expect(badge).toHaveClass('git-status-badge')
    })

    it('should have data-git-status attribute with status value', () => {
      render(<GitStatusBadge status="modified" />)
      const badge = screen.getByText('M')
      expect(badge).toHaveAttribute('data-git-status', 'modified')
    })

    it('should have role="img" for accessibility', () => {
      render(<GitStatusBadge status="modified" />)
      const badge = screen.getByRole('img', { name: 'Modified' })
      expect(badge).toBeInTheDocument()
    })

    describe('accessibility labels', () => {
      it('should have "Modified" aria-label for modified status', () => {
        render(<GitStatusBadge status="modified" />)
        expect(screen.getByLabelText('Modified')).toBeInTheDocument()
      })

      it('should have "Untracked" aria-label for untracked status', () => {
        render(<GitStatusBadge status="untracked" />)
        expect(screen.getByLabelText('Untracked')).toBeInTheDocument()
      })

      it('should have "Deleted" aria-label for deleted status', () => {
        render(<GitStatusBadge status="deleted" />)
        expect(screen.getByLabelText('Deleted')).toBeInTheDocument()
      })

      it('should have "Added" aria-label for staged status', () => {
        render(<GitStatusBadge status="staged" />)
        expect(screen.getByLabelText('Added')).toBeInTheDocument()
      })

      it('should have "Renamed" aria-label for renamed status', () => {
        render(<GitStatusBadge status="renamed" />)
        expect(screen.getByLabelText('Renamed')).toBeInTheDocument()
      })

      it('should have "Conflicted" aria-label for conflicted status', () => {
        render(<GitStatusBadge status="conflicted" />)
        expect(screen.getByLabelText('Conflicted')).toBeInTheDocument()
      })
    })
  })

  describe('folder variant (isFolder=true)', () => {
    it('should render dot for modified status', () => {
      render(<GitStatusBadge status="modified" isFolder={true} />)
      const dot = screen.getByRole('img')
      expect(dot).toHaveClass('git-status-dot')
    })

    it('should render dot for untracked status', () => {
      render(<GitStatusBadge status="untracked" isFolder={true} />)
      const dot = screen.getByRole('img')
      expect(dot).toHaveClass('git-status-dot')
    })

    it('should render dot for deleted status', () => {
      render(<GitStatusBadge status="deleted" isFolder={true} />)
      const dot = screen.getByRole('img')
      expect(dot).toHaveClass('git-status-dot')
    })

    it('should render dot for staged status', () => {
      render(<GitStatusBadge status="staged" isFolder={true} />)
      const dot = screen.getByRole('img')
      expect(dot).toHaveClass('git-status-dot')
    })

    it('should render dot for conflicted status', () => {
      render(<GitStatusBadge status="conflicted" isFolder={true} />)
      const dot = screen.getByRole('img')
      expect(dot).toHaveClass('git-status-dot')
    })

    it('should return null for unmodified status', () => {
      const { container } = render(<GitStatusBadge status="unmodified" isFolder={true} />)
      expect(container.firstChild).toBeNull()
    })

    it('should have data-git-status attribute with status value', () => {
      render(<GitStatusBadge status="modified" isFolder={true} />)
      const dot = screen.getByRole('img')
      expect(dot).toHaveAttribute('data-git-status', 'modified')
    })

    it('should have role="img" for accessibility', () => {
      render(<GitStatusBadge status="modified" isFolder={true} />)
      expect(screen.getByRole('img')).toBeInTheDocument()
    })

    describe('folder accessibility labels', () => {
      it('should have descriptive aria-label for modified status', () => {
        render(<GitStatusBadge status="modified" isFolder={true} />)
        expect(screen.getByLabelText('Folder contains modified files')).toBeInTheDocument()
      })

      it('should have descriptive aria-label for untracked status', () => {
        render(<GitStatusBadge status="untracked" isFolder={true} />)
        expect(screen.getByLabelText('Folder contains untracked files')).toBeInTheDocument()
      })

      it('should have descriptive aria-label for deleted status', () => {
        render(<GitStatusBadge status="deleted" isFolder={true} />)
        expect(screen.getByLabelText('Folder contains deleted files')).toBeInTheDocument()
      })

      it('should have descriptive aria-label for staged status', () => {
        render(<GitStatusBadge status="staged" isFolder={true} />)
        expect(screen.getByLabelText('Folder contains added files')).toBeInTheDocument()
      })

      it('should have descriptive aria-label for conflicted status', () => {
        render(<GitStatusBadge status="conflicted" isFolder={true} />)
        expect(screen.getByLabelText('Folder contains conflicted files')).toBeInTheDocument()
      })
    })

    it('should not render text content (only visual dot)', () => {
      const { container } = render(<GitStatusBadge status="modified" isFolder={true} />)
      const dot = container.querySelector('.git-status-dot')
      expect(dot?.textContent).toBe('')
    })
  })

  describe('variant differences', () => {
    it('should render different classes for file vs folder', () => {
      const { container: fileContainer } = render(<GitStatusBadge status="modified" isFolder={false} />)
      const { container: folderContainer } = render(<GitStatusBadge status="modified" isFolder={true} />)

      const fileBadge = fileContainer.querySelector('.git-status-badge')
      const folderDot = folderContainer.querySelector('.git-status-dot')

      expect(fileBadge).toBeInTheDocument()
      expect(folderDot).toBeInTheDocument()
      expect(fileBadge).not.toHaveClass('git-status-dot')
      expect(folderDot).not.toHaveClass('git-status-badge')
    })

    it('should render letter for file, no letter for folder', () => {
      const { container: fileContainer } = render(<GitStatusBadge status="modified" isFolder={false} />)
      const { container: folderContainer } = render(<GitStatusBadge status="modified" isFolder={true} />)

      expect(fileContainer.textContent).toBe('M')
      expect(folderContainer.textContent).toBe('')
    })
  })

  describe('all status types rendering', () => {
    const statusTypes: GitDisplayStatus[] = [
      'modified',
      'untracked',
      'deleted',
      'staged',
      'renamed',
      'conflicted',
    ]

    it('should render all non-unmodified statuses for files', () => {
      statusTypes.forEach((status) => {
        const { container } = render(<GitStatusBadge status={status} />)
        expect(container.firstChild).not.toBeNull()
      })
    })

    it('should render all non-unmodified statuses for folders', () => {
      statusTypes.forEach((status) => {
        const { container } = render(<GitStatusBadge status={status} isFolder={true} />)
        expect(container.firstChild).not.toBeNull()
      })
    })

    it.each(statusTypes)('should have correct data-git-status for %s', (status) => {
      const { unmount } = render(<GitStatusBadge status={status} />)
      const element = screen.getByRole('img')
      expect(element).toHaveAttribute('data-git-status', status)
      unmount()
    })
  })
})
