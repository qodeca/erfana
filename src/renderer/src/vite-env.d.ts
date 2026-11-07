// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/// <reference types="vite/client" />

// Type declaration for Vite's ?raw import suffix
// Allows importing files as raw strings at build time
declare module '*.md?raw' {
  const content: string
  export default content
}

// App version inlined at build time via electron.vite.config.ts `define`.
declare const __APP_VERSION__: string

// `true` only in an e2e build (`electron-vite build --mode e2e`); inlined by
// electron.vite.config.ts `define`. Gates test-hook code (spec 025 § 12).
declare const __ERFANA_TEST_HOOKS__: boolean
