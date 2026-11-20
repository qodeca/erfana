// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `reloadIfUnedited` – the comments sidebar wrote the file itself (a comment
 * save goes through main, not through this tab), so the tab looks at the disk
 * now (#478 plan S14: a `manual` check on the tracker). An unedited tab takes
 * the text; an edited one holds the conflict rather than losing either side.
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { PATH, openEditorTab } from './__test__/editorWatchHarness'

const SETTLED_MS = 3_000

const env = installFakeFreshness()

describe('useFileWatcher.reloadIfUnedited', () => {
  it('an unedited tab takes the text the comment save wrote', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    env.disk.write(PATH, '# v1\n<!-- comment -->\n', { silent: true })

    act(() => tab.current().reloadIfUnedited())
    await env.run(SETTLED_MS)

    expect(tab.buffer()).toBe('# v1\n<!-- comment -->\n')
  })

  it('an edited tab keeps its edits and holds the conflict', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)
    tab.type('# typing\n')
    env.disk.write(PATH, '# v1\n<!-- comment -->\n', { silent: true })

    act(() => tab.current().reloadIfUnedited())
    await env.run(SETTLED_MS)

    expect(tab.buffer()).toBe('# typing\n')
    expect(tab.current().externalChangeDetected).toBe(true)
  })

  it('does nothing when the disk did not change', async () => {
    env.disk.write(PATH, '# v1\n', { silent: true })
    const tab = await openEditorTab(env)

    act(() => tab.current().reloadIfUnedited())
    await env.run(SETTLED_MS)

    expect(tab.onContentUpdate).not.toHaveBeenCalled()
  })
})
