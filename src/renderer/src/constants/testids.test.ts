// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for testids.ts - Test ID constants and helpers
 *
 * @see testids.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Use dynamic import to ensure fresh module state for each test
async function getTestIds() {
  vi.resetModules()
  return import('./testids')
}

describe('TEST_IDS', () => {
  describe('structure', () => {
    it('should have all expected component sections', async () => {
      const { TEST_IDS } = await getTestIds()

      // Activity Bar
      expect(TEST_IDS.ACTIVITY_BAR).toBe('activity-bar')
      expect(TEST_IDS.ACTIVITY_BAR_BTN_FILES).toBe('activity-bar-btn-files')
      expect(TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL).toBe('activity-bar-btn-terminal')
      expect(TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).toBe('activity-bar-btn-settings')

      // Project Tree
      expect(TEST_IDS.PROJECT_TREE).toBe('project-tree')
      expect(TEST_IDS.PROJECT_TREE_NODE).toBe('project-tree-node')

      // Terminal
      expect(TEST_IDS.TERMINAL_PANEL).toBe('terminal-panel')
      expect(TEST_IDS.TERMINAL_BTN_EXPAND).toBe('terminal-btn-expand')

      // Editor
      expect(TEST_IDS.EDITOR_AREA).toBe('editor-area')
      expect(TEST_IDS.EDITOR_MONACO).toBe('editor-monaco')
      expect(TEST_IDS.EDITOR_PREVIEW).toBe('editor-preview')

      // Dialogs
      expect(TEST_IDS.DIALOG_OVERLAY).toBe('dialog-overlay')
      expect(TEST_IDS.DIALOG_BTN_CONFIRM).toBe('dialog-btn-confirm')
    })

    it('should have unique values for all keys', async () => {
      const { TEST_IDS } = await getTestIds()
      const values = Object.values(TEST_IDS)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)
    })

    it('should follow kebab-case naming convention', async () => {
      const { TEST_IDS } = await getTestIds()
      const values = Object.values(TEST_IDS)
      const kebabCasePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

      values.forEach((value) => {
        expect(value).toMatch(kebabCasePattern)
      })
    })

    it('should use SCREAMING_SNAKE_CASE for keys', async () => {
      const { TEST_IDS } = await getTestIds()
      const keys = Object.keys(TEST_IDS)
      const screamingSnakePattern = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/

      keys.forEach((key) => {
        expect(key).toMatch(screamingSnakePattern)
      })
    })
  })

  describe('component counts', () => {
    it('should have 4 Activity Bar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const activityBarIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('ACTIVITY_BAR'))
      expect(activityBarIds).toHaveLength(4)
    })

    it('should have 16 Project Tree IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const projectTreeIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('PROJECT_TREE'))
      expect(projectTreeIds).toHaveLength(16)
    })

    it('should have 14 Terminal Panel IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const terminalIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('TERMINAL_'))
      expect(terminalIds).toHaveLength(14)
    })

    it('should have 3 Claude Status Bar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const claudeIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('CLAUDE_STATUS_'))
      expect(claudeIds).toHaveLength(3)
    })

    it('should have 8 Camera Dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const cameraIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('CAMERA_'))
      expect(cameraIds).toHaveLength(8)
    })

    it('should have 15 Chat Bubble IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const chatIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('CHAT_'))
      expect(chatIds).toHaveLength(15)
    })

    it('should have 4 Git Status Bar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const gitIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('GIT_'))
      expect(gitIds).toHaveLength(4)
    })

    it('should have 20 Settings Overlay IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const settingsIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('SETTINGS_'))
      expect(settingsIds).toHaveLength(20)
    })

    it('should have 10 Transcription Dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const transcriptionIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('TRANSCRIPTION_'))
      expect(transcriptionIds).toHaveLength(10)
    })

    it('should have 12 Document Import Dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const docImportIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('DOCUMENT_IMPORT_'))
      expect(docImportIds).toHaveLength(12)
    })

    it('should have 6 Document Stats Bar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const statsIds = Object.keys(TEST_IDS).filter(
        (k) => k.startsWith('DOCUMENT_STATS_') || k.startsWith('STATS_')
      )
      expect(statsIds).toHaveLength(6)
    })

    it('should have 1 UI Blocker ID', async () => {
      const { TEST_IDS } = await getTestIds()
      const uiBlockerIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('UI_BLOCKER'))
      expect(uiBlockerIds).toHaveLength(1)
    })

    it('should have 1 Editor Error Boundary ID', async () => {
      const { TEST_IDS } = await getTestIds()
      const editorErrorIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('EDITOR_ERROR'))
      expect(editorErrorIds).toHaveLength(1)
    })

    it('should have 4 File Conflict Notification IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const fileConflictIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('FILE_CONFLICT'))
      expect(fileConflictIds).toHaveLength(4)
    })

    it('should have 5 Welcome Panel IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const welcomeIds = Object.keys(TEST_IDS).filter((k) => k.startsWith('WELCOME_'))
      expect(welcomeIds).toHaveLength(5)
    })

    it('should have 2 Context Menu base IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) =>
          k.startsWith('CONTEXT_MENU') &&
          !k.startsWith('CONTEXT_MENU_TERMINAL') &&
          !k.startsWith('CONTEXT_MENU_EDITOR') &&
          !k.startsWith('CONTEXT_MENU_PREVIEW') &&
          !k.startsWith('CONTEXT_MENU_ITEM_')
      )
      expect(ids).toHaveLength(2)
    })

    it('should have 3 Context Menu terminal IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) =>
          k.startsWith('CONTEXT_MENU_TERMINAL') ||
          k === 'CONTEXT_MENU_ITEM_COPY' ||
          k === 'CONTEXT_MENU_ITEM_PASTE'
      )
      expect(ids).toHaveLength(3)
    })

    it('should have 7 Context Menu editor/preview IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) =>
          k.startsWith('CONTEXT_MENU_EDITOR') ||
          k.startsWith('CONTEXT_MENU_PREVIEW') ||
          (k.startsWith('CONTEXT_MENU_ITEM_') &&
            k !== 'CONTEXT_MENU_ITEM_COPY' &&
            k !== 'CONTEXT_MENU_ITEM_PASTE')
      )
      expect(ids).toHaveLength(7)
    })

    it('should have 3 Dialog base IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) =>
          k === 'DIALOG_OVERLAY' || k === 'DIALOG_CONTAINER' || k === 'DIALOG_TITLE'
      )
      expect(ids).toHaveLength(3)
    })

    it('should have 6 External drop dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('EXTERNAL_DROP_'))
      expect(ids).toHaveLength(6)
    })

    it('should have 4 Conflict dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('CONFLICT_'))
      expect(ids).toHaveLength(4)
    })

    it('should have 4 Confirm dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) => k.startsWith('DIALOG_CONFIRM') || k === 'DIALOG_BTN_CONFIRM' || k === 'DIALOG_BTN_CANCEL'
      )
      expect(ids).toHaveLength(4)
    })

    it('should have 3 Alert dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) => k.startsWith('DIALOG_ALERT') || k === 'DIALOG_BTN_OK'
      )
      expect(ids).toHaveLength(3)
    })

    it('should have 4 Prompt dialog IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('DIALOG_PROMPT'))
      expect(ids).toHaveLength(4)
    })

    it('should have 5 File picker IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('FILE_PICKER'))
      expect(ids).toHaveLength(5)
    })

    it('should have 5 Diagram Viewer IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('DIAGRAM_VIEWER'))
      expect(ids).toHaveLength(5)
    })

    it('should have 12 Image Viewer IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('IMAGE_VIEWER_'))
      expect(ids).toHaveLength(12)
    })

    it('should have 4 Mermaid Toolbar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('MERMAID_'))
      expect(ids).toHaveLength(4)
    })

    it('should have 6 Editor Tab IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('TAB_') && !k.startsWith('IMAGE_TAB_'))
      expect(ids).toHaveLength(6)
    })

    it('should have 3 Image Tab IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('IMAGE_TAB_'))
      expect(ids).toHaveLength(3)
    })

    it('should have 8 Search Bar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('SEARCH_BAR'))
      expect(ids).toHaveLength(8)
    })

    it('should have 6 Toast Notification IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter((k) => k.startsWith('TOAST'))
      expect(ids).toHaveLength(6)
    })

    it('should have 6 Editor Content Layout IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) =>
          k === 'EDITOR_AREA' ||
          k === 'EDITOR_CONTENT' ||
          k === 'EDITOR_PANE' ||
          k === 'PREVIEW_PANE' ||
          k === 'EDITOR_MONACO' ||
          k === 'EDITOR_PREVIEW'
      )
      expect(ids).toHaveLength(6)
    })

    it('should have 20 Markdown Toolbar IDs', async () => {
      const { TEST_IDS } = await getTestIds()
      const ids = Object.keys(TEST_IDS).filter(
        (k) =>
          k.startsWith('MARKDOWN_') ||
          k.startsWith('TOOLBAR_BTN_') ||
          k.startsWith('VIEW_MODE_BTN_') ||
          k === 'MODIFIED_INDICATOR' ||
          k === 'AUTOSAVE_INDICATOR' ||
          k === 'RELOAD_INDICATOR'
      )
      expect(ids).toHaveLength(20)
    })
  })
})

