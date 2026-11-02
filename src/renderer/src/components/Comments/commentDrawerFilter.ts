// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the drawer's current filter, readable outside the drawer
 * (comments-v2 C-13: the stepper steps "within the drawer's current filter
 * (default Open)").
 *
 * The drawer owns its filter; this keeps it under the drawer's `id` (one per
 * panel, `comment-drawer-…`) so the comment window – and the preview's step
 * keys – can read it. It lives as long as the drawer: once the drawer is shut,
 * its entry is gone and every reader gets the default, Open – the same filter
 * the drawer starts with when it opens again.
 *
 * @module components/Comments/commentDrawerFilter
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { DrawerFilter } from './commentRows'

/** The filter a shut or absent drawer stands for. */
export const DEFAULT_DRAWER_FILTER: DrawerFilter = 'open'

const filters = new Map<string, DrawerFilter>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The filter of the drawer with `drawerId`, or Open when it is shut.
 *
 * @param drawerId - The drawer's `id`; `undefined` reads the default.
 * @returns The filter.
 */
export function drawerFilterOf(drawerId: string | undefined): DrawerFilter {
  return (drawerId === undefined ? undefined : filters.get(drawerId)) ?? DEFAULT_DRAWER_FILTER
}

/**
 * Read a drawer's filter and re-render when it changes.
 *
 * @param drawerId - The drawer's `id`; `undefined` always reads Open.
 * @returns The filter.
 */
export function useDrawerFilter(drawerId: string | undefined): DrawerFilter {
  return useSyncExternalStore(subscribe, () => drawerFilterOf(drawerId))
}

/**
 * The drawer's own filter state, shared under its `id` – a drop-in for
 * `useState<DrawerFilter>('open')` in `CommentDrawer`.
 *
 * @param drawerId - The drawer's `id`.
 * @returns `[filter, setFilter]`.
 *
 * @example
 * ```tsx
 * const [filter, setFilter] = useDrawerFilterState(props.id)
 * ```
 */
export function useDrawerFilterState(drawerId: string): readonly [DrawerFilter, (next: DrawerFilter) => void] {
  const filter = useDrawerFilter(drawerId)
  const setFilter = useCallback(
    (next: DrawerFilter) => {
      if (filters.get(drawerId) === next) return
      filters.set(drawerId, next)
      emit()
    },
    [drawerId]
  )
  // Shut, the drawer stands for the default again.
  useEffect(
    () => () => {
      if (filters.delete(drawerId)) emit()
    },
    [drawerId]
  )
  return [filter, setFilter] as const
}

/** Test helper: forget every drawer's filter. */
export function resetDrawerFilters(): void {
  filters.clear()
  emit()
}
