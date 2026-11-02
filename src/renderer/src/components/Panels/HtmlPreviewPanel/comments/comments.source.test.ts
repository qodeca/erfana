// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Source rules for the comments UI (docs/designs/comments/html-preview-comments.md
 * §12.2): SEC-25 and R-011.
 *
 * SEC-25 asks for an ESLint rule rejecting `dangerouslySetInnerHTML` under
 * `comments/`. That rule belongs in `eslint.config.mjs`, outside this phase's
 * write scope, so until it lands this test is the gate: it reads every
 * comments source file as text. Comment text and reviewer names are
 * attacker-controlled (anyone who can edit the HTML file writes them), so they
 * must only ever reach the DOM as React text.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../../../..')

/** Every non-test source file under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__test-helpers__') out.push(...sources(path))
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/**
 * Every comment folder of the renderer, the shared base of spec 024 included
 * (architecture note § 8 C15): the HTML parts, the shared components, the
 * Markdown adapter and the file-comment gateway.
 */
const FILES = [
  ...sources(__dirname),
  ...sources(resolve(SRC, 'components/Comments')),
  ...sources(resolve(SRC, 'components/Editor/markdownComments')),
  ...sources(resolve(SRC, 'services/comments')),
  resolve(SRC, 'components/Settings/sections/CommentsSection.tsx'),
  resolve(SRC, 'stores/usePreviewCommentStore.ts'),
  resolve(SRC, 'services/preview/commentGateway.ts'),
  resolve(SRC, 'hooks/useCommentDirtyGuard.ts'),
  resolve(SRC, 'hooks/useUnsavedSourcesFeed.ts')
]

const COMMENT_SOURCE_FLOOR = 29

const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('comments source rules', () => {
  // A floor, not a range: moving files into the shared folders must never make
  // the scan see fewer files (spec 024, § 8 C15). Raise it as files are added.
  it('scans the comments sources, and never fewer than before', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(COMMENT_SOURCE_FLOOR)
  })

  it.each(FILES.map(f => [relative(SRC, f), f]))(
    'SEC-25 %s never sets HTML from a string',
    (_name, path) => {
      const text = code(path)
      expect(text).not.toMatch(/dangerouslySetInnerHTML/)
      expect(text).not.toMatch(/\.(innerHTML|outerHTML)\s*=/)
      expect(text).not.toMatch(/insertAdjacentHTML|document\.write|createContextualFragment/)
    }
  )

  it('R-011 no "Send to agent" control anywhere', () => {
    for (const path of FILES) {
      // Prose may name the control to say it is absent; code may not.
      expect(code(path), relative(SRC, path)).not.toMatch(/send\s+to\s+(the\s+)?agent/i)
    }
  })
})
