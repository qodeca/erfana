// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HtmlPreviewSection.test.tsx
 *
 * Coverage for the AC21 global HTML-execution toggle (Issue #74):
 * - renders the toggle reflecting the store value (on / off / default)
 * - toggling calls the store update with the flipped `enabled`
 * - the checkbox is disabled while settings have not loaded
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HtmlPreviewSection } from './HtmlPreviewSection'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import type { GlobalSettings } from '../../../../../shared/ipc/global-settings-schema'

/** Build a complete settings object with `htmlPreview.enabled` overridden. */
function settingsWith(enabled: boolean): GlobalSettings {
  return {
    logging: { level: 'info' },
    editor: { preserveLineBreaks: false },
    gitStatus: { pollingEnabled: true, pollingInterval: 5000 },
    transcription: { backend: 'openai', openaiApiKeyStored: false, whisperModel: 'base' },
    htmlPreview: { enabled }
  }
}

describe('HtmlPreviewSection', () => {
  beforeEach(() => {
    // Partial setState merges, so the real store keeps its other methods.
    useGlobalSettingsStore.setState({ settings: settingsWith(true) })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useGlobalSettingsStore.setState({ settings: null })
  })

  it('renders the section with its heading and toggle', () => {
    render(<HtmlPreviewSection />)

    const heading = screen.getByRole('heading', { name: 'HTML preview' })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('settings-section-title')
    expect(screen.getByTestId('settings-toggle-html-preview')).toBeInTheDocument()
  })

  it('reflects an enabled store value (checked)', () => {
    useGlobalSettingsStore.setState({ settings: settingsWith(true) })
    render(<HtmlPreviewSection />)

    expect(screen.getByRole('checkbox', { name: 'Run HTML files' })).toBeChecked()
  })

  it('reflects a disabled store value (unchecked)', () => {
    useGlobalSettingsStore.setState({ settings: settingsWith(false) })
    render(<HtmlPreviewSection />)

    expect(screen.getByRole('checkbox', { name: 'Run HTML files' })).not.toBeChecked()
  })

  it('defaults to checked when the htmlPreview field is absent', () => {
    // Simulate a settings object that predates the field.
    const legacy = settingsWith(true) as Partial<GlobalSettings>
    delete legacy.htmlPreview
    useGlobalSettingsStore.setState({ settings: legacy as GlobalSettings })

    render(<HtmlPreviewSection />)

    expect(screen.getByRole('checkbox', { name: 'Run HTML files' })).toBeChecked()
  })

  it('calls updateHtmlPreviewEnabled with the flipped value when toggled off', () => {
    const update = vi.fn()
    useGlobalSettingsStore.setState({
      settings: settingsWith(true),
      updateHtmlPreviewEnabled: update
    })

    render(<HtmlPreviewSection />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Run HTML files' }))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(false)
  })

  it('calls updateHtmlPreviewEnabled with the flipped value when toggled on', () => {
    const update = vi.fn()
    useGlobalSettingsStore.setState({
      settings: settingsWith(false),
      updateHtmlPreviewEnabled: update
    })

    render(<HtmlPreviewSection />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Run HTML files' }))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(true)
  })

  it('disables the toggle while settings are null', () => {
    useGlobalSettingsStore.setState({ settings: null })
    render(<HtmlPreviewSection />)

    expect(screen.getByRole('checkbox', { name: 'Run HTML files' })).toBeDisabled()
  })
})
