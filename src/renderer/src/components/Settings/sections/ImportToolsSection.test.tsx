// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ImportToolsSection (#250): status for each tool combination, per-platform
 * install hint, "Check again", and the always-mounted live region.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportToolsSection } from './ImportToolsSection'
import { useDocumentImportStore } from '../../../stores/useDocumentImportStore'
import { TEST_IDS } from '../../../constants/testids'
import { DOCUMENT_IMPORT } from '../../../../../shared/constants'
import type { ImportToolStatusResponse } from '../../../../../shared/ipc/import-schema'

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../../utils/logger', () => ({ logger: mockLogger }))

const mockToolStatus = vi.fn<(request: { recheck: boolean }) => Promise<ImportToolStatusResponse>>()
const mockOpenExternal = vi.fn(async (_url: string) => undefined)
const mockGetPlatform = vi.fn(() => 'darwin')

function ok(libreOffice: boolean, imageMagick: boolean, throttled = false): ImportToolStatusResponse {
  return { success: true, libreOffice, imageMagick, extensions: ['pdf'], throttled }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPlatform.mockReturnValue('darwin')
  ;(window as unknown as { api: unknown }).api = {
    utils: { getPlatform: () => mockGetPlatform() },
    import: { toolStatus: (r: { recheck: boolean }) => mockToolStatus(r) }
  }
  Object.defineProperty(window, 'electron', {
    value: { shell: { openExternal: (url: string) => mockOpenExternal(url) } },
    writable: true,
    configurable: true
  })
  useDocumentImportStore.setState({
    hasLibreOffice: false,
    hasImageMagick: false,
    toolStatusKnown: false,
    isCheckingTools: false,
    toolCheckOutcome: 'idle',
    documentExtensions: []
  })
})

function row(format: string): HTMLElement {
  const rows = screen.getAllByTestId(TEST_IDS.SETTINGS_IMPORT_TOOL_STATUS)
  const found = rows.find((r) => r.dataset.format === format)
  if (!found) throw new Error(`no row for ${format}`)
  return found
}

async function renderWith(libreOffice: boolean, imageMagick: boolean): Promise<void> {
  mockToolStatus.mockResolvedValue(ok(libreOffice, imageMagick))
  render(<ImportToolsSection />)
  await waitFor(() => expect(row('office').dataset.state).not.toBe('checking'))
}

