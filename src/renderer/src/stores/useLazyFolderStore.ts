// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Children of lazy folders, read on expand (review finding [32]).
 *
 * The tree walk leaves ignored folders and folders past its entry cap unread
 * (`FileNode.lazy`). The project tree reads such a folder when it is expanded
 * (`useLazyFolderChildren`) and keeps the result here, so every consumer of
 * the project's files – the tree, and the terminal's file links – sees the
 * same merged tree (`useMergedProjectFiles`). One window shows one project, so
 * one store is enough; entries for paths no longer in the tree are pruned.
 */
import { create } from 'zustand'
import type { FileNode } from '../../../shared/ipc/file-schema'

export interface LoadedChildren {
  readonly children: FileNode[]
  /**
   * The base tree the read was made against: another one means stale (read
   * again on the next expand). `null` for children carried over from an
   * earlier tree when a read folder turned lazy – shown, and always stale.
   */
  readonly baseTree: FileNode[] | null
}

/** A row's read state, for its marker; absent when idle. */
export type LazyFolderStatus = 'loading' | 'failed'

interface LazyFolderState {
  readonly loaded: ReadonlyMap<string, LoadedChildren>
  readonly status: ReadonlyMap<string, LazyFolderStatus>
  /** Replace the whole map (a reconcile after a new base tree) */
  replaceLoaded: (loaded: ReadonlyMap<string, LoadedChildren>) => void
  setLoaded: (path: string, entry: LoadedChildren) => void
  /** Set or (with null) clear one row's marker */
  setStatus: (path: string, status: LazyFolderStatus | null) => void
  /** Keep the markers of these paths only */
  pruneStatus: (keep: ReadonlySet<string>) => void
  reset: () => void
}

export const useLazyFolderStore = create<LazyFolderState>((set) => ({
  loaded: new Map(),
  status: new Map(),
  replaceLoaded: (loaded) => set({ loaded }),
  setLoaded: (path, entry) => set((state) => ({ loaded: new Map(state.loaded).set(path, entry) })),
  setStatus: (path, status) =>
    set((state) => {
      if ((state.status.get(path) ?? null) === status) return state
      const next = new Map(state.status)
      if (status === null) next.delete(path)
      else next.set(path, status)
      return { status: next }
    }),
  pruneStatus: (keep) =>
    set((state) => {
      if ([...state.status.keys()].every((path) => keep.has(path))) return state
      return { status: new Map([...state.status].filter(([path]) => keep.has(path))) }
    }),
  reset: () => set({ loaded: new Map(), status: new Map() })
}))
