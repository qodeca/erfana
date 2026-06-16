// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { File } from 'lucide-react'
import { FileSystemDialog } from './FileSystemDialog'
import type { NewFileDialogConfig } from './types'

interface NewFileDialogProps {
  config: NewFileDialogConfig
  zIndex: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * NewFileDialog - Specialized dialog for creating new files
 *
 * Thin wrapper around FileSystemDialog configured for file creation.
 *
 * Features:
 * - Shows File icon and parent path context
 * - Auto-focuses input field
 * - Validates against invalid characters, reserved names, duplicates
 * - Character counter and inline validation errors
 * - Keyboard shortcuts tooltip (Enter to create, Esc to cancel)
 *
 * @example
 * ```typescript
 * const { showNewFile } = useDialog()
 * const fileName = await showNewFile({
 *   title: 'Create New File',
 *   message: '',
 *   parentPath: '/project/docs',
 *   inputPlaceholder: 'notes.md',
 *   existingNames: ['README.md', 'notes.txt']
 * })
 * if (fileName) console.log('Created:', fileName)
 * ```
 */
export function NewFileDialog({ config, zIndex, onSubmit, onCancel }: NewFileDialogProps) {
  const { id, title, parentPath, existingNames = [] } = config
  const placeholder = config.inputPlaceholder || 'notes.md'

  return (
    <FileSystemDialog
      id={id}
      title={title}
      icon={<File size={20} strokeWidth={2} />}
      itemType="file"
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
