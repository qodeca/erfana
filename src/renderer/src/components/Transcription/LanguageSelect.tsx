// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LanguageSelect Component
 *
 * Dropdown selector for transcription language options. Displays human-readable
 * language labels and includes an "Auto-detect" option at the top.
 *
 * @see Issue #75 - Media import with transcription
 */

import type { TranscriptionLanguage } from '../../../../shared/ipc/transcription-schema'
import { TEST_IDS } from '../../constants/testids'

/**
 * Language option with code and human-readable label.
 */
interface LanguageOption {
  /** ISO language code or 'auto' */
  value: TranscriptionLanguage
  /** Human-readable label */
  label: string
}

/**
 * All supported transcription languages with human-readable labels.
 * "Auto-detect" is first in the list as the default option.
 */
const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'pl', label: 'Polish' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
  { value: 'no', label: 'Norwegian' },
  { value: 'ro', label: 'Romanian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sv', label: 'Swedish' },
  { value: 'th', label: 'Thai' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'vi', label: 'Vietnamese' }
]

/**
 * Props for the LanguageSelect component.
 */
interface LanguageSelectProps {
  /** Currently selected language code */
  value: TranscriptionLanguage
  /** Callback when the user selects a different language */
  onChange: (language: TranscriptionLanguage) => void
  /** Whether the select is disabled (e.g., during transcription) */
  disabled?: boolean
}

/**
 * Language selector dropdown for transcription.
 *
 * Renders a styled `<select>` element with all supported transcription
 * languages. Uses the same styling as settings select dropdowns.
 *
 * @param props - Component props
 * @returns Rendered select element
 *
 * @example
 * ```tsx
 * const [language, setLanguage] = useState<TranscriptionLanguage>('auto')
 *
 * <LanguageSelect
 *   value={language}
 *   onChange={setLanguage}
 *   disabled={isTranscribing}
 * />
 * ```
 */
export function LanguageSelect({
  value,
  onChange,
  disabled = false
}: LanguageSelectProps): JSX.Element {
  return (
    <select
      className="transcription-language-select"
      value={value}
      onChange={(e) => onChange(e.target.value as TranscriptionLanguage)}
      disabled={disabled}
      data-testid={TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT}
      aria-label="Transcription language"
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
