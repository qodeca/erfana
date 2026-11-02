// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared comment base – the format core every commentable file kind uses
 * (spec 024 architecture note 001 § 1; public spec docs/html-comments/format-v1.md).
 *
 * Pure code: no Electron, no file system, no parser of any file type; zod and
 * @noble/hashes only. Main and the renderer may import it; a preload may NOT
 * (preloads are self-contained bundles, electron.vite.config.ts).
 *
 * `htmlKind.ts` lives in this folder but is HTML-specific: it wraps the
 * parse5 modules of `../htmlComments/`, so it is left out of this barrel and
 * importing the base never loads parse5. Import it by its path.
 */
export * from './agentNotes'
export * from './anchorEvidence'
export * from './anchorLookup'
export * from './anchorSel'
export * from './blocks'
export * from './conflictMarkers'
export * from './cutText'
export * from './encoding'
export * from './fileKind'
export * from './format'
export * from './identity'
export * from './noteLines'
export * from './quoteText'
export * from './reattach'
export * from './splice'
export type * from './targetIndex'
export * from './thread'
