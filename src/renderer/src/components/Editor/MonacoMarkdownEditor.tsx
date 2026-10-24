// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useRef, useImperativeHandle, forwardRef, useLayoutEffect } from 'react'
import Editor, { OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useSearchStore } from '../../stores/useSearchStore'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import { registerTestEditor } from '../../testHooks/editorTestHook'
import { registerClipboardActions } from '../../utils/monacoClipboardCommands'
import { getMonacoLanguage } from '../../utils/monacoLanguage'
import { disableWorkerLanguageServices } from '../../utils/monacoLanguageServices'
import { createEditorValueSync, type EditorValueSync } from '../../utils/monacoValueSync'
import { isKeyboardMenuEcho, markKeyboardMenuOpen } from '../ContextMenu/contextMenuKey'
import './MonacoMarkdownEditor.css'

// Configure Monaco to use local files instead of CDN
// This prevents CSP violations in Electron
loader.config({ monaco })

// Opening a `.html`/`.css`/`.ts` file switches the model language (item 75), which
// would otherwise spin up worker-backed language services that cannot be
// constructed in this bundle (no MonacoEnvironment). Turn them off once, here,
// leaving the main-thread tokenizer (syntax highlighting) intact. Idempotent.
disableWorkerLanguageServices(monaco)

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
  /**
   * The document text as React holds it.
   *
   * The editor is uncontrolled: it mounts with this text and afterwards owns
   * its buffer. A new `value` is written into the buffer only when it is an
   * outside change (reload from disk, conflict "Reload") – never when it is
   * the editor's own `onChange` echo, even an echo that is behind the buffer.
   * See `utils/monacoValueSync.ts`.
   */
  value: string
  /** Called with the full buffer text after every user edit (not after an outside change) */
  onChange: (value: string) => void
  /**
   * Path of the open file. Picks the language, and a different path mounts a
   * fresh editor model, so undo can never step back into another file.
   */
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
    // Sync state of the mounted editor (null until mount); see monacoValueSync
    const valueSyncRef = useRef<EditorValueSync | null>(null)
    // The file the mounted editor was created for. A path change remounts the
    // inner <Editor>; until the new one mounts, the old one must not be synced.
    const mountedPathRef = useRef<string | undefined>(undefined)
    // Latest props for listeners registered once at mount. @monaco-editor/react
    // also keeps only the first `onMount`, so anything it closes over is stale.
    const latestRef = useRef({ value, onChange, filePath, onSelectionChange, onEditorMount, onContextMenu })

    useLayoutEffect(() => {
      latestRef.current = { value, onChange, filePath, onSelectionChange, onEditorMount, onContextMenu }
    })

    // A new path remounts the inner <Editor> (see its `key`), whose cleanup
    // disposes the old editor only later, in the passive phase. Drop it now:
    // a disposed editor reads as an empty document, and a save in that gap
    // would write '' instead of falling back to the React copy of the text.
    useLayoutEffect(() => {
      if (editorRef.current && mountedPathRef.current !== filePath) {
        editorRef.current = null
        valueSyncRef.current = null
      }
    }, [filePath])

    // Outside changes. A layout effect, not a passive one: it runs inside the
    // commit, so no keystroke can arrive between React rendering `value` and
    // this check. The echo test in reconcile() covers the other direction – a
    // keystroke that reached Monaco before React rendered the previous one.
    useLayoutEffect(() => {
      const editor = editorRef.current
      const sync = valueSyncRef.current
      // The path is only a guard (read from latestRef, refreshed by the effect
      // above in this same commit): a path change remounts the editor, and the
      // new one starts from `defaultValue`.
      if (!editor || !sync || mountedPathRef.current !== latestRef.current.filePath) return
      const result = sync.reconcile(editor, value)
      if (result === 'applied') {
        logger.debug('MonacoMarkdownEditor applied an outside change', { valueLength: value.length })
      }
    }, [value])

    // Every commit, after the effect above: once React shows exactly what the
    // buffer holds, forget the remembered emits (see EditorValueSync.confirm –
    // edits that cancel out never change `value`, so the effect above alone
    // would keep them).
    useLayoutEffect(() => {
      const editor = editorRef.current
      const sync = valueSyncRef.current
      if (!editor || !sync || mountedPathRef.current !== latestRef.current.filePath) return
      sync.confirm(editor, latestRef.current.value)
    })

    // Debug logging
    logger.debug('MonacoMarkdownEditor render', {
      valueLength: value?.length,
      filePath,
      hasValue: !!value
    })

    const handleEditorDidMount: OnMount = (editor, monaco) => {
      logger.debug('Monaco mounted', { valueLength: latestRef.current.value.length })
      editorRef.current = editor
      monacoRef.current = monaco
      // E2E only: a no-op unless the launcher switched the test hooks on.
      // Forgets the editor itself when the editor is disposed.
      registerTestEditor(editor)

      // The model was created from `defaultValue` when Monaco finished
      // loading, which can be a few renders before this callback: start from
      // the latest text, with no undo entry and no `onChange`.
      const sync = createEditorValueSync()
      valueSyncRef.current = sync
      mountedPathRef.current = latestRef.current.filePath
      sync.resetTo(editor, latestRef.current.value)

      // Our own listener rather than the wrapper's `onChange` prop: it has to
      // stay silent while an outside change is being written, or a reload from
      // disk would mark the file modified and re-arm autosave. Disposed along
      // with the editor.
      editor.onDidChangeModelContent(() => {
        // `editorRef.current !== editor`: after a path change this editor is
        // already detached (see the [filePath] effect) but not yet disposed;
        // anything it reports must not land in the next file's state.
        if (sync.isApplying() || editorRef.current !== editor) return
        const text = editor.getValue()
        sync.recordEmit(text)
        latestRef.current.onChange(text)
      })

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
        const notify = latestRef.current.onSelectionChange
        if (selection && notify) {
          notify(selection)
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

      // One path for both ways in: the pointer (at the pointer) and the
      // keyboard (under the caret).
      const openMenuAt = (x: number, y: number): void => {
        const model = editor.getModel()
        if (!model) return

        const selection = editor.getSelection()
        const hasSelection = selection && !selection.isEmpty()
        const selectedText = hasSelection ? model.getValueInRange(selection) : ''

        // Get cursor position for context (used even without selection)
        const position = editor.getPosition()
        const cursorLine = position?.lineNumber ?? 1

        // Notify parent component
        const notify = latestRef.current.onContextMenu
        if (notify) {
          notify({
            x,
            y,
            selectedText,
            startLine: hasSelection ? selection!.startLineNumber : cursorLine,
            endLine: hasSelection ? selection!.endLineNumber : cursorLine
          })
        }
      }

      // Handle right-click context menu (always show our menu for Paste support)
      editor.onContextMenu((e: monaco.editor.IEditorMouseEvent) => {
        // Prevent Monaco's default context menu (disabled, but belt-and-suspenders)
        e.event.preventDefault()
        e.event.stopPropagation()
        // Windows also turns the Menu key into a native contextmenu after the
        // keybinding below already opened the menu under the caret (#90).
        if (isKeyboardMenuEcho()) return
        openMenuAt(e.event.posx, e.event.posy)
      })

      // Shift+F10 and the Menu key open the same menu under the caret (#90).
      // With `contextmenu: false` Monaco's own Shift+F10 action shows nothing,
      // so this action replaces it rather than competes with it.
      //
      // `addAction`, NOT `addCommand`: in standalone Monaco `addCommand`
      // registers a keybinding for EVERY editor (no editor-id condition), so
      // with two editors open the last-mounted one would answer the key, act
      // on a hidden file, and go dead when that editor closes. An action is
      // scoped to its editor and disposed with it.
      /* deviates: design/system/components/menu/index.html — no aria-haspopup /
         aria-expanded on the opener: Monaco owns its input textarea and its
         ARIA. See the card's Exceptions. */
      editor.addAction({
        id: 'erfana.openContextMenu',
        label: 'Open context menu',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F10, monaco.KeyCode.ContextMenu],
        run: () => {
          const position = editor.getPosition()
          const caret = position ? editor.getScrolledVisiblePosition(position) : null
          const host = editor.getDomNode()?.getBoundingClientRect()
          if (!host) return
          markKeyboardMenuOpen()
          openMenuAt(
            host.left + (caret?.left ?? 0),
            host.top + (caret ? caret.top + caret.height : 0)
          )
        }
      })

      // Notify parent component that editor is mounted and ready
      latestRef.current.onEditorMount?.(editor)
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
          // One editor (and model) per file: a different file never inherits
          // this one's undo history or pending emits.
          key={filePath ?? ''}
          height="100%"
          // Markdown stays markdown; a `.html`/`.css`/`.ts`/… file gets its own
          // Monarch tokenizer (item 75). Unknown/absent extensions fall back to
          // 'markdown', so existing `.md` behaviour is unchanged.
          language={getMonacoLanguage(filePath ?? '')}
          theme="vs-dark"
          // Uncontrolled on purpose – never `value=`. The wrapper's controlled
          // sync replaces the whole buffer from a passive effect, and a
          // keystroke landing before that effect was lost (typed characters
          // dropped under load). Outside changes go through the layout effect
          // above instead.
          defaultValue={value}
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
