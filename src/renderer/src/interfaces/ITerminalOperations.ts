// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for terminal operations required by terminal store
 * Enables dependency injection and testing
 *
 * Follows Interface Segregation Principle - only includes methods actually used by the store
 */
export interface ITerminalOperations {
  /**
   * Write data to a terminal
   */
  write(
    terminalId: string,
    data: string
  ): Promise<{ success: boolean; error?: string }>
}
