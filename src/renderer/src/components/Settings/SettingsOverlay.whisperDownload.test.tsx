// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whisper model download in Settings, for keyboard and screen-reader users
 * (WCAG 4.1.3 Status Messages, 2.4.3 Focus Order):
 *
 * - the Download button stays focusable (aria-disabled, not disabled) while
 *   the download runs, and a Cancel button stops it;
 * - progress reaches an always-mounted status region at most every 10 % or 5 s;
 * - an error goes to an always-mounted alert region, a cancel to the status
 *   region (design/system/components/feedback), and focus is handed on when
 *   the control that held it goes away.
 *
 * Split from SettingsOverlay.test.tsx (its own mocks and a fake clock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { SettingsOverlay } from './SettingsOverlay'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))
vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

type DownloadResult = { success: boolean; path?: string; error?: string; cancelled?: boolean }
type Progress = { percent: number; downloadedBytes: number; totalBytes: number }

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let emitProgress: (progress: Progress) => void
let binary: ReturnType<typeof deferred<DownloadResult>>
let model: ReturnType<typeof deferred<DownloadResult>>
let api: {
  ensureBinary: ReturnType<typeof vi.fn>
  ensureModel: ReturnType<typeof vi.fn>
  cancelDownload: ReturnType<typeof vi.fn>
}

const downloadButton = (): HTMLElement => screen.getByTestId('settings-btn-whisper-model')
const cancelButton = (): HTMLElement | null => screen.queryByTestId('settings-btn-whisper-cancel')
const liveRegion = (): HTMLElement => screen.getByTestId('settings-whisper-download-live')
const alertRegion = (): HTMLElement => screen.getByTestId('settings-whisper-download-alert')

