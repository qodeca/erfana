// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { getDirname, pathsEqual } from '../../utils/fileUtils'
import { isNodeRow, type TreeRow } from './visibleRows'

/**
 * Whether moving `sourcePath` into `targetParent` would leave it where it is.
 *
 * Hovering a sibling of the dragged item resolves to the item's own folder; a
 * drop there is a no-op, not an error and not a "moved" toast.
 *
 * @param sourcePath - The dragged item
 * @param targetParent - The folder the drop resolves to
 * @returns True when the folder is the item's current parent
 */
export function isSameFolderMove(sourcePath: string, targetParent: string): boolean {
  return pathsEqual(getDirname(sourcePath), targetParent)
}

/**
 * The folder an internal (tree) drag will land in, for drop feedback.
 *
 * Hovering a folder lands in it; hovering a file lands in the file's folder.
 * The nested tree got the second case for free, because a folder's element
 * contained its children's; a flat list has to say it. Nothing is highlighted
 * when the drop would be a no-op: over the dragged item itself, or in the
 * folder it already sits in.
 *
 * @param rows - The visible rows
 * @param indexByPath - Row index by path
 * @param activeId - Path of the dragged item, or null when nothing is dragged
 * @param overId - Path of the hovered row, or null
 * @returns The target folder's path, or null for no feedback
 */
export function resolveInternalDropFolder(
  rows: readonly TreeRow[],
  indexByPath: ReadonlyMap<string, number>,
  activeId: string | null,
  overId: string | null
): string | null {
  if (activeId === null || overId === null || overId === activeId) return null
  const index = indexByPath.get(overId)
  if (index === undefined) return null
  const row = rows[index]
  if (!isNodeRow(row)) return null
  const folder = row.node.type === 'directory' ? row.node.path : row.parentPath
  if (folder === null || isSameFolderMove(activeId, folder)) return null
  return folder
}
