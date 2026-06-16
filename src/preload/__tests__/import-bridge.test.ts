// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload bridge tests – api.import.*
 *
 * Tests that each api.import method correctly delegates to ipcRenderer
 * and that event-subscription methods return working cleanup functions.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// vi.hoisted() ensures mock references are available when vi.mock factories
// run (vi.mock is hoisted above imports, plain const declarations are not).
// ---------------------------------------------------------------------------

const { mockInvoke, mockOn, mockRemoveListener } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOn: vi.fn(),
  mockRemoveListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((key: string, api: unknown) => {
      ;(globalThis as Record<string, unknown>)[key] = api
    })
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
    send: vi.fn(),
    sendSync: vi.fn()
  },
  webUtils: {
    getPathForFile: vi.fn()
  }
}))

vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
      removeListener: mockRemoveListener,
      send: vi.fn(),
      sendSync: vi.fn()
    },
    webFrame: { insertCSS: vi.fn(), setZoomFactor: vi.fn(), setZoomLevel: vi.fn() },
    webUtils: { getPathForFile: vi.fn() },
    process: { platform: 'darwin', versions: {}, env: {} }
  },
  exposeElectronAPI: vi.fn()
}))

// Import the preload entry point AFTER all mocks are registered.
import '../index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ImportBridge = {
  documentImport: (request: unknown) => Promise<unknown>
  cancelDocument: () => Promise<unknown>
  getDocumentExtensions: () => Promise<unknown>
  onDocumentProgress: (cb: (data: unknown) => void) => () => void
  onDependenciesReady: (cb: (data: unknown) => void) => () => void
}

function getImportApi(): ImportBridge {
  const api = (globalThis as Record<string, unknown>).api as Record<string, unknown>
  return api.import as ImportBridge
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api.import – document import bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('documentImport invokes import:document channel with request', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, outputPath: '/tmp/document.md' })

    const request = { filePath: '/tmp/document.pdf', options: { ocr: true } }
    await getImportApi().documentImport(request)

    expect(mockInvoke).toHaveBeenCalledWith('import:document', request)
  })

  it('cancelDocument invokes import:documentCancel channel', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true })

    await getImportApi().cancelDocument()

    expect(mockInvoke).toHaveBeenCalledWith('import:documentCancel')
  })

  it('getDocumentExtensions invokes import:getDocumentExtensions channel', async () => {
    mockInvoke.mockResolvedValueOnce(['pdf', 'docx'])

    await getImportApi().getDocumentExtensions()

    expect(mockInvoke).toHaveBeenCalledWith('import:getDocumentExtensions')
  })

  it('onDocumentProgress subscribes and returns cleanup function', () => {
    const callback = vi.fn()

    const cleanup = getImportApi().onDocumentProgress(callback)

    expect(mockOn).toHaveBeenCalledWith('import:documentProgress', expect.any(Function))
    expect(typeof cleanup).toBe('function')
  })

  it('onDocumentProgress cleanup calls removeListener', () => {
    const callback = vi.fn()

    getImportApi().onDocumentProgress(callback)

    // Rebuild the cleanup – call onDocumentProgress again to get a fresh one
    // (vi.clearAllMocks runs between tests, but within this test we have one call).
    // Re-subscribe and extract cleanup from the second call.
    vi.clearAllMocks()

    const cleanup = getImportApi().onDocumentProgress(callback)
    const listener = mockOn.mock.calls[0][1]

    cleanup()

    expect(mockRemoveListener).toHaveBeenCalledWith('import:documentProgress', listener)
  })

  it('onDocumentProgress listener forwards payload to callback', () => {
    const callback = vi.fn()

    getImportApi().onDocumentProgress(callback)

    // Simulate ipcRenderer firing the progress event.
    const listener = mockOn.mock.calls[0][1] as (_event: unknown, data: unknown) => void
    const progress = { percent: 50, phase: 'Converting...' }
    listener(null, progress)

    expect(callback).toHaveBeenCalledWith(progress)
  })

  it('onDependenciesReady subscribes and returns cleanup function', () => {
    const callback = vi.fn()

    const cleanup = getImportApi().onDependenciesReady(callback)

    expect(mockOn).toHaveBeenCalledWith('import:dependenciesReady', expect.any(Function))
    expect(typeof cleanup).toBe('function')
  })

  it('onDependenciesReady cleanup calls removeListener', () => {
    const callback = vi.fn()

    const cleanup = getImportApi().onDependenciesReady(callback)
    const registeredListener = mockOn.mock.calls[0][1]

    cleanup()

    expect(mockRemoveListener).toHaveBeenCalledWith(
      'import:dependenciesReady',
      registeredListener
    )
  })

  it('onDependenciesReady listener forwards payload to callback', () => {
    const callback = vi.fn()

    getImportApi().onDependenciesReady(callback)

    const listener = mockOn.mock.calls[0][1] as (_event: unknown, data: unknown) => void
    const event = { libreOffice: true, imageMagick: false, extensions: ['pdf'] }
    listener(null, event)

    expect(callback).toHaveBeenCalledWith(event)
  })
})
