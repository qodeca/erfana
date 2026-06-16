// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Folder } from 'lucide-react'
import { FileSystemDialog } from './FileSystemDialog'
import type { NewFolderDialogConfig } from './types'

interface NewFolderDialogProps {
  config: NewFolderDialogConfig
  zIndex: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * NewFolderDialog - Specialized dialog for creating new folders
 *
 * Thin wrapper around FileSystemDialog configured for folder creation.
 *
 * Features:
 * - Shows Folder icon and parent path context
 * - Auto-focuses input field
 * - Validates against invalid characters, reserved names, duplicates
 * - Character counter and inline validation errors
 * - Keyboard shortcuts tooltip (Enter to create, Esc to cancel)
 *
 * @example
 * ```typescript
 * const { showNewFolder } = useDialog()
 * const folderName = await showNewFolder({
 *   title: 'Create New Folder',
 *   message: '',
 *   parentPath: '/project/docs',
 *   inputPlaceholder: 'new-folder',
 *   existingNames: ['assets', 'images']
 * })
 * if (folderName) console.log('Created:', folderName)
 * ```
 */
export function NewFolderDialog({ config, zIndex, onSubmit, onCancel }: NewFolderDialogProps) {
  const { id, title, parentPath, existingNames = [] } = config
  const placeholder = config.inputPlaceholder || 'new-folder'

  return (
    <FileSystemDialog
      id={id}
      title={title}
      icon={<Folder size={20} strokeWidth={2} />}
      itemType="folder"
      operation="create"
      parentPath={parentPath}
      inputPlaceholder={placeholder}
      existingNames={existingNames}
      zIndex={zIndex}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
