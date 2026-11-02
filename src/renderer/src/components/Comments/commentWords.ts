// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which preview's words a comment surface speaks (spec 024 024-FR-007, C-03).
 *
 * The strings themselves live in `commentCopy.ts` – one source for both
 * previews; this context only says which table a component reads. The
 * HTML Preview never provides it, so every shared component it renders keeps
 * `HTML_WORDS`, the strings it showed before; a renderer-hosted preview wraps
 * its comment surfaces in a provider with its own words.
 *
 * @module components/Comments/commentWords
 */
import { createContext, useContext } from 'react'
import { HTML_WORDS, type CommentWords } from './commentCopyWords'

/** The words of the preview the surface belongs to; the HTML Preview's by default. */
export const CommentWordsContext = createContext<CommentWords>(HTML_WORDS)

/** The words of the preview this component is drawn in. */
export function useCommentWords(): CommentWords {
  return useContext(CommentWordsContext)
}
