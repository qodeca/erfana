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
