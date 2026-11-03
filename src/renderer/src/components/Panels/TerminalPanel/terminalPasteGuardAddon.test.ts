// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { TerminalPasteGuardAddon } from './terminalPasteGuardAddon'

vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

function terminalWith(element: HTMLElement | undefined) {
  return { element, paste: vi.fn(), focus: vi.fn() } as unknown as Terminal & {
    paste: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
  }
}

function dataTransfer(types: string[], text = ''): DataTransfer {
  return { types, getData: (type: string) => (type === 'text/plain' ? text : ''), dropEffect: 'none' } as unknown as DataTransfer
}

function dispatch(target: EventTarget, type: string, init: { clipboardData?: DataTransfer; dataTransfer?: DataTransfer } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  if (init.clipboardData !== undefined) Object.defineProperty(event, 'clipboardData', { value: init.clipboardData })
  if (init.dataTransfer !== undefined) Object.defineProperty(event, 'dataTransfer', { value: init.dataTransfer })
  target.dispatchEvent(event)
  return event
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('TerminalPasteGuardAddon (025-FR-009, S-17)', () => {
  let addon: TerminalPasteGuardAddon | null = null
  afterEach(() => {
    addon?.dispose()
    addon = null
    document.body.innerHTML = ''
  })

  function setup(answer: boolean) {
    const element = document.createElement('div')
    const child = document.createElement('textarea')
    element.appendChild(child)
    document.body.appendChild(element)
    const terminal = terminalWith(element)
    const guard = vi.fn(() => Promise.resolve(answer))
    addon = new TerminalPasteGuardAddon(guard)
    addon.activate(terminal)
    return { element, child, terminal, guard }
  }

  it('lets a plain paste through to xterm untouched', () => {
    const { child, guard } = setup(true)
    const event = dispatch(child, 'paste', { clipboardData: dataTransfer(['text/plain'], 'npm test') })
    expect(event.defaultPrevented).toBe(false)
    expect(guard).not.toHaveBeenCalled()
  })

  it('holds a risky paste and types it only after the guard says yes', async () => {
    const { child, terminal, guard } = setup(true)
    const event = dispatch(child, 'paste', { clipboardData: dataTransfer(['text/plain'], 'rm -rf ~\n') })
    expect(event.defaultPrevented).toBe(true)
    expect(guard).toHaveBeenCalledWith('rm -rf ~\n', 'paste')
    await flush()
    expect(terminal.paste).toHaveBeenCalledWith('rm -rf ~\n')
  })

  it('types nothing when the guard says no', async () => {
    const { child, terminal } = setup(false)
    dispatch(child, 'paste', { clipboardData: dataTransfer(['text/plain'], 'a\u001bb') })
    await flush()
    expect(terminal.paste).not.toHaveBeenCalled()
  })

  it('accepts and guards a text drop from outside the window', async () => {
    const { child, terminal, guard } = setup(true)
    const over = dispatch(child, 'dragover', { dataTransfer: dataTransfer(['text/plain'], '') })
    expect(over.defaultPrevented).toBe(true)
    const drop = dispatch(child, 'drop', { dataTransfer: dataTransfer(['text/plain'], 'one\ntwo') })
    expect(drop.defaultPrevented).toBe(true)
    expect(guard).toHaveBeenCalledWith('one\ntwo', 'externalDrop')
    expect(terminal.focus).toHaveBeenCalled()
    await flush()
    expect(terminal.paste).toHaveBeenCalledWith('one\ntwo')
  })

  it('leaves file drops and drags that started inside Erfana alone', () => {
    const { child, guard } = setup(true)
    const files = dispatch(child, 'drop', { dataTransfer: dataTransfer(['Files', 'text/plain'], 'x') })
    expect(files.defaultPrevented).toBe(false)
    dispatch(document, 'dragstart')
    const over = dispatch(child, 'dragover', { dataTransfer: dataTransfer(['text/plain'], '') })
    expect(over.defaultPrevented).toBe(false)
    const internal = dispatch(child, 'drop', { dataTransfer: dataTransfer(['text/plain'], 'tree path') })
    expect(internal.defaultPrevented).toBe(false)
    expect(guard).not.toHaveBeenCalled()
  })

  it('treats a drop after an internal drag ended as external again', () => {
    const { child, guard } = setup(true)
    dispatch(document, 'dragstart')
    dispatch(document, 'dragend')
    dispatch(child, 'drop', { dataTransfer: dataTransfer(['text/plain'], 'x') })
    expect(guard).toHaveBeenCalledWith('x', 'externalDrop')
  })

  it('ignores an empty drop', () => {
    const { child, guard } = setup(true)
    const drop = dispatch(child, 'drop', { dataTransfer: dataTransfer(['text/plain'], '') })
    expect(drop.defaultPrevented).toBe(false)
    expect(guard).not.toHaveBeenCalled()
  })

  it('removes every listener on dispose', () => {
    const { child, guard } = setup(true)
    addon?.dispose()
    const event = dispatch(child, 'paste', { clipboardData: dataTransfer(['text/plain'], 'a\nb') })
    expect(event.defaultPrevented).toBe(false)
    expect(guard).not.toHaveBeenCalled()
  })

  it('leaves events with no data alone', () => {
    const { child, guard } = setup(true)
    expect(dispatch(child, 'paste').defaultPrevented).toBe(false)
    expect(dispatch(child, 'dragover').defaultPrevented).toBe(false)
    expect(dispatch(child, 'dragover', { dataTransfer: dataTransfer(['text/html'], '') }).defaultPrevented).toBe(false)
    expect(dispatch(child, 'drop').defaultPrevented).toBe(false)
    expect(guard).not.toHaveBeenCalled()
  })

  it('does nothing for a terminal that is not open yet', () => {
    addon = new TerminalPasteGuardAddon(vi.fn())
    expect(() => addon?.activate(terminalWith(undefined))).not.toThrow()
  })

  it('logs instead of throwing when the guard rejects', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const terminal = terminalWith(element)
    addon = new TerminalPasteGuardAddon(() => Promise.reject(new Error('boom')))
    addon.activate(terminal)
    dispatch(element, 'paste', { clipboardData: dataTransfer(['text/plain'], 'a\nb') })
    await flush()
    expect(terminal.paste).not.toHaveBeenCalled()
    const { logger } = await import('../../../utils/logger')
    expect(logger.warn).toHaveBeenCalledWith('Terminal paste guard failed', { error: 'boom' })
  })

  it('logs a rejection that is not an Error as text', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    addon = new TerminalPasteGuardAddon(() => Promise.reject('odd'))
    addon.activate(terminalWith(element))
    dispatch(element, 'paste', { clipboardData: dataTransfer(['text/plain'], 'a\nb') })
    await flush()
    const { logger } = await import('../../../utils/logger')
    expect(logger.warn).toHaveBeenCalledWith('Terminal paste guard failed', { error: 'odd' })
  })
})
