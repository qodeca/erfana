// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ISO 639-1 to ISO 639-3 Language Code Mapping
 *
 * Maps 2-letter language codes from the UI (ISO 639-1) to
 * 3-letter codes required by Tesseract OCR (ISO 639-3).
 *
 * @see Issue #132 – LiteParse document import
 */

/**
 * Mapping of ISO 639-1 (2-letter) to Tesseract language codes.
 * Covers the most common languages available in Tesseract traineddata.
 */
const ISO_TO_TESS: Record<string, string> = {
  af: 'afr',
  ar: 'ara',
  bg: 'bul',
  bn: 'ben',
  ca: 'cat',
  cs: 'ces',
  cy: 'cym',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  et: 'est',
  fa: 'fas',
  fi: 'fin',
  fr: 'fra',
  ga: 'gle',
  gu: 'guj',
  he: 'heb',
  hi: 'hin',
  hr: 'hrv',
  hu: 'hun',
  id: 'ind',
  is: 'isl',
  it: 'ita',
  ja: 'jpn',
  ka: 'kat',
  kn: 'kan',
  ko: 'kor',
  lt: 'lit',
  lv: 'lav',
  mk: 'mkd',
  ml: 'mal',
  mr: 'mar',
  ms: 'msa',
  mt: 'mlt',
  nl: 'nld',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sk: 'slk',
  sl: 'slv',
  sq: 'sqi',
  sr: 'srp',
  sv: 'swe',
  ta: 'tam',
  te: 'tel',
  th: 'tha',
  tl: 'tgl',
  tr: 'tur',
  uk: 'ukr',
  ur: 'urd',
  vi: 'vie',
  zh: 'chi_sim'
}

/**
 * Convert an ISO 639-1 language code to a Tesseract language code.
 *
 * - 2-letter codes are mapped via the lookup table
 * - 3-letter codes (already Tesseract format) are passed through
 * - Unknown codes fall back to 'eng' (English)
 *
 * @param code - Language code (ISO 639-1 or ISO 639-3)
 * @returns Tesseract-compatible language code
 *
 * @example
 * isoToTessLang('en')  // 'eng'
 * isoToTessLang('de')  // 'deu'
 * isoToTessLang('eng') // 'eng' (passthrough)
 * isoToTessLang('xx')  // 'eng' (fallback)
 */
export function isoToTessLang(code: string | undefined | null): string {
  if (!code) return 'eng'

  const normalized = code.trim().toLowerCase()

  // Already a 3-letter code – pass through if it looks like a valid language code
  if (normalized.length === 3 && /^[a-z]{3}$/.test(normalized)) return normalized

  // Look up 2-letter code
  return ISO_TO_TESS[normalized] ?? 'eng'
}
