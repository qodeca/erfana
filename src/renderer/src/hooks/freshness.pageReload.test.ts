// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A reloaded page follows every tab it shows (#478 G2, QG-8 H3).
 *
 * The G2 e2e tests reload the real window, but a reloaded page cannot get its
 * tabs back through the UI today, so they subscribe by hand through the
 * bridge. This is the renderer half that those calls stand in for: when a
 * page mounts its tabs, each tab's tracker – the editor adapter and the image
 * adapter, as the panels mount them – subscribes once, with a new id and its
 * own profile, and follows its file. Main ending the old page's subscriptions
 * is covered by the main-side count test in `e2e/file-freshness-gaps.e2e.ts`.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { openEditorTab } from './__test__/editorWatchHarness'
import { useFileChangeSubscription } from './useFileChangeSubscription'

const A = '/proj/a.md'
const B = '/proj/b.md'
const PIC = '/proj/pic.svg'
const RELOADS = 20

const env = installFakeFreshness()

/** One page: two editor tabs and an image tab, mounted as the panels mount them. */
async function mountPage() {
  const editors = [await openEditorTab(env, A), await openEditorTab(env, B)]
  const image = renderHook(() =>
    useFileChangeSubscription(PIC, {
      ready: true,
      baseline: env.disk.stamp(PIC),
      visible: true,
      currentVersion: undefined,
      onBytes: () => {}
    })
  )
  await env.flush()
  return {
    editors,
    unload: () => {
      for (const tab of editors) tab.hook.unmount()
      image.unmount()
    }
  }
}

describe('a fresh page subscribes for each open tab (G2, H3)', () => {
  it('each tab subscribes once, with a new id and its profile, and follows its file', async () => {
    for (const [path, text] of [[A, '# A\n'], [B, '# B\n'], [PIC, '<svg/>']] as const) {
      env.disk.write(path, text, { silent: true })
    }
    const first = await mountPage()
    const firstIds = env.source.subscribeCalls.map((call) => call.watchId)
    first.unload()
    const before = env.source.subscribeCalls.length

    const page = await mountPage()

    const calls = env.source.subscribeCalls.slice(before)
    expect(calls.map(({ filePath, profile }) => ({ filePath, profile }))).toEqual([
      { filePath: A, profile: 'editor' },
      { filePath: B, profile: 'editor' },
      { filePath: PIC, profile: 'image' }
    ])
    expect(calls.map((call) => call.watchId).filter((id) => firstIds.includes(id))).toEqual([])
    expect(env.source.subscriptions.size).toBe(3)

    env.disk.write(B, '# B\n\nafter the reload\n')
    await env.run(500)
    expect(page.editors[1].buffer()).toBe('# B\n\nafter the reload\n')
    page.unload()
  })

  it(`after ${RELOADS} reloads the page holds exactly one subscription per tab`, async () => {
    for (const [path, text] of [[A, '# A\n'], [B, '# B\n'], [PIC, '<svg/>']] as const) {
      env.disk.write(path, text, { silent: true })
    }
    let page = await mountPage()
    for (let i = 0; i < RELOADS; i++) {
      page.unload()
      page = await mountPage()
    }

    expect(env.source.subscriptions.size).toBe(3)
    expect(env.source.subscribeCalls).toHaveLength(3 * (RELOADS + 1))
    page.unload()
    expect(env.source.subscriptions.size).toBe(0)
  })
})
