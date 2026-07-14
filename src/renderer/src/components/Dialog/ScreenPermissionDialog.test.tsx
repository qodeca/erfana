// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ScreenPermissionDialog — the macOS grant-and-relaunch flow shown
 * when a screenshot is denied. Verifies the settings deep-link and relaunch
 * bridge calls plus the close affordance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ScreenPermissionDialog } from './ScreenPermissionDialog'
import { TEST_IDS } from '../../constants/testids'

const openSettings = vi.fn(() => Promise.resolve())
const relaunchApp = vi.fn(() => Promise.resolve())

beforeEach(() => {
  vi.clearAllMocks()
  if (!document.getElementById('portal-root')) {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  }
  // Extend window.api (never vi.stubGlobal('window', ...) — it destroys React DOM internals).
  ;(window as unknown as { api: unknown }).api = {
    system: { openScreenRecordingSettings: openSettings, relaunchApp }
  }
})

describe('ScreenPermissionDialog', () => {
  it('renders nothing when closed', () => {
    render(<ScreenPermissionDialog isOpen={false} onClose={vi.fn()} status="denied" zIndex={10000} />)
    expect(screen.queryByTestId(TEST_IDS.SCREEN_PERMISSION_DIALOG)).not.toBeInTheDocument()
  })

  it('renders the dialog when open', () => {
    render(<ScreenPermissionDialog isOpen={true} onClose={vi.fn()} status="denied" zIndex={10000} />)
    expect(screen.getByTestId(TEST_IDS.SCREEN_PERMISSION_DIALOG)).toBeInTheDocument()
  })

  it('opens Screen Recording settings via the system bridge', () => {
    render(<ScreenPermissionDialog isOpen={true} onClose={vi.fn()} status="denied" zIndex={10000} />)
    fireEvent.click(screen.getByTestId(TEST_IDS.SCREEN_PERMISSION_BTN_OPEN_SETTINGS))
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it('relaunches the app via the system bridge', () => {
    render(<ScreenPermissionDialog isOpen={true} onClose={vi.fn()} status="denied" zIndex={10000} />)
    fireEvent.click(screen.getByTestId(TEST_IDS.SCREEN_PERMISSION_BTN_RELAUNCH))
    expect(relaunchApp).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<ScreenPermissionDialog isOpen={true} onClose={onClose} status="denied" zIndex={10000} />)
    fireEvent.click(screen.getByTestId(TEST_IDS.SCREEN_PERMISSION_BTN_CLOSE))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
