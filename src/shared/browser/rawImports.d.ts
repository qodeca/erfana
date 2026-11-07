// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Vite's `?raw` import of the pinned Public Suffix List (`publicSuffixList.dat`):
 * the file's text as a string, inlined at build time.
 */
declare module '*.dat?raw' {
  const text: string
  export default text
}
