// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for OcrLanguageSelect component
 *
 * Verifies rendering of all language options, selected value binding,
 * change callback, disabled state, test ID, and id prop forwarding.
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OcrLanguageSelect, OCR_LANGUAGE_OPTIONS } from './OcrLanguageSelect'
import { TEST_IDS } from '../../constants/testids'

describe('OcrLanguageSelect', () => {
  describe('Rendering', () => {
    it('renders a select element with correct test ID', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select.tagName).toBe('SELECT')
    })

    it('renders all 31 language options', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.options).toHaveLength(OCR_LANGUAGE_OPTIONS.length)
      expect(select.options).toHaveLength(31)
    })

    it('has English as the first option with value "eng"', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.options[0].value).toBe('eng')
      expect(select.options[0].text).toBe('English')
    })

    it('renders option labels for all supported languages', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement

      const renderedValues = Array.from(select.options).map((o) => o.value)
      const renderedLabels = Array.from(select.options).map((o) => o.text)

      for (const option of OCR_LANGUAGE_OPTIONS) {
        expect(renderedValues).toContain(option.value)
        expect(renderedLabels).toContain(option.label)
      }
    })

    it('shows Chinese (Simplified) with chi_sim code', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      const chiSimOption = Array.from(select.options).find((o) => o.value === 'chi_sim')
      expect(chiSimOption).toBeDefined()
      expect(chiSimOption!.text).toBe('Chinese (Simplified)')
    })

    it('shows Chinese (Traditional) with chi_tra code', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      const chiTraOption = Array.from(select.options).find((o) => o.value === 'chi_tra')
      expect(chiTraOption).toBeDefined()
      expect(chiTraOption!.text).toBe('Chinese (Traditional)')
    })
  })

  describe('Selected value', () => {
    it('shows the correct selected value for eng', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.value).toBe('eng')
    })

    it('shows the correct selected value for pol', () => {
      render(<OcrLanguageSelect value="pol" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.value).toBe('pol')
    })

    it('shows the correct selected value for chi_sim', () => {
      render(<OcrLanguageSelect value="chi_sim" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.value).toBe('chi_sim')
    })

    it('shows the correct selected value for deu', () => {
      render(<OcrLanguageSelect value="deu" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.value).toBe('deu')
    })
  })

  describe('onChange callback', () => {
    it('calls onChange with the Tesseract code when selecting a different language', () => {
      const handleChange = vi.fn()
      render(<OcrLanguageSelect value="eng" onChange={handleChange} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)

      fireEvent.change(select, { target: { value: 'pol' } })

      expect(handleChange).toHaveBeenCalledOnce()
      expect(handleChange).toHaveBeenCalledWith('pol')
    })

    it('calls onChange with chi_sim for Chinese (Simplified) selection', () => {
      const handleChange = vi.fn()
      render(<OcrLanguageSelect value="eng" onChange={handleChange} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)

      fireEvent.change(select, { target: { value: 'chi_sim' } })

      expect(handleChange).toHaveBeenCalledWith('chi_sim')
    })

    it('calls onChange with chi_tra for Chinese (Traditional) selection', () => {
      const handleChange = vi.fn()
      render(<OcrLanguageSelect value="eng" onChange={handleChange} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)

      fireEvent.change(select, { target: { value: 'chi_tra' } })

      expect(handleChange).toHaveBeenCalledWith('chi_tra')
    })

    it('does not call onChange when no change event fires', () => {
      const handleChange = vi.fn()
      render(<OcrLanguageSelect value="eng" onChange={handleChange} />)
      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe('Disabled state', () => {
    it('is disabled when disabled prop is true', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} disabled={true} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).toBeDisabled()
    })

    it('is enabled when disabled prop is false', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} disabled={false} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).toBeEnabled()
    })

    it('is enabled by default when disabled prop is omitted', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).toBeEnabled()
    })
  })

  describe('id prop', () => {
    it('forwards id prop to the select element', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} id="ocr-lang" />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).toHaveAttribute('id', 'ocr-lang')
    })

    it('has no id attribute when id prop is omitted', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).not.toHaveAttribute('id')
    })
  })

  describe('Accessibility', () => {
    it('has aria-label when id is not provided', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).toHaveAttribute('aria-label', 'OCR language')
    })

    it('does not have aria-label when id is provided (label association covers it)', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} id="ocr-lang" />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).not.toHaveAttribute('aria-label')
    })
  })

  describe('CSS class', () => {
    it('has the doc-import-language-select class', () => {
      render(<OcrLanguageSelect value="eng" onChange={() => {}} />)
      const select = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT)
      expect(select).toHaveClass('doc-import-language-select')
    })
  })
})
