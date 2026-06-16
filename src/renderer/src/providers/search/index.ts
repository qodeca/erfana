// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Search providers barrel export.
 *
 * @see ADR-Spec001-001 - Unified search architecture
 */

// Interface and types
export type { SearchProvider, SearchOptions, SearchMatch } from './SearchProvider'

// Implementations
export { MonacoSearchProvider } from './MonacoSearchProvider'
export { PreviewSearchProvider } from './PreviewSearchProvider'
