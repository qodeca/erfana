// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2, D2, F4) run against the
 * comment watch (C4): `freshness/mainTrackedWatch.ts` with the `comments`
 * profile, the adapter `fileCommentWatches.defaultFileCommentWatch` builds.
 * Over the core's fakes; what the drawer "shows" is the disk text when it last
 * listed the file.
 */
import { vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { describeFreshnessContract } from '../../../shared/freshness/__test__/freshnessContract'
import { installTrackedWatchHarness } from '../freshness/__test__/trackedWatchHarness'

const DOCUMENT = '/proj/notes.md'
const h = installTrackedWatchHarness()

describeFreshnessContract('comment watch (mainTrackedWatch, comments profile)', {
  env: () => h.env(),
  filePath: DOCUMENT,
  profile: 'comments',
  open: async () => {
    const drawer = await h.open('comments', DOCUMENT)
    return {
      shown: () => drawer.shown(),
      applyCount: () => drawer.changes,
      state: () => drawer.handle.state(),
      reload: () => drawer.handle.reload(),
      setVisible: async (visible) => {
        drawer.handle.setVisible(visible)
        await h.clock.run(0)
      }
    }
  },
  shows: (text) => text,
  adapterModule: 'src/main/services/freshness/mainTrackedWatch.ts',
  editable: false,
  skips: {
    '9-content-refusal':
      'C1 is the list\'s business (plan § 5.6: existing refusals, `refusedView`); the watch follows the stamp only',
    '10-hidden-deferred': 'a comment watch is never hidden: it lives in main and follows its document (plan § 5.2)'
  }
})
