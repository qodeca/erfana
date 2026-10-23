// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalSection: the terminal screen-reader mode override (lens review [23]).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalSection, screenReaderStatusText } from './TerminalSection'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { getDefaultGlobalSettings } from '../../../../../shared/ipc/global-settings-schema'
import { TEST_IDS } from '../../../constants/testids'

const platform = { mac: true, windows: false }
vi.mock('../../../utils/platform', () => ({
  isMacOS: () => platform.mac,
  isWindows: () => platform.windows
}))

let pushSupport: ((data: { enabled: boolean }) => void) | null = null

function installApi(osEnabled: boolean): void {
  ;(window as any).api = {
    ...(window as any).api,
    terminal: {
      getScreenReaderSupport: vi.fn().mockResolvedValue({ enabled: osEnabled }),
      onScreenReaderSupportChanged: vi.fn((cb: (data: { enabled: boolean }) => void) => {
        pushSupport = cb
        return vi.fn()
      })
    },
    globalSettings: { set: vi.fn().mockResolvedValue({ success: true }) }
  }
}

describe('TerminalSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    platform.mac = true
    platform.windows = false
    pushSupport = null
    installApi(false)
    useGlobalSettingsStore.setState({ settings: getDefaultGlobalSettings() })
  })

  it('names the select with its visible label and describes it', async () => {
    render(<TerminalSection />)
    const select = screen.getByRole('combobox', { name: 'Screen reader mode' })
    expect(select).toHaveValue('auto')
    expect(select).toHaveAttribute(
      'aria-describedby',
      'terminal-screen-reader-mode-description terminal-screen-reader-mode-status'
    )
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Auto', 'On', 'Off'])
    expect(await screen.findByText('No screen reader is running, so it is off.')).toBeInTheDocument()
  })

  it('saves the chosen mode to global settings', async () => {
    const user = userEvent.setup()
    render(<TerminalSection />)

    await user.selectOptions(screen.getByTestId(TEST_IDS.SETTINGS_SELECT_SCREEN_READER_MODE), 'on')

    expect(window.api.globalSettings.set).toHaveBeenCalledWith('terminal', { screenReaderMode: 'on' })
    expect(useGlobalSettingsStore.getState().settings?.terminal.screenReaderMode).toBe('on')
    expect(screen.getByTestId(TEST_IDS.SETTINGS_SCREEN_READER_STATUS)).toHaveTextContent('On for every terminal.')
  })

  it('shows a detected screen reader live in Auto', async () => {
    render(<TerminalSection />)
    await screen.findByText('No screen reader is running, so it is off.')
    act(() => pushSupport!({ enabled: true }))
    expect(screen.getByTestId(TEST_IDS.SETTINGS_SCREEN_READER_STATUS)).toHaveTextContent(
      'A screen reader is running, so it is on.'
    )
  })

  it('is disabled until settings load', () => {
    useGlobalSettingsStore.setState({ settings: null })
    render(<TerminalSection />)
    expect(screen.getByTestId(TEST_IDS.SETTINGS_SELECT_SCREEN_READER_MODE)).toBeDisabled()
  })

  it('says Auto cannot detect a screen reader where the platform does not report one', () => {
    platform.mac = false
    render(<TerminalSection />)
    expect(screen.getByTestId(TEST_IDS.SETTINGS_SCREEN_READER_STATUS)).toHaveTextContent(/Choose On to use one/)
  })
})

describe('screenReaderStatusText', () => {
  it.each([
    ['on', null, true, 'On for every terminal.'],
    ['off', true, true, 'Off for every terminal.'],
    ['auto', null, true, 'Checking for a screen reader…'],
    ['auto', true, true, 'A screen reader is running, so it is on.'],
    ['auto', false, true, 'No screen reader is running, so it is off.']
  ] as const)('%s / detected %s', (mode, detected, reports, text) => {
    expect(screenReaderStatusText(mode, detected, reports)).toBe(text)
  })
})
