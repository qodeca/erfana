// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cross-cutting CSS-policy audit test for issue #211.
 *
 * The audit added `user-select: text` to data-bearing text surfaces that
 * dockview-core's panel chrome would otherwise inherit as `none`. This test
 * reads the central utilities.css plus the surviving module-scoped CSS files as
 * raw text (Vite `?raw` import) and asserts the policy rule is still declared
 * for the named selector.
 *
 * Why raw CSS instead of computed-style assertions: `getComputedStyle` for
 * non-standard properties like `user-select` is unreliable in jsdom (vitest
 * #1689, #8017) and would silently false-pass if the substrate degrades. The
 * raw-CSS approach is deterministic, covers every audited surface, and has no
 * runtime dependency.
 *
 * Adding a new selectable surface: add the selector to
 * `src/renderer/src/styles/utilities.css` and add a new row to
 * AUDIT_211_SURFACES.
 *
 * See: docs/ui-style-guide.md § Text selection policy
 */

import { describe, it, expect } from 'vitest'

import utilitiesCss from './utilities.css?raw'
import imageViewerCss from '../components/Panels/ImageViewerPanel.module.css?raw'

interface AuditSurface {
  /** Plain label used in test names and assertion messages */
  surface: string
  /** Path relative to repo root, for error reporting */
  file: string
  /** CSS selector that must declare `user-select: text` in the named file */
  selector: string
  /** Raw CSS contents loaded via Vite `?raw` */
  css: string
}

/**
 * Every surface in the #211 audit. CI asserts the named selector still
 * declares `user-select: text` in the named file. A regression that drops
 * the declaration fails this test loudly with the surface name.
 */
export const AUDIT_211_SURFACES: readonly AuditSurface[] = [
  { surface: 'MarkdownPreview content', file: 'src/renderer/src/styles/utilities.css', selector: '.markdown-preview-content', css: utilitiesCss },
  { surface: 'Dialog body', file: 'src/renderer/src/styles/utilities.css', selector: '.dialog-body', css: utilitiesCss },
  { surface: 'Dialog title', file: 'src/renderer/src/styles/utilities.css', selector: '.dialog-title', css: utilitiesCss },
  { surface: 'FilePicker filename', file: 'src/renderer/src/styles/utilities.css', selector: '.file-picker-filename', css: utilitiesCss },
  { surface: 'FilePicker path', file: 'src/renderer/src/styles/utilities.css', selector: '.file-picker-path', css: utilitiesCss },
  { surface: 'Welcome heading', file: 'src/renderer/src/styles/utilities.css', selector: '.welcome-content h2', css: utilitiesCss },
  { surface: 'Welcome paragraph', file: 'src/renderer/src/styles/utilities.css', selector: '.welcome-content p', css: utilitiesCss },
  { surface: 'Recent project name', file: 'src/renderer/src/styles/utilities.css', selector: '.recent-project-name', css: utilitiesCss },
  { surface: 'Recent project path', file: 'src/renderer/src/styles/utilities.css', selector: '.recent-project-path', css: utilitiesCss },
  { surface: 'Recent project time', file: 'src/renderer/src/styles/utilities.css', selector: '.recent-project-time', css: utilitiesCss },
  { surface: 'Chat panel', file: 'src/renderer/src/styles/utilities.css', selector: '.chat-panel', css: utilitiesCss },
  { surface: 'File conflict message', file: 'src/renderer/src/styles/utilities.css', selector: '.file-conflict-message', css: utilitiesCss },
  { surface: 'Document stats bar', file: 'src/renderer/src/styles/utilities.css', selector: '.document-stats-bar', css: utilitiesCss },
  { surface: 'Image viewer metadata', file: 'src/renderer/src/components/Panels/ImageViewerPanel.module.css', selector: '.metadataItem', css: imageViewerCss },
  { surface: 'Image viewer error', file: 'src/renderer/src/components/Panels/ImageViewerPanel.module.css', selector: '.errorMessage', css: imageViewerCss },
  { surface: 'Project panel content', file: 'src/renderer/src/styles/utilities.css', selector: '.project-panel .sidebar-panel-content', css: utilitiesCss },
  { surface: 'Claude status bar', file: 'src/renderer/src/styles/utilities.css', selector: '.terminal-claude-statusbar', css: utilitiesCss },
  { surface: 'Terminal status hint', file: 'src/renderer/src/styles/utilities.css', selector: '.terminal-status-hint', css: utilitiesCss },
  { surface: 'Search match count', file: 'src/renderer/src/styles/utilities.css', selector: '.search-match-count', css: utilitiesCss },
  { surface: 'Settings content', file: 'src/renderer/src/styles/utilities.css', selector: '.settings-content', css: utilitiesCss },
  { surface: 'Toast message', file: 'src/renderer/src/styles/utilities.css', selector: '.toast-message', css: utilitiesCss },
  { surface: 'Character count', file: 'src/renderer/src/styles/utilities.css', selector: '.char-count', css: utilitiesCss }
]

/**
 * Escape a CSS selector for embedding inside a RegExp source string. The
 * audit's selectors use only `.`, alphanumerics, hyphens, and spaces, so the
 * required escapes are `.` (literal dot) and collapsing whitespace to `\s+`.
 */
function escapeSelectorForRegex(selector: string): string {
  return selector.replace(/\./g, '\\.').replace(/\s+/g, '\\s+')
}

describe('user-select audit (#211) — every audited surface declares user-select: text', () => {
  it.each(AUDIT_211_SURFACES)(
    '$surface ($selector) is selectable in $file',
    ({ selector, css, file }) => {
      const escaped = escapeSelectorForRegex(selector)
      // Match the selector and `user-select: text` within the same rule block
      // or its adjacent selector list. The bounded {0,800} window covers
      // comma-separated selector lists plus the leading declarations in the rule.
      const pattern = new RegExp(`${escaped}[\\s\\S]{0,800}?user-select:\\s*text\\s*;`, 'i')
      expect(
        pattern.test(css),
        `Expected ${selector} to declare \`user-select: text\` in ${file}.\n` +
        `If this surface was intentionally removed from the audit, update AUDIT_211_SURFACES.`
      ).toBe(true)
    }
  )
})
