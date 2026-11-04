// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree follows the active tab (#453): when a file or preview tab
 * becomes active, the tree opens the folders down to its file, scrolls the row
 * into view when it is not, and marks it (`aria-current`, drawn as the lime
 * underline of the decided card
 * docs/design-system/system/components/tree-active-file/index.html).
 *
 * - Off when `projectTree.followActiveTab` is off: no folder opens, no row is
 *   marked.
 * - Never moves keyboard focus. It moves the tree's one Tab stop to the
 *   revealed row (roving tabindex), so Tab into the tree lands on the file –
 *   but only while focus is outside the tree.
 * - Runs on a tab switch only. A folder the person closes above the file is
 *   not reopened until the tab changes again, and a filter change is not a
 *   tab switch.
 * - The folders it opens and the ones the person takes over are tracked by
 *   the pure rules in `revealActiveFile.ts`; every expansion change that is
 *   not the reveal's own – a click, a key, a drag hover – counts as the
 *   person's.
 */
import { useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import type { FilterMode } from '../../types/filters'
import { isFollowActiveTabEnabled } from '../../../../shared/ipc/global-settings-schema'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { useActiveTabFilePath } from '../../hooks/useActiveTabFilePath'
import { useLatestRef } from '../../hooks/useLatestRef'
import { claimForUser, planReveal, resolveReveal, revealPathsEqual } from './revealActiveFile'

/** What {@link useRevealActiveFile} needs from the tree. */
export interface RevealActiveFileOptions {
  projectPath: string | null
  filterMode: FilterMode
  /** The tree's root row: paths are spelled the way its rows spell them */
  rootFolderNode: FileNode | null
  expandedFolders: Set<string>
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>
  /** Row index by path, of the rows the tree shows now */
  indexByPath: ReadonlyMap<string, number>
  virtualizer: Pick<Virtualizer<HTMLDivElement, Element>, 'measurementsCache' | 'scrollToIndex'>
  treeContainerRef: RefObject<HTMLDivElement | null>
  /** Moves the tree's Tab stop (roving tabindex) without focusing anything */
  setFocusedPath: (path: string) => void
}

/** The row showing `path` – its own path and index – compared by `revealPathsEqual` when the exact spelling is not a row. */
function findRow(indexByPath: ReadonlyMap<string, number>, path: string): [string, number] | undefined {
  const exact = indexByPath.get(path)
  if (exact !== undefined) return [path, exact]
  for (const entry of indexByPath) if (revealPathsEqual(entry[0], path)) return entry
  return undefined
}

/** Whether a row's box lies wholly inside the scroll container's viewport. */
function isRowFullyVisible(container: HTMLElement, start: number, end: number): boolean {
  return start >= container.scrollTop && end <= container.scrollTop + container.clientHeight
}

/**
 * Reveal the active tab's file in the project tree.
 *
 * @param options - The tree's state and the handles the reveal acts through
 * @returns The path of the row to mark, or `null` when no row is marked
 */
export function useRevealActiveFile(options: RevealActiveFileOptions): string | null {
  const { projectPath, filterMode, rootFolderNode, expandedFolders, setExpandedFolders, indexByPath } = options
  const enabled = useGlobalSettingsStore((state) => isFollowActiveTabEnabled(state.settings ?? {}))
  const activeFile = useActiveTabFilePath()
  // The mark is derived, never stored: the active file while it is revealable.
  // A marked file the tree stops showing (a folder closed above it) is simply
  // not drawn – no row carries the path until it is back.
  const revealedPath = useMemo(
    () => (enabled ? resolveReveal(projectPath, activeFile, filterMode, rootFolderNode)?.file ?? null : null),
    [enabled, projectPath, activeFile, filterMode, rootFolderNode]
  )

  const ownedRef = useRef<ReadonlySet<string>>(new Set())
  const revealedSetRef = useRef<ReadonlySet<string> | null>(null)
  const previousExpandedRef = useRef<ReadonlySet<string>>(expandedFolders)
  const pendingScrollRef = useRef<string | null>(null)
  const latest = useLatestRef({ ...options })

  // The person's changes first, so a reveal in the same commit plans with
  // what they have already taken over.
  useEffect(() => {
    const previous = previousExpandedRef.current
    previousExpandedRef.current = expandedFolders
    if (expandedFolders === revealedSetRef.current) return
    ownedRef.current = claimForUser(ownedRef.current, previous, expandedFolders)
  }, [expandedFolders])

  // A tab switch (or the setting turned on): close what the last reveal
  // opened, open what this file needs, mark it. The filter and the open
  // folders are read through `latest`, so neither change is a tab switch.
  useEffect(() => {
    if (!enabled) {
      ownedRef.current = new Set()
      pendingScrollRef.current = null
      return
    }
    const { filterMode: filter, rootFolderNode: root, expandedFolders: expanded } = latest.current
    const target = resolveReveal(projectPath, activeFile, filter, root)
    const plan = planReveal(expanded, ownedRef.current, target?.folders ?? null)
    ownedRef.current = plan.owned
    if (plan.expanded !== expanded) {
      const next = new Set(plan.expanded)
      revealedSetRef.current = next
      setExpandedFolders(next)
    }
    pendingScrollRef.current = target?.file ?? null
  }, [enabled, activeFile, projectPath, latest, setExpandedFolders])

  // Scroll and Tab stop, once the row exists: it may wait for a lazy folder's
  // read or for the tree refresh that adds a file just created.
  useEffect(() => {
    const target = pendingScrollRef.current
    const row = target === null ? undefined : findRow(indexByPath, target)
    if (row === undefined) return
    const [rowPath, index] = row
    pendingScrollRef.current = null
    const { virtualizer, treeContainerRef, setFocusedPath } = latest.current
    const container = treeContainerRef.current
    const item = virtualizer.measurementsCache[index]
    if (container && item && !isRowFullyVisible(container, item.start, item.end)) {
      virtualizer.scrollToIndex(index, { align: 'center' })
    }
    if (!container?.contains(document.activeElement)) setFocusedPath(rowPath)
  }, [activeFile, revealedPath, indexByPath, latest])

  return revealedPath
}