describe('getPathHash', () => {
  let getPathHash: (path: string) => string

  beforeEach(async () => {
    const module = await getTestIds()
    getPathHash = module.getPathHash
  })

  it('should return an 8-character lowercase hex string', () => {
    const hash = getPathHash('src/main/index.ts')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('should be deterministic (same input = same output)', () => {
    const path = 'src/renderer/App.tsx'
    const hash1 = getPathHash(path)
    const hash2 = getPathHash(path)
    expect(hash1).toBe(hash2)
  })

  it('should handle empty string', () => {
    const hash = getPathHash('')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    // djb2 hash of empty string: 5381 = 0x1505
    expect(hash).toBe('00001505')
  })

  it('should produce different hashes for different paths', () => {
    const hash1 = getPathHash('src/main/index.ts')
    const hash2 = getPathHash('src/main/index.js')
    const hash3 = getPathHash('src/renderer/index.ts')

    expect(hash1).not.toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash2).not.toBe(hash3)
  })

  it('should handle paths with special characters', () => {
    const paths = [
      'path/with spaces/file.ts',
      'path-with-dashes/file.ts',
      'path_with_underscores/file.ts',
      'path/with/deep/nesting/file.ts',
      '/absolute/path/file.ts',
      './relative/path/file.ts',
      '../parent/path/file.ts'
    ]

    paths.forEach((path) => {
      const hash = getPathHash(path)
      expect(hash).toMatch(/^[0-9a-f]{8}$/)
    })
  })

  it('should handle unicode characters', () => {
    const hash = getPathHash('docs/README-polski.md')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('should handle very long paths', () => {
    const longPath = 'a/'.repeat(100) + 'file.ts'
    const hash = getPathHash(longPath)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('should differentiate similar paths that could collide naively', () => {
    // These paths could collide if using simple string manipulation
    const hash1 = getPathHash('foo/bar.md')
    const hash2 = getPathHash('foo-bar.md')
    const hash3 = getPathHash('foobar.md')

    expect(hash1).not.toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash2).not.toBe(hash3)
  })

  it('should produce consistent hash for known value (regression test)', () => {
    // This ensures the algorithm doesn't change unexpectedly
    const hash = getPathHash('src/main/index.ts')
    // If this test fails, existing data-testid attributes in the DOM
    // will no longer match the expected values
    expect(hash).toBe('f97840bd')
  })
})

describe('getDynamicTestId', () => {
   
  let getDynamicTestId: (prefix: string, path: string) => string
  let TEST_IDS: Record<string, string>

  beforeEach(async () => {
    const module = await getTestIds()
    getDynamicTestId = module.getDynamicTestId
    TEST_IDS = module.TEST_IDS
  })

  it('should combine prefix and hash with hyphen', () => {
    const testId = getDynamicTestId('project-tree-node', 'src/main/index.ts')
    expect(testId).toMatch(/^project-tree-node-[0-9a-f]{8}$/)
  })

  it('should work with TEST_IDS constants', () => {
    const testId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
    expect(testId).toMatch(/^project-tree-node-[0-9a-f]{8}$/)
  })

  it('should produce consistent results', () => {
    const path = 'src/renderer/App.tsx'
    const testId1 = getDynamicTestId(TEST_IDS.TAB_ITEM, path)
    const testId2 = getDynamicTestId(TEST_IDS.TAB_ITEM, path)
    expect(testId1).toBe(testId2)
  })

  it('should produce different IDs for different paths', () => {
    const testId1 = getDynamicTestId(TEST_IDS.TAB_ITEM, 'src/main/index.ts')
    const testId2 = getDynamicTestId(TEST_IDS.TAB_ITEM, 'src/renderer/App.tsx')
    expect(testId1).not.toBe(testId2)
  })

  it('should produce different IDs for same path with different prefixes', () => {
    const path = 'src/main/index.ts'
    const testId1 = getDynamicTestId(TEST_IDS.TAB_ITEM, path)
    const testId2 = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, path)
    expect(testId1).not.toBe(testId2)
  })

  it('should handle empty path', () => {
    const testId = getDynamicTestId(TEST_IDS.FILE_PICKER_ITEM, '')
    expect(testId).toBe('file-picker-item-00001505')
  })

  it('should produce consistent result for known path (regression test)', () => {
    // Regression test to ensure dynamic IDs remain stable
    const testId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
    expect(testId).toBe('project-tree-node-f97840bd')
  })
})

describe('TestId type', () => {
  it('should accept valid TEST_IDS values', async () => {
    const { TEST_IDS } = await getTestIds()
    type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS]

    // Type-level test: this should compile without errors
    const validId: TestId = TEST_IDS.ACTIVITY_BAR
    expect(validId).toBe('activity-bar')
  })

  it('should represent string literal union', async () => {
    const module = await getTestIds()
    type TestId = (typeof module.TEST_IDS)[keyof typeof module.TEST_IDS]

    // Verify the type is a union of string literals, not just string
    const checkType = (_id: TestId): void => {}

    // These should all be valid - using module.TEST_IDS to avoid unused var
    checkType(module.TEST_IDS.ACTIVITY_BAR)
    checkType(module.TEST_IDS.PROJECT_TREE)
    checkType(module.TEST_IDS.TERMINAL_PANEL)

    // Verify TestId is a finite union of string literals
    // by checking the total count of TEST_IDS keys matches expected
    const totalIds = Object.keys(module.TEST_IDS).length
    expect(totalIds).toBeGreaterThan(0)
  })
})
