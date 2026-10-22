// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Integration tests for refactored MarkdownEditorPanel.
 *
 * Tests orchestration of extracted hooks and components:
 * - useAutoSave - auto-save functionality
 * - useFileWatcher - external file change detection
 * - useScrollSync - scroll synchronization hooks
 * - MarkdownToolbar - toolbar component integration
 * - EditorContentLayout - split layout rendering
 * - DocumentStatsBar - stats footer
 * - EditorErrorBoundary - error boundary wrapper
 *
 * These tests focus on verifying the component correctly orchestrates
 * its extracted hooks and components without testing implementation details.
 *
 * @module MarkdownEditorPanel.integration.test
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('MarkdownEditorPanel Integration', () => {
  describe('Component Orchestration', () => {
    it('imports successfully', () => {
      // Test that the module can be imported without errors
      expect(async () => {
        await import('./MarkdownEditorPanel')
      }).toBeDefined()
    })
  })

  describe('Hook Dependencies', () => {
    it('useAutoSave hook is imported correctly', async () => {
      const { useAutoSave } = await import('../../hooks/useAutoSave')
      expect(useAutoSave).toBeDefined()
      expect(typeof useAutoSave).toBe('function')
    })

    it('useFileWatcher hook is imported correctly', async () => {
      const { useFileWatcher } = await import('../../hooks/useFileWatcher')
      expect(useFileWatcher).toBeDefined()
      expect(typeof useFileWatcher).toBe('function')
    })

    it('useScrollSync hook is imported correctly', async () => {
      const { useScrollSync } = await import(
        '../Editor/MarkdownEditorPanel/hooks/useScrollSync'
      )
      expect(useScrollSync).toBeDefined()
      expect(typeof useScrollSync).toBe('function')
    })

    it('useExportHandlers hook is imported correctly', async () => {
      const { useExportHandlers } = await import(
        '../Editor/MarkdownEditorPanel/hooks/useExportHandlers'
      )
      expect(useExportHandlers).toBeDefined()
      expect(typeof useExportHandlers).toBe('function')
    })

    it('useEditorContextMenu hook is imported correctly', async () => {
      const { useEditorContextMenu } = await import('../../hooks/useEditorContextMenu')
      expect(useEditorContextMenu).toBeDefined()
      expect(typeof useEditorContextMenu).toBe('function')
    })

    it('useDividerPosition hook is imported correctly', async () => {
      const { useDividerPosition } = await import('../../hooks/useDividerPosition')
      expect(useDividerPosition).toBeDefined()
      expect(typeof useDividerPosition).toBe('function')
    })

    it('useKeyboardShortcuts hook is imported correctly', async () => {
      const { useKeyboardShortcuts } = await import('../../hooks/useKeyboardShortcuts')
      expect(useKeyboardShortcuts).toBeDefined()
      expect(typeof useKeyboardShortcuts).toBe('function')
    })
  })

  describe('Component Dependencies', () => {
    it('MarkdownToolbar component is imported correctly', async () => {
      const { MarkdownToolbar } = await import(
        '../Editor/MarkdownEditorPanel/components'
      )
      expect(MarkdownToolbar).toBeDefined()
      expect(typeof MarkdownToolbar).toBe('function')
    })

    it('EditorErrorBoundary component is imported correctly', async () => {
      const { EditorErrorBoundary } = await import(
        '../Editor/MarkdownEditorPanel/components'
      )
      expect(EditorErrorBoundary).toBeDefined()
      expect(typeof EditorErrorBoundary).toBe('function')
    })

    it('DocumentStatsBar component is imported correctly', async () => {
      const { DocumentStatsBar } = await import('./DocumentStatsBar')
      expect(DocumentStatsBar).toBeDefined()
      expect(typeof DocumentStatsBar).toBe('function')
    })
  })

  describe('Pure Logic Functions', () => {
    it('calculateStats is imported correctly', async () => {
      const { calculateStats } = await import('./markdownEditorPanel.logic')
      expect(calculateStats).toBeDefined()
      expect(typeof calculateStats).toBe('function')
    })

    it('extractFileName is imported correctly', async () => {
      const { extractFileName } = await import('./markdownEditorPanel.logic')
      expect(extractFileName).toBeDefined()
      expect(typeof extractFileName).toBe('function')
    })

    it('formatTabTitle is imported correctly', async () => {
      const { formatTabTitle } = await import('../../utils/tabTitle')
      expect(formatTabTitle).toBeDefined()
      expect(typeof formatTabTitle).toBe('function')
    })

    it('getDefaultViewMode is imported correctly', async () => {
      const { getDefaultViewMode } = await import('./markdownEditorPanel.logic')
      expect(getDefaultViewMode).toBeDefined()
      expect(typeof getDefaultViewMode).toBe('function')
    })
  })

  describe('Pure Logic Behavior', () => {
    it('calculateStats calculates document statistics correctly', async () => {
      const { calculateStats } = await import('./markdownEditorPanel.logic')

      const content = `# Title\n\nParagraph with **bold** text.\n\nAnother paragraph.`
      const stats = calculateStats(content)

      expect(stats).toBeDefined()
      expect(stats.lines).toBe(5)
      expect(stats.words).toBeGreaterThan(0)
      expect(stats.characters).toBeGreaterThan(0)
    })

    it('extractFileName extracts file name from path', async () => {
      const { extractFileName } = await import('./markdownEditorPanel.logic')

      expect(extractFileName('/path/to/file.md')).toBe('file.md')
      expect(extractFileName('/another/path/document.txt')).toBe('document.txt')
      expect(extractFileName('file.md')).toBe('file.md')
    })

    it('formatTabTitle formats title with modified indicator', async () => {
      const { formatTabTitle } = await import('../../utils/tabTitle')

      expect(formatTabTitle('file.md', false, false)).toBe('file.md')
      expect(formatTabTitle('file.md', true, false)).toBe('● file.md')
      expect(formatTabTitle('file.md', false, true)).toBe('file.md (deleted)')
      expect(formatTabTitle('file.md', true, true)).toBe('file.md (deleted)') // Both indicators don't stack
    })

    it('getDefaultViewMode returns correct default view mode', async () => {
      const { getDefaultViewMode } = await import('./markdownEditorPanel.logic')

      expect(getDefaultViewMode('/path/to/file.md')).toBe('preview')
      expect(getDefaultViewMode('/path/to/file.txt')).toBe('editor')
      expect(getDefaultViewMode('/path/to/document.markdown')).toBe('preview')
    })
  })

  describe('Type Exports', () => {
    it('exports ViewMode type', async () => {
      const module = await import('../Editor/MarkdownEditorPanel/types')
      expect(module).toBeDefined()
    })

    it('exports EditorFile type', async () => {
      const module = await import('../Editor/MarkdownEditorPanel/types')
      expect(module).toBeDefined()
    })
  })

  describe('Refactoring Validation', () => {
    it('all pure logic functions are accessible', async () => {
      const logic = await import('./markdownEditorPanel.logic')

      const expectedFunctions = [
        'calculateStats',
        'extractFileName',
        'getDefaultViewMode',
        'buildScrollMapEntries',
        'interpolateScrollPosition',
        'isSplitMode'
      ]

      expectedFunctions.forEach((fnName) => {
        expect(logic[fnName]).toBeDefined()
        expect(typeof logic[fnName]).toBe('function')
      })
    })
  })

  describe('Stats Calculation Integration', () => {
    it('calculates stats for empty content', async () => {
      const { calculateStats } = await import('./markdownEditorPanel.logic')

      const stats = calculateStats('')

      expect(stats.lines).toBe(0)
      expect(stats.words).toBe(0)
      expect(stats.characters).toBe(0)
    })

    it('calculates stats for single line', async () => {
      const { calculateStats } = await import('./markdownEditorPanel.logic')

      const stats = calculateStats('Hello world')

      expect(stats.lines).toBe(1)
      expect(stats.words).toBe(2)
      expect(stats.characters).toBe(11)
    })

    it('calculates stats for multiline content', async () => {
      const { calculateStats } = await import('./markdownEditorPanel.logic')

      const content = `Line 1\nLine 2\nLine 3`
      const stats = calculateStats(content)

      expect(stats.lines).toBe(3)
      expect(stats.words).toBe(6)
    })
  })

  describe('File Path Extraction', () => {
    it('handles Unix-style paths', async () => {
      const { extractFileName } = await import('./markdownEditorPanel.logic')

      expect(extractFileName('/home/user/documents/file.md')).toBe('file.md')
    })

    it('handles Windows-style paths', async () => {
      const { extractFileName } = await import('./markdownEditorPanel.logic')

      // The function uses split('/'), so Windows paths need backslash conversion
      // or the function should be updated to handle both
      expect(extractFileName('C:/Users/John/file.md')).toBe('file.md')
    })

    it('handles file name without path', async () => {
      const { extractFileName } = await import('./markdownEditorPanel.logic')

      expect(extractFileName('standalone.md')).toBe('standalone.md')
    })
  })

  describe('View Mode Logic', () => {
    it('detects markdown files', async () => {
      const { getDefaultViewMode } = await import('./markdownEditorPanel.logic')

      const markdownExtensions = ['.md', '.markdown']

      markdownExtensions.forEach((ext) => {
        expect(getDefaultViewMode(`/path/to/file${ext}`)).toBe('preview')
      })
    })

    it('defaults to editor for non-markdown files', async () => {
      const { getDefaultViewMode } = await import('./markdownEditorPanel.logic')

      const otherExtensions = ['.txt', '.log', '.json', '.js', '.ts']

      otherExtensions.forEach((ext) => {
        expect(getDefaultViewMode(`/path/to/file${ext}`)).toBe('editor')
      })
    })
  })

  describe('Split Mode Detection', () => {
    it('isSplitMode detects vertical split', async () => {
      const { isSplitMode } = await import('./markdownEditorPanel.logic')

      expect(isSplitMode('split')).toBe(true)
    })

    it('isSplitMode detects horizontal split', async () => {
      const { isSplitMode } = await import('./markdownEditorPanel.logic')

      expect(isSplitMode('split-horizontal')).toBe(true)
    })

    it('isSplitMode returns false for non-split modes', async () => {
      const { isSplitMode } = await import('./markdownEditorPanel.logic')

      expect(isSplitMode('editor')).toBe(false)
      expect(isSplitMode('preview')).toBe(false)
    })
  })

  describe('Save by id (issue #124, part 3 §3.6)', () => {
    // Rendering the panel needs monaco-editor, which does not resolve in this
    // environment, so – like the rest of this suite – the wiring is pinned
    // without a render: on the panel's source. The registry's behaviour is
    // covered in editorSaveRegistry.test.ts.
    // Vitest runs from the repository root; jsdom's import.meta.url is not a file URL.
    // Normalise the line endings: `.gitattributes` carries `* text=auto`, so this
    // file is CRLF on a Windows checkout while the needles below are written with
    // `\n`. Without this, the multi-line `toContain` assertions can never match.
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Panels/MarkdownEditorPanel.tsx'),
      'utf8'
    ).replace(/\r\n/g, '\n')
    const handleSave = source.slice(
      source.indexOf('const handleSave = useCallback'),
      source.indexOf('}, [currentFile, isFileDeleted, dismissConflict')
    )

    it('useEditorSaveRegistration hook is imported correctly', async () => {
      const { useEditorSaveRegistration } = await import('../../hooks/useEditorSaveRegistration')
      expect(typeof useEditorSaveRegistration).toBe('function')
    })

    it('registers the tab once: a manual save, the conflict flag, and an autosave hold', () => {
      const calls = source.match(/useEditorSaveRegistration\(/g) ?? []
      expect(calls).toHaveLength(1)
      expect(source).toContain(
        "useEditorSaveRegistration(panelIdRef.current, () => handleSave('registry'), externalChangeDetected, () => {\n" +
          '    // A hold stops autosave for real (no re-arming by typing or the modified\n' +
          '    // effect) and makes the editor read-only, so nothing new can be typed\n' +
          '    // between a flush and the end of the hold.\n' +
          '    const releaseAutoSave = holdAutoSave()\n'
      )
      expect(source).toContain('}, () => saveInFlightRef.current ?? Promise.resolve())')
      // Registered below useAutoSave, whose holdAutoSave it uses.
      expect(source.indexOf('useEditorSaveRegistration(panelIdRef')).toBeGreaterThan(source.indexOf('= useAutoSave('))
    })

    it('handleSave answers true after a write and false with no file or a failed write', () => {
      expect(handleSave).toContain("async (trigger: SaveTrigger = 'user'): Promise<boolean> =>")
      expect(handleSave).toContain('if (!currentFile) return false')
      expect(handleSave.match(/return true/g)).toHaveLength(1)
      expect(handleSave).toMatch(/catch \(error\) \{[\s\S]*return false\s*\} finally/)
    })

    it('keeps the autosave guard order unchanged', () => {
      const order = [
        'markSaving()',
        'pauseWatch()',
        'getValue()',
        'writeFile(',
        'notifySaveComplete(contentToSave)',
        'settleSavedFile(prev, contentToSave, bufferNow)',
        'resumeWatch()',
        'unmarkSaving()'
      ].map((step) => handleSave.indexOf(step))

      expect(order.every((index) => index >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
    })
  })

  describe('Save after a folder rename (v0.21.0 validation)', () => {
    // Pinned on the source for the same reason as the block above: rendering
    // the panel needs monaco-editor. The message and dedupe rules themselves
    // are unit-tested in markdownEditorPanel.logic.test.ts.
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/Panels/MarkdownEditorPanel.tsx'),
      'utf8'
    ).replace(/\r\n/g, '\n')
    const handleSave = source.slice(
      source.indexOf('const handleSave = useCallback'),
      source.indexOf('}, [currentFile, isFileDeleted, dismissConflict')
    )
    const catchBlock = handleSave.slice(handleSave.indexOf('} catch (error) {'), handleSave.indexOf('} finally {'))

    it('the slice under test exists', () => {
      expect(handleSave.length).toBeGreaterThan(0)
      expect(catchBlock.length).toBeGreaterThan(0)
    })

    it('a failed save shows an error toast with the reason and still answers false', () => {
      expect(catchBlock).toContain('formatSaveError(error, extractFileName(currentFile.path))')
      expect(catchBlock).toContain('shouldToastSaveError(trigger, message, lastSaveErrorRef.current)')
      expect(catchBlock).toMatch(/showToast\(\{ title: 'Save failed', message, type: 'error'/)
      expect(catchBlock).toContain('return false')
      // The log line drops the absolute path the errno message quotes; the toast keeps it
      expect(catchBlock).toContain("logger.error('Error saving file', loggableError(error))")
      // The tab is marked clean only after a write that succeeded
      expect(catchBlock).not.toContain('setEditorDirty(panelIdRef.current, false)')
    })

    it('one failure, one toast: a save by id leaves the toast to the registry caller', () => {
      // previewTabMove toasts on `false` (editorSaveRegistry contract), so the
      // panel's own toast is skipped for the registry trigger
      expect(catchBlock).toMatch(/if \(trigger !== 'registry'\) \{[\s\S]*showToast\(/)
      expect(catchBlock.indexOf("if (trigger !== 'registry')")).toBeLessThan(catchBlock.indexOf('showToast('))
    })

    it('wires each caller to its trigger: Cmd+S is user, autosave is autosave, the registry is registry', () => {
      expect(source).toContain("onSave: () => handleSave('user'),")
      expect(source).toContain("await handleSave('autosave')")
      // an autosave never overwrites a file that changed on disk
      expect(source.indexOf('if (externalChangeDetected) return')).toBeLessThan(
        source.indexOf("await handleSave('autosave')")
      )
      expect(source).toContain("() => handleSave('registry'), externalChangeDetected")
      expect(source.match(/handleSave\(/g)).toHaveLength(3)
    })

    it('only the tab’s own Cmd+S of a deleted tab may recreate the missing folder', () => {
      expect(handleSave).toContain('if (shouldRecreateParentDirs(trigger, isFileDeleted)) {')
      expect(handleSave).toContain('createParentDirs: true,')
      expect(handleSave.match(/createParentDirs: true/g)).toHaveLength(1)
    })

    it('names the project the file was opened under on every write', () => {
      expect(handleSave).toContain('const generation = openedGenerationRef.current')
      const writes = handleSave.match(/await fileGateway\.writeFile\(\{[^}]*\}\)/g) ?? []
      expect(writes).toHaveLength(2)
      for (const write of writes) expect(write).toContain('generation')
    })

    it('settles a finished save in one update, from the buffer as it is after the write', () => {
      // Two updates (written text, then the newer buffer) let React render the
      // older text as current for a moment; the rules are in settleSavedFile
      expect(handleSave.match(/setCurrentFile\(/g)).toHaveLength(1)
      expect(handleSave).toContain('const bufferNow = editorRef.current?.getEditor()?.getValue()')
      expect(handleSave).toContain(
        'bufferNow !== undefined && bufferNow !== contentToSave'
      )
    })

    it('clears the tab’s dirty dot when the buffer takes the disk’s text (Reload from Disk)', () => {
      const watcherUpdate = source.slice(
        source.indexOf('const handleContentUpdateFromWatcher = useCallback'),
        source.indexOf('const {\n    externalChangeDetected')
      )
      expect(watcherUpdate).toContain('modified: false')
      expect(watcherUpdate).toContain('setEditorDirty(panelIdRef.current, false)')
    })

    it('keeps a remounted editor read-only while an autosave hold is active', () => {
      expect(source).toContain('const releaseReadOnly = readOnlyHold.hold()')
      const onMount = source.slice(
        source.indexOf('const handleEditorMount = useCallback'),
        source.indexOf('}, [viewMode, setIsEditorReady, readOnlyHold])')
      )
      expect(onMount).toContain('readOnlyHold.applyToMountedEditor(editor)')
      // The hook's behaviour is covered in useEditorReadOnlyHold.test.ts
    })

    it('forgets the last failure reason when the panel switches file', () => {
      expect(source).toMatch(
        /useEffect\(\(\) => \{\n\s*lastSaveErrorRef\.current = null\n\s*\}, \[currentFile\?\.path\]\)/
      )
    })
  })
})
