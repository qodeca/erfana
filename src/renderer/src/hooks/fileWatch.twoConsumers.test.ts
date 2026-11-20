// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Two consumers of one file across a delete and a restore (#252, #478 S9).
 *
 * The legacy watch API counted `start`s per path, so one consumer's late
 * `stop` could take the count another had just rebuilt and leave that tab
 * deaf. Each tab now holds a subscription of its own (`watchId`), so neither
 * can release the other's. Here the editor (`useFileWatcher`) and the image
 * viewer's adapter (`useFileChangeSubscription`) follow the same file: both
 * must hear the file come back, and closing one must leave the other live.
 *
 * @module fileWatch.twoConsumers.test
 */
import { describe, expect, it } from 'vitest'

import { installImageWatchHarness, openImageTab } from './__test__/fileWatchHarness'
import { openEditorTab } from './__test__/editorWatchHarness'

const SHARED_PATH = '/proj/notes.md'
const SETTLED_MS = 3_000

const h = installImageWatchHarness()

describe('two consumers of one file', () => {
  it('both follow the file again after a delete and a restore', async () => {
    h.disk.write(SHARED_PATH, '# v1\n', { silent: true })
    const editor = await openEditorTab(h, SHARED_PATH)
    const viewer = await openImageTab(h, SHARED_PATH)

    h.disk.remove(SHARED_PATH)
    await h.run(SETTLED_MS)
    expect(editor.current().isFileDeleted).toBe(true)
    expect(viewer.hook.result.current.isFileDeleted).toBe(true)

    h.disk.write(SHARED_PATH, '# back\n', { silent: true })
    await h.run(SETTLED_MS * 4)
    expect(editor.current().isFileDeleted).toBe(false)
    expect(viewer.hook.result.current.isFileDeleted).toBe(false)

    h.disk.write(SHARED_PATH, '# after\n')
    await h.run(SETTLED_MS)
    expect(editor.buffer()).toBe('# after\n')
    expect(viewer.shown()).toBe(h.disk.stamp(SHARED_PATH)?.hash)
  })

  it('closing one leaves the other following, in either order', async () => {
    for (const closeFirst of ['editor', 'viewer'] as const) {
      h.disk.write(SHARED_PATH, '# v1\n', { silent: true })
      const editor = await openEditorTab(h, SHARED_PATH)
      const viewer = await openImageTab(h, SHARED_PATH)

      if (closeFirst === 'editor') editor.hook.unmount()
      else viewer.hook.unmount()
      await h.flush()

      h.disk.write(SHARED_PATH, `# after closing the ${closeFirst}\n`)
      await h.run(SETTLED_MS)
      if (closeFirst === 'editor') {
        expect(viewer.shown()).toBe(h.disk.stamp(SHARED_PATH)?.hash)
        viewer.hook.unmount()
      } else {
        expect(editor.buffer()).toBe(`# after closing the ${closeFirst}\n`)
        editor.hook.unmount()
      }
      await h.flush()
      expect(h.source.subscriptions.size).toBe(0)
    }
  })
})
