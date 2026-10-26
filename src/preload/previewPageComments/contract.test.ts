// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's inlined constants against their main-side sources
 * (docs/designs/html-preview-comments.md §8).
 *
 * A preload entry must stay self-contained (#73), so `constants.ts` repeats
 * the channel names, the token format and the limits main uses. Nothing else
 * pins the copies together, and a drift fails silently: a renamed channel
 * makes every pick vanish, a changed limit makes main drop picks the preload
 * thinks are fine. A value import is fine HERE: the build constraint applies
 * to the preload bundle, not to its test.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_COMMENTS_ARGUMENT } from '../../main/services/preview/previewSessionPolicy'
import { PREVIEW_LIMITS } from '../../shared/preview-limits'
import { PreviewCommentPageChannels } from '../../shared/ipc/preview-comment-channels'
import { CommentPickSchema } from '../../shared/ipc/preview-comment-schema'
import { TAG_MAX_CHARS as SHARED_TAG_MAX_CHARS } from '../../shared/htmlComments/format'
import {
  BLOCK_HEADER as SHARED_BLOCK_HEADER,
  ELEMENT_TOKEN_ATTRIBUTE,
  ELEMENT_TOKEN_PATTERN,
  QUOTE_CONTEXT_CHARS as SHARED_QUOTE_CONTEXT_CHARS
} from '../../shared/htmlComments'
import {
  BLOCK_HEADER,
  COMMENTS_ARGUMENT,
  COMMENT_ANCHORS_CHANNEL,
  COMMENT_HELLO_CHANNEL,
  COMMENT_PICK_CHANNEL,
  COMMENT_STATE_CHANNEL,
  MAX_TOKENS_PER_DOCUMENT,
  PICKS_PER_SECOND,
  PICK_BOX_MAX_PX,
  PICK_TAG_PATTERN,
  TAG_MAX_CHARS,
  QUOTE_CONTEXT_CHARS,
  QUOTE_MAX_CHARS,
  RUNTIME_PATH_MAX_CHARS,
  SNAPSHOT_MAX_BYTES,
  TOKEN_ATTRIBUTE,
  TOKEN_PATTERN,
  VIEW_HASH_MAX_CHARS
} from './constants'

describe('previewPageComments constants match main', () => {
  it('uses the channel names main listens and sends on', () => {
    expect({
      HELLO: COMMENT_HELLO_CHANNEL,
      PICK: COMMENT_PICK_CHANNEL,
      ANCHORS: COMMENT_ANCHORS_CHANNEL,
      STATE: COMMENT_STATE_CHANNEL
    }).toEqual(PreviewCommentPageChannels)
  })

  it('installs on the same renderer argument main passes with the flag on (the kill switch)', () => {
    expect(COMMENTS_ARGUMENT).toBe(PREVIEW_COMMENTS_ARGUMENT)
  })

  it('reads the token attribute and format instrument.ts writes', () => {
    expect(TOKEN_ATTRIBUTE).toBe(ELEMENT_TOKEN_ATTRIBUTE)
    expect(TOKEN_PATTERN.source).toBe(ELEMENT_TOKEN_PATTERN.source)
    expect(TOKEN_PATTERN.flags).toBe(ELEMENT_TOKEN_PATTERN.flags)
  })

  it('applies the limits main enforces', () => {
    expect({
      MAX_TOKENS_PER_DOCUMENT,
      PICKS_PER_SECOND,
      SNAPSHOT_MAX_BYTES,
      RUNTIME_PATH_MAX_CHARS,
      QUOTE_MAX_CHARS,
      VIEW_HASH_MAX_CHARS,
      QUOTE_CONTEXT_CHARS
    }).toEqual({
      MAX_TOKENS_PER_DOCUMENT: PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT,
      PICKS_PER_SECOND: PREVIEW_LIMITS.COMMENT_PICKS_PER_SECOND,
      SNAPSHOT_MAX_BYTES: PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES,
      RUNTIME_PATH_MAX_CHARS: PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS,
      QUOTE_MAX_CHARS: PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS,
      VIEW_HASH_MAX_CHARS: PREVIEW_LIMITS.COMMENT_VIEW_HASH_MAX_CHARS,
      QUOTE_CONTEXT_CHARS: SHARED_QUOTE_CONTEXT_CHARS
    })
  })

  it('describes a pick within what main’s pick schema accepts (R3-13 L5, R3-6)', () => {
    expect(TAG_MAX_CHARS).toBe(SHARED_TAG_MAX_CHARS)
    const pick = (extra: Record<string, unknown>): boolean =>
      CommentPickSchema.safeParse({ kind: 'menu', via: 'pointer', token: 'abcdefghijkl', view: { w: 1, h: 1, dpr: 1, x: 0, y: 0 }, ...extra }).success
    for (const tag of ['a', 'x-copy', 'foreignObject', 'svg:a', 'h1', 'x'.repeat(TAG_MAX_CHARS)]) {
      expect(PICK_TAG_PATTERN.test(tag), tag).toBe(true)
      expect(pick({ tag }), tag).toBe(true)
    }
    for (const tag of ['x-é', '1a', '-a', 'a b', '']) {
      expect(PICK_TAG_PATTERN.test(tag), tag).toBe(false)
      expect(pick({ tag }), tag).toBe(false)
    }
    expect(pick({ tag: 'x'.repeat(TAG_MAX_CHARS + 1) })).toBe(false)
    const edge = PICK_BOX_MAX_PX
    expect(pick({ box: { x: -edge, y: edge, w: edge, h: 0 } })).toBe(true)
    expect(pick({ box: { x: -edge - 1, y: 0, w: 0, h: 0 } })).toBe(false)
  })

  it('recognises an erfana block header exactly as the parser does', () => {
    const samples = [
      ' erfana:comment v1 id=c-1',
      'erfana:comment\tv12\n',
      '\n  erfana:comment v1',
      ' erfana:commentv1',
      ' erfana:comment v',
      ' erfana:comment v1x',
      'x erfana:comment v1',
      ' Erfana:comment v1'
    ]
    expect(samples.map(text => BLOCK_HEADER.test(text))).toEqual(samples.map(text => SHARED_BLOCK_HEADER.test(text)))
    expect(samples.filter(text => BLOCK_HEADER.test(text))).toHaveLength(3)
  })
})
