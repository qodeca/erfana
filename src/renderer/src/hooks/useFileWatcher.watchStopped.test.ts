// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The editor adapter's watch states (#478, plan S14; G5, G7, G9): a refused
 * subscribe stops following and says so, a queued tab waits for a slot and
 * follows from `started`, a limited watch is reported as such, and Reload
 * starts a new watch. The notice for each state is `selectNotice`'s job; this
 * suite pins only the state the adapter hands it.
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { PATH, openEditorTab } from './__test__/editorWatchHarness'

const SETTLED_MS = 3_000

const env = installFakeFreshness()

describe('useFileWatcher – watch states', () => {
  it('a refused subscribe stops following, never silently (G5)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    // The first subscribe and its one automatic restart are both refused
    env.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' }, { kind: 'refused', code: 'WATCH_FAILED' })
    const tab = await openEditorTab(env)
    await env.run(SETTLED_MS)

    expect(tab.current().state.watch).toEqual({ kind: 'stopped', reason: 'restart-failed' })
  })

  it('Reload after a refused subscribe follows the file again', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    // The first subscribe and its one automatic restart are both refused
    env.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' }, { kind: 'refused', code: 'WATCH_FAILED' })
    const tab = await openEditorTab(env)
    await env.run(SETTLED_MS)
    expect(tab.current().state.watch.kind).toBe('stopped')

    await act(async () => {
      const reloading = tab.current().reloadFromDisk()
      await env.clock.run(SETTLED_MS)
      await reloading
    })

    expect(tab.current().state.watch).toEqual({ kind: 'active', live: 'full' })
  })

  it('a tab past the watch cap is queued, then follows from `started` (G9)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    env.source.scriptSubscribe({ kind: 'queued' })
    const tab = await openEditorTab(env)
    expect(tab.current().state.watch).toEqual({ kind: 'queued' })

    // Written while it waited: the `started` stamp shows it changed
    env.disk.write(PATH, '# while queued\n', { silent: true })
    act(() => env.source.promote(env.source.subscribeCalls[0].watchId))
    await env.run(SETTLED_MS)

    expect(tab.current().state.watch).toEqual({ kind: 'active', live: 'full' })
    expect(tab.buffer()).toBe('# while queued\n')
  })

  it('a limited watch (network or WSL volume) is reported as limited (G7)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    env.source.scriptSubscribe({ kind: 'started', liveRefresh: 'limited' })
    const tab = await openEditorTab(env)

    expect(tab.current().state.watch).toEqual({ kind: 'active', live: 'limited' })
  })

  it('a watch main ends with the project stops quietly (project-closed)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    act(() =>
      env.source.emit({ watchId: env.source.subscribeCalls[0].watchId, kind: 'ended', reason: 'project-closed' })
    )
    await env.run(SETTLED_MS)

    expect(tab.current().state.watch).toEqual({ kind: 'stopped', reason: 'project-closed' })
  })
})
