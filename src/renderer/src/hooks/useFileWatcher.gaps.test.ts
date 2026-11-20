// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Gap tests for #478 against the editor's watch hook (plan step S0, T1).
 *
 * Written at S0 against the hook of then, each stated the correct behaviour
 * inside an `expect(…).rejects` pinned to the symptom the gap showed. Plan
 * step S14 rebuilt the hook on the shared tracker; each test is now the plain
 * assertion of the correct behaviour – that conversion is the T1 proof:
 *
 * | Gap | Closed by |
 * |-----|-----------|
 * | G3 | the tracker starts from the initial read's stamp and catches up when the subscribe answers |
 * | L1 | a pause belongs to the save; the resume reports what it missed and the tracker checks |
 * | L2 | a failed read is retried on the profile's back-off, then reported |
 * | L3 | own-save identity is the written stamp (main), never the text |
 *
 * The disk and the watch layer are the core's fakes (`installFakeFreshness`).
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { PATH, openEditorTab } from './__test__/editorWatchHarness'

/** Past the throttle and the read retries (100 + 300 + 900 ms). */
const SETTLED_MS = 3_000

const env = installFakeFreshness()

describe('#478 gaps in useFileWatcher, closed', () => {
  it('control: an outside change reaches an unedited tab', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    env.disk.write(PATH, '# outside\n')
    await env.run(SETTLED_MS)
    expect(tab.buffer()).toBe('# outside\n')
  })

  it('G3: a write before the watch is active is shown', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    // The subscribe answers only after chokidar's ready
    env.source.scriptSubscribe({ kind: 'hold' })
    const tab = await openEditorTab(env)

    // The tab showed '# v1'; an agent writes before the watch listens, so no event
    env.source.muted = true
    env.disk.write(PATH, '# written before ready\n')
    env.source.muted = false
    act(() => env.source.releaseHeld())
    await env.run(SETTLED_MS)

    expect(tab.buffer()).toBe('# written before ready\n')
  })

  it('L1: a change that arrives during the tab’s own save is not lost', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# mine\n')
    env.source.holdNextWrite()

    let saving: Promise<{ status: string }> = Promise.resolve({ status: 'none' })
    act(() => {
      saving = tab.current().save({ content: '# mine\n', trigger: 'autosave' })
    })
    await env.flush()
    expect(env.source.writeHeld).toBe(true)
    // The save has paused this tab's watch; an outside write lands in that moment
    env.disk.write(PATH, '# outside during save\n')
    let status = ''
    await act(async () => {
      env.source.releaseWrite()
      status = (await saving).status
    })
    await env.run(SETTLED_MS)

    // Neither overwritten nor dropped: the save stood down and the tab holds the conflict
    expect(status).toBe('changed-on-disk')
    expect(env.disk.content(PATH)).toBe('# outside during save\n')
    expect(tab.current().externalChangeDetected).toBe(true)
  })

  it('L2: a read that fails after a change is retried', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    // The file is held (antivirus) for the change read and its first retries
    env.disk.failNextReads(PATH, 2)
    env.disk.write(PATH, '# after the lock\n')
    await env.run(SETTLED_MS)

    expect(tab.buffer()).toBe('# after the lock\n')
  })

  it('L2: a read that keeps failing is reported, not dropped', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    env.disk.failNextReads(PATH, 100)
    env.disk.write(PATH, '# locked\n')
    await env.run(SETTLED_MS)

    expect(tab.current().state.content).toEqual({ kind: 'unavailable', reason: 'unreadable' })
  })

  it('L3: an outside write that restores earlier saved text is shown', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    // Save A, then save B
    for (const content of ['# A\n', '# B\n']) {
      tab.type(content)
      await act(async () => {
        await tab.current().save({ content, trigger: 'autosave' })
      })
      tab.markSaved()
      await env.run(SETTLED_MS)
    }

    // A revert (git checkout) writes A back – while the tab is clean
    tab.onContentUpdate.mockClear()
    env.disk.write(PATH, '# A\n')
    await env.run(SETTLED_MS)

    expect(tab.onContentUpdate).toHaveBeenCalledWith('# A\n', 'lf')
  })
})