describe('ImportToolsSection', () => {
  it('reads the cached status on mount, without re-probing', async () => {
    await renderWith(true, true)

    expect(mockToolStatus).toHaveBeenCalledTimes(1)
    expect(mockToolStatus).toHaveBeenCalledWith({ recheck: false })
    // The silent read announces nothing.
    expect(screen.getByTestId(TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE)).toHaveTextContent('')
  })

  it('shows "Checking…" until the first result arrives', () => {
    mockToolStatus.mockReturnValue(new Promise(() => {}))
    render(<ImportToolsSection />)

    expect(row('office').dataset.state).toBe('checking')
    expect(within(row('office')).getByText('Checking…')).toBeInTheDocument()
    expect(within(row('pdf')).getByText('Ready – built in')).toBeInTheDocument()
  })

  it.each([
    [true, true, 'ready', 'ready'],
    [true, false, 'ready', 'missing'],
    [false, true, 'missing', 'ready'],
    [false, false, 'missing', 'missing']
  ])(
    'LibreOffice %s / ImageMagick %s → office %s, images %s – in words, not colour alone',
    async (lo, im, officeState, imagesState) => {
      await renderWith(lo, im)

      expect(row('pdf').dataset.state).toBe('ready')
      expect(row('office').dataset.state).toBe(officeState)
      expect(row('images').dataset.state).toBe(imagesState)

      expect(
        within(row('office')).getByText(lo ? 'Ready – LibreOffice found' : 'LibreOffice not found')
      ).toBeInTheDocument()
      expect(
        within(row('images')).getByText(im ? 'Ready – ImageMagick found' : 'ImageMagick not found')
      ).toBeInTheDocument()

      // A hint appears only under a missing tool.
      expect(within(row('office')).queryByText(/Homebrew/) !== null).toBe(!lo)
      expect(within(row('images')).queryByText(/Homebrew/) !== null).toBe(!im)
    }
  )

  it('lists every extension each tool unlocks', async () => {
    await renderWith(false, false)

    for (const ext of DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS) {
      expect(within(row('office')).getByText(new RegExp(`\\.${ext}\\b`))).toBeInTheDocument()
    }
    for (const ext of DOCUMENT_IMPORT.IMAGEMAGICK_EXTENSIONS) {
      expect(within(row('images')).getByText(new RegExp(`\\.${ext}\\b`))).toBeInTheDocument()
    }
  })

  it('macOS: shows the Homebrew command for each missing tool', async () => {
    await renderWith(false, false)

    expect(within(row('office')).getByText('brew install --cask libreoffice')).toBeInTheDocument()
    expect(within(row('images')).getByText('brew install imagemagick')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument()
  })

  it('Windows: offers a download button that goes through shell:openExternal', async () => {
    mockGetPlatform.mockReturnValue('win32')
    await renderWith(false, false)

    expect(screen.queryByText(/brew install/)).not.toBeInTheDocument()
    await userEvent.click(within(row('office')).getByRole('button', { name: 'Download LibreOffice' }))
    await userEvent.click(within(row('images')).getByRole('button', { name: 'Download ImageMagick' }))

    expect(mockOpenExternal).toHaveBeenCalledWith(DOCUMENT_IMPORT.LIBREOFFICE_DOWNLOAD_URL)
    expect(mockOpenExternal).toHaveBeenCalledWith(DOCUMENT_IMPORT.IMAGEMAGICK_DOWNLOAD_URL)
  })

  it('Windows: a refused URL is logged, not thrown', async () => {
    mockGetPlatform.mockReturnValue('win32')
    mockOpenExternal.mockRejectedValueOnce(new Error('refused'))
    await renderWith(false, true)

    await userEvent.click(screen.getByRole('button', { name: 'Download LibreOffice' }))

    await waitFor(() => expect(mockLogger.error).toHaveBeenCalled())
  })

  it('Linux: a generic package-manager hint, no command and no link', async () => {
    mockGetPlatform.mockReturnValue('linux')
    await renderWith(false, false)

    expect(within(row('office')).getByText(/package manager/)).toBeInTheDocument()
    expect(screen.queryByText(/brew install/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument()
  })

  it('Check again re-runs detection and updates the rows without a restart', async () => {
    await renderWith(false, false)
    mockToolStatus.mockResolvedValueOnce(ok(true, true))

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() => expect(row('office').dataset.state).toBe('ready'))
    expect(row('images').dataset.state).toBe('ready')
    expect(mockToolStatus).toHaveBeenLastCalledWith({ recheck: true })
    expect(screen.getByTestId(TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE)).toHaveTextContent('Check complete.')
  })

  it('Check again is disabled while a check runs, so a second click cannot start another', async () => {
    await renderWith(false, false)
    let release: (r: ImportToolStatusResponse) => void = () => {}
    mockToolStatus.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))

    const button = screen.getByTestId(TEST_IDS.SETTINGS_BTN_IMPORT_TOOLS_RECHECK)
    await userEvent.click(button)

    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Checking…')
    await userEvent.click(button)
    expect(mockToolStatus).toHaveBeenCalledTimes(2) // mount read + one recheck

    await act(async () => release(ok(false, false)))
    expect(button).toBeEnabled()
  })

  it('announces a throttled recheck in the live region', async () => {
    await renderWith(false, false)
    mockToolStatus.mockResolvedValueOnce(ok(false, false, true))

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() =>
      expect(screen.getByTestId(TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE)).toHaveTextContent(
        'Checked a moment ago – try again in a few seconds.'
      )
    )
  })

  it('announces a failed check', async () => {
    await renderWith(false, false)
    mockToolStatus.mockResolvedValueOnce({ success: false, error: 'Request refused' })

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))

    await waitFor(() =>
      expect(screen.getByTestId(TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE)).toHaveTextContent(
        'Could not check the tools. Try again.'
      )
    )
  })

  it('keeps the live region mounted and polite before anything happens', () => {
    mockToolStatus.mockReturnValue(new Promise(() => {}))
    render(<ImportToolsSection />)

    const live = screen.getByTestId(TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE)
    expect(live).toHaveAttribute('aria-live', 'polite')
  })

  it('Check again is a real, keyboard-reachable button', async () => {
    await renderWith(true, true)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Check again' })).toHaveFocus()
  })
})
