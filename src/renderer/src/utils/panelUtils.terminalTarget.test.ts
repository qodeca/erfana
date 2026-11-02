// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * executePromptTemplate options for the built-in browser (spec 025, § 9.3):
 * `terminalId`, `openPanel`, `reveal`. Uses the real registry and renderer,
 * so the browser templates and their footer are exercised as shipped.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { executePromptTemplate, resetDefaultManagers } from './panelUtils'
import type { IPanelManager, ITerminalManager } from './panelManager.types'
import { ErrorCode } from '../../../shared/errors'
import { BROWSER_CAPTURE_FOOTER } from '../prompts/browserCaptureFooter'
import { MUTATE_DOCUMENT_FOOTER } from '../prompts/applyFooter'
import { showErrorToast } from './toastHelpers'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

vi.mock('./logger', () => ({ logger: mockLogger }))
vi.mock('./toastHelpers', () => ({ showErrorToast: vi.fn() }))

type MockManagers = {
  panelManager: IPanelManager & { setActivePanel: Mock }
  terminalManager: ITerminalManager & {
    isReady: Mock
    sendToTerminal: Mock
    sendToTerminalId: Mock
    waitForReady: Mock
  }
}

function createMockManagers(): MockManagers {
  return {
    panelManager: { setActivePanel: vi.fn() },
    terminalManager: {
      isReady: vi.fn().mockReturnValue(true),
      sendToTerminal: vi.fn().mockResolvedValue(true),
      sendToTerminalId: vi.fn().mockResolvedValue(true),
      waitForReady: vi.fn().mockResolvedValue(true)
    }
  }
}

const CAPTURE_VARIABLES = {
  selectedText: '',
  filePath: '',
  fullDocument: '',
  contextRef: '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d.md',
  screenshotRef: '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d.png',
  cropRef: '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d-crop.png',
  userInput: 'label cut off'
}

const BROWSER_OPTIONS = { terminalId: 'term-7', openPanel: false, reveal: 'withoutFocus' } as const

const MARKDOWN_VARIABLES = {
  selectedText: 'Hello world',
  filePath: '/project/doc.md',
  fullDocument: 'Hello world',
  fileRef: '@/project/doc.md:1',
  userInput: 'shorter'
}

