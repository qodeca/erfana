// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deleted-file surface tests for {@link ImageViewerPanel} (UX-5, H-4a, UX-11).
 *
 * A `deleted` event is existence-re-checked before the banner appears, so a
 * slow atomic replace recovers silently instead of accusing the user of
 * deleting the file. These tests pin that re-check, the banner copy and its
 * Reload recovery path, and the matching tab-title marker.
 *
 * @module ImageViewerPanel.deleted.test
 * @see temp/design-70.md § 4.4
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { IDockviewPanelHeaderProps } from 'dockview'

import { ImageViewerPanel } from './ImageViewerPanel'
import { ImageTab } from '../../Tabs/ImageTab'
import { TEST_IDS, getDynamicTestId } from '../../../constants/testids'
import { VIEWER_BANNER_COPY } from './imageViewerStatus.logic'
import { installImageViewerHarness } from './__test__/testUtils'

// The tab reads the open project to build its tooltip; nothing else about the
// project context matters here.
vi.mock('../../../context/ProjectManagementContext', () => ({
  useProjectManagementContext: () => ({ projectPath: '/proj' })
}))

// The tab's context menu needs the dialog provider, which this test has no
// business standing up: nothing here right-clicks a tab.
vi.mock('../../Tabs/useTabContextMenu', () => ({
  useTabContextMenu: () => []
}))

const h = installImageViewerHarness()

describe('ImageViewerPanel – live refresh', () => {
  describe('Deleted banner (UX-5, H-4a)', () => {
    it('shows the banner only after re-checking that the file is gone', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveAttribute('role', 'alert')
      expect(banner).toHaveAttribute('data-variant', 'deleted')
      expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.deleted)

      // The last loaded image is still on screen: the tab is not closed.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA'
      )
    })

    it('does not autofocus the Reload button', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      const reload = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)
      expect(reload).not.toHaveFocus()
      expect(reload).toHaveAccessibleName('Reload image from disk')
    })

    it('recovers instead of accusing when the file is back (slow atomic replace)', async () => {
      await h.renderAndSettle('/proj/icon.png')

      // getStats resolves: the rename landed outside the 100 ms detector window.
      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitDeleted('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      expect(
        screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      ).not.toBeInTheDocument()
    })

    it('clears the banner and restarts the watch when Reload succeeds', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      // The file is restored before the user presses Reload.
      h.getStats.mockResolvedValue({ size: 4096 })
      h.readBytes.mockResolvedValue('data:image/png;base64,CCCC')
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD))

      await waitFor(() => {
        expect(
          screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
        ).not.toBeInTheDocument()
      })
      expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,CCCC'
        )
      })
    })

    it('clears the banner on a following change event', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      h.getStats.mockResolvedValue({ size: 2048 })
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(
          screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('Tab title (UX-11, QG-11a H5)', () => {
    it('renders the deleted marker in the TAB, and reverts on recovery', async () => {
      // The panel and its tab share one panel api, exactly as dockview wires
      // them. Asserting `setTitle` was called proved nothing: the tab derived
      // its label from the file path and never read `api.title`, so the marker
      // rendered nowhere - and a deleted file in a BACKGROUND tab, whose banner
      // is inside the hidden panel body, had no indication anywhere at all.
      const props = h.makeProps('/proj/icon.png')
      const tabProps = {
        api: props.api,
        params: { filePath: '/proj/icon.png' }
      } as unknown as IDockviewPanelHeaderProps<{ filePath?: string }>

      render(
        <>
          <ImageViewerPanel {...props} />
          <ImageTab {...tabProps} />
        </>
      )
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)

      const tabLabel = screen.getByTestId(
        getDynamicTestId(TEST_IDS.IMAGE_TAB_LABEL, '/proj/icon.png')
      )
      expect(tabLabel).toHaveTextContent('icon.png')
      expect(tabLabel).not.toHaveTextContent('(deleted)')

      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      await waitFor(() => expect(tabLabel).toHaveTextContent('icon.png (deleted)'))

      h.getStats.mockResolvedValue({ size: 2048 })
      h.emitChanged('/proj/icon.png')

      await waitFor(() => expect(tabLabel).not.toHaveTextContent('(deleted)'))
      expect(tabLabel).toHaveTextContent('icon.png')
    })
  })
})
