// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2) run against the editor
 * adapter (`useFileWatcher`) over the core's fakes. An unedited tab shows the
 * disk's text, so "what the tab shows" is the text itself.
 */
import { act } from '@testing-library/react'

import { describeFreshnessContract } from '../../../shared/freshness/__test__/freshnessContract'
import { installFakeFreshness } from '../services/freshness/__test__/fakeFreshnessEnvironment'
import { PATH, openEditorTab } from './__test__/editorWatchHarness'

const env = installFakeFreshness()

describeFreshnessContract('editor (useFileWatcher)', {
  env: () => ({
    disk: env.disk,
    source: env.source,
    run: (ms) => env.run(ms),
    check: () => env.check(),
    act: (fn) => act(fn)
  }),
  filePath: PATH,
  profile: 'editor',
  open: async () => {
    const tab = await openEditorTab(env)
    return {
      shown: () => tab.buffer(),
      applyCount: () => tab.onContentUpdate.mock.calls.length,
      state: () => tab.current().state,
      reload: async () => {
        await act(async () => {
          const reloading = tab.current().reloadFromDisk()
          await env.clock.run(1_000)
          await reloading
        })
      },
      setVisible: async (visible) => {
        tab.setVisible(visible)
        await env.flush()
      }
    }
  },
  shows: (text) => text,
  adapterModule: 'src/renderer/src/hooks/useFileWatcher.ts',
  editable: true,
  skips: {
    '10-hidden-deferred': 'the editor reads hidden tabs too (readNow is always true): an unedited background tab stays current'
  }
})
