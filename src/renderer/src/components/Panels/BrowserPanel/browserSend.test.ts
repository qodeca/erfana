// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { sendCapture, templateOf, type SendDeps, type SendRequest } from './browserSend'

const PATHS = { context: '.erfana/browser/captures/c.md', screenshot: '.erfana/browser/captures/c.png', crop: '.erfana/browser/captures/c-crop.png' }
const REQUEST: SendRequest = {
  tabId: 'browser-tab-1',
  captureId: 'a'.repeat(32),
  terminalId: 'terminal-1',
  terminalName: 'Terminal',
  action: 'change',
  instruction: 'Make it blue'
}

function deps(over: Partial<SendDeps> = {}): SendDeps {
  return {
    writeCapture: vi.fn(async () => ({ paths: PATHS })),
    discardCaptureFiles: vi.fn(async () => ({ ok: true })),
    closeSent: vi.fn(async () => ({ ok: true })),
    executePrompt: vi.fn(async () => ({ success: true })),
    ...over
  }
}

describe('sendCapture', () => {
  it('writes the capture, sends the template with @ references and the instruction only, then closes the pick as sent', async () => {
    const d = deps()
    expect(await sendCapture(d, REQUEST)).toEqual({ kind: 'sent', contextPath: PATHS.context })
    expect(d.writeCapture).toHaveBeenCalledWith({ tabId: 'browser-tab-1', captureId: 'a'.repeat(32), terminalId: 'terminal-1' })
    expect(d.executePrompt).toHaveBeenCalledWith(
      'browser-change',
      {
        selectedText: '',
        filePath: '',
        fullDocument: '',
        userInput: 'Make it blue',
        contextRef: `@${PATHS.context}`,
        screenshotRef: `@${PATHS.screenshot}`,
        cropRef: `@${PATHS.crop}`
      },
      'terminal-1'
    )
    expect(d.closeSent).toHaveBeenCalledWith('browser-tab-1', 'a'.repeat(32))
    expect(d.discardCaptureFiles).not.toHaveBeenCalled()
  })

  it('answers the no-terminal guard without asking main', async () => {
    const d = deps()
    expect(await sendCapture(d, { ...REQUEST, terminalId: null })).toEqual({ kind: 'guard', guard: { kind: 'noTerminal', process: null } })
    expect(d.writeCapture).not.toHaveBeenCalled()
  })

  it('passes main\'s guard on, and asks with sendAnyway only when the reviewer chose it', async () => {
    const d = deps({ writeCapture: vi.fn(async () => ({ guard: { kind: 'shell' as const, process: 'zsh' } })) })
    expect(await sendCapture(d, REQUEST)).toEqual({ kind: 'guard', guard: { kind: 'shell', process: 'zsh' } })
    expect(d.executePrompt).not.toHaveBeenCalled()
    await sendCapture(d, { ...REQUEST, sendAnyway: true })
    expect(d.writeCapture).toHaveBeenLastCalledWith(expect.objectContaining({ sendAnyway: true }))
  })

  it('reports a write error or a refused write without sending', async () => {
    const error = deps({ writeCapture: vi.fn(async () => ({ error: 'The disk is full' })) })
    expect(await sendCapture(error, REQUEST)).toEqual({ kind: 'failed', reason: 'The disk is full' })
    const thrown = deps({ writeCapture: vi.fn(async () => Promise.reject(new Error('ipc'))) })
    expect(await sendCapture(thrown, REQUEST)).toEqual({ kind: 'failed', reason: "Erfana couldn't save the capture files" })
    expect(error.executePrompt).not.toHaveBeenCalled()
  })

  it('deletes the written files when the terminal write fails, and keeps the pick open', async () => {
    for (const executePrompt of [vi.fn(async () => ({ success: false })), vi.fn(async () => Promise.reject(new Error('gone')))]) {
      const d = deps({ executePrompt, discardCaptureFiles: vi.fn(async () => Promise.reject(new Error('x'))) })
      expect(await sendCapture(d, REQUEST)).toEqual({ kind: 'failed', reason: "Erfana couldn't type into Terminal" })
      expect(d.discardCaptureFiles).toHaveBeenCalledWith('browser-tab-1', 'a'.repeat(32))
      expect(d.closeSent).not.toHaveBeenCalled()
    }
  })

  it('names each action\'s template', () => {
    expect(['explain', 'ask', 'change', 'prompt'].map(a => templateOf(a as never))).toEqual([
      'browser-explain',
      'browser-ask',
      'browser-change',
      'browser-prompt'
    ])
  })
})
