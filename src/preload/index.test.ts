// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CLIPBOARD_CHANNELS } from '../shared/ipc/clipboard-channels'

// Mock electron + toolkit before importing preload
const listeners: Record<string, Array<(e: unknown, d: any) => void>> = {}

vi.mock('electron', () => {
  return {
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, value: unknown) => {
        ;(globalThis as any).window[key] = value
      })
    },
    ipcRenderer: {
      on: vi.fn((channel: string, cb: (e: unknown, d: any) => void) => {
        ;(listeners[channel] ||= []).push(cb)
      }),
      removeListener: vi.fn((channel: string, cb: (e: unknown, d: any) => void) => {
        const arr = listeners[channel] || []
        const idx = arr.indexOf(cb)
        if (idx >= 0) arr.splice(idx, 1)
      }),
      invoke: vi.fn(async (_channel: string, ..._args: any[]) => null),
      send: vi.fn(),
      __emit: (channel: string, data: any) => {
        for (const cb of listeners[channel] || []) cb({}, data)
      }
    },
    webUtils: {
      getPathForFile: vi.fn((file: File) => `/mocked/path/${file.name}`)
    }
  }
})

vi.mock('@electron-toolkit/preload', () => {
  // Minimal stub; not used directly in tests when contextIsolated=false
  return { electronAPI: {} }
})

declare global {
  interface Window {
    api: typeof import('./index').default extends never ? any : any
  }
}

beforeEach(async () => {
  // Force non-contextIsolated branch to attach directly to window
  ;(process as any).contextIsolated = false
  // Clean module cache to re-run preload init
  vi.resetModules()
  delete (window as any).api
  // Import the preload script
  await import('./index')
})

describe('preload api exposure', () => {
  it('exposes api on window with file and terminal namespaces', () => {
    expect(window.api).toBeDefined()
    expect(typeof window.api.file.openProject).toBe('function')
    expect(typeof window.api.file.onProjectChanged).toBe('function')
    expect(typeof window.api.terminal.create).toBe('function')
  })

  it('file.openProject invokes correct IPC channel', async () => {
    const { ipcRenderer } = await import('electron')
    await window.api.file.openProject()
    expect((ipcRenderer.invoke as any)).toHaveBeenCalledWith('file:openProject')
  })

  it('onProjectChanged delivers payload with string | null', async () => {
    const { ipcRenderer } = await import('electron')
    const received: Array<{ oldPath: string | null; newPath: string | null }> = []
    const unsubscribe = window.api.file.onProjectChanged((data) => {
      // Type-level check: data.newPath accepts null
      const n: string | null = data.newPath
      received.push({ oldPath: data.oldPath, newPath: n })
    })

    ;(ipcRenderer as any).__emit('project:changed', { oldPath: '/a', newPath: null })
    ;(ipcRenderer as any).__emit('project:changed', { oldPath: null, newPath: '/b' })

    expect(received).toEqual([
      { oldPath: '/a', newPath: null },
      { oldPath: null, newPath: '/b' }
    ])

    // Unsubscribe blocks further events
    unsubscribe()
    ;(ipcRenderer as any).__emit('project:changed', { oldPath: '/x', newPath: '/y' })
    expect(received.length).toBe(2)
  })

  describe('file.moveItem parameter passing', () => {
    it('should pass all 4 parameters to IPC when replaceExisting=true', async () => {
      const { ipcRenderer } = await import('electron')

      await window.api.file.moveItem('/source/file.md', '/target', 'newname.md', true)

      expect((ipcRenderer.invoke as any)).toHaveBeenCalledWith(
        'file:moveItem',
        '/source/file.md',
        '/target',
        'newname.md',
        true
      )
    })

    it('should pass all 4 parameters to IPC when replaceExisting=false', async () => {
      const { ipcRenderer } = await import('electron')

      await window.api.file.moveItem('/source/file.md', '/target', undefined, false)

      expect((ipcRenderer.invoke as any)).toHaveBeenCalledWith(
        'file:moveItem',
        '/source/file.md',
        '/target',
        undefined,
        false
      )
    })

    it('should pass replaceExisting=undefined when not provided', async () => {
      const { ipcRenderer } = await import('electron')

      await window.api.file.moveItem('/source/file.md', '/target')

      // Should be called with 4 arguments, last being undefined
      const calls = (ipcRenderer.invoke as any).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall).toHaveLength(5) // channel + 4 parameters
      expect(lastCall[0]).toBe('file:moveItem')
      expect(lastCall[1]).toBe('/source/file.md')
      expect(lastCall[2]).toBe('/target')
      expect(lastCall[3]).toBeUndefined()
      expect(lastCall[4]).toBeUndefined()
    })

    it('should pass newName without replaceExisting', async () => {
      const { ipcRenderer } = await import('electron')

      await window.api.file.moveItem('/source/file.md', '/target', 'renamed.md')

      const calls = (ipcRenderer.invoke as any).mock.calls
      const lastCall = calls[calls.length - 1]
      expect(lastCall).toEqual([
        'file:moveItem',
        '/source/file.md',
        '/target',
        'renamed.md',
        undefined
      ])
    })
  })
})

