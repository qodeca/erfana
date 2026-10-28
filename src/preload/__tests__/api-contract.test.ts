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
          "findByName": "file:findByName",
          "getProjectPath": "file:getProjectPath",
          "getSession": "file:getSession",
          "getStats": "file:getStats",
          "moveBatchFromExternal": "file:moveBatchFromExternal",
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
          "ackOutput": "terminal:ackOutput",
          "clearComplete": "terminal:clearComplete",
          "create": "terminal:create",
          "getActivity": "terminal:getActivity",
          "getInfo": "terminal:getInfo",
          "getScreenReaderSupport": "terminal:getScreenReaderSupport",
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
          "screenReaderSupportChanged": "terminal:screenReaderSupportChanged",
        },
      }
    `)
  })
})

describe('file bridge', () => {
  /**
   * Every request method, called with the request object the contract takes. The
   * bridge passes the object through as it is: the wire is that one argument.
   */
  const calls: Array<{
    method: keyof FileBridge
    channel: string
    args: unknown[]
  }> = [
    { method: 'openProject', channel: FILE_CHANNELS.openProject, args: [] },
    { method: 'openProjectByPath', channel: FILE_CHANNELS.openProjectByPath, args: [{ projectPath: 'p' }] },
    { method: 'getSession', channel: FILE_CHANNELS.getSession, args: [] },
    { method: 'readDirectory', channel: FILE_CHANNELS.readDirectory, args: [{ dirPath: 'd' }] },
    { method: 'findByName', channel: FILE_CHANNELS.findByName, args: [{ dirPath: 'd', name: 'a.md' }] },
    { method: 'readFile', channel: FILE_CHANNELS.readFile, args: [{ filePath: 'f' }] },
    { method: 'writeFile', channel: FILE_CHANNELS.writeFile, args: [{ filePath: 'f', content: 'c' }] },
    {
      method: 'writeFile',
      channel: FILE_CHANNELS.writeFile,
      args: [{ filePath: 'f', content: 'c', createParentDirs: true, generation: 4 }]
    },
    { method: 'getStats', channel: FILE_CHANNELS.getStats, args: [{ filePath: 'f' }] },
    { method: 'exists', channel: FILE_CHANNELS.exists, args: [{ filePath: 'f' }] },
    { method: 'getProjectPath', channel: FILE_CHANNELS.getProjectPath, args: [] },
    { method: 'createFile', channel: FILE_CHANNELS.createFile, args: [{ dirPath: 'd', name: 'n' }] },
    { method: 'createFolder', channel: FILE_CHANNELS.createFolder, args: [{ dirPath: 'd', name: 'n' }] },
    { method: 'deleteFile', channel: FILE_CHANNELS.deleteFile, args: [{ filePath: 'f' }] },
    { method: 'deleteFolder', channel: FILE_CHANNELS.deleteFolder, args: [{ filePath: 'd' }] },
    { method: 'rename', channel: FILE_CHANNELS.rename, args: [{ oldPath: 'o', newName: 'n' }] },
    { method: 'revealInFileManager', channel: FILE_CHANNELS.revealInFileManager, args: [{ filePath: 'f' }] },
    {
      method: 'moveItem',
      channel: FILE_CHANNELS.moveItem,
      args: [{ sourcePath: 's', targetParentPath: 't', newName: 'n', replaceExisting: true }]
    },
    {
      method: 'copyItem',
      channel: FILE_CHANNELS.copyItem,
      args: [{ sourcePath: 's', targetParentPath: 't', newName: 'n' }]
    },
    {
      method: 'checkConflict',
      channel: FILE_CHANNELS.checkConflict,
      args: [{ targetParentPath: 't', itemName: 'n' }]
    },
    { method: 'validatePath', channel: FILE_CHANNELS.validatePath, args: [{ filePath: 'f' }] },
    { method: 'readImage', channel: FILE_CHANNELS.readImage, args: [{ filePath: 'f', knownVersion: 'v' }] },
    { method: 'validateExternal', channel: FILE_CHANNELS.validateExternal, args: [{ sourcePath: 's' }] },
    {
      method: 'copyFromExternal',
      channel: FILE_CHANNELS.copyFromExternal,
      args: [{ sourcePath: 's', targetFolder: 't', conflictResolution: 'replace' }]
    },
    {
      method: 'moveFromExternal',
      channel: FILE_CHANNELS.moveFromExternal,
      args: [{ sourcePath: 's', targetFolder: 't', conflictResolution: 'keepBoth' }]
    },
    {
      method: 'moveBatchFromExternal',
      channel: FILE_CHANNELS.moveBatchFromExternal,
      args: [
        {
          items: [{ sourcePath: 's1' }, { sourcePath: 's2', conflictResolution: 'replace' }],
          targetFolder: 't'
        }
      ]
    },
    { method: 'selectExternalFiles', channel: FILE_CHANNELS.selectExternalFiles, args: [] },
    { method: 'closeProject', channel: FILE_CHANNELS.closeProject, args: [{ expectedGeneration: 3 }] },
    { method: 'closeProject', channel: FILE_CHANNELS.closeProject, args: [] }
  ]

  /** Methods that take no request: nothing but the channel goes on the wire. */
  const NO_REQUEST = new Set<keyof FileBridge>([
    'openProject',
    'getSession',
    'getProjectPath',
    'selectExternalFiles'
  ])

  it.each(calls)('$method sends $channel with its request object', async ({ method, channel, args }) => {
    await (fileBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
    // At most one argument on the wire: the request object itself, not a copy spread into positions
    const [sentChannel, ...wire] = ipc.invoke.mock.calls[0] as unknown[]
    expect(sentChannel).toBe(channel)
    if (NO_REQUEST.has(method)) {
      expect(wire).toEqual([])
    } else {
      expect(wire).toHaveLength(1)
      expect(wire[0]).toBe(args[0])
    }
  })

  it('passes no project root on any external-file channel', async () => {
    await fileBridge.validateExternal({ sourcePath: 's' })
    await fileBridge.copyFromExternal({ sourcePath: 's', targetFolder: 't' })
    await fileBridge.moveFromExternal({ sourcePath: 's', targetFolder: 't' })
    for (const call of ipc.invoke.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('projectRoot')
    }
  })

  it('covers every file channel constant', async () => {
    for (const { method, args } of calls) {
      await (fileBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    }
    const sent = new Set(ipc.invoke.mock.calls.map((call) => (call as unknown[])[0]))
    expect([...sent].sort()).toEqual(Object.values(FILE_CHANNELS).sort())
  })

  it('has one method per contract entry, and nothing else', () => {
    const expected = [...new Set(calls.map((c) => c.method)), 'onProjectChanged'].sort()
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
    { method: 'getActivity', channel: TERMINAL_CHANNELS.getActivity, args: ['t'], wire: ['t'] },
    // Payload-free: nothing travels with the request (lens review [23])
    { method: 'getScreenReaderSupport', channel: TERMINAL_CHANNELS.getScreenReaderSupport, args: [], wire: [] }
  ]

  it.each(requests)('$method sends $channel', async ({ method, channel, args, wire }) => {
    await (terminalBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    expect(ipc.invoke).toHaveBeenCalledWith(channel, ...wire)
  })

  it('resize, markClearComplete and ackOutput are fire-and-forget sends', () => {
    terminalBridge.resize('t', 80, 24)
    expect(ipc.send).toHaveBeenLastCalledWith(TERMINAL_CHANNELS.resize, {
      terminalId: 't',
      cols: 80,
      rows: 24
    })
    terminalBridge.markClearComplete('t')
    expect(ipc.send).toHaveBeenLastCalledWith(TERMINAL_CHANNELS.clearComplete, { terminalId: 't' })
    terminalBridge.ackOutput('t', 4096)
    expect(ipc.send).toHaveBeenLastCalledWith(TERMINAL_CHANNELS.ackOutput, { terminalId: 't', chars: 4096 })
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('covers every terminal request channel constant', async () => {
    for (const { method, args } of requests) {
      await (terminalBridge[method] as (...a: unknown[]) => Promise<unknown>)(...args)
    }
    terminalBridge.resize('t', 80, 24)
    terminalBridge.markClearComplete('t')
    terminalBridge.ackOutput('t', 1)
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
    ['onClear', TERMINAL_EVENTS.clear],
    ['onScreenReaderSupportChanged', TERMINAL_EVENTS.screenReaderSupportChanged]
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
