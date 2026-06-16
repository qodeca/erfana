// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useRef, useImperativeHandle, forwardRef } from 'react'
import Editor, { OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useSearchStore } from '../../stores/useSearchStore'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import { registerClipboardActions } from '../../utils/monacoClipboardCommands'
import './MonacoMarkdownEditor.css'

// Configure Monaco to use local files instead of CDN
// This prevents CSP violations in Electron
loader.config({ monaco })

/**
 * Context menu event payload for editor right-click handling.
 */
export interface EditorContextMenuEvent {
  /** X coordinate of the click in viewport pixels */
  x: number
  /** Y coordinate of the click in viewport pixels */
  y: number
  /** The selected text content */
  selectedText: string
  /** 1-based line number where selection starts */
  startLine: number
  /** 1-based line number where selection ends */
  endLine: number
}

interface MonacoMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  filePath?: string
  onSelectionChange?: (selection: string) => void
  onEditorMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void
  /** Callback when user right-clicks with a text selection */
  onContextMenu?: (event: EditorContextMenuEvent) => void
}

export interface MonacoEditorHandle {
  // Formatting methods
  formatBold: () => void
  formatItalic: () => void
  formatStrikethrough: () => void
  formatCode: () => void
  formatCodeBlock: () => void
  insertLink: () => void
  insertImage: () => void
  insertHeading: (level: number) => void
  insertList: (ordered: boolean) => void

  // Direct editor access for advanced operations
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null

  /**
   * Access the Monaco namespace captured at mount.
   * Lets non-editor code (e.g. the context-menu hook) build clipboard deps
   * without importing `monaco-editor` as a value (which doesn't resolve in the
   * renderer test env). Returns null before the editor has mounted.
   */
  getMonaco: () => typeof monaco | null

  // Scroll synchronization methods
  getScrollTop: () => number
  setScrollTop: (offset: number) => void
  getTopForLineNumber: (line: number) => number

  /**
   * Set cursor position and reveal line in center of editor.
   * Used by terminal file links to open files at specific locations.
   * @param line 1-based line number
   * @param column 1-based column (default: 1)
   */
  setPositionAndReveal: (line: number, column?: number) => void
}

