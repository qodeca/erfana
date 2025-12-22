/**
 * Search providers barrel export.
 *
 * @see ADR-BRS001-001 - Unified search architecture
 */

// Interface and types
export type { SearchProvider, SearchOptions, SearchMatch } from './SearchProvider'

// Implementations
export { MonacoSearchProvider } from './MonacoSearchProvider'
export { PreviewSearchProvider } from './PreviewSearchProvider'
