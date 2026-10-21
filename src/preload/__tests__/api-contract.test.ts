// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload `file` and `terminal` bridges against their shared contracts.
 *
 * Types: `Api` is the preload object's own type, the renderer's `window.api`
 * is that type, and both bridges are exactly their contract interfaces.
 *
 * Runtime: every contract method sends the channel the channel constants name,
 * with the arguments it was given, and between them the methods cover every
 * channel constant, so a channel cannot be added without a bridge method.
 */
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { FILE_CHANNELS, FILE_EVENTS } from '../../shared/ipc/file-channels'
import { TERMINAL_CHANNELS, TERMINAL_EVENTS } from '../../shared/ipc/terminal-channels'
import type { FileBridge } from '../../shared/ipc/file-schema'
import type { TerminalBridge } from '../../shared/ipc/terminal-schema'
import type { Api } from '../index'
import { fileBridge } from '../fileBridge'
import { terminalBridge } from '../terminalBridge'

type Listener = (event: unknown, payload: unknown) => void

const ipc = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>()
  return {
    listeners,
    invoke: vi.fn(async () => undefined),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((registered) => registered !== listener)
      )
    })
  }
})

vi.mock('electron', () => ({ ipcRenderer: ipc }))

beforeEach(() => {
  ipc.listeners.clear()
  ipc.invoke.mockClear()
  ipc.send.mockClear()
  ipc.on.mockClear()
  ipc.removeListener.mockClear()
})

describe('Api type', () => {
  it('window.api is the preload object type, and each bridge is its contract', () => {
    expectTypeOf<Window['api']>().toEqualTypeOf<Api>()
    expectTypeOf<Api['file']>().toEqualTypeOf<FileBridge>()
    expectTypeOf<Api['terminal']>().toEqualTypeOf<TerminalBridge>()
    expectTypeOf(fileBridge).toEqualTypeOf<FileBridge>()
    expectTypeOf(terminalBridge).toEqualTypeOf<TerminalBridge>()
  })

  it('a method that returns something else than the contract says is not accepted', () => {
    expectTypeOf<Api['file']['moveItem']>().returns.resolves.toEqualTypeOf<{
      path: string
      isSymlink?: boolean
    }>()
    expectTypeOf<Api['file']['deleteFile']>().returns.resolves.toEqualTypeOf<boolean>()
  })
})

describe('channel names', () => {
  it('are the wire strings, which must not change', () => {
    expect({
      FILE_CHANNELS,
      FILE_EVENTS,
      TERMINAL_CHANNELS,
      TERMINAL_EVENTS
    }).toMatchInlineSnapshot(`
      {
        "FILE_CHANNELS": {
          "checkConflict": "file:checkConflict",
          "closeProject": "file:closeProject",
          "copyFromExternal": "file:copyFromExternal",
          "copyItem": "file:copyItem",
          "createFile": "file:createFile",
          "createFolder": "file:createFolder",
          "deleteFile": "file:deleteFile",
          "deleteFolder": "file:deleteFolder",
          "exists": "file:exists",
          "getProjectPath": "file:getProjectPath",
          "getSession": "file:getSession",
          "getStats": "file:getStats",
          "moveFromExternal": "file:moveFromExternal",
          "moveItem": "file:moveItem",
          "openProject": "file:openProject",
          "openProjectByPath": "file:openProjectByPath",
          "readDirectory": "file:readDirectory",
          "readFile": "file:readFile",
          "readImage": "file:readImage",
          "rename": "file:rename",
          "revealInFileManager": "file:revealInFileManager",
          "selectExternalFiles": "file:selectExternalFiles",
          "validateExternal": "file:validateExternal",
          "validatePath": "file:validatePath",
          "writeFile": "file:writeFile",
        },
        "FILE_EVENTS": {
          "projectChanged": "project:changed",
        },
        "TERMINAL_CHANNELS": {
          "clearComplete": "terminal:clearComplete",
          "create": "terminal:create",
          "getActivity": "terminal:getActivity",
          "getInfo": "terminal:getInfo",
          "isAvailable": "terminal:isAvailable",
          "kill": "terminal:kill",
          "list": "terminal:list",
          "resize": "terminal:resize",
          "write": "terminal:write",
        },
        "TERMINAL_EVENTS": {
          "clear": "terminal:clear",
          "data": "terminal:data",
          "error": "terminal:error",
          "exit": "terminal:exit",
        },
      }
    `)
  })
})

