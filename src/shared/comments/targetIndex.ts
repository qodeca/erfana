// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the shared comment modules need of a parsed file, whatever its kind
 * (spec 024, architecture note 001 § 1 "Format core", § 3).
 *
 * Quote reads (`quoteText.ts`), the backup-tier tables (`anchorLookup.ts`),
 * the position evidence (`anchorEvidence.ts`), re-attachment (`reattach.ts`)
 * and the block classifier (`blocks.ts`) read a file through this interface
 * only, so they never depend on the HTML parse. `HtmlIndex`
 * (`htmlComments/htmlIndex.ts`) implements it for HTML.
 *
 * Types only: no code, no imports.
 */

/** One thing in a file a comment block can be about: an element, a Markdown block. */
export interface IndexedTarget {
  /** The tag a comment's anchor stores for it (`p`, `li`, `button`). */
  readonly tag: string
  /** Offset of the target's first character in {@link TargetIndex.text}. */
  readonly start: number
  /** The `id` the target carries, when it has one. */
  readonly id: string | undefined
  /** Start of the target's readable text in {@link TargetIndex.visibleText}. */
  readonly textStart: number
  /** End of the target's readable text in {@link TargetIndex.visibleText}. */
  readonly textEnd: number
}

/** One comment node of a file (`<!--` … `-->`), in source order. */
export interface IndexedCommentNode {
  /** Offset of `<!--`. */
  readonly start: number
  /** Offset just after the comment's close (the end of the file when unterminated). */
  readonly end: number
  /** The comment text between `<!--` and its close, as the kind's parser reports it. */
  readonly data: string
  /** Lies where a block is never read as live (HTML: `<template>` content); such a block is damaged. */
  readonly inTemplate: boolean
}

/**
 * One parsed file, as the shared comment modules read it. Offsets are UTF-16
 * offsets into {@link TargetIndex.text}, BOM included.
 *
 * @typeParam T - The kind's own target record; it carries at least {@link IndexedTarget}.
 */
export interface TargetIndex<T extends IndexedTarget = IndexedTarget> {
  /** The decoded file, BOM included when it has one. */
  readonly text: string
  /** 1 when {@link TargetIndex.text} starts with a BOM, else 0. Nothing is ever inserted before it. */
  readonly bomLength: number
  /** The file's readable text, which {@link IndexedTarget.textStart} and `textEnd` index into. */
  readonly visibleText: string
  /** Every target a block may be about, in source order. */
  readonly elements: readonly T[]
  /** Every comment node, blocks and other comments alike, in source order. */
  readonly comments: readonly IndexedCommentNode[]
  /** The target that starts at `offset`. */
  elementAt(offset: number): T | undefined
  /** The target at a path {@link TargetIndex.pathOfTarget} wrote. */
  elementAtPath(path: string): T | undefined
  /** The path an anchor stores for `target`. */
  pathOfTarget(target: T): string
}
