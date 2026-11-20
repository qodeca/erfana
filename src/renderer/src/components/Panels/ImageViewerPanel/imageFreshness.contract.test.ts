// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2) run against the image
 * viewer's adapter (`useFileChangeSubscription`) over the core's fakes. The
 * fake `file:readImage` labels each version with the fake disk's content hash,
 * so "what the tab shows" is that hash.
 */
import { act } from '@testing-library/react'

import { fakeHash } from '../../../../../shared/freshness/__test__/fakeDisk'
import { describeFreshnessContract } from '../../../../../shared/freshness/__test__/freshnessContract'
import { WATCHED_PATH, installImageWatchHarness, openImageTab } from '../../../hooks/__test__/fileWatchHarness'

const h = installImageWatchHarness()

describeFreshnessContract('image viewer (useFileChangeSubscription)', {
  env: () => ({
    disk: h.disk,
    source: h.source,
    run: (ms) => h.run(ms),
    check: () => h.check(),
    act: (fn) => act(fn)
  }),
  filePath: WATCHED_PATH,
  profile: 'image',
  open: async () => {
    const tab = await openImageTab(h)
    return {
      shown: () => tab.shown(),
      applyCount: () => tab.onBytes.mock.calls.length,
      state: () => tab.hook.result.current.state,
      reload: async () => {
        await act(async () => {
          const reloading = tab.hook.result.current.reload()
          await h.clock.run(1_000)
          await reloading
        })
      },
      setVisible: async (visible) => {
        tab.setVisible(visible)
        await h.flush()
      }
    }
  },
  shows: (text) => fakeHash(text),
  adapterModule: 'src/renderer/src/hooks/useFileChangeSubscription.ts',
  editable: false
})
