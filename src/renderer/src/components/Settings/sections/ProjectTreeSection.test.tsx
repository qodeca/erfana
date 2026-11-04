// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings > Project tree > Follow the active tab (#453): default on, bound
 * to `projectTree.followActiveTab`. Its place after Editor is held by
 * `SettingsOverlay.test.tsx`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ProjectTreeSection } from './ProjectTreeSection'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { globalSettings } from '../../../test-utils/globalSettings'

const LABEL = 'Follow the active tab'

afterEach(() => {
  vi.restoreAllMocks()
  useGlobalSettingsStore.setState({ settings: null })
})

describe('ProjectTreeSection', () => {
  it('is on by default, with its description', () => {
    useGlobalSettingsStore.setState({ settings: globalSettings() })
    render(<ProjectTreeSection />)

    const section = screen.getByRole('region', { name: 'Project tree' })
    const toggle = within(section).getByRole('checkbox', { name: LABEL })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(
      'When you switch to a file or preview tab, the project tree opens its folders, scrolls to the file and underlines it.'
    )
  })

  it('reads a settings object without the section as on', () => {
    const older: Partial<ReturnType<typeof globalSettings>> = globalSettings()
    delete older.projectTree
    useGlobalSettingsStore.setState({ settings: older as ReturnType<typeof globalSettings> })
    render(<ProjectTreeSection />)
    expect(screen.getByRole('checkbox', { name: LABEL })).toBeChecked()
  })

  it('reflects off, and is disabled until settings load', () => {
    useGlobalSettingsStore.setState({ settings: globalSettings({ projectTree: { followActiveTab: false } }) })
    const { unmount } = render(<ProjectTreeSection />)
    expect(screen.getByRole('checkbox', { name: LABEL })).not.toBeChecked()
    unmount()

    useGlobalSettingsStore.setState({ settings: null })
    render(<ProjectTreeSection />)
    expect(screen.getByRole('checkbox', { name: LABEL })).toBeDisabled()
  })

  it('writes the toggle through the store', () => {
    const update = vi.fn(async () => {})
    useGlobalSettingsStore.setState({ settings: globalSettings(), updateProjectTreeFollowActiveTab: update })
    render(<ProjectTreeSection />)

    fireEvent.click(screen.getByRole('checkbox', { name: LABEL }))
    expect(update).toHaveBeenCalledWith(false)
  })
})
