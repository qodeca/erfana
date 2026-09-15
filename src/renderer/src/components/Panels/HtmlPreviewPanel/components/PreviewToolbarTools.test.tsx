// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview toolbar's trailing tools, and the Open in default browser button
 * end to end through the panel (issue #124, part 4; UX spec §1.1 and §1.4).
 *
 * The panel-level cases matter as much as the unit ones: "the page the tab shows
 * now" is `params.filePath`, and only a render of the real panel proves the
 * button reads it rather than the page the tab was opened on.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreviewFindTool, PreviewToolbarTools } from './PreviewToolbarTools'
import { PreviewChromeBand } from './PreviewChromeBand'
import { HtmlPreviewPanel } from '../HtmlPreviewPanel'
import { usePreviewPanelActions } from '../hooks/usePreviewPanelActions'
import { installHtmlPreviewPanelHarness } from '../__test__/panelHarness'
import type { BrowserOpenFileResponse } from '../../../../../../shared/ipc/browser-schema'

// The panel's hooks log through the renderer logger, which has no bridge here.
const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}))
vi.mock('../../../../utils/logger', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: mockLogger
}))

const { makeProps } = installHtmlPreviewPanelHarness()

const OPEN = 'preview-band-open-in-browser'
const EXPORT = 'preview-band-export-pdf'

describe('PreviewToolbarTools', () => {
  it('renders nothing when neither action is wired', () => {
    const { container } = render(<PreviewToolbarTools />)
    expect(container).toBeEmptyDOMElement()
  })

  it('puts the rule, then Open in default browser, then Export to PDF last', () => {
    const { container } = render(
      <PreviewToolbarTools onOpenInBrowser={vi.fn()} onExportPdf={vi.fn()} />
    )

    const children = Array.from(container.children)
    expect(children).toHaveLength(3)
    expect(children[0]).toHaveClass('erf-band__separator')
    expect(children[1]).toBe(screen.getByTestId(OPEN))
    expect(children[2]).toBe(screen.getByTestId(EXPORT))
  })

  it('names and titles the button "Open in default browser"', () => {
    render(<PreviewToolbarTools onOpenInBrowser={vi.fn()} />)

    const button = screen.getByTestId(OPEN)
    expect(button).toHaveAccessibleName('Open in default browser')
    expect(button).toHaveAttribute('title', 'Open in default browser')
    expect(button).toHaveClass('erf-band__tool')
    expect(button).not.toHaveAttribute('aria-disabled')
  })

  it('keeps the rule when only the browser action is wired', () => {
    const { container } = render(<PreviewToolbarTools onOpenInBrowser={vi.fn()} />)

    expect(container.querySelector('.erf-band__separator')).not.toBeNull()
    expect(screen.queryByTestId(EXPORT)).toBeNull()
  })

  it('omits the button when only the export is wired', () => {
    render(<PreviewToolbarTools onExportPdf={vi.fn()} />)

    expect(screen.queryByTestId(OPEN)).toBeNull()
    expect(screen.getByTestId(EXPORT)).toBeInTheDocument()
  })

  it('calls the action on a press', async () => {
    const user = userEvent.setup()
    const onOpenInBrowser = vi.fn()
    render(<PreviewToolbarTools onOpenInBrowser={onOpenInBrowser} />)

    await user.click(screen.getByTestId(OPEN))

    expect(onOpenInBrowser).toHaveBeenCalledTimes(1)
  })

  it('shows busy with aria-disabled, never disabled, keeps focus and ignores presses', async () => {
    const user = userEvent.setup()
    const onOpenInBrowser = vi.fn()
    render(<PreviewToolbarTools onOpenInBrowser={onOpenInBrowser} openingInBrowser />)

    const button = screen.getByTestId(OPEN)
    button.focus()
    await user.click(button)
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
    expect(onOpenInBrowser).not.toHaveBeenCalled()
  })

  it('names Find and Export to PDF exactly as the minimal tier of PreviewNavControls.css matches them', () => {
    // That tier hides the two by `[aria-label='…']`, so rewording either button
    // would silently leave it on a row too narrow for it. Read the names off
    // the rendered buttons, not from a copy here, so the test follows the code.
    render(
      <>
        <PreviewFindTool onFind={vi.fn()} />
        <PreviewToolbarTools onExportPdf={vi.fn()} />
      </>
    )
    const names = [screen.getByTestId('preview-band-find'), screen.getByTestId(EXPORT)].map((b) =>
      b.getAttribute('aria-label')
    )

    const css = readFileSync(resolve(__dirname, 'PreviewNavControls.css'), 'utf8')
    const minimal = /@container \(width < 293px\) \{([\s\S]*?)\n\}/.exec(css)?.[1]
    expect(minimal, 'the width < 293px block is missing').toBeDefined()
    for (const name of names) {
      expect(name).toBeTruthy()
      expect(minimal).toContain(`.erf-band__tool[aria-label='${name}']`)
    }
  })
})

