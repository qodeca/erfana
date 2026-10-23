// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree's Markdown filter: Markdown files, and the folders that
 * lead to one.
 *
 * Lazy folders (finding 32, #320) are judged by what is known of them:
 *
 * - read on expand: like any folder – kept while what was read holds Markdown,
 *   or a still-unread `capped` sub-folder that may; one that loads with
 *   neither disappears (focus recovery moves a focus it held to its parent);
 * - its read failed: kept, whatever its kind, so its "Could not read this
 *   folder" line stays in view; it counts as unread;
 * - never read, `capped`: kept, because a walk bound – not its contents – left
 *   it empty, and it may well hold Markdown; so is one read against an older
 *   base tree (`isUnreadLazy` with `base`), since files may have been added
 *   to it since – an agent writing `notes.md` into it, say;
 * - never read, `ignored`: hidden, like the build and cache output it is;
 * - never read, `linked`: hidden – its files show under the folder the link
 *   leads to.
 */
import type { FileNode } from '../../../../shared/ipc/file-schema'
import type { LazyFolderStatus } from '../../stores/useLazyFolderStore'
import { isUnreadLazy } from '../../utils/lazyTree'

/** `.md` and `.markdown`, any case. */
export function isMarkdownFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * @param nodes - The merged tree
 * @param loaded - Lazy folders read so far, by path
 * @param status - Lazy folders being read or whose read failed, by path
 * @param base - The base tree now shown: a read against another one is stale
 * @returns The filtered tree
 */
export function filterMarkdownTree(
  nodes: FileNode[],
  loaded: ReadonlyMap<string, unknown>,
  status: ReadonlyMap<string, LazyFolderStatus> = new Map(),
  base?: FileNode[]
): FileNode[] {
  const kept: FileNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (isMarkdownFileName(node.name)) kept.push(node)
      continue
    }
    const children =
      node.children && node.children.length > 0 ? filterMarkdownTree(node.children, loaded, status, base) : []
    if (children.length > 0) {
      kept.push({ ...node, children })
    } else if (node.lazy !== undefined && status.get(node.path) === 'failed') {
      // Its line says it could not be read
      kept.push({ ...node, children: [] })
    } else if (node.lazy === 'capped' && isUnreadLazy(node.path, loaded, status, base)) {
      // Its contents are unknown until it is expanded
      kept.push({ ...node, children: [] })
    }
  }
  return kept
}
