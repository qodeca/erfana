// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The editor adapter on the shared freshness tracker (#478, plan S14): the
 * subscription's life, the editor's update rule (unedited → take the disk's
 * text; edited → hold the conflict; edited but equal → adopt), the conflict
 * choices, blocked content (F1) and the save add-on (own echo silent – N1;
 * a stale autosave → "Not saved" – F16).
 *
 * The disk and the watch layer are the core's fakes, installed as the
 * window's freshness environment; time is the fake clock.
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { PATH, openEditorTab } from './__test__/editorWatchHarness'

/** Past the tracker's throttle, delete confirmation and read retries. */
const SETTLED_MS = 3_000

const env = installFakeFreshness()

describe('useFileWatcher – subscription', () => {
  it('subscribes once when ready, and releases the watch on unmount', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    expect(env.source.subscribeCalls).toHaveLength(1)
    expect(env.source.subscribeCalls[0]).toMatchObject({ filePath: PATH, profile: 'editor' })
    expect(tab.current().state.watch).toEqual({ kind: 'active', live: 'full' })

    tab.hook.unmount()
    await env.flush()
    expect(env.source.unsubscribeCalls).toEqual([env.source.subscribeCalls[0].watchId])
  })

  it('does not subscribe before the initial read is in (ready=false) or with no file', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    await openEditorTab(env, PATH, { ready: false })
    await openEditorTab(env, PATH, { filePath: null })
    expect(env.source.subscribeCalls).toHaveLength(0)
  })
})

describe('useFileWatcher – the editor rule', () => {
  it('puts an outside change into an unedited tab and flashes the indicator', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    env.disk.write(PATH, '# v2\r\n')
    await env.run(SETTLED_MS)

    expect(tab.onContentUpdate).toHaveBeenCalledWith('# v2\r\n', 'crlf')
    expect(tab.buffer()).toBe('# v2\r\n')
    expect(tab.current().externalChangeDetected).toBe(false)
  })

  it('holds the conflict for an edited tab, and Keep my version clears it', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# mine\n')

    env.disk.write(PATH, '# theirs\n')
    await env.run(SETTLED_MS)

    expect(tab.onContentUpdate).not.toHaveBeenCalled()
    expect(tab.current().externalChangeDetected).toBe(true)

    act(() => tab.current().keepLocal())
    await env.run(SETTLED_MS)
    expect(tab.current().externalChangeDetected).toBe(false)
    expect(tab.buffer()).toBe('# mine\n')
  })

  it('Reload from disk discards the edits for the disk’s text', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# mine\n')
    env.disk.write(PATH, '# theirs\n')
    await env.run(SETTLED_MS)

    await act(async () => {
      const reloading = tab.current().reloadFromDisk()
      await env.clock.run(SETTLED_MS)
      await reloading
    })

    expect(tab.buffer()).toBe('# theirs\n')
    expect(tab.current().externalChangeDetected).toBe(false)
  })

  it('adopts silently when the edited buffer already equals the disk (line endings aside)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# same\n')

    env.disk.write(PATH, '# same\r\n')
    await env.run(SETTLED_MS)

    expect(tab.current().externalChangeDetected).toBe(false)
    expect(tab.onContentUpdate).not.toHaveBeenCalled()
  })

  it('shows a confirmed delete, and clears it when the file is back', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    env.disk.remove(PATH)
    await env.run(SETTLED_MS)
    expect(tab.current().isFileDeleted).toBe(true)

    env.disk.write(PATH, '# back\n', { silent: true })
    await env.run(SETTLED_MS * 4)
    expect(tab.current().isFileDeleted).toBe(false)
    expect(tab.buffer()).toBe('# back\n')
  })

  it('makes the tab read-only when the file grows past the limit (F1), with its size', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    env.disk.block(PATH, 'too-large')
    env.disk.write(PATH, '# huge\n')
    await env.run(SETTLED_MS)

    expect(tab.current().isReadOnlyBlocked).toBe(true)
    expect(tab.current().state.content).toEqual({ kind: 'unavailable', reason: 'too-large' })
  })
})

describe('useFileWatcher – save', () => {
  it('an autosave sends the stamp it read, and its own echo changes nothing (N1)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# typed\n')

    let reply: Awaited<ReturnType<ReturnType<typeof tab.current>['save']>> | undefined
    await act(async () => {
      reply = await tab.current().save({ content: '# typed\n', trigger: 'autosave' })
    })
    await env.run(SETTLED_MS)

    expect(reply?.status).toBe('written')
    expect(env.source.writeCalls[0].expectedStamp).toBeDefined()
    expect(env.source.pauseCalls).toHaveLength(1)
    expect(tab.onContentUpdate).not.toHaveBeenCalled()
    expect(tab.current().externalChangeDetected).toBe(false)
  })

  it('an autosave over an outside change writes nothing and holds the "Not saved" conflict (F16)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# typed\n')
    // An outside write the tab has not heard of yet
    env.source.muted = true
    env.disk.write(PATH, '# theirs\n')
    env.source.muted = false

    let status: string | undefined
    await act(async () => {
      status = (await tab.current().save({ content: '# typed\n', trigger: 'autosave' })).status
    })
    await env.run(SETTLED_MS)

    expect(status).toBe('changed-on-disk')
    expect(env.disk.content(PATH)).toBe('# theirs\n')
    expect(tab.current().state.content).toMatchObject({ kind: 'changed', mode: 'held', notSaved: true })
  })

  it('an explicit save writes without a stamp check', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    await act(async () => {
      await tab.current().save({ content: '# mine\n', trigger: 'explicit' })
    })

    expect(env.source.writeCalls[0].expectedStamp).toBeUndefined()
    expect(env.disk.content(PATH)).toBe('# mine\n')
  })

  it('writes plainly when the tab is not following yet', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env, PATH, { ready: false })

    await act(async () => {
      await tab.current().save({ content: '# early\n', trigger: 'autosave' })
    })

    expect(env.source.writeCalls).toEqual([{ filePath: PATH, content: '# early\n' }])
    expect(env.source.pauseCalls).toHaveLength(0)
  })
})

describe('useFileWatcher – catching up', () => {
  it('a power-resume check finds a change the watch never reported (G8)', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    env.disk.write(PATH, '# while asleep\n', { silent: true })

    act(() => env.check())
    await env.run(SETTLED_MS)

    expect(tab.buffer()).toBe('# while asleep\n')
  })

  it('a comment save elsewhere (reloadIfUnedited) brings the text in', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    env.disk.write(PATH, '# with comment\n', { silent: true })

    act(() => tab.current().reloadIfUnedited())
    await env.run(SETTLED_MS)

    expect(tab.buffer()).toBe('# with comment\n')
  })
})
