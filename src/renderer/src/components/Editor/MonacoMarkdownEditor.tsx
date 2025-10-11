import { useRef, useImperativeHandle, forwardRef } from 'react'
import Editor, { OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import './MonacoMarkdownEditor.css'

// Configure Monaco to use local files instead of CDN
// This prevents CSP violations in Electron
loader.config({ monaco })

interface MonacoMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  filePath?: string
  onSelectionChange?: (selection: string) => void
}

export interface MonacoEditorHandle {
  formatBold: () => void
  formatItalic: () => void
  formatStrikethrough: () => void
  formatCode: () => void
  formatCodeBlock: () => void
  insertLink: () => void
  insertImage: () => void
  insertHeading: (level: number) => void
  insertList: (ordered: boolean) => void
}

export const MonacoMarkdownEditor = forwardRef<MonacoEditorHandle, MonacoMarkdownEditorProps>(
  ({ value, onChange, filePath, onSelectionChange }, ref) => {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

    // Debug logging
    console.log('MonacoMarkdownEditor render:', {
      valueLength: value?.length,
      filePath,
      hasValue: !!value
    })

    const handleEditorDidMount: OnMount = (editor, monaco) => {
      console.log('Monaco mounted, setting value:', value?.substring(0, 50))
      editorRef.current = editor

      // Configure markdown-specific options
      editor.updateOptions({
        wordWrap: 'on',
        wrappingIndent: 'same',
        lineNumbers: 'on',
        minimap: { enabled: true },
        fontSize: 14,
        lineHeight: 24,
        padding: { top: 16, bottom: 16 },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        rulers: [80, 120],
        bracketPairColorization: { enabled: true }
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

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      formatBold,
      formatItalic,
      formatStrikethrough,
      formatCode,
      formatCodeBlock,
      insertLink,
      insertImage,
      insertHeading,
      insertList
    }))

    return (
      <div className="monaco-markdown-editor">
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
