// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Panel Handler Registry
 *
 * Registry pattern for managing panel handlers.
 * Allows new panel types to be added without modifying core logic.
 *
 * PHASE 2 INFRASTRUCTURE:
 * This registry is built but not yet integrated into executePromptTemplate().
 * Currently, panelUtils.ts uses the simpler createDefaultManagers() approach.
 * Integration is planned for when additional panel types are added (e.g., Copilot panel).
 *
 * Usage:
 *   const registry = createPanelHandlerRegistry()
 *   registry.register(createTerminalPanelHandler())
 *   const handler = registry.get('terminal')
 *   await handler?.send({ content: 'npm install', location: 'right' })
 */

import type { IPanelHandler, PanelHandlerFactory } from './panelHandler.types'
import type { PanelManagers } from './panelManager.types'
import { createTerminalPanelHandler } from './terminalPanelHandler'

/**
 * Registry for panel handlers
 */
export interface IPanelHandlerRegistry {
  /**
   * Register a panel handler
   * @param handler - Handler to register
   */
  register(handler: IPanelHandler): void

  /**
   * Register a handler using a factory function
   * @param factory - Factory that creates the handler
   */
  registerFactory(factory: PanelHandlerFactory): void

  /**
   * Get a handler by panel type
   * @param panelType - Type of panel (e.g., 'terminal')
   * @returns Handler or undefined if not found
   */
  get(panelType: string): IPanelHandler | undefined

  /**
   * Check if a handler is registered for a panel type
   * @param panelType - Type of panel
   */
  has(panelType: string): boolean

  /**
   * Get all registered panel types
   */
  getPanelTypes(): string[]

  /**
   * Get all available panel types (handlers that report isAvailable() = true)
   */
  getAvailablePanelTypes(): string[]

  /**
   * Unregister a handler
   * @param panelType - Type of panel to unregister
   * @returns true if handler was removed, false if not found
   */
  unregister(panelType: string): boolean

  /**
   * Clear all registered handlers
   */
  clear(): void
}

/**
 * Default implementation of panel handler registry
 */
class PanelHandlerRegistry implements IPanelHandlerRegistry {
  private handlers: Map<string, IPanelHandler> = new Map()

  register(handler: IPanelHandler): void {
    if (!handler.panelType) {
      throw new Error('Handler must have a panelType')
    }
    this.handlers.set(handler.panelType, handler)
  }

  registerFactory(factory: PanelHandlerFactory): void {
    const handler = factory()
    this.register(handler)
  }

  get(panelType: string): IPanelHandler | undefined {
    return this.handlers.get(panelType)
  }

  has(panelType: string): boolean {
    return this.handlers.has(panelType)
  }

  getPanelTypes(): string[] {
    return Array.from(this.handlers.keys())
  }

  getAvailablePanelTypes(): string[] {
    return Array.from(this.handlers.entries())
      .filter(([, handler]) => handler.isAvailable())
      .map(([type]) => type)
  }

  unregister(panelType: string): boolean {
    return this.handlers.delete(panelType)
  }

  clear(): void {
    this.handlers.clear()
  }
}

/**
 * Create a new panel handler registry
 */
export function createPanelHandlerRegistry(): IPanelHandlerRegistry {
  return new PanelHandlerRegistry()
}

/**
 * Create a registry with default handlers pre-registered
 * @param managers - Optional managers for dependency injection
 */
export function createDefaultPanelHandlerRegistry(
  managers?: PanelManagers
): IPanelHandlerRegistry {
  const registry = createPanelHandlerRegistry()

  // Register terminal handler
  registry.register(createTerminalPanelHandler(managers))

  // Future: Register other handlers here
  // registry.register(createCopilotPanelHandler(managers))

  return registry
}

/** Default registry singleton (lazily initialized) */
let defaultRegistry: IPanelHandlerRegistry | null = null

/**
 * Get the default panel handler registry
 * Creates a new registry with default handlers if not already initialized.
 */
export function getDefaultPanelHandlerRegistry(): IPanelHandlerRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createDefaultPanelHandlerRegistry()
  }
  return defaultRegistry
}

/**
 * Reset the default registry (for testing)
 */
export function resetDefaultPanelHandlerRegistry(): void {
  defaultRegistry = null
}
