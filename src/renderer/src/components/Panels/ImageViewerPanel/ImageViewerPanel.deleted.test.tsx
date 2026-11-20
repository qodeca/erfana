// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deleted-file surface tests for {@link ImageViewerPanel} (UX-5, H-4a, UX-11).
 *
 * A `deleted` event is existence-re-checked before the banner appears, so a
 * slow atomic replace recovers silently instead of accusing the user of
 * deleting the file. These tests pin that re-check, the banner (the shared
 * deleted notice, #478 § 3.6, with Close tab – F14), its recovery when the
 * file is back, and the matching tab-title marker.
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
import { installImageViewerHarness } from './__test__/testUtils'
import {
  FRESHNESS_NOTICE_COPY,
  FRESHNESS_NOTICE_TEST_IDS
} from '../../FileConflictNotification/freshnessNoticeCopy'

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

/** Past the deleted state's first probes (back-off), with headroom. */
const PROBE_MS = 4_000

describe('ImageViewerPanel – live refresh', () => {
  describe('Deleted banner (UX-5, H-4a)', () => {
    it('shows the banner only after re-checking that the file is gone', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      // No live-region role of its own: the panel's status region announces (F13)
      expect(banner).not.toHaveAttribute('role')
      expect(banner).toHaveAttribute('data-variant', 'deleted')
      expect(banner).toHaveTextContent(FRESHNESS_NOTICE_COPY.deleted('icon.png'))

      // The last loaded image is still on screen: the tab is not closed.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA'
      )
    })

    it('offers Close tab, not autofocused, and no Reload (F14)', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      const close = await screen.findByTestId(FRESHNESS_NOTICE_TEST_IDS.close)
      expect(close).not.toHaveFocus()
      expect(close).toHaveAccessibleName('Close tab')
      expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).not.toBeInTheDocument()
    })

    it('recovers instead of accusing when the file is back (slow atomic replace)', async () => {
      await h.renderAndSettle('/proj/icon.png')

      // getStats resolves: the rename landed outside the 100 ms detector window.
      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.replaceFile('/proj/icon.png')
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

    it('Close tab closes the panel', async () => {
      const props = h.makeProps('/proj/icon.png')
      render(<ImageViewerPanel {...props} />)
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')

      fireEvent.click(await screen.findByTestId(FRESHNESS_NOTICE_TEST_IDS.close))

      expect(props.api.close).toHaveBeenCalledTimes(1)
    })

    it('clears the banner and follows a new watch when the file is restored', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.getStats.mockRejectedValue(new Error('ENOENT'))
      h.emitDeleted('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      // The file is restored; the deleted state's probe finds it
      h.getStats.mockResolvedValue({ size: 4096 })
      h.readBytes.mockResolvedValue('data:image/png;base64,CCCC')
      h.replaceFile('/proj/icon.png')

      await waitFor(
        () => {
          expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)).not.toBeInTheDocument()
        },
        { timeout: PROBE_MS }
      )
      await waitFor(() => expect(h.fileWatch.subscribe).toHaveBeenCalledTimes(2))
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
