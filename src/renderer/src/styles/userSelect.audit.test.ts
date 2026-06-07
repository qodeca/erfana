/**
 * Cross-cutting CSS-policy audit test for issue #211.
 *
 * The audit added `user-select: text` to data-bearing text surfaces that
 * dockview-core's panel chrome would otherwise inherit as `none`. This test
 * reads each component CSS file as raw text (Vite `?raw` import) and asserts
 * the policy rule is still declared for the named selector.
 *
 * Why raw CSS instead of computed-style assertions: `getComputedStyle` for
 * non-standard properties like `user-select` is unreliable in jsdom (vitest
 * #1689, #8017) and would silently false-pass if the substrate degrades. The
 * raw-CSS approach is deterministic, covers every audited surface, and has no
 * runtime dependency.
 *
 * Adding a new selectable surface: declare `user-select: text` on the
 * component CSS, add a new row to AUDIT_211_SURFACES, and (if it's a new
 * file) add the `?raw` import below.
 *
 * See: docs/ui-style-guide.md § Text selection policy
 */

import { describe, it, expect } from 'vitest'

 
// @ts-expect-error Vite ?raw query — typed via vite/client
import dialogCss from '../components/Dialog/Dialog.css?raw'
// @ts-expect-error Vite ?raw query
import filePickerCss from '../components/Dialog/FilePickerDialog.css?raw'
// @ts-expect-error Vite ?raw query
import appDockLayoutCss from '../components/DockLayout/AppDockLayout.css?raw'
// @ts-expect-error Vite ?raw query
import chatBubbleCss from '../components/Editor/DiagramViewer/ChatBubble.css?raw'
// @ts-expect-error Vite ?raw query
import markdownPreviewCss from '../components/Editor/MarkdownPreview.css?raw'
// @ts-expect-error Vite ?raw query
import fileConflictCss from '../components/FileConflictNotification/FileConflictNotification.css?raw'
// @ts-expect-error Vite ?raw query
import documentStatsBarCss from '../components/Panels/DocumentStatsBar.css?raw'
// @ts-expect-error Vite ?raw query
import imageViewerCss from '../components/Panels/ImageViewerPanel.module.css?raw'
// @ts-expect-error Vite ?raw query
import projectPanelCss from '../components/Panels/ProjectPanel.css?raw'
// @ts-expect-error Vite ?raw query
import claudeStatusBarCss from '../components/Panels/TerminalPanel/components/ClaudeStatusBar.css?raw'
// @ts-expect-error Vite ?raw query
import terminalStatusContentCss from '../components/Panels/TerminalPanel/components/TerminalStatusContent.css?raw'
// @ts-expect-error Vite ?raw query
import searchBarCss from '../components/Search/SearchBar.css?raw'
// @ts-expect-error Vite ?raw query
import settingsOverlayCss from '../components/Settings/SettingsOverlay.css?raw'
// @ts-expect-error Vite ?raw query
import toastCss from '../components/Toast/Toast.css?raw'
// @ts-expect-error Vite ?raw query
import characterCountCss from '../components/shared/CharacterCount.css?raw'

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
  { surface: 'MarkdownPreview content', file: 'src/renderer/src/components/Editor/MarkdownPreview.css', selector: '.markdown-preview-content', css: markdownPreviewCss },
  { surface: 'Dialog body', file: 'src/renderer/src/components/Dialog/Dialog.css', selector: '.dialog-body', css: dialogCss },
  { surface: 'Dialog title', file: 'src/renderer/src/components/Dialog/Dialog.css', selector: '.dialog-title', css: dialogCss },
  { surface: 'FilePicker filename', file: 'src/renderer/src/components/Dialog/FilePickerDialog.css', selector: '.file-picker-filename', css: filePickerCss },
  { surface: 'FilePicker path', file: 'src/renderer/src/components/Dialog/FilePickerDialog.css', selector: '.file-picker-path', css: filePickerCss },
  { surface: 'Welcome heading', file: 'src/renderer/src/components/DockLayout/AppDockLayout.css', selector: '.welcome-content h2', css: appDockLayoutCss },
  { surface: 'Welcome paragraph', file: 'src/renderer/src/components/DockLayout/AppDockLayout.css', selector: '.welcome-content p', css: appDockLayoutCss },
  { surface: 'Recent project name', file: 'src/renderer/src/components/DockLayout/AppDockLayout.css', selector: '.recent-project-name', css: appDockLayoutCss },
  { surface: 'Recent project path', file: 'src/renderer/src/components/DockLayout/AppDockLayout.css', selector: '.recent-project-path', css: appDockLayoutCss },
  { surface: 'Recent project time', file: 'src/renderer/src/components/DockLayout/AppDockLayout.css', selector: '.recent-project-time', css: appDockLayoutCss },
  { surface: 'Chat panel', file: 'src/renderer/src/components/Editor/DiagramViewer/ChatBubble.css', selector: '.chat-panel', css: chatBubbleCss },
  { surface: 'File conflict message', file: 'src/renderer/src/components/FileConflictNotification/FileConflictNotification.css', selector: '.file-conflict-message', css: fileConflictCss },
  { surface: 'Document stats bar', file: 'src/renderer/src/components/Panels/DocumentStatsBar.css', selector: '.document-stats-bar', css: documentStatsBarCss },
  { surface: 'Image viewer metadata', file: 'src/renderer/src/components/Panels/ImageViewerPanel.module.css', selector: '.metadataItem', css: imageViewerCss },
  { surface: 'Image viewer error', file: 'src/renderer/src/components/Panels/ImageViewerPanel.module.css', selector: '.errorMessage', css: imageViewerCss },
  { surface: 'Project panel content', file: 'src/renderer/src/components/Panels/ProjectPanel.css', selector: '.project-panel .sidebar-panel-content', css: projectPanelCss },
  { surface: 'Claude status bar', file: 'src/renderer/src/components/Panels/TerminalPanel/components/ClaudeStatusBar.css', selector: '.terminal-claude-statusbar', css: claudeStatusBarCss },
  { surface: 'Terminal status hint', file: 'src/renderer/src/components/Panels/TerminalPanel/components/TerminalStatusContent.css', selector: '.terminal-status-hint', css: terminalStatusContentCss },
  { surface: 'Search match count', file: 'src/renderer/src/components/Search/SearchBar.css', selector: '.search-match-count', css: searchBarCss },
  { surface: 'Settings content', file: 'src/renderer/src/components/Settings/SettingsOverlay.css', selector: '.settings-content', css: settingsOverlayCss },
  { surface: 'Toast message', file: 'src/renderer/src/components/Toast/Toast.css', selector: '.toast-message', css: toastCss },
  { surface: 'Character count', file: 'src/renderer/src/components/shared/CharacterCount.css', selector: '.char-count', css: characterCountCss }
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