describe('executePromptTemplate terminal-target options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDefaultManagers()
  })

  describe('default behaviour (no new option)', () => {
    it('opens the panel, waits for the active terminal and sends there', async () => {
      const managers = createMockManagers()

      const result = await executePromptTemplate('explain', MARKDOWN_VARIABLES, { managers, showToast: false })

      expect(result.success).toBe(true)
      expect(managers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
      expect(managers.terminalManager.waitForReady).toHaveBeenCalled()
      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith(expect.any(String), true)
      expect(managers.terminalManager.sendToTerminalId).not.toHaveBeenCalled()
    })

    it('keeps the apply footer for a mutation template', async () => {
      const managers = createMockManagers()

      await executePromptTemplate('modify', MARKDOWN_VARIABLES, { managers, showToast: false })

      const [content] = managers.terminalManager.sendToTerminal.mock.calls[0]
      expect(content).toContain(MUTATE_DOCUMENT_FOOTER.replaceAll('{{fileRef}}', '@/project/doc.md:1'))
      expect(content).not.toContain(BROWSER_CAPTURE_FOOTER)
    })

    it('treats openPanel: true alone as the default path', async () => {
      const managers = createMockManagers()

      await executePromptTemplate('explain', MARKDOWN_VARIABLES, { managers, showToast: false, openPanel: true })

      expect(managers.terminalManager.waitForReady).toHaveBeenCalled()
      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalled()
    })
  })

  describe('terminalId', () => {
    it('025-AC-032 sends browser-change to the named terminal with the instruction, references and footer', async () => {
      const managers = createMockManagers()

      const result = await executePromptTemplate('browser-change', CAPTURE_VARIABLES, { managers, ...BROWSER_OPTIONS })

      expect(result.success).toBe(true)
      expect(result.completionTs).toEqual(expect.any(Number))
      expect(managers.terminalManager.sendToTerminalId).toHaveBeenCalledTimes(1)
      const [terminalId, content] = managers.terminalManager.sendToTerminalId.mock.calls[0]
      expect(terminalId).toBe('term-7')
      expect(content).toContain('label cut off')
      expect(content).toContain(CAPTURE_VARIABLES.contextRef)
      expect(content).toContain(CAPTURE_VARIABLES.screenshotRef)
      expect(content).toContain(BROWSER_CAPTURE_FOOTER)
      expect(content).not.toContain(MUTATE_DOCUMENT_FOOTER)
      expect(managers.terminalManager.sendToTerminal).not.toHaveBeenCalled()
    })

    it('025-AC-036 keeps page-derived text passed in other variables out of the sent prompt', async () => {
      const managers = createMockManagers()
      const marker = 'INJECT-7f3a'

      await executePromptTemplate(
        'browser-explain',
        { ...CAPTURE_VARIABLES, selectedText: marker, fullDocument: marker, fileRef: marker, projectPath: marker },
        { managers, ...BROWSER_OPTIONS }
      )

      const [, content] = managers.terminalManager.sendToTerminalId.mock.calls[0]
      expect(content).not.toContain(marker)
    })

    it('never waits for or opens a terminal when openPanel is false', async () => {
      const managers = createMockManagers()

      await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, { managers, terminalId: 'term-7', openPanel: false })

      expect(managers.terminalManager.waitForReady).not.toHaveBeenCalled()
      expect(managers.terminalManager.isReady).not.toHaveBeenCalled()
      expect(managers.panelManager.setActivePanel).not.toHaveBeenCalled()
    })

    it('opens the panel before sending when openPanel is left at its default', async () => {
      const managers = createMockManagers()
      const order: string[] = []
      managers.panelManager.setActivePanel.mockImplementation(() => order.push('open'))
      managers.terminalManager.sendToTerminalId.mockImplementation(async () => {
        order.push('send')
        return true
      })

      await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, { managers, terminalId: 'term-7' })

      expect(order).toEqual(['open', 'send'])
      expect(managers.terminalManager.waitForReady).not.toHaveBeenCalled()
    })

    it('fails with PROMPT_SEND_FAILED and the send toast when the send fails', async () => {
      const managers = createMockManagers()
      managers.terminalManager.sendToTerminalId.mockResolvedValue(false)

      const result = await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, { managers, ...BROWSER_OPTIONS })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_SEND_FAILED)
      expect(showErrorToast).toHaveBeenCalledWith('Terminal Error', expect.any(String))
    })

    it('shows no toast on failure when showToast is false', async () => {
      const managers = createMockManagers()
      managers.terminalManager.sendToTerminalId.mockResolvedValue(false)

      await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, { managers, ...BROWSER_OPTIONS, showToast: false })

      expect(showErrorToast).not.toHaveBeenCalled()
    })

    it('fails when the terminal manager cannot send to a named terminal', async () => {
      const managers = createMockManagers()
      const legacy: ITerminalManager = {
        isReady: managers.terminalManager.isReady,
        sendToTerminal: managers.terminalManager.sendToTerminal,
        waitForReady: managers.terminalManager.waitForReady
      }

      const result = await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, {
        managers: { panelManager: managers.panelManager, terminalManager: legacy },
        ...BROWSER_OPTIONS,
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_SEND_FAILED)
      expect(managers.terminalManager.sendToTerminal).not.toHaveBeenCalled()
    })

    it('sends nothing when a required capture reference is missing', async () => {
      const managers = createMockManagers()

      const result = await executePromptTemplate(
        'browser-ask',
        { ...CAPTURE_VARIABLES, screenshotRef: undefined },
        { managers, ...BROWSER_OPTIONS, showToast: false }
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_VALIDATION_FAILED)
      expect(managers.terminalManager.sendToTerminalId).not.toHaveBeenCalled()
    })

    it('sends nothing when the instruction is only spaces', async () => {
      const managers = createMockManagers()

      const result = await executePromptTemplate(
        'browser-prompt',
        { ...CAPTURE_VARIABLES, userInput: '   ' },
        { managers, ...BROWSER_OPTIONS, showToast: false }
      )

      expect(result.error?.code).toBe(ErrorCode.PROMPT_VALIDATION_FAILED)
      expect(managers.terminalManager.sendToTerminalId).not.toHaveBeenCalled()
    })
  })

  describe("reveal: 'withoutFocus'", () => {
    it('shows the terminal panel after a successful send', async () => {
      const managers = createMockManagers()
      const order: string[] = []
      managers.panelManager.setActivePanel.mockImplementation(() => order.push('reveal'))
      managers.terminalManager.sendToTerminalId.mockImplementation(async () => {
        order.push('send')
        return true
      })

      await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, { managers, ...BROWSER_OPTIONS })

      expect(order).toEqual(['send', 'reveal'])
      expect(managers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    })

    it('does not reveal after a failed send', async () => {
      const managers = createMockManagers()
      managers.terminalManager.sendToTerminalId.mockResolvedValue(false)

      await executePromptTemplate('browser-explain', CAPTURE_VARIABLES, { managers, ...BROWSER_OPTIONS, showToast: false })

      expect(managers.panelManager.setActivePanel).not.toHaveBeenCalled()
    })
  })

  describe('openPanel: false without terminalId', () => {
    it('sends to the active terminal without opening the panel or waiting', async () => {
      const managers = createMockManagers()

      const result = await executePromptTemplate('explain', MARKDOWN_VARIABLES, { managers, openPanel: false, showToast: false })

      expect(result.success).toBe(true)
      expect(managers.panelManager.setActivePanel).not.toHaveBeenCalled()
      expect(managers.terminalManager.waitForReady).not.toHaveBeenCalled()
      expect(managers.terminalManager.sendToTerminal).toHaveBeenCalledWith(expect.any(String), true)
    })

    it('fails when there is no active terminal to send to', async () => {
      const managers = createMockManagers()
      managers.terminalManager.sendToTerminal.mockResolvedValue(false)

      const result = await executePromptTemplate('explain', MARKDOWN_VARIABLES, { managers, openPanel: false, showToast: false })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(ErrorCode.PROMPT_SEND_FAILED)
    })
  })
})
