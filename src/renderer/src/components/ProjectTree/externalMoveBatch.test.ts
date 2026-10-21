// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalFileMoveBatchResponse } from '../../../../shared/ipc/external-file-schema'

const { showGlobalToast, logger } = vi.hoisted(() => ({
  showGlobalToast: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../Toast/toastService', () => ({ showGlobalToast }))
vi.mock('../../utils/logger', () => ({ logger }))

import { moveExternalBatch, type PendingExternalMove } from './externalMoveBatch'

const moves = (...names: string[]): PendingExternalMove[] =>
  names.map((name) => ({ file: { path: `/in/${name}`, name } }))

const apiAnswering = (response: ExternalFileMoveBatchResponse | Error) => {
  const moveBatchFromExternal = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  return { moveBatchFromExternal }
}

describe('moveExternalBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends all the files in one request, each with its own conflict strategy', async () => {
    const api = apiAnswering({ results: [{ success: true }, { success: true }, { success: true }] })

    await moveExternalBatch(
      api,
      [
        { file: { path: '/in/a.md', name: 'a.md' }, conflictResolution: 'keepBoth' },
        { file: { path: '/in/b.md', name: 'b.md' }, conflictResolution: 'replace' },
        { file: { path: '/in/c.md', name: 'c.md' } }
      ],
      '/proj/docs'
    )

    expect(api.moveBatchFromExternal).toHaveBeenCalledTimes(1)
    expect(api.moveBatchFromExternal).toHaveBeenCalledWith({
      items: [
        { sourcePath: '/in/a.md', conflictResolution: 'keepBoth' },
        { sourcePath: '/in/b.md', conflictResolution: 'replace' },
        { sourcePath: '/in/c.md', conflictResolution: undefined }
      ],
      targetFolder: '/proj/docs'
    })
  })

  it('counts every moved file and shows no toast', async () => {
    const api = apiAnswering({ results: [{ success: true }, { success: true }] })

    const outcome = await moveExternalBatch(api, moves('a.md', 'b.md'), '/proj')

    expect(outcome).toEqual({ successCount: 2, failCount: 0 })
    expect(showGlobalToast).not.toHaveBeenCalled()
  })

  it('does not treat a Cancel answer as a failure', async () => {
    const cancelled = { success: false, errorCode: 'EXTERNAL_FILE_MOVE_CANCELLED', error: 'cancelled' }
    const api = apiAnswering({ results: [cancelled, cancelled] })

    const outcome = await moveExternalBatch(api, moves('a.md', 'b.md'), '/proj')

    expect(outcome).toEqual({ successCount: 0, failCount: 0 })
    expect(showGlobalToast).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(2)
  })

  it('reports each failed file on its own and keeps counting the others', async () => {
    const api = apiAnswering({
      results: [
        { success: true },
        { success: false, error: 'Source file was deleted', errorCode: 'EXTERNAL_FILE_SOURCE_DELETED' },
        { success: false, errorCode: 'EXTERNAL_FILE_MOVE_NOT_GRANTED' }
      ]
    })

    const outcome = await moveExternalBatch(api, moves('a.md', 'b.md', 'c.md'), '/proj')

    expect(outcome).toEqual({ successCount: 1, failCount: 2 })
    expect(showGlobalToast).toHaveBeenCalledTimes(2)
    expect(showGlobalToast).toHaveBeenNthCalledWith(1, {
      title: 'Move failed',
      message: 'Source file was deleted',
      type: 'error'
    })
    expect(showGlobalToast).toHaveBeenNthCalledWith(2, {
      title: 'Move failed',
      message: 'Failed to move "c.md"',
      type: 'error'
    })
  })

  it('warns once for a moved link', async () => {
    const api = apiAnswering({ results: [{ success: true, isSymlink: true }, { success: true }] })

    await moveExternalBatch(api, moves('link', 'b.md'), '/proj')

    expect(showGlobalToast).toHaveBeenCalledTimes(1)
    expect(showGlobalToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Symlink moved', type: 'warning' })
    )
  })

  it('fails every file with one toast when the whole request was refused', async () => {
    const api = apiAnswering({ results: [], error: 'No project is open', errorCode: 'NO_PROJECT' })

    const outcome = await moveExternalBatch(api, moves('a.md', 'b.md', 'c.md'), '/proj')

    expect(outcome).toEqual({ successCount: 0, failCount: 3 })
    expect(showGlobalToast).toHaveBeenCalledTimes(1)
    expect(showGlobalToast).toHaveBeenCalledWith({
      title: 'Move failed',
      message: 'No project is open',
      type: 'error'
    })
  })

  it('fails every file with one toast when the request itself rejects', async () => {
    const api = apiAnswering(new Error('IPC down'))

    const outcome = await moveExternalBatch(api, moves('a.md', 'b.md'), '/proj')

    expect(outcome).toEqual({ successCount: 0, failCount: 2 })
    expect(showGlobalToast).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalled()
  })
})
