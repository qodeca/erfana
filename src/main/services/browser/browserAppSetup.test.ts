// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registerSchemesAsPrivileged, fromPath, mockLogger } = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  fromPath: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged },
  session: { fromPath },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: vi.fn(),
    decryptString: vi.fn()
  },
  shell: { openExternal: vi.fn() },
  WebContentsView: vi.fn()
}))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../ipc/senderValidation', () => ({ RENDERER_FILE_URL: 'file:///app/out/renderer/index.html' }))
vi.mock('../../ipc/browser-tab-handlers', () => ({ registerBrowserTabHandlers: vi.fn() }))

import {
  BROWSER_DISK_CACHE_BYTES,
  closeBrowserWindow,
  currentAppAddresses,
  flushBrowserProfiles,
  getBrowserRuntime,
  installBrowserAfterReady,
  installBrowserBeforeReady
} from './browserAppSetup'
import { browserSessionRegistry } from './browserSessionRegistry'
import { ProjectSessionStore } from '../session/ProjectSession'

describe('browserAppSetup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('before ready: registers the schemes once, caps the disk cache at 512 MB, installs the gated baseline', () => {
    const appendSwitch = vi.fn()
    let created: ((e: unknown, wc: unknown) => void) | undefined
    installBrowserBeforeReady({
      commandLine: { appendSwitch } as never,
      on: ((event: string, listener: (e: unknown, wc: unknown) => void) => {
        if (event === 'web-contents-created') created = listener
      }) as never
    })
    expect(registerSchemesAsPrivileged).toHaveBeenCalledTimes(1)
    expect(BROWSER_DISK_CACHE_BYTES).toBe(536870912)
    expect(appendSwitch).toHaveBeenCalledWith('disk-cache-size', '536870912')

    // 025-NFR-001: the baseline still applies to a view outside browser sessions
    const setWindowOpenHandler = vi.fn()
    created!({}, { id: 99_001, session: {}, isDestroyed: () => false, setWindowOpenHandler, on: vi.fn(), getURL: () => '' })
    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1)

    // S8: an unknown webContents in a browser session gets the baseline and is closed
    const browserSession = {}
    browserSessionRegistry.registerSession(browserSession)
    const close = vi.fn()
    const intruder = {
      id: 99_002,
      session: browserSession,
      isDestroyed: () => false,
      once: vi.fn(),
      close,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      getURL: () => ''
    }
    created!({}, intruder)
    expect(intruder.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    return Promise.resolve().then(() => expect(close).toHaveBeenCalledTimes(1))
  })

  it("after ready: the default session refuses erfana-local and the runtime follows the project session", async () => {
    const handle = vi.fn()
    const projectSession = new ProjectSessionStore()
    const onChange = vi.spyOn(projectSession, 'onChange')
    const registerTabHandlers = vi.fn()
    const runtime = installBrowserAfterReady({
      defaultSession: { protocol: { handle } } as never,
      projectSession,
      lockService: { checkLock: vi.fn(), acquireLock: vi.fn() },
      registerTabHandlers
    })
    expect(registerTabHandlers).toHaveBeenCalledWith({ service: runtime.tabs })
    expect(handle).toHaveBeenCalledWith('erfana-local', expect.any(Function))
    const response = (handle.mock.calls[0][1] as (r: Request) => Response)(new Request('erfana-local://h/x'))
    expect(response.status).toBe(403)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(getBrowserRuntime()).toBe(runtime)
    // No browser session is created until a tab asks for one
    expect(fromPath).not.toHaveBeenCalled()
    await expect(runtime.profiles.openForTab()).rejects.toMatchObject({ code: 'no-project' })
  })

  it('closes a closing window\'s tabs, and closes the old project\'s tabs when the project changes', async () => {
    const projectSession = new ProjectSessionStore()
    const runtime = installBrowserAfterReady({
      defaultSession: { protocol: { handle: vi.fn() } } as never,
      projectSession,
      lockService: { checkLock: vi.fn(), acquireLock: vi.fn() },
      registerTabHandlers: vi.fn()
    })
    const closeWindow = vi.spyOn(runtime.tabs, 'closeWindow')
    closeBrowserWindow(7)
    expect(closeWindow).toHaveBeenCalledWith(7)
    closeWindow.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => closeBrowserWindow(8)).not.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith('Browser teardown on window close failed', expect.objectContaining({ windowId: 8 }))

    const closeProject = vi.spyOn(runtime.tabs, 'closeProject')
    await runtime.teardown.run('/projects/a')
    expect(closeProject).toHaveBeenCalledWith('/projects/a')
  })

  it('names the renderer entry and the resources folder as app addresses, and no dev server outside development', () => {
    expect(currentAppAddresses()).toEqual({
      rendererEntry: 'file:///app/out/renderer/index.html',
      resourcesDir: process.resourcesPath,
      devServerOrigin: null
    })
  })

  it('flushes the cookies and storage of every profile opened in this run, and never rejects', async () => {
    const runtime = installBrowserAfterReady({
      defaultSession: { protocol: { handle: vi.fn() } } as never,
      projectSession: new ProjectSessionStore(),
      lockService: { checkLock: vi.fn(), acquireLock: vi.fn() },
      registerTabHandlers: vi.fn()
    })
    const flushStore = vi.fn(async () => Promise.reject(new Error('gone')))
    const flushStorageData = vi.fn()
    vi.spyOn(runtime.profiles, 'openSessions').mockResolvedValue([{ cookies: { flushStore }, flushStorageData }])
    await expect(flushBrowserProfiles()).resolves.toBeUndefined()
    expect(flushStore).toHaveBeenCalledTimes(1)
    expect(flushStorageData).toHaveBeenCalledTimes(1)
  })
})
