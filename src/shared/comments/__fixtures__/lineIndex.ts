// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A minimal non-HTML {@link TargetIndex} for the kind-agnostic tests: comment
 * nodes found by a plain `<!--` … `-->` scan, no targets. It proves the shared
 * classifier and splice work without the HTML parse (spec 024 § 1, C2).
 */
import { classifyIndexedBlocks } from '../blocks'
import { BOM_CHAR } from '../encoding'
import type { KindDocument } from '../fileKind'
import type { IndexedCommentNode, TargetIndex } from '../targetIndex'

/** Every `<!--` … `-->` of `text`, in order; an unclosed one runs to the end. */
function commentNodes(text: string): IndexedCommentNode[] {
  const nodes: IndexedCommentNode[] = []
  for (let at = text.indexOf('<!--'); at >= 0; ) {
    const close = text.indexOf('-->', at + 4)
    const end = close < 0 ? text.length : close + 3
    nodes.push({ start: at, end, data: text.slice(at + 4, close < 0 ? text.length : close), inTemplate: false })
    at = text.indexOf('<!--', end)
  }
  return nodes
}

/** The index of `text`: its comment nodes, no targets. */
export function lineIndex(text: string): TargetIndex {
  return {
    text,
    bomLength: text.startsWith(BOM_CHAR) ? 1 : 0,
    visibleText: '',
    elements: [],
    comments: commentNodes(text),
    elementAt: () => undefined,
    elementAtPath: () => undefined,
    pathOfTarget: () => ''
  }
}

/** `text` parsed as a `line-start` kind with no targets: every `ok` block is orphaned. */
export function lineDocument(text: string): KindDocument {
  const index = lineIndex(text)
  return { text, index, state: classifyIndexedBlocks(index, 'line-start', () => ({ state: 'orphaned' })) }
}
