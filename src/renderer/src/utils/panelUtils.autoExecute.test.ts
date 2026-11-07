// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every built-in prompt command submits itself (#449).
 *
 * Runs each prompt in the real registry through the path a preview or editor
 * context menu uses – executePromptTemplate → openPanelAndSendContent →
 * terminal manager → the real terminal store's sendToTerminal – with only the
 * IPC write mocked, and checks that the prompt ends in exactly one Enter.
 * TerminalPanelHandler.send (the panel-handler path) is checked the same way.
 *
 * Split from panelUtils.test.ts, which mocks the registry at module scope
 * (docs/windows/contributing.md § Test-file split policy).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { executePromptTemplate } from './panelUtils'
import { TerminalPanelHandler } from './terminalPanelHandler'
import type { PanelManagers } from './panelManager.types'
import { getAllPrompts } from '../prompts/registry'
import { promptRenderer } from '../prompts/renderer'
import { mockPromptVariables } from '../prompts/__test-utils__/fixtures'
import { createTerminalStore } from '../stores/useTerminalStore'
import { ENTER_NO_OUTPUT_DELAY_MS } from '../stores/terminalInputSettle'

vi.mock('./toastHelpers', () => ({ showErrorToast: vi.fn() }))

const mockWrite = vi.fn()
const terminalStore = createTerminalStore({ write: mockWrite })

/** Managers backed by the real terminal store, as createDefaultManagers wires them. */
const managers: PanelManagers = {
  panelManager: { setActivePanel: vi.fn() },
  terminalManager: {
    isReady: () => terminalStore.getState().activeTerminalId !== null,
    sendToTerminal: (content, autoExecute) => terminalStore.getState().sendToTerminal(content, autoExecute)
  }
}

/** A long, multi-line selection, as in the issue. */
const longSelection = Array.from({ length: 120 }, (_, i) => `Selected line ${i + 1}.`).join('\n')

/** Every variable any built-in prompt requires (prompts/validation.ts). */
const variables = mockPromptVariables({
  selectedText: longSelection,
  userInput: 'Make it shorter',
  diagramType: 'flowchart',
  mermaidCode: 'graph TD\n  A-->B',
  mermaidError: 'Parse error on line 2',
  userInstruction: 'Add a node C',
  targetDirection: 'LR',
  directionLabel: 'Left to Right',
  importedFilePath: '/Users/test/project/imported.md',
  // The browser prompts (spec 025) reference a page capture
  contextRef: '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d.md',
  screenshotRef: '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d.png'
})

const allPrompts = getAllPrompts()

function written(): string[] {
  return mockWrite.mock.calls.map(([, data]) => String(data))
}

describe('built-in prompt commands press Enter after the paste (#449)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockWrite.mockResolvedValue({ success: true })
    terminalStore.getState().clearActivity('term1')
    terminalStore.setState({ activeTerminalId: 'term1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('has autoExecute on for every prompt in the registry', () => {
    expect(allPrompts.length).toBeGreaterThan(0)
    const notAutoExecuting = allPrompts.filter((p) => p.autoExecute !== true).map((p) => p.id)
    expect(notAutoExecuting).toEqual([])
  })

  it.each(allPrompts.map((p) => [p.id]))(
    '"%s" via executePromptTemplate: one paste, then exactly one Enter',
    async (promptId) => {
      const result = executePromptTemplate(promptId, variables, { managers, showToast: false })

      // Before the wait is over only the paste is written
      await vi.advanceTimersByTimeAsync(0)
      expect(written()).toHaveLength(1)
      expect(written()[0]).not.toMatch(/\r$/)

      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)
      await expect(result).resolves.toMatchObject({ success: true })

      expect(written()).toHaveLength(2)
      expect(written()[1]).toBe('\r')
      expect(written().filter((d) => d === '\r')).toHaveLength(1)
      // The paste carries the prompt as one bracketed paste (the templates are multi-line)
      expect(written()[0].startsWith('\x1b[200~')).toBe(true)
      expect(written()[0].endsWith('\x1b[201~')).toBe(true)
    }
  )

  it.each(allPrompts.map((p) => [p.id]))(
    '"%s" via TerminalPanelHandler.send: exactly one Enter, last',
    async (promptId) => {
      const config = allPrompts.find((p) => p.id === promptId)!
      const content = promptRenderer.render(config.template, variables)
      const handler = new TerminalPanelHandler(managers)

      const result = handler.send({ content, location: 'right', autoExecute: config.autoExecute, showToast: false })
      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

      await expect(result).resolves.toEqual({ success: true })
      expect(written()).toHaveLength(2)
      expect(written().at(-1)).toBe('\r')
      expect(written().filter((d) => d === '\r')).toHaveLength(1)
    }
  )

  it('reports failure, with no Enter, when the paste write fails', async () => {
    mockWrite.mockResolvedValue({ success: false, error: 'Terminal not found' })

    const result = await executePromptTemplate('explain', variables, { managers, showToast: false })

    expect(result.success).toBe(false)
    expect(written()).not.toContain('\r')
  })

  it('reports failure when the Enter write fails', async () => {
    mockWrite.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'closed' })

    const result = executePromptTemplate('explain', variables, { managers, showToast: false })
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

    await expect(result).resolves.toMatchObject({ success: false })
  })
})
