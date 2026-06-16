// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for iconRegistry.tsx
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  getIcon,
  isValidIcon,
  renderIcon,
  getAllIconNames,
  DEFAULT_ICON_PROPS,
  LARGE_ICON_PROPS
} from './iconRegistry'

describe('iconRegistry', () => {
  describe('getIcon()', () => {
    it('should return and render maximize2 icon', () => {
      const Icon = getIcon('maximize2')
      expect(Icon).toBeDefined()
      const { container } = render(<Icon size={14} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should return and render edit-3 icon', () => {
      const Icon = getIcon('edit-3')
      expect(Icon).toBeDefined()
      const { container } = render(<Icon size={14} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should return and render help-circle icon', () => {
      const Icon = getIcon('help-circle')
      expect(Icon).toBeDefined()
      const { container } = render(<Icon size={14} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should return and render sparkles icon', () => {
      const Icon = getIcon('sparkles')
      expect(Icon).toBeDefined()
      const { container } = render(<Icon size={14} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should return fallback component for unknown icon', () => {
      const Icon = getIcon('unknown-icon')
      expect(Icon).toBeDefined()
      // Fallback should still render
      const { container } = render(<Icon size={14} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should return fallback for empty string', () => {
      const Icon = getIcon('')
      expect(Icon).toBeDefined()
      const { container } = render(<Icon size={14} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('isValidIcon()', () => {
    it('should return true for valid icon names', () => {
      expect(isValidIcon('maximize2')).toBe(true)
      expect(isValidIcon('edit-3')).toBe(true)
      expect(isValidIcon('help-circle')).toBe(true)
      expect(isValidIcon('sparkles')).toBe(true)
      expect(isValidIcon('message-circle')).toBe(true)
    })

    it('should return false for invalid icon names', () => {
      expect(isValidIcon('unknown')).toBe(false)
      expect(isValidIcon('')).toBe(false)
      expect(isValidIcon('not-an-icon')).toBe(false)
    })
  })

  describe('renderIcon()', () => {
    it('should render a valid icon', () => {
      const { container } = render(<>{renderIcon('maximize2')}</>)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should apply default props', () => {
      const { container } = render(<>{renderIcon('edit-3')}</>)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', String(DEFAULT_ICON_PROPS.size))
      expect(svg).toHaveAttribute('height', String(DEFAULT_ICON_PROPS.size))
    })

    it('should allow custom props to override defaults', () => {
      const { container } = render(<>{renderIcon('sparkles', { size: 24 })}</>)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '24')
      expect(svg).toHaveAttribute('height', '24')
    })

    it('should render fallback for unknown icon', () => {
      const { container } = render(<>{renderIcon('unknown-icon')}</>)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('getAllIconNames()', () => {
    it('should return array of icon names', () => {
      const names = getAllIconNames()
      expect(Array.isArray(names)).toBe(true)
      expect(names.length).toBeGreaterThan(0)
    })

    it('should include common icons', () => {
      const names = getAllIconNames()
      expect(names).toContain('maximize2')
      expect(names).toContain('edit-3')
      expect(names).toContain('help-circle')
      expect(names).toContain('sparkles')
    })

    it('should include all registered icons', () => {
      const names = getAllIconNames()
      expect(names).toContain('minimize2')
      expect(names).toContain('refresh')
      expect(names).toContain('copy')
      expect(names).toContain('message-circle')
      expect(names).toContain('file-text')
      expect(names).toContain('alert-circle')
    })
  })

  describe('icon props constants', () => {
    it('should have default props with size 14', () => {
      expect(DEFAULT_ICON_PROPS.size).toBe(14)
      expect(DEFAULT_ICON_PROPS.strokeWidth).toBe(2)
    })

    it('should have large props with size 18', () => {
      expect(LARGE_ICON_PROPS.size).toBe(18)
      expect(LARGE_ICON_PROPS.strokeWidth).toBe(2)
    })
  })
})
