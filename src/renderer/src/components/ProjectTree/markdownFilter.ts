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
 * - never read, `capped`: kept, because a walk bound – not its contents – left
 *   it empty, and it may well hold Markdown;
 * - never read, `ignored`: hidden, like the build and cache output it is.
 */
import type { FileNode } from '../../../../shared/ipc/file-schema'

/** `.md` and `.markdown`, any case. */
export function isMarkdownFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * @param nodes - The merged tree
 * @param loaded - Lazy folders read so far, by path
 * @returns The filtered tree
 */
export function filterMarkdownTree(nodes: FileNode[], loaded: ReadonlyMap<string, unknown>): FileNode[] {
  const kept: FileNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (isMarkdownFileName(node.name)) kept.push(node)
      continue
    }
    const children = node.children && node.children.length > 0 ? filterMarkdownTree(node.children, loaded) : []
    if (children.length > 0) {
      kept.push({ ...node, children })
    } else if (node.lazy === 'capped' && !loaded.has(node.path)) {
      // Its contents are unknown until it is expanded
      kept.push({ ...node, children: [] })
    }
  }
  return kept
}
