// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * OcrLanguageSelect Component
 *
 * Dropdown selector for OCR language options using Tesseract ISO 639-3 codes.
 * Unlike the transcription LanguageSelect (ISO 639-1), OCR uses three-letter
 * codes with optional script suffixes (e.g., 'chi_sim' for Simplified Chinese).
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { TEST_IDS } from '../../constants/testids'

/**
 * OCR language option with Tesseract code and human-readable label.
 */
interface OcrLanguageOption {
  /** Tesseract ISO 639-3 language code */
  value: string
  /** Human-readable label */
  label: string
}

/**
 * All supported OCR languages with Tesseract ISO 639-3 codes.
 * English is first as the default option.
 */
export const OCR_LANGUAGE_OPTIONS: OcrLanguageOption[] = [
  { value: 'eng', label: 'English' },
  { value: 'pol', label: 'Polish' },
  { value: 'deu', label: 'German' },
  { value: 'fra', label: 'French' },
  { value: 'spa', label: 'Spanish' },
  { value: 'ita', label: 'Italian' },
  { value: 'por', label: 'Portuguese' },
  { value: 'nld', label: 'Dutch' },
  { value: 'rus', label: 'Russian' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'chi_sim', label: 'Chinese (Simplified)' },
  { value: 'chi_tra', label: 'Chinese (Traditional)' },
  { value: 'kor', label: 'Korean' },
  { value: 'ara', label: 'Arabic' },
  { value: 'ces', label: 'Czech' },
  { value: 'dan', label: 'Danish' },
  { value: 'fin', label: 'Finnish' },
  { value: 'ell', label: 'Greek' },
  { value: 'heb', label: 'Hebrew' },
  { value: 'hin', label: 'Hindi' },
  { value: 'hun', label: 'Hungarian' },
  { value: 'ind', label: 'Indonesian' },
  { value: 'msa', label: 'Malay' },
  { value: 'nor', label: 'Norwegian' },
  { value: 'ron', label: 'Romanian' },
  { value: 'slk', label: 'Slovak' },
  { value: 'swe', label: 'Swedish' },
  { value: 'tha', label: 'Thai' },
  { value: 'tur', label: 'Turkish' },
  { value: 'ukr', label: 'Ukrainian' },
  { value: 'vie', label: 'Vietnamese' }
]

/**
 * Props for the OcrLanguageSelect component.
 */
interface OcrLanguageSelectProps {
  /** Currently selected OCR language code (Tesseract ISO 639-3) */
  value: string
  /** Callback when the user selects a different language */
  onChange: (language: string) => void
  /** Whether the select is disabled */
  disabled?: boolean
  /** HTML id for label association */
  id?: string
}

/**
 * OCR language selector dropdown for document import.
 *
 * Renders a styled `<select>` element with all supported Tesseract OCR
 * languages. Uses ISO 639-3 codes (three-letter) with optional script
 * suffixes for Chinese variants.
 *
 * @param props - Component props
 * @returns Rendered select element
 *
 * @example
 * ```tsx
 * const [ocrLanguage, setOcrLanguage] = useState('eng')
 *
 * <OcrLanguageSelect
 *   value={ocrLanguage}
 *   onChange={setOcrLanguage}
 *   disabled={isImporting}
 *   id="ocr-lang"
 * />
 * ```
 */
export function OcrLanguageSelect({
  value,
  onChange,
  disabled = false,
  id
}: OcrLanguageSelectProps): JSX.Element {
  return (
    <select
      id={id}
      className="doc-import-language-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      data-testid={TEST_IDS.DOCUMENT_IMPORT_LANGUAGE_SELECT}
      aria-label={id ? undefined : 'OCR language'}
    >
      {OCR_LANGUAGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