export const MonacoMarkdownEditor = forwardRef<MonacoEditorHandle, MonacoMarkdownEditorProps>(
  ({ value, onChange, filePath, onSelectionChange, onEditorMount, onContextMenu }, ref) => {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const monacoRef = useRef<typeof monaco | null>(null)

    // Debug logging
    logger.debug('MonacoMarkdownEditor render', {
      valueLength: value?.length,
      filePath,
      hasValue: !!value
    })

    const handleEditorDidMount: OnMount = (editor, monaco) => {
      logger.debug('Monaco mounted, setting value', { valuePreview: value?.substring(0, 50) })
      editorRef.current = editor
      monacoRef.current = monaco

      // Configure markdown-specific options
      editor.updateOptions({
        wordWrap: 'on',
        wrappingIndent: 'same',
        lineNumbers: 'on',
        minimap: { enabled: false }, // Disabled per user request
        fontSize: 13, // Reduced from 14 for more compact view
        lineHeight: 20, // Reduced from 24 for tighter line spacing
        padding: { top: 8, bottom: 8 }, // Reduced from 16 for less padding
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        rulers: [], // Removed vertical ruler lines
        bracketPairColorization: { enabled: true },
        contextmenu: false, // Disable Monaco's built-in context menu (use our custom EditorContextMenu)
        occurrencesHighlight: 'off' // Disable word highlighting on click
      })

      // Handle selection changes
      editor.onDidChangeCursorSelection((e) => {
        const selection = editor.getModel()?.getValueInRange(e.selection)
        if (selection && onSelectionChange) {
          onSelectionChange(selection)
        }
      })

      // Add markdown-specific keybindings
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
        wrapSelection('**')
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
        wrapSelection('*')
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        insertLink()
      })

      // Override Cmd/Ctrl+F to prevent Monaco's built-in search
      // Let window-level capture handler (useSearchKeyboard) take over
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
        // No-op - let window-level capture handler take over
      })

      // Override Cmd/Ctrl+G (find next) to use our search
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
        useSearchStore.getState().nextMatch()
      })

      // Override Cmd/Ctrl+Shift+G (find previous)
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG,
        () => {
          useSearchStore.getState().previousMatch()
        }
      )

      // Route Cmd/Ctrl+C/X/V through the central clipboard service (fixes the
      // browser-clipboard NotAllowedError). See registerClipboardActions for
      // why addAction is used (chord ownership + built-in suppression) and why
      // no contextMenu group/order is set.
      registerClipboardActions(editor, monaco)

      // Handle right-click context menu (always show our menu for Paste support)
      editor.onContextMenu((e: monaco.editor.IEditorMouseEvent) => {
        // Prevent Monaco's default context menu (disabled, but belt-and-suspenders)
        e.event.preventDefault()
        e.event.stopPropagation()

        const model = editor.getModel()
        if (!model) return

        const selection = editor.getSelection()
        const hasSelection = selection && !selection.isEmpty()
        const selectedText = hasSelection ? model.getValueInRange(selection) : ''

        // Get cursor position for context (used even without selection)
        const position = editor.getPosition()
        const cursorLine = position?.lineNumber ?? 1

        // Notify parent component
        if (onContextMenu) {
          onContextMenu({
            x: e.event.posx,
            y: e.event.posy,
            selectedText,
            startLine: hasSelection ? selection!.startLineNumber : cursorLine,
            endLine: hasSelection ? selection!.endLineNumber : cursorLine
          })
        }
      })

      // Notify parent component that editor is mounted and ready
      if (onEditorMount) {
        onEditorMount(editor)
      }
    }

    const wrapSelection = (wrapper: string) => {
      const editor = editorRef.current
      if (!editor) return

      const selection = editor.getSelection()
      if (!selection) return

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      const wrappedText = `${wrapper}${selectedText}${wrapper}`

      editor.executeEdits('', [
        {
          range: selection,
          text: wrappedText
        }
      ])

      // Update selection to be inside the wrapper
      editor.setSelection({
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn + wrapper.length,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn + wrapper.length
      })
    }

    const insertLink = () => {
      const editor = editorRef.current
      if (!editor) return

      const selection = editor.getSelection()
      if (!selection) return

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      const linkText = selectedText || 'link text'
      const markdown = `[${linkText}](url)`

      editor.executeEdits('', [
        {
          range: selection,
          text: markdown
        }
      ])
    }

    const formatBold = () => wrapSelection('**')
    const formatItalic = () => wrapSelection('*')
    const formatStrikethrough = () => wrapSelection('~~')
    const formatCode = () => wrapSelection('`')

    const formatCodeBlock = () => {
      const editor = editorRef.current
      if (!editor) return

      const selection = editor.getSelection()
      if (!selection) return

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      const markdown = `\n\`\`\`\n${selectedText}\n\`\`\`\n`

      editor.executeEdits('', [
        {
          range: selection,
          text: markdown
        }
      ])
    }

    const insertImage = () => {
      const editor = editorRef.current
      if (!editor) return

      const selection = editor.getSelection()
      if (!selection) return

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      const altText = selectedText || 'image'
      const markdown = `![${altText}](url)`

      editor.executeEdits('', [
        {
          range: selection,
          text: markdown
        }
      ])
    }

    const insertHeading = (level: number) => {
      const editor = editorRef.current
      if (!editor) return

      const selection = editor.getSelection()
      if (!selection) return

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      const headingText = selectedText || 'Heading'
      const markdown = `${'#'.repeat(level)} ${headingText}`

      editor.executeEdits('', [
        {
          range: selection,
          text: markdown
        }
      ])
    }

    const insertList = (ordered: boolean) => {
      const editor = editorRef.current
      if (!editor) return

      const selection = editor.getSelection()
      if (!selection) return

      const model = editor.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(selection)
      const lines = selectedText ? selectedText.split('\n') : ['List item']
      const markdown = lines
        .map((line, i) => (ordered ? `${i + 1}. ${line}` : `- ${line}`))
        .join('\n')

      editor.executeEdits('', [
        {
          range: selection,
          text: markdown
        }
      ])
    }

    // Scroll synchronization methods
    const getScrollTop = (): number => {
      const editor = editorRef.current
      if (!editor) return 0
      return editor.getScrollTop()
    }

    const setScrollTop = (offset: number): void => {
      const editor = editorRef.current
      if (!editor) return
      editor.setScrollTop(offset)
    }

    const getTopForLineNumber = (line: number): number => {
      const editor = editorRef.current
      if (!editor) return 0
      return editor.getTopForLineNumber(line)
    }

    const setPositionAndReveal = (line: number, column: number = 1): void => {
      const editor = editorRef.current
      if (!editor) return

      // Ensure line and column are valid (1-based)
      const model = editor.getModel()
      if (!model) return

      const lineCount = model.getLineCount()
      const safeLine = Math.max(1, Math.min(line, lineCount))
      const lineContent = model.getLineContent(safeLine)
      const safeColumn = Math.max(1, Math.min(column, lineContent.length + 1))

      // Set cursor position
      editor.setPosition({ lineNumber: safeLine, column: safeColumn })

      // Reveal line in center of viewport
      editor.revealLineInCenter(safeLine)

      // Focus the editor
      editor.focus()
    }

    const getEditor = (): monaco.editor.IStandaloneCodeEditor | null => {
      return editorRef.current
    }

    const getMonaco = (): typeof monaco | null => {
      return monacoRef.current
    }

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      // Formatting methods
      formatBold,
      formatItalic,
      formatStrikethrough,
      formatCode,
      formatCodeBlock,
      insertLink,
      insertImage,
      insertHeading,
      insertList,

      // Direct editor access
      getEditor,
      getMonaco,

      // Scroll synchronization methods
      getScrollTop,
      setScrollTop,
      getTopForLineNumber,
      setPositionAndReveal
    }))

    return (
      <div className="monaco-markdown-editor" data-testid={TEST_IDS.EDITOR_MONACO}>
        <Editor
          height="100%"
          language="markdown"
          theme="vs-dark"
          value={value}
          onChange={(value) => onChange(value || '')}
          onMount={handleEditorDidMount}
          options={{
            automaticLayout: true
          }}
        />
      </div>
    )
  }
)

// Add display name for React DevTools
MonacoMarkdownEditor.displayName = 'MonacoMarkdownEditor'
