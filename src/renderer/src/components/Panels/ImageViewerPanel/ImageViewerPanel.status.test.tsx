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
import { VIEWER_BANNER_COPY, VIEWER_STATUS_COPY } from './imageViewerStatus.logic'
import { alertsExcludingExportRegion, installImageViewerHarness } from './__test__/testUtils'

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
      expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.unavailableWatcherError)

      // The toolbar slot does NOT repeat it: role="alert" and role="status"
      // announcing the same sentence is one message too many (QG-11a).
      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toHaveAttribute('data-state', 'idle')
      expect(slot).toHaveTextContent('')

      // The viewer stays usable while degraded.
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN))
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('125%')
    })

    it('names the cap and the remedy when the cap refused the watch', async () => {
      // Verbatim message from `FileWatcherService.watchFile` - the only thing
      // that entitles the viewer to blame the cap.
      h.fileWatch.start.mockResolvedValue({
        success: false,
        error: 'Maximum watched files limit reached (100)'
      })

      await h.renderAndSettle('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.unavailableLimit)
      // The remedy has to be readable, not hidden in an accessible name: the
      // user's Reload cannot work until they close something.
      expect(banner).toHaveTextContent('Close some tabs')
    })

    it('does not blame the cap for a non-cap watch start failure', async () => {
      // `start` also fails when the atomic-save re-arm ends the watch while a
      // second consumer joins it. Same degraded surface, different cause: the
      // user has no tabs to close, so the copy must not tell them to.
      h.fileWatch.start.mockResolvedValue({
        success: false,
        error: 'File watch ended while joining: /proj/icon.png'
      })

      await h.renderAndSettle('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.unavailableWatcherError)
      expect(banner).not.toHaveTextContent('Close some tabs')
    })

    it('still reports a dead watch while the banner is reporting the deletion', async () => {
      // Two facts, two surfaces: the banner takes the more specific one and the
      // slot keeps the other, so neither disappears.
      await h.renderAndSettle('/proj/icon.png')

      h.emitWatchError('/proj/icon.png', 'ENOSPC')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      await waitFor(() => expect(banner).toHaveAttribute('data-variant', 'deleted'))
      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toHaveAttribute('data-state', 'unavailable')
      expect(slot).toHaveTextContent(VIEWER_STATUS_COPY.unavailable)
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
      expect(screen.getAllByRole('status')).toHaveLength(2)
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
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

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

      // The file is readable, so `recover` gets past the stat - and the restart
      // is what fails.
      h.fileWatch.start.mockResolvedValue({ success: false, error: 'ENOSPC' })
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

      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(overlay).toContainElement(banner)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeInTheDocument()
      // One alert region, not two: the panel's copy is suppressed while the
      // overlay owns the surface.
      expect(alertsExcludingExportRegion()).toHaveLength(1)
    })

    it('moves the banner back into the panel when full screen closes', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)
      expect(alertsExcludingExportRegion()).toHaveLength(1)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_CLOSE))

      const banner = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_PANEL)).toContainElement(banner)
    })
  })
})
