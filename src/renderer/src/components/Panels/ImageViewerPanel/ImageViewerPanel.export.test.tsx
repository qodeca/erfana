// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Export-control tests for {@link ImageViewerPanel} (issue #73).
 *
 * The property both design documents call the key one for a toolbar that
 * renders twice: the panel's controls and the full-screen overlay's controls
 * are ONE export. Clicking the overlay's PNG button fires the same handler
 * once, and both instances then read busy - a hook per instance would let the
 * two disagree and let a second click reach the main-side lock.
 *
 * Also pinned here: the panel-owned export live region, and requirement 12 -
 * these actions have no keyboard shortcut, so no key press may start an export.
 *
 * @module ImageViewerPanel.export.test
 * @see temp/design-73.md § 7.6, § 7.8, § 12.2
 */

import { describe, it, expect, vi } from 'vitest'
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react'

import type { ImageExportResponse } from '../../../../../shared/ipc/image-export-schema'
import { TEST_IDS } from '../../../constants/testids'
import { IMAGE_EXPORT_COPY } from './imageViewerStatus.logic'
import { installImageViewerHarness } from './__test__/testUtils'

const h = installImageViewerHarness()

/** Puts the viewer into full screen and returns the overlay element. */
async function enterFullScreen(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
  return screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)
}

/** Holds an export open so the busy state can be inspected in both surfaces. */
function holdExportOpen(): { resolve: (value: ImageExportResponse) => void } {
  let resolve!: (value: ImageExportResponse) => void
  const promise = new Promise<ImageExportResponse>((r) => {
    resolve = r
  })
  h.imageExportRun.mockReturnValue(promise)
  return { resolve }
}

