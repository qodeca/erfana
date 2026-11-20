// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The shared freshness contract (#478 plan § 5.2, D2, F4) run against the
 * Markdown preview's image follow (`markdownImageFreshness.ts`, `dependent`
 * profile). What the preview "shows" is the bytes last handed to the store;
 * the fake read makes them the disk's text.
 */
import { describeFreshnessContract } from '../../../../shared/freshness/__test__/freshnessContract'
import { installImageFollowHarness } from './__test__/markdownImageFreshnessHarness'

const IMAGE = '/proj/docs/img/a.png'
const KEY = '/proj/docs/img/a.png'
const h = installImageFollowHarness()

/** No deleted-state probe: the `dependent` profile has none (plan § 3.4). */
const NO_PROBE =
  'the `dependent` profile has no deleted-state probe (plan § 3.4); a file that comes back is found by the next check – ' +
  'window focus, a power resume, the store\'s directory signal (markdownImageFreshness.test.ts)'

describeFreshnessContract('Markdown preview images (markdownImageFreshness)', {
  env: () => ({
    disk: h.disk,
    source: h.source,
    run: (ms = 0) => h.clock.run(ms),
    check: () => h.check(),
    act: (fn) => fn()
  }),
  filePath: IMAGE,
  profile: 'dependent',
  open: async () => {
    h.follow.sync([h.image(KEY, IMAGE)])
    await h.clock.run(0)
    const shownAtOpen = h.disk.content(IMAGE)
    return {
      shown: () => h.refreshed.get(KEY)?.at(-1)?.dataUrl ?? shownAtOpen,
      applyCount: () => h.refreshed.get(KEY)?.length ?? 0,
      state: () => h.follow.stateOf(KEY) ?? { watch: { kind: 'stopped', reason: 'restart-failed' }, content: { kind: 'fresh' } },
      reload: () => h.follow.reload(KEY),
      setVisible: async () => {
        await h.clock.run(0)
      }
    }
  },
  shows: (text) => text,
  adapterModule: 'src/renderer/src/components/Editor/markdownImageFreshness.ts',
  editable: false,
  skips: {
    '3-deleted-and-back': NO_PROBE,
    '3b-back-found-by-probe': NO_PROBE,
    '3c-back-refused': NO_PROBE,
    '10-hidden-deferred':
      'a hidden preview follows nothing (its slots are given back); on show the new subscription\'s catch-up reads the ' +
      'change (markdownImageFreshness.test.ts)'
  }
})
