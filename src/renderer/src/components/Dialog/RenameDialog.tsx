// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { File, Folder } from 'lucide-react'
import { FileSystemDialog } from './FileSystemDialog'
import type { RenameDialogConfig } from './types'

interface RenameDialogProps {
  config: RenameDialogConfig
  zIndex: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * RenameDialog - Specialized dialog for renaming files and folders
 *
 * Thin wrapper around FileSystemDialog configured for rename operations.
 *
 * Features:
 * - Shows file/folder icon and parent path context
 * - Auto-selects entire filename (including extension)
 * - Allows changing file extensions
 * - Validates against invalid characters, reserved names, duplicates
 * - Character counter and inline validation errors
 * - Keyboard shortcuts tooltip (Enter to rename, Esc to cancel)
 *
 * @example
 * ```typescript
 * const { showRename } = useDialog()
 * const newName = await showRename({
 *   title: 'Rename File',
 *   message: '',
 *   currentName: 'document.md',
 *   itemPath: '/project/docs/document.md',
 *   itemType: 'file',
 *   parentPath: '/project/docs',
 *   existingNames: ['README.md', 'notes.txt']
 * })
 * if (newName) console.log('Renamed to:', newName)
 * ```
 */
export function RenameDialog({ config, zIndex, onSubmit, onCancel }: RenameDialogProps) {
  const { id, title, currentName, itemType, existingNames = [] } = config
  const parentPath = config.parentPath || ''

  // Select icon based on item type
  const icon =
    itemType === 'file' ? (
      <File size={20} strokeWidth={2} />
    ) : (
      <Folder size={20} strokeWidth={2} />
    )

  // Map 'directory' to 'folder' for FileSystemDialog
  const mappedItemType: 'file' | 'folder' = itemType === 'file' ? 'file' : 'folder'

  return (
    <FileSystemDialog
      id={id}
      title={title}
      icon={icon}
      itemType={mappedItemType}
      operation="rename"
      parentPath={parentPath}
      currentName={currentName}
      existingNames={existingNames}
      zIndex={zIndex}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
