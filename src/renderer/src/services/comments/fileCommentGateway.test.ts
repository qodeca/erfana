// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file-comment gateway never throws: a missing bridge, a throwing bridge
 * and a rejected invoke all answer "refused", so the comment window keeps the
 * reviewer's text (spec 024 architecture note 001 § 4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { FileCommentsBridge } from '../../../../shared/ipc/file-comment-schema'
import { fileCommentGateway } from './fileCommentGateway'

const REFUSED = { ok: false, code: ErrorCode.UNKNOWN_ERROR }
const LIST = { panelId: 'p', filePath: '/proj/a.md' }

function install(bridge: Partial<FileCommentsBridge> | undefined): void {
  ;(window as unknown as { api?: unknown }).api = bridge === undefined ? {} : { fileComments: bridge }
}

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('fileCommentGateway', () => {
  it('answers refused and subscribes to nothing without the bridge', async () => {
    install(undefined)
    expect(fileCommentGateway.available()).toBe(false)
    expect(await fileCommentGateway.list(LIST)).toEqual(REFUSED)
    expect(await fileCommentGateway.openDraft(LIST)).toEqual(REFUSED)
    expect(fileCommentGateway.onChanged(() => {})).toBeTypeOf('function')
  })

  it('folds a rejected invoke and a throwing bridge into refused', async () => {
    install({
      list: vi.fn(async () => {
        throw new Error('no handler')
      }),
      save: vi.fn(() => {
        throw new Error('sync throw')
      }),
      onChanged: vi.fn(() => {
        throw new Error('sync throw')
      })
    })
    expect(await fileCommentGateway.list(LIST)).toEqual(REFUSED)
    expect(await fileCommentGateway.save({ panelId: 'p', fileKey: 'f1', threadKey: 't1', rawHash: 'a'.repeat(64), op: 'deleteThread' })).toEqual(REFUSED)
    expect(fileCommentGateway.onChanged(() => {})).toBeTypeOf('function')
  })

  it('passes requests and answers through unchanged', async () => {
    const answer = { ok: true as const, draftToken: 'b'.repeat(32) }
    const off = vi.fn()
    const bridge = { openDraft: vi.fn(async () => answer), onChanged: vi.fn(() => off) }
    install(bridge)
    expect(fileCommentGateway.available()).toBe(true)
    expect(await fileCommentGateway.openDraft(LIST)).toBe(answer)
    expect(bridge.openDraft).toHaveBeenCalledWith(LIST)
    const callback = vi.fn()
    expect(fileCommentGateway.onChanged(callback)).toBe(off)
    expect(bridge.onChanged).toHaveBeenCalledWith(callback)
  })
})