describe('ImageViewerPanel – export controls', () => {
  describe('Both toolbar instances', () => {
    it('renders exactly one of each control per surface', async () => {
      await h.renderAndSettle()
      const panel = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_PANEL)
      const overlay = await enterFullScreen()

      // The ids are duplicated ON PURPOSE and disambiguated by ancestor, the
      // same way the zoom and full-screen ids already are.
      for (const id of [
        TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG,
        TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF,
        TEST_IDS.IMAGE_VIEWER_BTN_COPY
      ]) {
        expect(within(panel).getAllByTestId(id)).toHaveLength(1)
        expect(within(overlay).getAllByTestId(id)).toHaveLength(1)
      }
    })

    it('fires ONE request when the overlay control is clicked', async () => {
      await h.renderAndSettle()
      const overlay = await enterFullScreen()

      fireEvent.click(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))

      await waitFor(() => expect(h.imageExportRun).toHaveBeenCalledTimes(1))
      expect(h.imageExportRun).toHaveBeenCalledWith({
        filePath: '/proj/icon.png',
        target: 'png'
      })
    })

    it('shows the busy state in BOTH surfaces from one click', async () => {
      await h.renderAndSettle()
      const panel = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_PANEL)
      const overlay = await enterFullScreen()
      const gate = holdExportOpen()

      fireEvent.click(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY))

      await waitFor(() =>
        expect(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toHaveAttribute(
          'aria-busy',
          'true'
        )
      )
      // One hook, one state: the panel's copy of the same button is busy too.
      expect(within(panel).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toHaveAttribute(
        'aria-busy',
        'true'
      )
      expect(within(panel).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toHaveAttribute(
        'aria-disabled',
        'true'
      )

      await act(async () => {
        gate.resolve({
          success: true,
          target: 'clipboard',
          output: { width: 800, height: 600 }
        } as ImageExportResponse)
      })
    })

    it('never uses the `disabled` attribute, so focus survives the save dialog', async () => {
      await h.renderAndSettle()
      const gate = holdExportOpen()
      const button = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)

      button.focus()
      fireEvent.click(button)

      await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
      expect(button).not.toBeDisabled()
      // A `disabled` control is blurred by the browser at once; this one still
      // has focus when the native dialog hands it back.
      expect(document.activeElement).toBe(button)

      await act(async () => {
        gate.resolve({
          success: true,
          target: 'png',
          filePath: '/out/icon.png',
          output: { width: 800, height: 600 }
        } as ImageExportResponse)
      })
    })
  })

  describe('Export live regions', () => {
    it('mounts BOTH regions, empty, while idle', async () => {
      await h.renderAndSettle()

      const polite = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)
      expect(polite).toHaveAttribute('role', 'status')
      expect(polite).toHaveAttribute('aria-live', 'polite')
      expect(polite).toHaveAttribute('aria-atomic', 'true')
      expect(polite).toHaveTextContent('')

      // The assertive half is mounted from the start too: a live region added
      // to the DOM together with its text is not announced.
      const alert = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_ALERT)
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveAttribute('aria-atomic', 'true')
      // `role="alert"` already implies assertive; pairing the two is redundant.
      expect(alert).not.toHaveAttribute('aria-live')
      // An author-supplied name on an atomic region can replace the text a
      // screen reader would otherwise speak (the constraint on the status slot).
      expect(alert).not.toHaveAttribute('aria-label')
      expect(polite).not.toHaveAttribute('aria-label')
      expect(alert).toHaveTextContent('')
    })

    it('announces the busy sentence while an export runs', async () => {
      await h.renderAndSettle()
      const gate = holdExportOpen()

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF))

      await waitFor(() =>
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)).toHaveTextContent(
          IMAGE_EXPORT_COPY.pdf.announceBusy
        )
      )

      await act(async () => {
        gate.resolve({
          success: true,
          target: 'pdf',
          filePath: '/out/icon.pdf',
          output: { width: 800, height: 600 }
        } as ImageExportResponse)
      })
    })

    it('moves into the overlay with the top surface, exactly once', async () => {
      await h.renderAndSettle()
      const overlay = await enterFullScreen()

      // One element per role, one announcement - the panel's copy would be a
      // second `role="status"` saying the same thing.
      for (const id of [
        TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS,
        TEST_IDS.IMAGE_VIEWER_EXPORT_ALERT
      ]) {
        expect(screen.getAllByTestId(id)).toHaveLength(1)
        expect(within(overlay).getByTestId(id)).toBeInTheDocument()
      }
    })

    it('announces a FAILED full-screen export assertively, not politely', async () => {
      h.imageExportRun.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_WRITE_FAILED',
        error: 'Could not write to that folder'
      } as unknown as ImageExportResponse)

      await h.renderAndSettle()
      const overlay = await enterFullScreen()

      fireEvent.click(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))

      // The overlay is `aria-modal="true"`, so the toast's own alert region is
      // outside the accessibility tree. A failure written into the polite
      // region can be queued or dropped, and the user is then left believing
      // the file was written.
      await waitFor(() =>
        expect(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_ALERT)).toHaveTextContent(
          'Export failed: Could not write to that folder'
        )
      )
      expect(
        within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS).textContent
      ).toBe('')
    })

    it('keeps the settled sentence while full screen, where the toast may not be heard', async () => {
      await h.renderAndSettle()
      const overlay = await enterFullScreen()

      fireEvent.click(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))

      await waitFor(() =>
        expect(within(overlay).getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)).toHaveTextContent(
          'PNG exported: Saved as icon.png'
        )
      )
    })

    it('clears on settle while the panel is the top surface', async () => {
      await h.renderAndSettle()

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))

      // The toast is reachable here, so the region does not repeat it.
      await waitFor(() => expect(h.imageExportRun).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)).toHaveTextContent('')
      )
    })
  })

  describe('No keyboard shortcuts (requirement 12)', () => {
    it('starts no export from any plausible key press', async () => {
      await h.renderAndSettle()
      const panel = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_PANEL)
      panel.focus()

      for (const key of ['e', 'E', 'c', 'C', 'p', 'P', 's', 'S']) {
        for (const modifiers of [
          {},
          { metaKey: true },
          { ctrlKey: true },
          { shiftKey: true },
          { metaKey: true, shiftKey: true }
        ]) {
          fireEvent.keyDown(document, { key, ...modifiers })
        }
      }

      // The actions are click-only by design: no shortcut is documented, so
      // none may exist to be discovered by accident.
      expect(h.imageExportRun).not.toHaveBeenCalled()
    })
  })

  describe('Cancellation', () => {
    it('shows no toast when the user dismisses the save dialog', async () => {
      const toasts = vi.fn()
      window.addEventListener('app:toast', toasts)
      h.imageExportRun.mockResolvedValue({
        success: false,
        errorCode: 'IMAGE_EXPORT_CANCELLED',
        error: 'Image export was cancelled'
      } as unknown as ImageExportResponse)

      await h.renderAndSettle()
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))
      await waitFor(() => expect(h.imageExportRun).toHaveBeenCalledTimes(1))

      expect(toasts).not.toHaveBeenCalled()
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_EXPORT_STATUS)).toHaveTextContent('')
      window.removeEventListener('app:toast', toasts)
    })
  })
})
