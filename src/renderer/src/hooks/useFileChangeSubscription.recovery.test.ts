// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image adapter across a delete and a return (#252, #450, #478 plan S15):
 * a confirmed delete is shown, a file put back clears it by itself with its
 * new bytes, and Reload reports whether the tab follows its file again.
 *
 * @module useFileChangeSubscription.recovery.test
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WATCHED_PATH, installImageWatchHarness, openImageTab, type ImageTab } from './__test__/fileWatchHarness'

const SETTLED_MS = 3_000

const h = installImageWatchHarness()

async function deletedTab(): Promise<ImageTab> {
  h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
  const tab = await openImageTab(h)
  h.disk.remove(WATCHED_PATH)
  await h.run(SETTLED_MS)
  expect(tab.hook.result.current.isFileDeleted).toBe(true)
  return tab
}

describe('useFileChangeSubscription – delete and recovery', () => {
  it('a file deleted and put back shows its new bytes and follows again', async () => {
    const tab = await deletedTab()

    h.disk.write(WATCHED_PATH, 'png-back', { silent: true })
    await h.run(SETTLED_MS * 4)

    expect(tab.hook.result.current.isFileDeleted).toBe(false)
    expect(tab.shown()).toBe(h.disk.stamp(WATCHED_PATH)?.hash)

    h.disk.write(WATCHED_PATH, 'png-after')
    await h.run(SETTLED_MS)
    expect(tab.shown()).toBe(h.disk.stamp(WATCHED_PATH)?.hash)
  })

  it('a delete that is an atomic save (the file is back at once) is never shown', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h)

    h.disk.remove(WATCHED_PATH)
    h.disk.write(WATCHED_PATH, 'png-2')
    await h.run(SETTLED_MS)

    expect(tab.hook.result.current.isFileDeleted).toBe(false)
    expect(tab.shown()).toBe(h.disk.stamp(WATCHED_PATH)?.hash)
  })

  it('Reload resolves false while the file is still gone, true once it is back', async () => {
    const tab = await deletedTab()

    let followed: boolean | undefined
    await act(async () => {
      const reloading = tab.hook.result.current.reload()
      await h.clock.run(SETTLED_MS)
      followed = await reloading
    })
    expect(followed).toBe(false)

    h.disk.write(WATCHED_PATH, 'png-back', { silent: true })
    await act(async () => {
      const reloading = tab.hook.result.current.reload()
      await h.clock.run(SETTLED_MS)
      followed = await reloading
    })
    expect(followed).toBe(true)
    expect(tab.hook.result.current.isFileDeleted).toBe(false)
  })
})
