// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Restoring a deleted file from the editor (#450, #478 F7, F14): a save in the
 * deleted state never sends a stamp check (there is no file to compare), may
 * recreate the missing folder, and brings the tab back to following its file.
 * An autosave never runs in that state – `shouldAutosave` decides that in the
 * panel (see `autosaveGate.test.ts`).
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { PATH, openEditorTab, type EditorTab } from './__test__/editorWatchHarness'

const SETTLED_MS = 3_000

const env = installFakeFreshness()

async function deletedTab(): Promise<EditorTab> {
  env.disk.write(PATH, '# v1\n', { silent: true })
  const tab = await openEditorTab(env)
  env.disk.remove(PATH)
  await env.run(SETTLED_MS)
  expect(tab.current().isFileDeleted).toBe(true)
  return tab
}

describe('useFileWatcher – restore a deleted file', () => {
  it('Restore file writes the buffer back with no stamp check, and the tab follows again', async () => {
    const tab = await deletedTab()

    let status = ''
    await act(async () => {
      status = (await tab.current().save({ content: '# kept\n', trigger: 'restore' })).status
    })
    await env.run(SETTLED_MS)

    expect(status).toBe('written')
    expect(env.source.writeCalls.at(-1)?.expectedStamp).toBeUndefined()
    expect(env.disk.content(PATH)).toBe('# kept\n')
    expect(tab.current().isFileDeleted).toBe(false)

    // Following again: the next outside change reaches the (clean) tab
    tab.markSaved()
    env.disk.write(PATH, '# after restore\n')
    await env.run(SETTLED_MS)
    expect(tab.buffer()).toBe('# after restore\n')
  })

  it('passes the recreate-folder flag through to the write', async () => {
    const tab = await deletedTab()

    await act(async () => {
      await tab.current().save({ content: '# kept\n', trigger: 'restore', createParentDirs: true })
    })

    expect(env.source.writeCalls.at(-1)).toMatchObject({ filePath: PATH, createParentDirs: true })
  })

  it('a file put back from outside clears the deleted state by itself', async () => {
    const tab = await deletedTab()

    env.disk.write(PATH, '# checked out again\n', { silent: true })
    await env.run(SETTLED_MS * 4)

    expect(tab.current().isFileDeleted).toBe(false)
    expect(tab.buffer()).toBe('# checked out again\n')
  })
})
