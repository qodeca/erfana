// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Git Status Bar Component
 * ====================================
 * Footer bar showing git branch and status counts
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitStatusBar } from './GitStatusBar'
import type { GitStatusCounts } from '../../../../shared/ipc/git-schema'

describe('GitStatusBar', () => {
  const defaultCounts: GitStatusCounts = {
    modified: 0,
    untracked: 0,
    deleted: 0,
    staged: 0,
    conflicted: 0,
  }

  describe('non-git repository', () => {
    it('should return null when isGitRepo is false', () => {
      const { container } = render(
        <GitStatusBar
          isGitRepo={false}
          branch={null}
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(container.firstChild).toBeNull()
    })

    it('should not render any elements when not a git repo', () => {
      const { container } = render(
        <GitStatusBar
          isGitRepo={false}
          branch="main"
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(container.querySelector('.git-status-bar')).not.toBeInTheDocument()
    })
  })

  describe('git repository rendering', () => {
    it('should render when isGitRepo is true', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(screen.getByText('main')).toBeInTheDocument()
    })

    it('should render branch name', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="develop"
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(screen.getByText('develop')).toBeInTheDocument()
    })

    it('should show "unknown" when branch is null', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch={null}
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(screen.getByText('unknown')).toBeInTheDocument()
    })

    it('should show "HEAD (detached)" when isDetached is true', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="a1b2c3d"
          isDetached={true}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(screen.getByText('HEAD (detached)')).toBeInTheDocument()
    })
  })

  describe('status counts display', () => {
    it('should show "Clean" when all counts are zero', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(screen.getByText('Clean')).toBeInTheDocument()
    })

    it('should show modified count when > 0', () => {
      const counts: GitStatusCounts = {
        ...defaultCounts,
        modified: 5,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('M5')).toBeInTheDocument()
    })

    it('should show untracked count when > 0', () => {
      const counts: GitStatusCounts = {
        ...defaultCounts,
        untracked: 3,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('U3')).toBeInTheDocument()
    })

    it('should show deleted count when > 0', () => {
      const counts: GitStatusCounts = {
        ...defaultCounts,
        deleted: 2,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('D2')).toBeInTheDocument()
    })

    it('should show staged count when > 0', () => {
      const counts: GitStatusCounts = {
        ...defaultCounts,
        staged: 4,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('A4')).toBeInTheDocument()
    })

    it('should show conflicted count when > 0', () => {
      const counts: GitStatusCounts = {
        ...defaultCounts,
        conflicted: 1,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('!1')).toBeInTheDocument()
    })

    it('should show multiple counts when multiple > 0', () => {
      const counts: GitStatusCounts = {
        modified: 5,
        untracked: 3,
        deleted: 1,
        staged: 2,
        conflicted: 0,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('M5')).toBeInTheDocument()
      expect(screen.getByText('U3')).toBeInTheDocument()
      expect(screen.getByText('D1')).toBeInTheDocument()
      expect(screen.getByText('A2')).toBeInTheDocument()
      expect(screen.queryByText('!0')).not.toBeInTheDocument()
    })

    it('should not show "Clean" when any count > 0', () => {
      const counts: GitStatusCounts = {
        ...defaultCounts,
        modified: 1,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.queryByText('Clean')).not.toBeInTheDocument()
    })

    it('should not show counts when 0', () => {
      const counts: GitStatusCounts = {
        modified: 5,
        untracked: 0,
        deleted: 0,
        staged: 0,
        conflicted: 0,
      }
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )
      expect(screen.getByText('M5')).toBeInTheDocument()
      expect(screen.queryByText('U0')).not.toBeInTheDocument()
      expect(screen.queryByText('D0')).not.toBeInTheDocument()
      expect(screen.queryByText('A0')).not.toBeInTheDocument()
      expect(screen.queryByText('!0')).not.toBeInTheDocument()
    })
  })

  describe('truncation warning', () => {
    it('should show warning icon when truncated is true', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={defaultCounts}
          truncated={true}
        />
      )
      const warning = screen.getByTitle('Too many changes - showing first 10,000 files')
      expect(warning).toBeInTheDocument()
    })

    it('should not show warning icon when truncated is false', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={defaultCounts}
          truncated={false}
        />
      )
      expect(screen.queryByTitle('Too many changes - showing first 10,000 files')).not.toBeInTheDocument()
    })

    it('should have correct title attribute on warning', () => {
      render(
        <GitStatusBar
          isGitRepo={true}
          branch="main"
          isDetached={false}
          counts={defaultCounts}
          truncated={true}
        />
      )
      const warning = screen.getByTitle('Too many changes - showing first 10,000 files')
      expect(warning).toHaveAttribute('title', 'Too many changes - showing first 10,000 files')
    })
  })

  describe('complete layouts', () => {
    it('should render all sections: branch and counts', () => {
      const counts: GitStatusCounts = {
        modified: 3,
        untracked: 2,
        deleted: 1,
        staged: 0,
        conflicted: 0,
      }

      const { container } = render(
        <GitStatusBar
          isGitRepo={true}
          branch="feature/git-status"
          isDetached={false}
          counts={counts}
          truncated={false}
        />
      )

      expect(screen.getByText('feature/git-status')).toBeInTheDocument()
      expect(screen.getByText('M3')).toBeInTheDocument()
      expect(screen.getByText('U2')).toBeInTheDocument()
      expect(screen.getByText('D1')).toBeInTheDocument()
      expect(container.querySelector('.git-status-bar')).toBeInTheDocument()
      expect(container.querySelector('.git-branch')).toBeInTheDocument()
      expect(container.querySelector('.git-counts')).toBeInTheDocument()
    })
  })
})
