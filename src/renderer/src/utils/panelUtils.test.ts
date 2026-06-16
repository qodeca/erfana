// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for panelUtils.ts
 * Tests panel management, terminal readiness, and prompt execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  waitForTerminalReady,
  openPanelAndSendContent,
  executePromptTemplate,
  resetDefaultManagers
} from './panelUtils'
import type { IPanelManager, ITerminalManager } from './panelManager.types'
import { ErrorCode } from '../../../shared/errors'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('./logger', () => ({ logger: mockLogger }))

// Mock the toast helpers to prevent actual toast notifications
vi.mock('./toastHelpers', () => ({
  showErrorToast: vi.fn()
}))

// Mock the registry and renderer
vi.mock('../prompts/registry', () => ({
  PROMPT_REGISTRY: {
    'explain': {
      id: 'explain',
      label: 'Explain',
      icon: 'maximize2',
      template: 'Explain: {{selectedText}}',
      autoExecute: true
    },
    'modify': {
      id: 'modify',
      label: 'Modify',
      icon: 'edit-3',
      template: 'Modify: {{selectedText}} - {{userInput}}',
      autoExecute: true
    },
    'diagram-chat': {
      id: 'diagram-chat',
      label: 'Diagram Chat',
      icon: 'message-circle',
      template: 'Diagram: {{mermaidCode}} - {{userInstruction}}',
      autoExecute: false
    }
  }
}))

vi.mock('../prompts/renderer', () => ({
  promptRenderer: {
    render: vi.fn((template: string, variables: Record<string, unknown>) => {
      // Simple variable substitution for testing
      let result = template
      Object.entries(variables).forEach(([key, value]) => {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''))
      })
      return result
    })
  }
}))

// Helper to create mock managers
function createMockManagers(): {
  panelManager: IPanelManager & { setActivePanel: ReturnType<typeof vi.fn> }
  terminalManager: ITerminalManager & {
    isReady: ReturnType<typeof vi.fn>
    sendToTerminal: ReturnType<typeof vi.fn>
  }
} {
  return {
    panelManager: {
      setActivePanel: vi.fn()
    },
    terminalManager: {
      isReady: vi.fn().mockReturnValue(true),
      sendToTerminal: vi.fn().mockResolvedValue(true)
    }
  }
}

