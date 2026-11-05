// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MarkdownToolbar component for the markdown editor panel.
 *
 * Provides view mode toggles, formatting buttons, export actions,
 * and file status indicators. This is a pure presentational component
 * that delegates all state changes to parent callbacks.
 *
 * Buttons that do not fit a narrow panel move into a "More actions" (…) menu,
 * rightmost first (#461, the Toolbar overflow card). The comment tools, the
 * modified dot and the live status region never move.
 *
 * @module MarkdownToolbar
 */

import {
  FileEdit,
  Columns2,
  Rows2,
  Eye,
  Bold,
  Italic,
  Code,
  Link,
  Image,
  Heading1,
  List,
  ListOrdered,
  Strikethrough,
  FileDown,
  FileText,
  Search
} from 'lucide-react'
import type { MonacoEditorHandle } from '../../MonacoMarkdownEditor'
import type { ViewMode, EditorFile } from '../types'
import { useSearchStore } from '../../../../stores/useSearchStore'
import { getSelectedText } from '../../../../utils/selectionHelpers'
import { TEST_IDS } from '../../../../constants/testids'
import { formatShortcut } from '../../../../utils/shortcutLabel'
import { ToolbarOverflow, type ToolbarAction, type ToolbarEntry } from '../../../ToolbarOverflow/ToolbarOverflow'
import './MarkdownToolbar.css'

// Re-export types for convenience
export type { ViewMode, EditorFile } from '../types'

/** The toolbar's accessible name. */
const TOOLBAR_LABEL = 'Markdown formatting'

/** The "…" menu's accessible name. */
const MENU_LABEL = 'Markdown toolbar actions'

/** Why the exports are off in the editor-only view: the row's tooltip and the menu item's reason. */
const EXPORT_DISABLED_REASON = 'switch to preview or split mode'

/**
 * Props for the MarkdownToolbar component.
 */
export interface MarkdownToolbarProps {
  /** Current view mode (editor, split, split-horizontal, preview) */
  viewMode: ViewMode
  /** Currently open file, or null if no file is open */
  currentFile: EditorFile | null
  /** Reference to the Monaco editor for formatting actions */
  editorRef: React.RefObject<MonacoEditorHandle | null>
  /** Whether an auto-save operation is in progress */
  isAutoSaving: boolean
  /** Whether the file is being reloaded from disk */
  isReloading: boolean
  /** Whether PDF export is in progress */
  isExportingPdf: boolean
  /** Whether DOCX export is in progress */
  isExportingDocx: boolean
  /** Callback when view mode is changed */
  onViewModeChange: (mode: ViewMode) => void
  /** Callback to export the document as PDF */
  onExportPdf: () => void
  /** Callback to export the document as DOCX */
  onExportDocx: () => void
  /**
   * The comment tools, after Find in the preview-only view (spec 024,
   * differences table D-28); the caller passes `null` in every other view.
   */
  commentTools?: React.ReactNode
}

const ICON = { size: 16, strokeWidth: 2 } as const

/** A formatting button: what it shows and the editor command it runs. */
interface FormatButton {
  id: string
  icon: React.ReactNode
  /** The accessible name and the menu label */
  label: string
  /** The tooltip, before any shortcut */
  title: string
  /** The letter of its Mod+letter shortcut, shown in the tooltip and the menu */
  shortcutKey?: string
  testId: string
  separatorBefore?: boolean
  run: (editor: MonacoEditorHandle) => void
}

/** The formatting buttons, left to right (editor and vertical split views only). */
const FORMAT_BUTTONS: readonly FormatButton[] = [
  { id: 'bold', icon: <Bold {...ICON} />, label: 'Bold', title: 'Bold', shortcutKey: 'B',
    testId: TEST_IDS.TOOLBAR_BTN_BOLD, run: (editor) => editor.formatBold() },
  { id: 'italic', icon: <Italic {...ICON} />, label: 'Italic', title: 'Italic', shortcutKey: 'I',
    testId: TEST_IDS.TOOLBAR_BTN_ITALIC, run: (editor) => editor.formatItalic() },
  { id: 'strikethrough', icon: <Strikethrough {...ICON} />, label: 'Strikethrough', title: 'Strikethrough',
    testId: TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH, run: (editor) => editor.formatStrikethrough() },
  { id: 'code', icon: <Code {...ICON} />, label: 'Inline code', title: 'Inline Code', separatorBefore: true,
    testId: TEST_IDS.TOOLBAR_BTN_CODE, run: (editor) => editor.formatCode() },
  { id: 'link', icon: <Link {...ICON} />, label: 'Insert link', title: 'Insert Link', shortcutKey: 'K',
    testId: TEST_IDS.TOOLBAR_BTN_LINK, run: (editor) => editor.insertLink() },
  { id: 'image', icon: <Image {...ICON} />, label: 'Insert image', title: 'Insert Image',
    testId: TEST_IDS.TOOLBAR_BTN_IMAGE, run: (editor) => editor.insertImage() },
  { id: 'heading', icon: <Heading1 {...ICON} />, label: 'Heading 1', title: 'Heading 1', separatorBefore: true,
    testId: TEST_IDS.TOOLBAR_BTN_HEADING, run: (editor) => editor.insertHeading(1) },
  { id: 'list', icon: <List {...ICON} />, label: 'Bullet list', title: 'Bullet List',
    testId: TEST_IDS.TOOLBAR_BTN_LIST, run: (editor) => editor.insertList(false) },
  { id: 'list-ordered', icon: <ListOrdered {...ICON} />, label: 'Numbered list', title: 'Numbered List',
    testId: TEST_IDS.TOOLBAR_BTN_LIST_ORDERED, run: (editor) => editor.insertList(true) }
]

/** A tooltip with its shortcut, in this platform's words (`Bold (⌘B)`, `Bold (Ctrl+B)`). */
function withShortcut(title: string, shortcut: string | undefined): string {
  return shortcut ? `${title} (${shortcut})` : title
}

/** The four view modes, left to right: [mode, icon, menu label, tooltip, test id]. */
const VIEW_MODES: ReadonlyArray<readonly [ViewMode, React.ReactNode, string, string, string]> = [
  ['editor', <FileEdit key="editor" {...ICON} />, 'Editor only', 'Editor Only', TEST_IDS.VIEW_MODE_BTN_EDITOR],
  [
    'split-horizontal',
    <Rows2 key="split-horizontal" {...ICON} />,
    'Split horizontal',
    'Split Horizontal (Preview Top)',
    TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL
  ],
  [
    'split',
    <Columns2 key="split" {...ICON} />,
    'Split vertical',
    'Split Vertical (Side by Side)',
    TEST_IDS.VIEW_MODE_BTN_SPLIT
  ],
  ['preview', <Eye key="preview" {...ICON} />, 'Preview only', 'Preview Only', TEST_IDS.VIEW_MODE_BTN_PREVIEW]
]

/**
 * Toolbar for the markdown editor panel.
 *
 * Provides controls for:
 * - View mode switching (editor only, split vertical/horizontal, preview only)
 * - Text formatting (bold, italic, strikethrough, code, link, image, heading, lists)
 * - Document export (PDF, DOCX)
 * - File status indicators (modified, auto-saving, reloading)
 * - Search activation
 *
 * @param props - Component props
 * @returns Rendered toolbar element
 *
 * @example Basic usage
 * ```tsx
 * <MarkdownToolbar
 *   viewMode="split"
 *   currentFile={currentFile}
 *   editorRef={editorRef}
 *   isAutoSaving={false}
 *   isReloading={false}
 *   isExportingPdf={false}
 *   isExportingDocx={false}
 *   onViewModeChange={setViewMode}
 *   onExportPdf={handleExportPdf}
 *   onExportDocx={handleExportDocx}
 * />
 * ```
 */
export function MarkdownToolbar({
  viewMode,
  currentFile,
  editorRef,
  isAutoSaving,
  isReloading,
  isExportingPdf,
  isExportingDocx,
  onViewModeChange,
  onExportPdf,
  onExportDocx,
  commentTools = null
}: MarkdownToolbarProps): JSX.Element {
  /**
   * Opens the search overlay with any currently selected text.
   * Uses getSelectedText to check Monaco editor first, then DOM selection.
   */
  const handleOpenSearch = (): void => {
    const selectedText = getSelectedText(editorRef)
    useSearchStore.getState().openSearch(selectedText)
  }

  // Formatting buttons are visible only in editor or vertical split modes;
  // in the other two, Find stands alone at the start.
  const showFormattingButtons = viewMode === 'editor' || viewMode === 'split'

  // Export buttons are disabled in editor-only mode (no preview available)
  const exportDisabled = viewMode === 'editor'

  const formatting: ToolbarAction[] = (showFormattingButtons ? FORMAT_BUTTONS : []).map((button) => {
    const shortcut = button.shortcutKey ? formatShortcut(button.shortcutKey, { mod: true }) : undefined
    return {
      id: button.id,
      icon: button.icon,
      label: button.label,
      title: withShortcut(button.title, shortcut),
      shortcut,
      testId: button.testId,
      separatorBefore: button.separatorBefore,
      className: 'toolbar-btn',
      onSelect: () => {
        const editor = editorRef.current
        if (editor) button.run(editor)
      }
    }
  })

  const findShortcut = formatShortcut('F', { mod: true })
  const find: ToolbarAction = {
    id: 'find',
    icon: <Search {...ICON} />,
    label: 'Find',
    title: withShortcut('Find', findShortcut),
    shortcut: findShortcut,
    testId: TEST_IDS.TOOLBAR_BTN_SEARCH,
    separatorBefore: showFormattingButtons,
    className: 'toolbar-btn',
    onSelect: handleOpenSearch
  }

  // The view modes keep their look (`.active`) and now say which is on in
  // `aria-pressed`; in the menu the current one is a checked item.
  /* deviates: docs/design-system/system/patterns/toolbar-overflow/index.html – rule 7 makes a
     view-mode radio a menuitemradio; the shared ContextMenu has only checkbox items, so the
     current view mode is a checked menuitemcheckbox (and a toggle button in the row). */
  const viewModes: ToolbarAction[] = VIEW_MODES.map(([mode, icon, label, title, testId]) => ({
    id: `view-${mode}`,
    icon,
    label,
    title,
    testId,
    pressed: viewMode === mode,
    className: `view-mode-btn ${viewMode === mode ? 'active' : ''}`,
    onSelect: () => onViewModeChange(mode)
  }))

  const exports: ToolbarAction[] = [
    {
      id: 'export-pdf',
      icon: <FileDown {...ICON} />,
      label: 'Export to PDF',
      title: exportDisabled ? `Export to PDF (${EXPORT_DISABLED_REASON})` : 'Export to PDF',
      reason: exportDisabled ? capitalise(EXPORT_DISABLED_REASON) : undefined,
      disabled: !currentFile || isExportingPdf || exportDisabled,
      onSelect: onExportPdf,
      className: 'toolbar-btn',
      testId: TEST_IDS.TOOLBAR_BTN_EXPORT_PDF,
      separatorBefore: true
    },
    {
      id: 'export-docx',
      icon: <FileText {...ICON} />,
      label: 'Export to Word',
      title: exportDisabled ? `Export to Word (${EXPORT_DISABLED_REASON})` : 'Export to Word',
      reason: exportDisabled ? capitalise(EXPORT_DISABLED_REASON) : undefined,
      disabled: !currentFile || isExportingDocx || exportDisabled,
      onSelect: onExportDocx,
      className: 'toolbar-btn',
      testId: TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX
    }
  ]

  const entries: ToolbarEntry[] = [
    ...formatting,
    find,
    /* deviates: docs/design-system/system/patterns/toolbar-overflow/index.html – rule 4 pins
       nothing; the comment tools are a component of their own (two stateful buttons with a
       count and a drawer), not one action, so they stay in the row and the buttons around
       them give way. */
    ...(commentTools !== null && commentTools !== undefined && commentTools !== false
      ? [{ kind: 'pinned' as const, id: 'comment-tools', content: commentTools }]
      : []),
    { kind: 'spacer', id: 'spacer', className: 'toolbar-spacer' },
    /*
      File status indicators.

      The modified bullet sits OUTSIDE the live region below, on purpose: it
      is a persistent state, not news, and inside the region every
      clean -> dirty transition made a screen reader announce a bullet glyph.
      `aria-hidden` because the tab title already carries "modified" in words
      (QG-11a).
    */
    ...(currentFile?.modified
      ? [
          {
            kind: 'pinned' as const,
            id: 'modified',
            content: (
              <span className="modified-indicator" aria-hidden="true" data-testid={TEST_IDS.MODIFIED_INDICATOR}>
                ●
              </span>
            )
          }
        ]
      : []),
    /*
      The live region is PERMANENTLY mounted (pinned, so it never moves into the
      menu): one that enters the DOM at the same moment its text appears is not
      announced (WCAG 2.2 4.1.3). The inner spans stay conditional, so every
      existing testid assertion keeps its meaning. Issue #70 / finding UX-1.
    */
    {
      kind: 'pinned',
      id: 'status',
      content: (
        <span className="file-status-slot" role="status" aria-live="polite">
          {isAutoSaving && (
            <span className="file-status-indicator" data-testid={TEST_IDS.AUTOSAVE_INDICATOR}>
              Auto-saving...
            </span>
          )}
          {isReloading && (
            <span className="file-status-indicator" data-testid={TEST_IDS.RELOAD_INDICATOR}>
              Reloaded from disk
            </span>
          )}
        </span>
      )
    },
    ...viewModes,
    ...exports
  ]

  return (
    <ToolbarOverflow
      className="markdown-toolbar"
      toolbarLabel={TOOLBAR_LABEL}
      testId={TEST_IDS.MARKDOWN_TOOLBAR}
      actions={entries}
      buttonClassName="toolbar-btn"
      separatorClassName="toolbar-separator"
      menuLabel={MENU_LABEL}
    />
  )
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
