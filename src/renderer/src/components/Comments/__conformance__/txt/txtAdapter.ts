// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `.txt` conformance adapter: the renderer half of the test-only `.txt`
 * preview (spec 024 024-FR-002, 024-AC-002; architecture note 001 § 3
 * "`txtAdapter`: renders `<p data-line-start>`").
 *
 * The preview draws one `<p data-line-start>` per paragraph of the `.txt`
 * kind; this adapter answers the shared overlay host's questions about them.
 * Paragraphs never nest, so there is no parent or child, and every paragraph
 * can take a comment. The words are the Markdown Preview's (a paragraph is a
 * paragraph in both).
 *
 * TEST-ONLY. It is in no production adapter list.
 */
import type { PickedTargetRequest, ThreadPlacement } from '../../../../../../shared/ipc/file-comment-schema'
import { MARKDOWN_WORDS } from '../../commentCopyWords'
import type { PreviewCommentAdapter } from '../../overlay/previewAdapter'

const PARAGRAPH = 'p[data-line-start]'

/** The quote a pick carries: the paragraph's text, whitespace collapsed, NFC. */
const quoteOf = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC')

/**
 * The `.txt` preview's adapter.
 *
 * @param root - The rendered content element, or `null` while unmounted.
 * @returns The adapter the overlay host drives.
 */
export function createTxtAdapter(root: () => HTMLElement | null): PreviewCommentAdapter {
  const targetsInOrder = (): HTMLElement[] => [...(root()?.querySelectorAll<HTMLElement>(PARAGRAPH) ?? [])]
  const lineOf = (target: HTMLElement): number => Number.parseInt(target.dataset.lineStart ?? '', 10) || 1

  const targetAt = (node: Node | null): HTMLElement | null => {
    const content = root()
    if (content === null || node === null || !content.contains(node)) return null
    const el = node instanceof Element ? node : node.parentElement
    return el?.closest<HTMLElement>(PARAGRAPH) ?? null
  }

  const describe = (target: HTMLElement): PickedTargetRequest => {
    const line = lineOf(target)
    const exact = quoteOf(target)
    return { lineStart: line, lineEnd: line, tag: 'p', ordinal: 1, ...(exact === '' ? {} : { quote: { exact, prefix: '', suffix: '' } }) }
  }

  const attach = (placement: ThreadPlacement): HTMLElement | null =>
    placement.tag === 'p' ? (targetsInOrder().find(el => lineOf(el) === placement.line) ?? null) : null

  return {
    words: MARKDOWN_WORDS,
    targetAt,
    targetsInOrder,
    parentOf: () => null,
    childOf: () => null,
    tagOf: () => 'p',
    lineOf,
    canComment: () => ({ ok: true }),
    describe,
    attach,
    root
  }
}