/**
 * Tests for the central text-clipboard bridge.
 *
 * Asserts api.clipboard.readText/writeText route to ipcRenderer.invoke with the
 * CLIPBOARD_CHANNELS names and pass the payload through unchanged.
 *
 * @see Issue #203 - Central text-clipboard service
 */
describe('clipboard bridge', () => {
  it('exposes clipboard namespace with readText/writeText', () => {
    expect(window.api.clipboard).toBeDefined()
    expect(typeof window.api.clipboard.readText).toBe('function')
    expect(typeof window.api.clipboard.writeText).toBe('function')
  })

  it('readText invokes the readText channel with no payload', async () => {
    const { ipcRenderer } = await import('electron')

    await window.api.clipboard.readText()

    expect((ipcRenderer.invoke as any)).toHaveBeenCalledWith(CLIPBOARD_CHANNELS.readText)
  })

  it('writeText invokes the writeText channel and passes the text through', async () => {
    const { ipcRenderer } = await import('electron')

    await window.api.clipboard.writeText('hello clipboard')

    expect((ipcRenderer.invoke as any)).toHaveBeenCalledWith(
      CLIPBOARD_CHANNELS.writeText,
      'hello clipboard'
    )
  })
})

/**
 * Tests for utils.getPathForFile API
 *
 * This API wraps Electron's webUtils.getPathForFile() to get absolute
 * file paths from File objects in sandboxed renderers.
 *
 * @see Issue #85 - Terminal drag-and-drop file path insertion
 */
describe('utils.getPathForFile', () => {
  it('should expose utils namespace on window.api', () => {
    expect(window.api.utils).toBeDefined()
    expect(typeof window.api.utils.getPathForFile).toBe('function')
  })

  it('should call webUtils.getPathForFile and return the path', async () => {
    const { webUtils } = await import('electron')
    const mockFile = new File(['content'], 'test-file.txt', { type: 'text/plain' })

    const result = window.api.utils.getPathForFile(mockFile)

    expect(webUtils.getPathForFile).toHaveBeenCalledWith(mockFile)
    expect(result).toBe('/mocked/path/test-file.txt')
  })

  it('should handle files with spaces in name', async () => {
    const { webUtils } = await import('electron')
    const mockFile = new File([''], 'file with spaces.md', { type: 'text/markdown' })

    const result = window.api.utils.getPathForFile(mockFile)

    expect(webUtils.getPathForFile).toHaveBeenCalledWith(mockFile)
    expect(result).toBe('/mocked/path/file with spaces.md')
  })

  it('should handle files with special characters in name', async () => {
    const { webUtils } = await import('electron')
    const mockFile = new File([''], "file'with\"quotes.txt", { type: 'text/plain' })

    const result = window.api.utils.getPathForFile(mockFile)

    expect(webUtils.getPathForFile).toHaveBeenCalledWith(mockFile)
    expect(result).toBe("/mocked/path/file'with\"quotes.txt")
  })

  it('should handle files with unicode characters in name', async () => {
    const { webUtils } = await import('electron')
    const mockFile = new File([''], 'ファイル名.txt', { type: 'text/plain' })

    const result = window.api.utils.getPathForFile(mockFile)

    expect(webUtils.getPathForFile).toHaveBeenCalledWith(mockFile)
    expect(result).toBe('/mocked/path/ファイル名.txt')
  })

  it('should handle files with long names', async () => {
    const { webUtils } = await import('electron')
    const longName = 'a'.repeat(200) + '.txt'
    const mockFile = new File([''], longName, { type: 'text/plain' })

    const result = window.api.utils.getPathForFile(mockFile)

    expect(webUtils.getPathForFile).toHaveBeenCalledWith(mockFile)
    expect(result).toBe(`/mocked/path/${longName}`)
  })
})

