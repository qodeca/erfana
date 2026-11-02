// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Element tokens for the served copy of a page
 * (docs/designs/comments/html-preview-comments.md §6, §19 R3-12, R3-13).
 *
 * The preview serves an instrumented COPY – the file on disk never changes –
 * in which every eligible start tag carries `data-erfana-el="<token>"` right
 * after its tag name. The preload reads and strips the attribute at document
 * start, so a pick names its element by an opaque token, and main maps the
 * token back to a start-tag offset in the bytes it served. Tokens are not
 * authoritative: main re-reads and re-validates the file at Save.
 *
 * - Eligible = the same rule as for a comment block (htmlIndex.ts): an own
 *   start tag, not `html`/`head`, not inside `head` or `<template>` content.
 *   Raw-text content (`script`, `style`, `textarea`, …) holds no start tags,
 *   and a `<` inside an attribute value is never a tag, because offsets come
 *   from the parser, not from a scan.
 * - All attributes go in through one splice list over the original text, so
 *   removing them gives the original back exactly (U-092).
 * - A source that already contains `data-erfana-el` (any case) is not
 *   instrumented: the page could otherwise plant tokens of its own (U-091).
 * - Over `COMMENT_MAX_TOKENS_PER_DOCUMENT` tokens the page is "too large": it is
 *   served raw and comments are unavailable for it (R3-13).
 *
 * The token table is returned as plain parallel arrays sorted by offset, so
 * it crosses a worker boundary cheaply (R3-12).
 */
import { PREVIEW_LIMITS } from '../preview-limits'
import { cryptoRandomBytes, randomBase32, type RandomBytes } from '../comments/format'
import { indexHtml, type HtmlIndex } from './htmlIndex'

/** The attribute carrying a token in the served copy. */
export const ELEMENT_TOKEN_ATTRIBUTE = 'data-erfana-el'
/** 12 lowercase base32 characters: 60 random bits. */
export const ELEMENT_TOKEN_PATTERN = /^[a-z2-7]{12}$/
const ELEMENT_TOKEN_LENGTH = 12
const ATTRIBUTE_PRESENT = /data-erfana-el/i

/** A fresh element token from a cryptographic source (U-093). */
export function mintElementToken(random: RandomBytes = cryptoRandomBytes): string {
  return randomBase32(ELEMENT_TOKEN_LENGTH, random)
}

/** The served copy and its token table. */
export interface InstrumentedHtml {
  readonly kind: 'ok'
  /** The text to serve, with one attribute added per eligible start tag. */
  readonly html: string
  /** `tokens[i]` marks the start tag at `offsets[i]` (in the ORIGINAL text) of tag `tags[i]`. */
  readonly tokens: readonly string[]
  readonly offsets: readonly number[]
  readonly tags: readonly string[]
}

/** Result of {@link instrumentHtml}; anything but `ok` means "serve the raw bytes". */
export type InstrumentResult =
  | InstrumentedHtml
  /** The source already contains `data-erfana-el`. */
  | { readonly kind: 'collision' }
  /** More eligible elements than the token cap. */
  | { readonly kind: 'too-large'; readonly count: number }

/** Options for {@link instrumentHtml}. */
export interface InstrumentOptions {
  /** The shared parse of `text`, when the caller already has it. */
  readonly index?: HtmlIndex
  /** Defaults to `COMMENT_MAX_TOKENS_PER_DOCUMENT`. */
  readonly maxTokens?: number
}

/**
 * Add `data-erfana-el="<token>"` after every eligible start tag's name.
 *
 * @param text - The decoded file (BOM included).
 * @param mintToken - Returns a new token per call; each must match {@link ELEMENT_TOKEN_PATTERN}.
 */
export function instrumentHtml(
  text: string,
  mintToken: () => string,
  options: InstrumentOptions = {}
): InstrumentResult {
  if (ATTRIBUTE_PRESENT.test(text)) return { kind: 'collision' }
  const index = options.index ?? indexHtml(text)
  const maxTokens = options.maxTokens ?? PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT
  if (index.elements.length > maxTokens) return { kind: 'too-large', count: index.elements.length }
  const elements = [...index.elements].sort((a, b) => a.start - b.start)
  const parts: string[] = []
  const tokens: string[] = []
  let pos = 0
  for (const el of elements) {
    const token = mintToken()
    if (!ELEMENT_TOKEN_PATTERN.test(token)) {
      throw new TypeError('instrumentHtml: mintToken returned a malformed token')
    }
    parts.push(text.slice(pos, el.nameEnd), ` ${ELEMENT_TOKEN_ATTRIBUTE}="${token}"`)
    tokens.push(token)
    pos = el.nameEnd
  }
  parts.push(text.slice(pos))
  return {
    kind: 'ok',
    html: parts.join(''),
    tokens,
    offsets: elements.map(el => el.start),
    tags: elements.map(el => el.tag)
  }
}