/** Let the awaited IPC promises and the React updates after them run. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderAndStart(): Promise<void> {
  render(<SettingsOverlay />)
  // The overlay focuses its close button once it opens; start after that
  await waitFor(() => expect(screen.getByRole('button', { name: /close settings/i })).toHaveFocus())
  await flush()
  act(() => downloadButton().focus())
  fireEvent.click(downloadButton())
  await flush()
}

describe('SettingsOverlay – whisper model download', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.setAttribute('id', 'portal-root')
    document.body.appendChild(portalRoot)

    binary = deferred<DownloadResult>()
    model = deferred<DownloadResult>()
    api = {
      ensureBinary: vi.fn(() => binary.promise),
      ensureModel: vi.fn(() => model.promise),
      cancelDownload: vi.fn().mockResolvedValue({ success: true })
    }
    ;(window as any).api = {
      transcription: {
        hasApiKey: vi.fn().mockResolvedValue(false),
        setApiKey: vi.fn().mockResolvedValue({ success: true }),
        clearApiKey: vi.fn().mockResolvedValue({ success: true })
      },
      whisper: {
        ...api,
        listModels: vi.fn().mockResolvedValue({ success: true, models: [{ name: 'base', size: 1, installed: false }] }),
        deleteModel: vi.fn().mockResolvedValue({ success: true }),
        onDownloadProgress: vi.fn((callback: (progress: Progress) => void) => {
          emitProgress = (progress) => act(() => callback(progress))
          return vi.fn()
        })
      },
      logging: {
        getLogsDir: vi.fn().mockResolvedValue('/logs'),
        openLogsFolder: vi.fn().mockResolvedValue('')
      },
      utils: {
        getPlatform: vi.fn().mockReturnValue('darwin'),
        getArch: vi.fn().mockReturnValue('arm64')
      }
    }

    useSettingsStore.setState({ isOpen: true })
    useGlobalSettingsStore.setState({
      settings: {
        logging: { level: 'info' },
        editor: { preserveLineBreaks: false },
        gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
        transcription: { backend: 'local' as const, openaiApiKeyStored: false, whisperModel: 'base' as const }
      },
      isLoading: false,
      error: null,
      isInitialized: true,
      updateWhisperModel: vi.fn()
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('keeps the Download button focusable while the download runs', async () => {
    await renderAndStart()

    expect(downloadButton()).toHaveAttribute('aria-disabled', 'true')
    expect(downloadButton()).not.toBeDisabled()
    expect(downloadButton()).toHaveFocus()
    expect(cancelButton()).not.toBeNull()

    // A second press while downloading starts nothing new
    fireEvent.click(downloadButton())
    await flush()
    expect(api.ensureBinary).toHaveBeenCalledTimes(1)
  })

  it('mounts the status and alert regions empty before any download starts', async () => {
    render(<SettingsOverlay />)
    await flush()
    expect(liveRegion()).toHaveAttribute('role', 'status')
    expect(liveRegion()).toBeEmptyDOMElement()
    expect(alertRegion()).toHaveAttribute('role', 'alert')
    expect(alertRegion()).toBeEmptyDOMElement()
  })

  it('announces progress at most every 10 % or every 5 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    await renderAndStart()
    expect(liveRegion()).toHaveTextContent('Download started')

    emitProgress({ percent: 3, downloadedBytes: 3, totalBytes: 100 })
    expect(liveRegion()).toHaveTextContent('Downloading, 3%')

    emitProgress({ percent: 7, downloadedBytes: 7, totalBytes: 100 })
    expect(liveRegion()).toHaveTextContent('Downloading, 3%')

    emitProgress({ percent: 11, downloadedBytes: 11, totalBytes: 100 })
    expect(liveRegion()).toHaveTextContent('Downloading, 11%')

    vi.setSystemTime(5000)
    emitProgress({ percent: 12, downloadedBytes: 12, totalBytes: 100 })
    expect(liveRegion()).toHaveTextContent('Downloading, 12%')

    // The visible status still shows every update
    emitProgress({ percent: 13, downloadedBytes: 13, totalBytes: 100 })
    expect(liveRegion()).toHaveTextContent('Downloading, 12%')
    expect(screen.getByTestId('settings-whisper-model-status')).toHaveTextContent('13%')

    // The model starts after the binary: progress falls back and counts again
    emitProgress({ percent: 1, downloadedBytes: 1, totalBytes: 100 })
    expect(liveRegion()).toHaveTextContent('Downloading, 1%')
  })

  it('cancels from the Cancel button, says so in the status, and returns focus to Download', async () => {
    await renderAndStart()
    binary.resolve({ success: true, path: '/bin/whisper' })
    await flush()

    act(() => cancelButton()!.focus())
    fireEvent.click(cancelButton()!)
    expect(api.cancelDownload).toHaveBeenCalledTimes(1)

    model.resolve({ success: false, cancelled: true, error: 'Download cancelled' })
    await flush()

    expect(liveRegion()).toHaveTextContent('Download cancelled')
    expect(screen.queryByTestId('settings-whisper-download-error')).toBeNull()
    expect(cancelButton()).toBeNull()
    expect(downloadButton()).toHaveTextContent('Download model')
    expect(downloadButton()).not.toHaveAttribute('aria-disabled')
    expect(downloadButton()).toHaveFocus()
  })

  it('does not start the model when Cancel came during the binary step', async () => {
    await renderAndStart()
    fireEvent.click(cancelButton()!)

    // The binary finished before the cancel reached it
    binary.resolve({ success: true, path: '/bin/whisper' })
    await flush()

    expect(api.ensureModel).not.toHaveBeenCalled()
    expect(liveRegion()).toHaveTextContent('Download cancelled')
  })

  it('announces a failed download through the alert region and shows it inline', async () => {
    await renderAndStart()
    binary.resolve({ success: true, path: '/bin/whisper' })
    await flush()
    model.resolve({ success: false, error: 'Hash mismatch' })
    await flush()

    expect(alertRegion()).toHaveTextContent('Hash mismatch')
    expect(screen.getByTestId('settings-whisper-download-error')).toHaveTextContent('Hash mismatch')
    expect(liveRegion()).toBeEmptyDOMElement()
    expect(downloadButton()).toHaveFocus()
  })

  it('moves focus to the model select once the model is ready and the buttons are gone', async () => {
    await renderAndStart()
    binary.resolve({ success: true, path: '/bin/whisper' })
    await flush()
    model.resolve({ success: true, path: '/models/base.bin' })
    await flush()

    expect(liveRegion()).toHaveTextContent('Model ready')
    expect(screen.queryByTestId('settings-btn-whisper-model')).toBeNull()
    expect(screen.getByTestId('settings-select-whisper-model')).toHaveFocus()
  })
})
