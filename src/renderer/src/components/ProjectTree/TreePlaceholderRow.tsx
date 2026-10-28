// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { LazyFolderStatus } from '../../stores/useLazyFolderStore'
import { placeholderKey } from './visibleRows'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import './ProjectTree.css'

interface TreePlaceholderRowProps {
  /** The expanded lazy folder the line belongs to */
  folderPath: string
  /** The folder's children's level */
  level: number
  status: LazyFolderStatus
  /** Offset from the top of the list in px (virtualised placement) */
  top: number
}

/**
 * The line under an expanded lazy folder (finding 32, #320) while it is read,
 * or after its read failed – a `buildVisibleRows` placeholder row.
 *
 * Drawn as the folder's first child row (same height and indent, design
 * card `row`) but not one: it is `aria-disabled`, takes no focus and no drag,
 * and carries no `data-path`, so the keyboard, type-ahead and focus recovery
 * never see it. The folder row itself says `aria-busy` while it loads. A drop
 * on the line lands in the folder: its droppable id resolves to the folder
 * (`dropTargetPath`), and a drop from the OS reads `data-drop-folder`.
 */
function TreePlaceholderRowLine({ folderPath, level, status, top }: TreePlaceholderRowProps) {
  const { setNodeRef } = useDroppable({
    id: placeholderKey(folderPath),
    data: { type: 'directory', path: folderPath, accepts: ['file', 'directory'] }
  })
  return (
    <div className="project-tree-node" ref={setNodeRef} style={{ top }} data-drop-folder={folderPath}>
      <div
        className="project-tree-item project-tree-placeholder"
        style={{ '--tree-level': level } as React.CSSProperties}
        role="treeitem"
        aria-level={level + 1}
        aria-disabled="true"
        data-status={status}
        data-testid={getDynamicTestId(TEST_IDS.PROJECT_TREE_PLACEHOLDER, folderPath)}
      >
        {status === 'loading' ? 'Loading…' : 'Could not read this folder'}
      </div>
    </div>
  )
}

export const TreePlaceholderRow = memo(TreePlaceholderRowLine)
