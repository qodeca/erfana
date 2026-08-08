// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageSelect } from './LanguageSelect'
import { TEST_IDS } from '../../constants/testids'

describe('LanguageSelect', () => {
  it('renders a select element with correct test ID', () => {
    render(<LanguageSelect value="auto" onChange={() => {}} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
    expect(select.tagName).toBe('SELECT')
  })

  it('has aria-label for accessibility', () => {
    render(<LanguageSelect value="auto" onChange={() => {}} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
    expect(select).toHaveAttribute('aria-label', 'Transcription language')
  })

  it('carries the id it is given, so a visible label can point at it', () => {
    render(
      <>
        <label htmlFor="lang">Language</label>
        <LanguageSelect id="lang" value="auto" onChange={() => {}} />
      </>
    )

    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
    expect(select).toHaveAttribute('id', 'lang')
    expect(screen.getByLabelText('Language')).toBe(select)
  })

  it('drops the fallback aria-label when an id is supplied', () => {
    // Two competing names would make the spoken name differ from the visible
    // one; the visible label wins. Same rule as OcrLanguageSelect.
    render(<LanguageSelect id="lang" value="auto" onChange={() => {}} />)

    expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)).not.toHaveAttribute(
      'aria-label'
    )
  })

  it('renders all language options', () => {
    render(<LanguageSelect value="auto" onChange={() => {}} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT) as HTMLSelectElement
    expect(select.options).toHaveLength(31)
  })

  it('has Auto-detect as first option with value "auto"', () => {
    render(<LanguageSelect value="auto" onChange={() => {}} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT) as HTMLSelectElement
    expect(select.options[0].text).toBe('Auto-detect')
    expect(select.options[0].value).toBe('auto')
  })

  it('calls onChange with selected language code', () => {
    const handleChange = vi.fn()
    render(<LanguageSelect value="auto" onChange={handleChange} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)

    fireEvent.change(select, { target: { value: 'pl' } })
    expect(handleChange).toHaveBeenCalledWith('pl')
  })

  it('is disabled when disabled prop is true', () => {
    render(<LanguageSelect value="auto" onChange={() => {}} disabled={true} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
    expect(select).toBeDisabled()
  })

  it('is enabled by default', () => {
    render(<LanguageSelect value="auto" onChange={() => {}} />)
    const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
    expect(select).toBeEnabled()
  })
})