describe('panelUtils.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDefaultManagers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('waitForTerminalReady()', () => {
    it('should return true immediately if terminal is ready', async () => {
      const terminalManager: ITerminalManager = {
        isReady: vi.fn().mockReturnValue(true),
        sendToTerminal: vi.fn()
      }

      const result = await waitForTerminalReady(terminalManager, 1000, 10)

      expect(result).toBe(true)
      expect(terminalManager.isReady).toHaveBeenCalledTimes(1)
    })

    it('should poll until terminal becomes ready', async () => {
      let callCount = 0
      const terminalManager: ITerminalManager = {
        isReady: vi.fn(() => {
          callCount++
          return callCount >= 3 // Ready on 3rd call
        }),
        sendToTerminal: vi.fn()
      }

      const result = await waitForTerminalReady(terminalManager, 1000, 10)

      expect(result).toBe(true)
      expect(callCount).toBe(3)
    })

    it('should timeout and return false if terminal never becomes ready', async () => {
      const terminalManager: ITerminalManager = {
        isReady: vi.fn().mockReturnValue(false),
        sendToTerminal: vi.fn()
      }

      mockLogger.warn.mockClear()
      const result = await waitForTerminalReady(terminalManager, 100, 20)

      expect(result).toBe(false)
      expect(mockLogger.warn).toHaveBeenCalledWith('Terminal readiness timeout after 100 ms')
    })

    it('should respect custom timeout', async () => {
      const terminalManager: ITerminalManager = {
        isReady: vi.fn().mockReturnValue(false),
        sendToTerminal: vi.fn()
      }

      mockLogger.warn.mockClear()
      const start = Date.now()
      await waitForTerminalReady(terminalManager, 150, 20)
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(140) // Allow some variance
      expect(elapsed).toBeLessThan(200)
    })

    it('should respect custom interval', async () => {
      let callCount = 0
      const terminalManager: ITerminalManager = {
        isReady: vi.fn(() => {
          callCount++
          return false
        }),
        sendToTerminal: vi.fn()
      }

      mockLogger.warn.mockClear()
      await waitForTerminalReady(terminalManager, 100, 30)

      // With 100ms timeout and 30ms interval, should poll ~3-4 times
      expect(callCount).toBeGreaterThanOrEqual(3)
      expect(callCount).toBeLessThanOrEqual(5)
    })
  })

  describe('openPanelAndSendContent()', () => {
    it('should open panel and send content when terminal is ready', async () => {
      const managers = createMockManagers()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'npm install',
        managers,
        showToast: false
      })

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(managers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith('npm install', false)
    })

    it('should pass autoExecute flag to terminal', async () => {
      const managers = createMockManagers()

      await openPanelAndSendContent({
        panel: 'terminal',
        location: 'left',
        content: 'echo hello',
        autoExecute: true,
        managers,
        showToast: false
      })

      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith('echo hello', true)
    })

    it('should return error result if terminal fails to initialize', async () => {
      const managers = createMockManagers()
      managers.terminalManager.isReady.mockReturnValue(false)

      mockLogger.error.mockClear()
      mockLogger.warn.mockClear()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'test',
        managers,
        terminalTimeout: 100, // Short timeout for fast test
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(ErrorCode.PROMPT_TERMINAL_TIMEOUT)
    })

    it('should still open panel even if terminal fails', async () => {
      const managers = createMockManagers()
      managers.terminalManager.isReady.mockReturnValue(false)

      mockLogger.error.mockClear()
      mockLogger.warn.mockClear()

      await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'test',
        managers,
        terminalTimeout: 100, // Short timeout for fast test
        showToast: false
      })

      // Panel should still be opened even if terminal init fails
      expect(managers.panelManager.setActivePanel).toHaveBeenCalled()
    })

    it('should return error result if sendToTerminal fails', async () => {
      const managers = createMockManagers()
      managers.terminalManager.sendToTerminal.mockResolvedValue(false)

      mockLogger.error.mockClear()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'bad command',
        managers,
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_SEND_FAILED)
    })

    it('should work with left location', async () => {
      const managers = createMockManagers()

      await openPanelAndSendContent({
        panel: 'terminal',
        location: 'left',
        content: 'test',
        managers,
        showToast: false
      })

      expect(managers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'left')
    })
  })

  describe('executePromptTemplate()', () => {
    it('should execute a valid prompt with all required variables', async () => {
      const managers = createMockManagers()

      const result = await executePromptTemplate(
        'explain',
        {
          selectedText: 'Hello world',
          filePath: '/path/file.md',
          fullDocument: 'Full content'
        },
        { managers, showToast: false }
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith(
        'Explain: Hello world',
        true // autoExecute is true for explain
      )
    })

    it('should return error result for unknown prompt ID', async () => {
      const managers = createMockManagers()
      mockLogger.error.mockClear()

      const result = await executePromptTemplate(
        'unknown-prompt',
        { selectedText: '', filePath: '', fullDocument: '' },
        { managers, showToast: false }
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(ErrorCode.PROMPT_NOT_FOUND)
    })

    it('should return error result when required variables are missing', async () => {
      const managers = createMockManagers()
      mockLogger.error.mockClear()

      const result = await executePromptTemplate(
        'modify',
        {
          selectedText: 'Some text',
          filePath: '/file.md',
          fullDocument: 'Content'
          // userInput is missing!
        },
        { managers, showToast: false }
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_VALIDATION_FAILED)
    })

    it('should respect autoExecute from prompt config', async () => {
      const managers = createMockManagers()

      // diagram-chat has autoExecute: false
      await executePromptTemplate(
        'diagram-chat',
        {
          selectedText: '',
          filePath: '/path/file.md',
          fullDocument: '',
          mermaidCode: 'graph TD; A-->B',
          userInstruction: 'Add node C'
        },
        { managers, showToast: false }
      )

      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith(
        expect.any(String),
        false
      )
    })

    it('should always send to right panel', async () => {
      const managers = createMockManagers()

      await executePromptTemplate(
        'explain',
        {
          selectedText: 'Test',
          filePath: '/file.md',
          fullDocument: ''
        },
        { managers, showToast: false }
      )

      expect(managers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    })

    it('should handle prompt execution failure gracefully', async () => {
      const managers = createMockManagers()
      managers.terminalManager.isReady.mockReturnValue(false)

      mockLogger.error.mockClear()
      mockLogger.warn.mockClear()

      const result = await executePromptTemplate(
        'explain',
        {
          selectedText: 'Test',
          filePath: '/file.md',
          fullDocument: ''
        },
        { managers, terminalTimeout: 100, showToast: false } // Short timeout for fast test
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_TERMINAL_TIMEOUT)
    })
  })

  describe('resetDefaultManagers()', () => {
    it('should reset the cached managers', () => {
      // This test verifies the reset function exists and can be called
      // The actual effect is tested implicitly by other tests
      expect(() => resetDefaultManagers()).not.toThrow()
    })
  })

  describe('openPanelAndSendContent - completionTs', () => {
    it('sets completionTs when sendToTerminal succeeds', async () => {
      const managers = createMockManagers()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'npm install',
        managers,
        showToast: false
      })

      expect(result.success).toBe(true)
      expect(result.completionTs).toBeDefined()
      expect(typeof result.completionTs).toBe('number')
      expect(result.completionTs).toBeGreaterThan(0)
    })

    it('does not set completionTs when sendToTerminal fails', async () => {
      const managers = createMockManagers()
      managers.terminalManager.sendToTerminal.mockResolvedValue(false)

      mockLogger.error.mockClear()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'bad command',
        managers,
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.completionTs).toBeUndefined()
    })

    it('does not set completionTs when terminal timeout occurs', async () => {
      const managers = createMockManagers()
      managers.terminalManager.isReady.mockReturnValue(false)

      mockLogger.error.mockClear()
      mockLogger.warn.mockClear()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'test',
        managers,
        terminalTimeout: 100,
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.completionTs).toBeUndefined()
    })

    it('completionTs reflects timing when command is sent', async () => {
      const managers = createMockManagers()
      const beforeTs = Date.now()

      const result = await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'echo hello',
        managers,
        showToast: false
      })

      const afterTs = Date.now()

      expect(result.completionTs).toBeDefined()
      expect(result.completionTs!).toBeGreaterThanOrEqual(beforeTs)
      expect(result.completionTs!).toBeLessThanOrEqual(afterTs)
    })
  })

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const managers = createMockManagers()

      await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: '',
        managers,
        showToast: false
      })

      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith('', false)
    })

    it('should handle special characters in content', async () => {
      const managers = createMockManagers()

      await openPanelAndSendContent({
        panel: 'terminal',
        location: 'right',
        content: 'echo "hello $USER" && pwd',
        managers,
        showToast: false
      })

      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith(
        'echo "hello $USER" && pwd',
        false
      )
    })

    it('should handle concurrent executions', async () => {
      const managers = createMockManagers()

      const promises = [
        executePromptTemplate(
          'explain',
          { selectedText: 'Text 1', filePath: '/a.md', fullDocument: '' },
          { managers, showToast: false }
        ),
        executePromptTemplate(
          'explain',
          { selectedText: 'Text 2', filePath: '/b.md', fullDocument: '' },
          { managers, showToast: false }
        )
      ]

      const results = await Promise.all(promises)

      expect(results.map(r => r.success)).toEqual([true, true])
      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledTimes(2)
    })
  })
})
