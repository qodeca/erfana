// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Status-slot and degradation tests for {@link ImageViewerPanel} (AC3, UX-1).
 *
 * The slot is permanently mounted with `role="status"`: a live region that
 * enters the DOM at the same moment its text appears is never announced. These
 * tests pin that invariant plus the two "watch is dead" surfaces – a watcher
 * error and a refused watch start – including the banner that carries the cause
 * and the remedy in visible text (QG-11a H3), and the feedback a failed Reload
 * gets (H4).
 *
 * @module ImageViewerPanel.status.test
 * @see temp/design-70.md § 4.3
 */

import { describe, it, expect } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'

import { TEST_IDS } from '../../../constants/testids'
import { INDICATOR_DURATION_MS } from '../../../constants/fileWatch'
import { VIEWER_STATUS_COPY } from './imageViewerStatus.logic'
import { installImageViewerHarness } from './__test__/testUtils'
import {
  FRESHNESS_NOTICE_COPY,
  FRESHNESS_NOTICE_TEST_IDS
} from '../../FileConflictNotification/freshnessNoticeCopy'

/** The first subscribe and its one automatic restart, both refused (#478 G5). */
const REFUSED_TWICE = 2

const h = installImageViewerHarness()

describe('ImageViewerPanel – live refresh', () => {
  describe('Status slot (AC3, UX-1)', () => {
    it('is mounted, empty and role="status" while idle', async () => {
      await h.renderAndSettle('/proj/icon.png')

      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toBeInTheDocument()
      expect(slot).toHaveAttribute('role', 'status')
      expect(slot).toHaveAttribute('data-state', 'idle')
      expect(slot).toHaveTextContent('')
    })

    it('announces a refresh and clears itself after the indicator window', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute(
          'data-state',
          'reloading'
        )
      })
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveTextContent(
        VIEWER_STATUS_COPY.reloading
      )

      await waitFor(
        () => {
          expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute(
            'data-state',
            'idle'
          )
        },
        { timeout: INDICATOR_DURATION_MS + 1500 }
      )
    })

    it('reports a dead watch in the banner, with the cause in VISIBLE text', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.emitWatchError('/proj/icon.png', 'ENOSPC')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveAttribute('data-variant', 'unavailable')
      expect(banner).toHaveTextContent(FRESHNESS_NOTICE_COPY.stopped('icon.png'))
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeInTheDocument()

      // The toolbar slot does NOT repeat it: two regions announcing the same
      // sentence is one message too many (QG-11a; one notice per panel – F13).
      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toHaveAttribute('data-state', 'idle')
      expect(slot).toHaveTextContent('')

      // The viewer stays usable while degraded.
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN))
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('125%')
    })

    it('shows the watch-limit notice for a tab queued past the cap, without Reload (G9)', async () => {
      // A queued tab is never silent (owner decision): it says why it is not
      // live and when it will be. Reload cannot free a slot, so there is none.
      h.fileWatch.subscribe.mockResolvedValueOnce({ status: 'queued' })

      await h.renderAndSettle('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveAttribute('data-notice', 'queued')
      expect(banner).toHaveTextContent(FRESHNESS_NOTICE_COPY.queued)
      expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).not.toBeInTheDocument()
    })

    it('does not blame the cap for a watch that could not start', async () => {
      // Same degraded surface, different cause: the user has no tabs to close,
      // so the copy must not talk about too many files.
      for (let i = 0; i < REFUSED_TWICE; i++) {
        h.fileWatch.subscribe.mockResolvedValueOnce({ status: 'refused', code: 'WATCH_FAILED' })
      }

      await h.renderAndSettle('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveTextContent(FRESHNESS_NOTICE_COPY.stopped('icon.png'))
      expect(banner).not.toHaveTextContent('Too many files')
    })

    it('shows one notice per panel: a deletion outranks a dead watch (F13)', async () => {
      // The deleted state's own probe follows the file back, so the deletion is
      // the one fact the user needs; the slot does not add a second notice.
      await h.renderAndSettle('/proj/icon.png')

      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      await waitFor(() => expect(banner).toHaveAttribute('data-variant', 'deleted'))
      h.emitWatchError('/proj/icon.png', 'ENOSPC')

      expect(screen.getAllByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)).toHaveLength(1)
      expect(banner).toHaveAttribute('data-variant', 'deleted')
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute('data-state', 'idle')
    })

    it('keeps exactly one live region per subject while full screen is open (QG-6 M5)', async () => {
      // The toolbar renders twice - panel and portal. Two elements with
      // role="status" and the same text announce every refresh twice.
      await h.renderAndSettle('/proj/icon.png')

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)

      expect(screen.getAllByTestId(TEST_IDS.IMAGE_VIEWER_TOOLBAR)).toHaveLength(2)
      // No getAllByTestId(...)[0] papering over a duplicate: there is one of
      // each. Counted per SUBJECT rather than by role, because issue #73 added
      // a second, unrelated live region for export progress - the defect this
      // pins is two regions saying the SAME thing, not two subjects.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)).toBeInTheDocument()
      // The freshness notice's announcer (#478 F13) is the third subject, also once
      expect(screen.getByTestId(FRESHNESS_NOTICE_TEST_IDS.status)).toBeInTheDocument()
      expect(screen.getAllByRole('status')).toHaveLength(3)
    })

    it('still announces a refresh that lands while full screen is open', async () => {
      await h.renderAndSettle('/proj/icon.png')
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute(
          'data-state',
          'reloading'
        )
      })
    })
  })

  describe('Reload feedback (QG-11a H4)', () => {
    it('says the file is still missing when Reload finds nothing', async () => {
      await h.renderAndSettle('/proj/icon.png')
      // The watch died, and the file is gone by the time the user presses Reload
      h.emitWatchError('/proj/icon.png', 'ENOSPC')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.fileWatch.subscribe.mockResolvedValueOnce({ status: 'refused', code: 'NOT_FOUND' })

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD))

      // Without this the click changed nothing at all on screen.
      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      await waitFor(() =>
        expect(slot).toHaveAttribute('data-state', 'reload-failed-missing')
      )
      expect(slot).toHaveTextContent(VIEWER_STATUS_COPY.reloadFailedMissing)

      // Transient, like the success confirmation it mirrors.
      await waitFor(() => expect(slot).not.toHaveAttribute('data-state', 'reload-failed-missing'), {
        timeout: INDICATOR_DURATION_MS + 1500
      })
    })

    it('says the watch could not be restarted when the file is back but start fails', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.emitWatchError('/proj/icon.png', 'ENOSPC')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      // The file is readable - and the restart is what fails.
      h.fileWatch.subscribe.mockResolvedValue({ status: 'refused', code: 'WATCH_FAILED' })
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD))

      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      await waitFor(() => expect(slot).toHaveAttribute('data-state', 'reload-failed-watch'))
      expect(slot).toHaveTextContent(VIEWER_STATUS_COPY.reloadFailedWatch)
    })
  })

  describe('Degraded banner in full screen (QG-6 M5)', () => {
    it('shows the banner and its Reload button inside the overlay', async () => {
      await h.renderAndSettle('/proj/icon.png')
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
      const overlay = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)

      h.emitWatchError('/proj/icon.png', 'ENOSPC')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(overlay).toContainElement(banner)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeInTheDocument()
      // One banner, not two: the panel's copy is suppressed while the overlay owns the surface
      expect(screen.getAllByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)).toHaveLength(1)
    })

    it('moves the banner back into the panel when full screen closes', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)
      expect(screen.getAllByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)).toHaveLength(1)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_CLOSE))

      const banner = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_PANEL)).toContainElement(banner)
    })
  })
})
