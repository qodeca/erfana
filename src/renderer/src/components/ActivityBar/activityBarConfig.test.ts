// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ActivityBar Configuration
 *
 * Tests for panel configuration including:
 * - ActivityBarPanel interface shape
 * - Panel configuration values
 * - requiresProject field validation
 * - Helper functions (getPanelsBySide, getPanelById)
 */

import { describe, it, expect } from 'vitest'
import {
  type ActivityBarPanel,
  activityBarPanels,
  getPanelsBySide,
  getPanelById
} from './activityBarConfig'

describe('activityBarConfig', () => {
  describe('ActivityBarPanel interface', () => {
    it('should allow requiresProject field', () => {
      const panel: ActivityBarPanel = {
        id: 'test',
        icon: () => null,
        label: 'Test',
        tooltip: 'Test Panel',
        side: 'left',
        dockviewPanelId: 'test',
        order: 1,
        requiresProject: true
      }

      expect(panel.requiresProject).toBe(true)
    })

    it('should allow optional requiresProject field', () => {
      const panel: ActivityBarPanel = {
        id: 'test',
        icon: () => null,
        label: 'Test',
        tooltip: 'Test Panel',
        side: 'left',
        dockviewPanelId: 'test',
        order: 1
      }

      expect(panel.requiresProject).toBeUndefined()
    })
  })

  describe('Panel configuration', () => {
    it('should have terminal panel with requiresProject: true', () => {
      const terminalPanel = activityBarPanels.find((p) => p.id === 'terminal')

      expect(terminalPanel).toBeDefined()
      expect(terminalPanel?.requiresProject).toBe(true)
    })

    it('should have project panel without requiresProject', () => {
      const projectPanel = activityBarPanels.find((p) => p.id === 'project')

      expect(projectPanel).toBeDefined()
      expect(projectPanel?.requiresProject).toBeUndefined()
    })

    it('should have search panel without requiresProject', () => {
      const searchPanel = activityBarPanels.find((p) => p.id === 'search')

      expect(searchPanel).toBeDefined()
      expect(searchPanel?.requiresProject).toBeUndefined()
    })
  })

  describe('Panel side placement', () => {
    it('should place terminal on right side', () => {
      const terminalPanel = activityBarPanels.find((p) => p.id === 'terminal')

      expect(terminalPanel?.side).toBe('right')
    })

    it('should place project on left side', () => {
      const projectPanel = activityBarPanels.find((p) => p.id === 'project')

      expect(projectPanel?.side).toBe('left')
    })
  })

  describe('getPanelsBySide', () => {
    it('should return left panels sorted by order', () => {
      const leftPanels = getPanelsBySide('left')

      expect(leftPanels.length).toBeGreaterThan(0)
      expect(leftPanels.every((p) => p.side === 'left')).toBe(true)

      // Check sorting by order
      for (let i = 1; i < leftPanels.length; i++) {
        expect(leftPanels[i].order).toBeGreaterThanOrEqual(leftPanels[i - 1].order)
      }
    })

    it('should return right panels sorted by order', () => {
      const rightPanels = getPanelsBySide('right')

      expect(rightPanels.length).toBeGreaterThan(0)
      expect(rightPanels.every((p) => p.side === 'right')).toBe(true)

      // Check sorting by order
      for (let i = 1; i < rightPanels.length; i++) {
        expect(rightPanels[i].order).toBeGreaterThanOrEqual(rightPanels[i - 1].order)
      }
    })

    it('should filter out disabled panels', () => {
      const leftPanels = getPanelsBySide('left')

      // Search panel is disabled
      expect(leftPanels.find((p) => p.id === 'search')).toBeUndefined()
    })

    it('should include enabled panels only', () => {
      const leftPanels = getPanelsBySide('left')

      expect(leftPanels.every((p) => p.enabled !== false)).toBe(true)
    })

    it('should include terminal in right panels', () => {
      const rightPanels = getPanelsBySide('right')

      expect(rightPanels.find((p) => p.id === 'terminal')).toBeDefined()
    })

    it('should not filter based on requiresProject', () => {
      // getPanelsBySide should return terminal even though it requires project
      // Filtering happens in ActivityBar component based on projectPath
      const rightPanels = getPanelsBySide('right')
      const terminalPanel = rightPanels.find((p) => p.id === 'terminal')

      expect(terminalPanel).toBeDefined()
      expect(terminalPanel?.requiresProject).toBe(true)
    })
  })

  describe('getPanelById', () => {
    it('should return panel by id', () => {
      const terminalPanel = getPanelById('terminal')

      expect(terminalPanel).toBeDefined()
      expect(terminalPanel?.id).toBe('terminal')
    })

    it('should return undefined for non-existent id', () => {
      const panel = getPanelById('non-existent')

      expect(panel).toBeUndefined()
    })

    it('should return project panel by id', () => {
      const projectPanel = getPanelById('project')

      expect(projectPanel).toBeDefined()
      expect(projectPanel?.id).toBe('project')
    })

    it('should return disabled panels', () => {
      // getPanelById should return even disabled panels
      const searchPanel = getPanelById('search')

      expect(searchPanel).toBeDefined()
      expect(searchPanel?.enabled).toBe(false)
    })
  })

  describe('Panel metadata', () => {
    it('should have terminal panel with correct metadata', () => {
      const terminalPanel = getPanelById('terminal')

      expect(terminalPanel).toMatchObject({
        id: 'terminal',
        label: 'Terminal',
        tooltip: 'Terminal (⌘J)',
        side: 'right',
        dockviewPanelId: 'terminal',
        order: 1,
        keyboardShortcut: 'mod+j',
        enabled: true,
        requiresProject: true
      })
    })

    it('should have project panel with correct metadata', () => {
      const projectPanel = getPanelById('project')

      expect(projectPanel).toMatchObject({
        id: 'project',
        label: 'Project',
        tooltip: 'Project (⌘B)',
        side: 'left',
        dockviewPanelId: 'project',
        order: 1,
        keyboardShortcut: 'mod+b',
        enabled: true
      })
    })

    it('should have all panels with required fields', () => {
      activityBarPanels.forEach((panel) => {
        expect(panel.id).toBeDefined()
        expect(panel.icon).toBeDefined()
        expect(panel.label).toBeDefined()
        expect(panel.tooltip).toBeDefined()
        expect(panel.side).toMatch(/^(left|right)$/)
        expect(panel.dockviewPanelId).toBeDefined()
        expect(typeof panel.order).toBe('number')
      })
    })
  })
})
