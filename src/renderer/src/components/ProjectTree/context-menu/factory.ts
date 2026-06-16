// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Context Menu Factory
 *
 * Factory pattern implementation for context menu generation.
 * Selects appropriate strategy based on node type and builds menu.
 *
 * Factory Pattern:
 * - Registers all available strategies
 * - Selects strategy using supports() method
 * - Delegates menu building to selected strategy
 *
 * Extensibility:
 * - Add new strategies without modifying factory logic
 * - Strategies self-register their node type support
 */

import type { IContextMenuFactory, IContextMenuStrategy, IMenuItem, MenuContext, FileNode } from './types'
import { DirectoryContextMenuStrategy, FileContextMenuStrategy } from './strategies'

/**
 * Context menu factory
 * Selects appropriate strategy and builds menus
 */
export class ContextMenuFactory implements IContextMenuFactory {
  private strategies: IContextMenuStrategy[]

  constructor() {
    // Register all strategies
    this.strategies = [
      new DirectoryContextMenuStrategy(),
      new FileContextMenuStrategy()
    ]
  }

  /**
   * Build context menu for a node
   * Selects appropriate strategy and delegates menu building
   *
   * @param node - File node to build menu for
   * @param ctx - Menu context with dependencies
   * @returns Array of menu items
   * @throws Error if no strategy supports the node type
   */
  build(node: FileNode, ctx: MenuContext): IMenuItem[] {
    const strategy = this.strategies.find(s => s.supports(node))

    if (!strategy) {
      throw new Error(`No context menu strategy found for node type: ${node.type}`)
    }

    return strategy.build(node, ctx)
  }
}
