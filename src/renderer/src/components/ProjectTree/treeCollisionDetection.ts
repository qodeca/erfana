// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import {
  type CollisionDetection,
  type DroppableContainer,
  pointerWithin,
  rectIntersection
} from '@dnd-kit/core'

/**
 * Collision detection that prioritises folders over files.
 *
 * Pointer intersection first (immediate feedback while dragging), narrowed to
 * directory targets when there are any, with rectangle intersection as the
 * fallback for pointer-less collisions.
 *
 * Two properties matter for large trees:
 * - Each collision already carries the container it came from in
 *   `data.droppableContainer` (`pointerWithin` populates it), so the type is
 *   read off the entry instead of scanning `args.droppableContainers` once per
 *   collision — that scan was O(collisions x droppables) on every pointer move,
 *   with one droppable per rendered row.
 * - It lives at module scope, so its identity is stable across renders and
 *   `DndContext` is never handed a fresh `collisionDetection` prop.
 */
export const treeCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)

  if (pointerCollisions.length > 0) {
    const directoryCollisions = pointerCollisions.filter(collision => {
      const container = collision.data?.droppableContainer as DroppableContainer | undefined
      return container?.data.current?.type === 'directory'
    })

    if (directoryCollisions.length > 0) {
      return directoryCollisions
    }

    return pointerCollisions
  }

  // Fallback to rectangle intersection
  return rectIntersection(args)
}
