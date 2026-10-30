// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the page's keyboard picker moved, for the comment window's live
 * region (docs/designs/comments/html-preview-comments.md §10.2, §10.8, §10.10
 * "Announce"; test E-022; security review S-L-A; comments-v2 C-10).
 *
 * The page holds no screen-reader text: anything in the page DOM is counted
 * by Find in page. The preload sends a `step` pick – what the picker reached,
 * and for an element its token – and main passes it on in
 * `commentModeChanged` (reason `picker`); the renderer words the sentence.
 *
 * The kind and the line are main's own: the kind from the tag main parsed for
 * the token, through a fixed table, and the line of its start tag in the file
 * served – never the page's ids or classes, which would let a page put any
 * sentence it likes into the reader's screen reader, in Erfana's voice. C-10
 * adds the element's kind (a fixed table over the parsed tag) and its open
 * comments from main's own pins. Its first words are not sent: the page's
 * text would widen what the sealed preload sends (PIN-S-003).
 */
import type { CommentModeChanged, CommentPickerElement, CommentPickerRole } from '../../../../shared/ipc/preview-comment-schema'
import { CommentTagNameSchema } from '../../../../shared/ipc/preview-comment-page-schema'
import type { ElementTokenEntry } from './ElementTokenTable'

/** What a checked `step` pick reached: the top, a leaf, or an element of the frame's own load. */
export type PickerStepInput =
  | { readonly say: 'top' | 'no-child' }
  | {
      readonly say: 'showing'
      readonly entry: Pick<ElementTokenEntry, 'tagName' | 'line'>
      /** The element reached lies below the tokened one (a script built it). */
      readonly added?: true
      /** C-10: open comments on the element, from main's own pins. */
      readonly comments?: number
    }

/** A picker event's step: what it reached, and for an element main's facts about it. */
export type PickerStep = Required<Pick<CommentModeChanged, 'say'>> & Pick<CommentModeChanged, 'element'>

/** The kind a tag names, as spoken (comments-v2 C-10): a fixed table in main, never page text. */
const ROLES: Readonly<Record<string, CommentPickerRole>> = {
  p: 'paragraph',
  li: 'list item',
  ul: 'list',
  ol: 'list',
  table: 'table',
  tr: 'table row',
  td: 'table cell',
  th: 'table cell',
  img: 'image',
  button: 'button',
  a: 'link',
  section: 'section',
  article: 'article',
  nav: 'navigation',
  header: 'header',
  footer: 'footer',
  aside: 'aside',
  main: 'main',
  blockquote: 'block quote',
  pre: 'code block',
  figure: 'figure',
  form: 'form'
}

/** The spoken kind of `tagName`: a heading with its level, a table entry, else "element". */
export function roleOf(tagName: string): CommentPickerRole {
  const tag = tagName.toLowerCase()
  const heading = /^h([1-6])$/.exec(tag)
  if (heading !== null) return `heading level ${heading[1]}` as CommentPickerRole
  return Object.hasOwn(ROLES, tag) ? ROLES[tag] : 'element'
}

/**
 * The step to pass on. A tag that no tag name can spell (parse5 keeps
 * whatever a start tag says) is left out rather than passed on. The kind,
 * line and comment count are main's; a script-built element has no kind.
 *
 * @param step - The checked step.
 * @returns The `say` and `element` fields of the event.
 */
export function pickerStepOf(step: PickerStepInput): PickerStep {
  if (step.say !== 'showing') return { say: step.say }
  const { tagName, line } = step.entry
  const element: CommentPickerElement = {
    ...(CommentTagNameSchema.safeParse(tagName).success ? { tag: tagName } : {}),
    line: Math.max(1, line),
    ...(step.added ? { added: true as const } : { role: roleOf(tagName) }),
    ...(step.comments === undefined || step.comments === 0 ? {} : { comments: step.comments })
  }
  return { say: 'showing', element }
}