describe('file bridge', () => {
  /** Every request method, called with the arguments the contract allows, and the wire it must produce. */
  const calls: Array<{
    method: keyof FileBridge
    channel: string
    args: unknown[]
    wire: unknown[]
  }> = [
    { method: 'openProject', channel: FILE_CHANNELS.openProject, args: [], wire: [] },
    { method: 'openProjectByPath', channel: FILE_CHANNELS.openProjectByPath, args: ['p'], wire: ['p'] },
    { method: 'getSession', channel: FILE_CHANNELS.getSession, args: [], wire: [] },
    { method: 'readDirectory', channel: FILE_CHANNELS.readDirectory, args: ['d'], wire: ['d'] },
    { method: 'readFile', channel: FILE_CHANNELS.readFile, args: ['f'], wire: ['f'] },
    { method: 'getStats', channel: FILE_CHANNELS.getStats, args: ['f'], wire: ['f'] },
    { method: 'exists', channel: FILE_CHANNELS.exists, args: ['f'], wire: ['f'] },
    { method: 'getProjectPath', channel: FILE_CHANNELS.getProjectPath, args: [], wire: [] },
    { method: 'createFile', channel: FILE_CHANNELS.createFile, args: ['d', 'n'], wire: ['d', 'n'] },
    { method: 'createFolder', channel: FILE_CHANNELS.createFolder, args: ['d', 'n'], wire: ['d', 'n'] },
    { method: 'deleteFile', channel: FILE_CHANNELS.deleteFile, args: ['f'], wire: ['f'] },
    { method: 'deleteFolder', channel: FILE_CHANNELS.deleteFolder, args: ['d'], wire: ['d'] },
    { method: 'rename', channel: FILE_CHANNELS.rename, args: ['o', 'n'], wire: ['o', 'n'] },
    { method: 'revealInFileManager', channel: FILE_CHANNELS.revealInFileManager, args: ['f'], wire: ['f'] },
    {
      method: 'moveItem',
      channel: FILE_CHANNELS.moveItem,
      args: ['s', 't', 'n', true],
      wire: ['s', 't', 'n', true]
    },
    { method: 'copyItem', channel: FILE_CHANNELS.copyItem, args: ['s', 't', 'n'], wire: ['s', 't', 'n'] },
    { method: 'checkConflict', channel: FILE_CHANNELS.checkConflict, args: ['t', 'n'], wire: ['t', 'n'] },
    { method: 'validatePath', channel: FILE_CHANNELS.validatePath, args: ['f', 'r'], wire: ['f', 'r'] },
    { method: 'readImage', channel: FILE_CHANNELS.readImage, args: ['f', 'v'], wire: ['f', 'v'] },
    {
      method: 'validateExternal',
      channel: FILE_CHANNELS.validateExternal,
      args: ['s', 'r'],
      wire: ['s', 'r']
    },
    {
      method: 'copyFromExternal',
      channel: FILE_CHANNELS.copyFromExternal,
      args: ['s', 't', 'r', 'replace'],
      wire: ['s', 't', 'r', 'replace']
    },
    {
      method: 'moveFromExternal',
      channel: FILE_CHANNELS.moveFromExternal,
      args: ['s', 't', 'r', 'keepBoth'],
      wire: ['s', 't', 'r', 'keepBoth']
    },
    { method: 'selectExternalFiles', channel: FILE_CHANNELS.selectExternalFiles, args: [], wire: [] },
    { method: 'closeProject', channel: FILE_CHANNELS.closeProject, args: [3], wire: [3] }
  ]

  it.each(calls)('$method sends $channel with its arguments', async ({ method, channel, args, wire }) => {
    await (fileBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
    expect(ipc.invoke).toHaveBeenCalledWith(channel, ...wire)
  })

  it('writeFile sends no options argument unless it was given one', async () => {
    await fileBridge.writeFile('f', 'c')
    expect(ipc.invoke).toHaveBeenLastCalledWith(FILE_CHANNELS.writeFile, 'f', 'c')
    await fileBridge.writeFile('f', 'c', { createParentDirs: true })
    expect(ipc.invoke).toHaveBeenLastCalledWith(FILE_CHANNELS.writeFile, 'f', 'c', {
      createParentDirs: true
    })
  })

  it('covers every file channel constant', async () => {
    await fileBridge.writeFile('f', 'c')
    for (const { method, args } of calls) {
      await (fileBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    }
    const sent = new Set(ipc.invoke.mock.calls.map((call) => (call as unknown[])[0]))
    expect([...sent].sort()).toEqual(Object.values(FILE_CHANNELS).sort())
  })

  it('has one method per contract entry, and nothing else', () => {
    const expected = [...calls.map((c) => c.method), 'writeFile', 'onProjectChanged'].sort()
    expect(Object.keys(fileBridge).sort()).toEqual(expected)
  })

  it('onProjectChanged delivers the payload and unsubscribes the same listener', () => {
    const callback = vi.fn()
    const unsubscribe = fileBridge.onProjectChanged(callback)
    const [channel, listener] = ipc.on.mock.calls[0] as unknown as [string, Listener]
    expect(channel).toBe(FILE_EVENTS.projectChanged)

    const payload = { oldPath: null, newPath: 'p', generation: 1 }
    listener({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)

    unsubscribe()
    expect(ipc.removeListener).toHaveBeenCalledWith(FILE_EVENTS.projectChanged, listener)
  })
})

describe('terminal bridge', () => {
  const requests: Array<{
    method: keyof TerminalBridge
    channel: string
    args: unknown[]
    wire: unknown[]
  }> = [
    { method: 'isAvailable', channel: TERMINAL_CHANNELS.isAvailable, args: ['t'], wire: ['t'] },
    {
      method: 'create',
      channel: TERMINAL_CHANNELS.create,
      args: [{ cols: 80, rows: 24 }],
      wire: [{ cols: 80, rows: 24 }]
    },
    {
      method: 'write',
      channel: TERMINAL_CHANNELS.write,
      args: ['t', 'ls'],
      wire: [{ terminalId: 't', data: 'ls' }]
    },
    { method: 'kill', channel: TERMINAL_CHANNELS.kill, args: ['t'], wire: ['t'] },
    { method: 'getInfo', channel: TERMINAL_CHANNELS.getInfo, args: ['t'], wire: ['t'] },
    { method: 'list', channel: TERMINAL_CHANNELS.list, args: [], wire: [] },
    { method: 'getActivity', channel: TERMINAL_CHANNELS.getActivity, args: ['t'], wire: ['t'] }
  ]

  it.each(requests)('$method sends $channel', async ({ method, channel, args, wire }) => {
    await (terminalBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    expect(ipc.invoke).toHaveBeenCalledWith(channel, ...wire)
  })

  it('resize and markClearComplete are fire-and-forget sends', () => {
    terminalBridge.resize('t', 80, 24)
    expect(ipc.send).toHaveBeenLastCalledWith(TERMINAL_CHANNELS.resize, {
      terminalId: 't',
      cols: 80,
      rows: 24
    })
    terminalBridge.markClearComplete('t')
    expect(ipc.send).toHaveBeenLastCalledWith(TERMINAL_CHANNELS.clearComplete, { terminalId: 't' })
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('covers every terminal request channel constant', async () => {
    for (const { method, args } of requests) {
      await (terminalBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    }
    terminalBridge.resize('t', 80, 24)
    terminalBridge.markClearComplete('t')
    const sent = [
      ...ipc.invoke.mock.calls.map((call) => (call as unknown[])[0]),
      ...ipc.send.mock.calls.map((call) => (call as unknown[])[0])
    ]
    expect(sent.sort()).toEqual(Object.values(TERMINAL_CHANNELS).sort())
  })

  it.each([
    ['onData', TERMINAL_EVENTS.data],
    ['onExit', TERMINAL_EVENTS.exit],
    ['onError', TERMINAL_EVENTS.error],
    ['onClear', TERMINAL_EVENTS.clear]
  ] as const)('%s listens on %s, delivers the payload and unsubscribes', (method, event) => {
    const callback = vi.fn()
    const unsubscribe = terminalBridge[method](callback)
    const [channel, listener] = ipc.on.mock.calls[0] as unknown as [string, Listener]
    expect(channel).toBe(event)

    listener({}, { terminalId: 't' })
    expect(callback).toHaveBeenCalledWith({ terminalId: 't' })

    unsubscribe()
    expect(ipc.removeListener).toHaveBeenCalledWith(event, listener)
  })
})
