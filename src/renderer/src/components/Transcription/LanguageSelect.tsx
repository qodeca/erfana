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
  /** HTML id for label association. Suppresses the fallback `aria-label`. */
  id?: string
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
 * NAMING: pass `id` whenever a visible `<label htmlFor=...>` sits beside the
 * control, and the label becomes its accessible name. Without `id` the label
 * is not associated — clicking it does nothing and a screen reader announces
 * the `aria-label` instead of the visible text — so the fallback `aria-label`
 * applies only when no `id` is given, and the two never compete. Same shape as
 * `OcrLanguageSelect`.
 *
 * @example With an associated visible label (preferred)
 * ```tsx
 * <label htmlFor="transcription-lang">Language</label>
 * <LanguageSelect id="transcription-lang" value={language} onChange={setLanguage} />
 * ```
 *
 * @example Standalone, named by the fallback aria-label
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
  disabled = false,
  id
}: LanguageSelectProps): JSX.Element {
  return (
    <select
      id={id}
      className="transcription-language-select"
      value={value}
      onChange={(e) => onChange(e.target.value as TranscriptionLanguage)}
      disabled={disabled}
      data-testid={TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT}
      aria-label={id ? undefined : 'Transcription language'}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
