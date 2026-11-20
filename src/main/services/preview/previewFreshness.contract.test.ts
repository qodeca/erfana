// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2, D2, F4) run against the
 * HTML preview's page watch: `freshness/mainTrackedWatch.ts` with the
 * `preview` profile, the adapter `buildPreviewGraph` hands `previewEntryWatch`.
 * Over the core's fakes; what the tab "shows" is the disk text at its last
 * reload. The page's sub-files are the pool's (`previewWatchPool.contract.test.ts`).
 */
import { vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { describeFreshnessContract } from '../../../shared/freshness/__test__/freshnessContract'
import { TRACKED_PATH, installTrackedWatchHarness } from '../freshness/__test__/trackedWatchHarness'

const h = installTrackedWatchHarness()

describeFreshnessContract('HTML preview page (mainTrackedWatch, preview profile)', {
  env: () => h.env(),
  filePath: TRACKED_PATH,
  profile: 'preview',
  open: async () => {
    const tab = await h.open('preview')
    return {
      shown: () => tab.shown(),
      applyCount: () => tab.changes,
      state: () => tab.handle.state(),
      reload: () => tab.handle.reload(),
      setVisible: async (visible) => {
        tab.handle.setVisible(visible)
        await h.clock.run(0)
      }
    }
  },
  shows: (text) => text,
  adapterModule: 'src/main/services/freshness/mainTrackedWatch.ts',
  editable: false,
  skips: {
    '9-content-refusal':
      'C1 is N/A for the preview (plan § 5.6): its version is the stamp, and the page renders whatever bytes it loads',
    '10-hidden-deferred':
      'the preview tracker reads at once; a hidden view defers its reload in the pipeline (isWanted), not in the tracker'
  }
})
