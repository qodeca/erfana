// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for PanelHandlerRegistry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createPanelHandlerRegistry,
  createDefaultPanelHandlerRegistry,
  getDefaultPanelHandlerRegistry,
  resetDefaultPanelHandlerRegistry
} from './panelHandlerRegistry'
import type { IPanelHandler } from './panelHandler.types'
import type { PanelManagers } from './panelManager.types'

// Mock the terminal panel handler
vi.mock('./terminalPanelHandler', () => ({
  createTerminalPanelHandler: vi.fn(() => ({
    panelType: 'terminal',
    displayName: 'Terminal',
    open: vi.fn(),
    waitForReady: vi.fn(() => Promise.resolve(true)),
    send: vi.fn(() => Promise.resolve({ success: true })),
    isAvailable: vi.fn(() => true)
  }))
}))

// Mock the factory to avoid Zustand imports
vi.mock('./panelManager.factory', () => ({
  createDefaultManagers: vi.fn(() => ({
    panelManager: { setActivePanel: vi.fn() },
    terminalManager: {
      isReady: vi.fn(() => true),
      sendToTerminal: vi.fn(() => Promise.resolve(true))
    }
  }))
}))

describe('PanelHandlerRegistry', () => {
  let mockHandler: IPanelHandler

  beforeEach(() => {
    mockHandler = {
      panelType: 'test-panel',
      displayName: 'Test Panel',
      open: vi.fn(),
      waitForReady: vi.fn(() => Promise.resolve(true)),
      send: vi.fn(() => Promise.resolve({ success: true })),
      isAvailable: vi.fn(() => true)
    }
    resetDefaultPanelHandlerRegistry()
  })

  afterEach(() => {
    resetDefaultPanelHandlerRegistry()
  })

  describe('createPanelHandlerRegistry()', () => {
    it('should create an empty registry', () => {
      const registry = createPanelHandlerRegistry()

      expect(registry.getPanelTypes()).toEqual([])
    })
  })

  describe('register()', () => {
    it('should register a handler', () => {
      const registry = createPanelHandlerRegistry()

      registry.register(mockHandler)

      expect(registry.has('test-panel')).toBe(true)
      expect(registry.get('test-panel')).toBe(mockHandler)
    })

    it('should throw if handler has no panelType', () => {
      const registry = createPanelHandlerRegistry()
      const invalidHandler = { ...mockHandler, panelType: '' }

      expect(() => registry.register(invalidHandler)).toThrow('Handler must have a panelType')
    })

    it('should overwrite existing handler for same panelType', () => {
      const registry = createPanelHandlerRegistry()
      const newHandler: IPanelHandler = {
        ...mockHandler,
        displayName: 'New Test Panel'
      }

      registry.register(mockHandler)
      registry.register(newHandler)

      expect(registry.get('test-panel')?.displayName).toBe('New Test Panel')
    })
  })

  describe('registerFactory()', () => {
    it('should register handler from factory', () => {
      const registry = createPanelHandlerRegistry()
      const factory = vi.fn(() => mockHandler)

      registry.registerFactory(factory)

      expect(factory).toHaveBeenCalled()
      expect(registry.has('test-panel')).toBe(true)
    })
  })

  describe('get()', () => {
    it('should return handler by panelType', () => {
      const registry = createPanelHandlerRegistry()
      registry.register(mockHandler)

      const handler = registry.get('test-panel')

      expect(handler).toBe(mockHandler)
    })

    it('should return undefined for unknown panelType', () => {
      const registry = createPanelHandlerRegistry()

      const handler = registry.get('unknown')

      expect(handler).toBeUndefined()
    })
  })

  describe('has()', () => {
    it('should return true for registered panelType', () => {
      const registry = createPanelHandlerRegistry()
      registry.register(mockHandler)

      expect(registry.has('test-panel')).toBe(true)
    })

    it('should return false for unregistered panelType', () => {
      const registry = createPanelHandlerRegistry()

      expect(registry.has('unknown')).toBe(false)
    })
  })

  describe('getPanelTypes()', () => {
    it('should return empty array when no handlers registered', () => {
      const registry = createPanelHandlerRegistry()

      expect(registry.getPanelTypes()).toEqual([])
    })

    it('should return all registered panel types', () => {
      const registry = createPanelHandlerRegistry()
      const handler2: IPanelHandler = {
        ...mockHandler,
        panelType: 'another-panel'
      }

      registry.register(mockHandler)
      registry.register(handler2)

      expect(registry.getPanelTypes()).toContain('test-panel')
      expect(registry.getPanelTypes()).toContain('another-panel')
    })
  })

  describe('getAvailablePanelTypes()', () => {
    it('should return only available panel types', () => {
      const registry = createPanelHandlerRegistry()
      const unavailableHandler: IPanelHandler = {
        ...mockHandler,
        panelType: 'unavailable-panel',
        isAvailable: vi.fn(() => false)
      }

      registry.register(mockHandler)
      registry.register(unavailableHandler)

      const available = registry.getAvailablePanelTypes()

      expect(available).toContain('test-panel')
      expect(available).not.toContain('unavailable-panel')
    })
  })

  describe('unregister()', () => {
    it('should remove registered handler', () => {
      const registry = createPanelHandlerRegistry()
      registry.register(mockHandler)

      const result = registry.unregister('test-panel')

      expect(result).toBe(true)
      expect(registry.has('test-panel')).toBe(false)
    })

    it('should return false for unregistered panelType', () => {
      const registry = createPanelHandlerRegistry()

      const result = registry.unregister('unknown')

      expect(result).toBe(false)
    })
  })

  describe('clear()', () => {
    it('should remove all handlers', () => {
      const registry = createPanelHandlerRegistry()
      registry.register(mockHandler)
      registry.register({ ...mockHandler, panelType: 'another' })

      registry.clear()

      expect(registry.getPanelTypes()).toEqual([])
    })
  })
})

describe('createDefaultPanelHandlerRegistry()', () => {
  it('should create registry with terminal handler', () => {
    const mockManagers: PanelManagers = {
      panelManager: { setActivePanel: vi.fn() },
      terminalManager: {
        isReady: vi.fn(() => true),
        sendToTerminal: vi.fn(() => Promise.resolve(true))
      }
    }

    const registry = createDefaultPanelHandlerRegistry(mockManagers)

    expect(registry.has('terminal')).toBe(true)
  })
})

describe('getDefaultPanelHandlerRegistry()', () => {
  beforeEach(() => {
    resetDefaultPanelHandlerRegistry()
  })

  it('should return same instance on multiple calls', () => {
    const registry1 = getDefaultPanelHandlerRegistry()
    const registry2 = getDefaultPanelHandlerRegistry()

    expect(registry1).toBe(registry2)
  })

  it('should have terminal handler registered', () => {
    const registry = getDefaultPanelHandlerRegistry()

    expect(registry.has('terminal')).toBe(true)
  })
})

describe('resetDefaultPanelHandlerRegistry()', () => {
  it('should reset the default registry', () => {
    const registry1 = getDefaultPanelHandlerRegistry()
    resetDefaultPanelHandlerRegistry()
    const registry2 = getDefaultPanelHandlerRegistry()

    expect(registry1).not.toBe(registry2)
  })
})
