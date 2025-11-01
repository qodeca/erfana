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