describe('PreviewChromeBand – default trailing tools', () => {
  it('passes the open-in-browser action and its busy flag to the trailing tools', async () => {
    const user = userEvent.setup()
    const onOpenInBrowser = vi.fn()
    const band = (busy: boolean): React.JSX.Element => (
      <PreviewChromeBand
        blockedHosts={[]}
        allowedHosts={[]}
        onApprove={vi.fn()}
        onOpenInBrowser={onOpenInBrowser}
        openingInBrowser={busy}
      />
    )
    const { rerender } = render(band(false))

    await user.click(screen.getByTestId(OPEN))
    expect(onOpenInBrowser).toHaveBeenCalledTimes(1)

    rerender(band(true))
    expect(screen.getByTestId(OPEN)).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('HtmlPreviewPanel – Open in default browser', () => {
  const openFile = vi.fn()

  beforeEach(() => {
    // After the harness's own beforeEach, which replaces `window.api`. The
    // platform bridge names the reveal command in the failure toast.
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.browser = { openFile }
    api.utils = { getPlatform: () => 'darwin' }
    openFile.mockReset()
  })

  it('opens the page the tab shows now, with its path unchanged', async () => {
    const user = userEvent.setup()
    openFile.mockResolvedValue({ success: true, usedFallback: false })
    const props = makeProps('C:\\proj\\site\\overview.html')
    const { rerender } = render(<HtmlPreviewPanel {...props} />)

    // A committed same-tab move rewrites `params.filePath` on the same panel.
    rerender(
      <HtmlPreviewPanel {...props} params={{ ...props.params, filePath: 'C:\\proj\\site\\pricing.html' }} />
    )
    await user.click(screen.getByTestId(OPEN))

    expect(openFile).toHaveBeenCalledTimes(1)
    expect(openFile).toHaveBeenCalledWith('C:\\proj\\site\\pricing.html')
  })

  it('is busy from the press until main answers, and ignores presses meanwhile', async () => {
    const user = userEvent.setup()
    let answer: (value: BrowserOpenFileResponse) => void = () => {}
    openFile.mockReturnValue(
      new Promise<BrowserOpenFileResponse>((resolve) => {
        answer = resolve
      })
    )
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    const button = screen.getByTestId(OPEN)

    await user.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()

    await user.click(button)
    await user.keyboard('{Enter}')
    expect(openFile).toHaveBeenCalledTimes(1)

    await act(async () => answer({ success: true, usedFallback: false }))
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))

    await user.click(button)
    expect(openFile).toHaveBeenCalledTimes(2)
  })

  it('clears the busy state when the request is refused', async () => {
    const user = userEvent.setup()
    openFile.mockRejectedValue(new Error('Refused untrusted sender'))
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    const button = screen.getByTestId(OPEN)

    await user.click(button)

    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
  })

  it('ignores a second call inside the same frame, before the busy state renders', async () => {
    // Two presses in one frame both see the old `openingInBrowser` prop, so the
    // button cannot stop the second one; the action's own guard has to.
    let answer: (value: BrowserOpenFileResponse) => void = () => {}
    openFile.mockReturnValue(
      new Promise<BrowserOpenFileResponse>((resolve) => {
        answer = resolve
      })
    )
    const { result } = renderHook(() =>
      usePreviewPanelActions({
        panelId: 'preview-1',
        filePath: '/proj/page.html',
        api: { close: vi.fn() },
        containerApi: {} as DockviewApi,
        searchProvider: { clearHighlights: vi.fn() },
        chipRef: { current: null }
      })
    )

    act(() => {
      result.current.openInBrowser()
      result.current.openInBrowser()
    })
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(result.current.openingInBrowser).toBe(true)

    await act(async () => answer({ success: true, usedFallback: false }))
    expect(result.current.openingInBrowser).toBe(false)
  })
})
