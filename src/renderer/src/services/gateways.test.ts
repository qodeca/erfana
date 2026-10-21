// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file and terminal gateways forward every bridge method, with the same
 * arguments and result, and read `window.api` on each call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import { fileGateway } from './fileGateway'
import { terminalGateway } from './terminalGateway'
import { getDefaultProjectTreeApi } from './projectTreeApi'

// Exhaustive by construction: a method added to a contract fails to compile here
const FILE_METHODS: Record<keyof FileBridge, true> = {
  openProject: true,
  openProjectByPath: true,
  getSession: true,
  readDirectory: true,
  readFile: true,
  writeFile: true,
  getStats: true,
  exists: true,
  getProjectPath: true,
  createFile: true,
  createFolder: true,
  deleteFile: true,
  deleteFolder: true,
  rename: true,
  revealInFileManager: true,
  moveItem: true,
  copyItem: true,
  checkConflict: true,
  validatePath: true,
  readImage: true,
  validateExternal: true,
  copyFromExternal: true,
  moveFromExternal: true,
  selectExternalFiles: true,
  onProjectChanged: true,
  closeProject: true
}

const TERMINAL_METHODS: Record<keyof TerminalBridge, true> = {
  isAvailable: true,
  create: true,
  write: true,
  resize: true,
  kill: true,
  getInfo: true,
  list: true,
  getActivity: true,
  onData: true,
  onExit: true,
  onError: true,
  onClear: true,
  markClearComplete: true
}

type Anything = (...args: unknown[]) => unknown

function fakeBridge(methods: string[]): Record<string, ReturnType<typeof vi.fn>> {
  return Object.fromEntries(methods.map((name) => [name, vi.fn(() => `${name}-result`)]))
}

const original = window.api

afterEach(() => {
  window.api = original
})

describe.each([
  ['fileGateway', 'file', fileGateway, FILE_METHODS],
  ['terminalGateway', 'terminal', terminalGateway, TERMINAL_METHODS]
] as const)('%s', (_name, key, gateway, methods) => {
  const names = Object.keys(methods)

  it('has exactly the contract methods', () => {
    expect(Object.keys(gateway).sort()).toEqual([...names].sort())
  })

  it.each(names)('%s forwards its arguments and returns the bridge result', (method) => {
    const bridge = fakeBridge(names)
    window.api = { [key]: bridge } as unknown as typeof window.api

    const result = (gateway as unknown as Record<string, Anything>)[method]('a', 2, { c: 3 })

    expect(bridge[method]).toHaveBeenCalledTimes(1)
    expect(bridge[method]).toHaveBeenCalledWith('a', 2, { c: 3 })
    expect(result).toBe(`${method}-result`)
  })

  it('forwards a call with no arguments without inventing any', () => {
    const bridge = fakeBridge(names)
    window.api = { [key]: bridge } as unknown as typeof window.api

    ;(gateway as unknown as Record<string, Anything>)[names[0]]()

    expect(bridge[names[0]]).toHaveBeenCalledWith()
  })

  it('reads window.api on every call', () => {
    const first = fakeBridge(names)
    const second = fakeBridge(names)

    window.api = { [key]: first } as unknown as typeof window.api
    ;(gateway as unknown as Record<string, Anything>)[names[0]]()
    window.api = { [key]: second } as unknown as typeof window.api
    ;(gateway as unknown as Record<string, Anything>)[names[0]]()

    expect(first[names[0]]).toHaveBeenCalledTimes(1)
    expect(second[names[0]]).toHaveBeenCalledTimes(1)
  })
})

describe('getDefaultProjectTreeApi', () => {
  it('hands the project tree the gateways and the directory watcher', () => {
    const directoryWatch = { start: vi.fn() }
    window.api = { directoryWatch } as unknown as typeof window.api

    const api = getDefaultProjectTreeApi()

    expect(api.file).toBe(fileGateway)
    expect(api.terminal).toBe(terminalGateway)
    expect(api.directoryWatch).toBe(directoryWatch)
  })

  it('keeps its identity while window.api stays the same, so effect dependencies hold', () => {
    window.api = { directoryWatch: {} } as unknown as typeof window.api
    expect(getDefaultProjectTreeApi()).toBe(getDefaultProjectTreeApi())
  })

  it('is rebuilt when window.api is replaced', () => {
    window.api = { directoryWatch: {} } as unknown as typeof window.api
    const before = getDefaultProjectTreeApi()
    window.api = { directoryWatch: {} } as unknown as typeof window.api
    expect(getDefaultProjectTreeApi()).not.toBe(before)
  })
})
