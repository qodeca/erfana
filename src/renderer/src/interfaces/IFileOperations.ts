/**
 * Interface for file operations required by clipboard store
 * Enables dependency injection and testing
 */
export interface IFileOperations {
  /**
   * Move a file or folder to a new parent directory
   */
  moveItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string
  ): Promise<{ path: string; isSymlink?: boolean }>

  /**
   * Copy a file or folder to a new location
   */
  copyItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string
  ): Promise<{ path: string; isSymlink?: boolean }>
}
