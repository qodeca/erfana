// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Main Process Window Creation Tests
 *
 * Tests for window creation, title configuration, and app initialization.
 * Focus on user-facing functionality like version display in title bar.
 */

/**
 * Every test here runs `vi.resetModules()` and re-imports `./index`, which
 * pulls the WHOLE main-process module graph in again — a real, known cost, not
 * a pending timer or an un-awaited promise. Under the full workspace run that
 * repeated re-import can exceed the 5 s default on a loaded machine and time
 * out a test that passes comfortably in isolation. The extra headroom only
 * applies when the import is genuinely slow; a hung test still fails.
 */
vi.setConfig({ testTimeout: 20_000 })

/** Renderer token file — the source of truth for the window's paint colour. */
const DESIGN_TOKENS_PATH = join(__dirname, '../renderer/src/styles/design-tokens.css')

/**
 * Parse `--color-brand-black` out of the renderer's design tokens.
 *
 * The main window's `backgroundColor` must equal it, otherwise the pre-paint
 * frame flashes a different colour than the app it is standing in for (#60 D).
 * Reading the token instead of hardcoding the hex means a token change fails
 * here rather than shipping a visible seam.
 */
function readBrandBlackToken(): string {
  const css = readFileSync(DESIGN_TOKENS_PATH, 'utf8')
  const match = /--color-brand-black:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css)
  if (!match) {
    throw new Error(`--color-brand-black not found in ${DESIGN_TOKENS_PATH}`)
  }
  return match[1].toLowerCase()
}

/** Lets the `app.whenReady()` promise chain in `index.ts` run to completion. */
async function flushStartup(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('Main Process - Window Creation', () => {
  let mockBrowserWindow: any
  let mockApp: any
  let mockIs: any
  let createdWindow: any
  let mockRegisterAppCrashLogging: any
  let mockRegisterWindowResponsiveness: any
  let mockRegisterWindowErrorSignals: any
  let mockRegisterQuitHandlers: any

  beforeEach(() => {
    // Reset modules to allow fresh imports
    vi.resetModules()
    delete process.env.ERFANA_E2E_FORCE_CRASH

    // Mock BrowserWindow
    createdWindow = {
      on: vi.fn(),
      show: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      // #60: the close-confirmation timeout closes the window itself when the
      // renderer never answers.
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        id: 1,
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(), // Required for destroyed event handler (issue #59)
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
        // #60: a crashed renderer can never answer the quit confirmation.
        isCrashed: vi.fn(() => false)
      }
    }

    mockBrowserWindow = vi.fn(() => createdWindow)
    // #216: registerClaudeStatusHandlers wires window-destroy cleanup over the
    // currently-open windows, so the BrowserWindow factory needs getAllWindows.
    ;(mockBrowserWindow as unknown as { getAllWindows: () => unknown[] }).getAllWindows = vi.fn(
      () => []
    )

    // Mock app
    mockApp = {
      getVersion: vi.fn(() => '0.3.7'),
      getName: vi.fn(() => 'ERFANA'),
      setName: vi.fn(),
      // #60: the E2E crash flag is gated on an unpackaged build; tests that
      // exercise the packaged path flip this before importing ./index.
      isPackaged: false,
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      // #216: claude-status handler attaches/detaches a browser-window-created
      // listener for future-window cleanup.
      removeListener: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn()
      },
      quit: vi.fn(),
      // #60: bounded before-quit shutdown must always reach app.exit(0).
      exit: vi.fn(),
      // Issue #156: Windows-only `app.setJumpList` is called from
      // src/main/index.ts:293 inside a `process.platform === 'win32'`
      // branch. On a Windows host the test runs hit that branch and the
      // call throws TypeError without this stub, cascading 21 file /
      // 151 test failures across the main project. Stub as a no-op
      // since the call site does not check the return value.
      setJumpList: vi.fn()
    }

    // Mock @electron-toolkit/utils
    mockIs = {
      dev: false,
      prod: true
    }

    // Mock electron module
    vi.doMock('electron', () => ({
      app: mockApp,
      shell: { openExternal: vi.fn() },
      BrowserWindow: mockBrowserWindow,
      Menu: {
        buildFromTemplate: vi.fn(() => ({})),
        setApplicationMenu: vi.fn()
      },
      ipcMain: {
        on: vi.fn(),
        handle: vi.fn(),
        removeHandler: vi.fn()
      },
      // #216: claude-status handler imports `webContents` for the targeted send.
      webContents: {
        fromId: vi.fn(() => null)
      },
      // #74: preview scheme registration runs at module load.
      protocol: { registerSchemesAsPrivileged: vi.fn() }
    }))

    // Mock menu module
    vi.doMock('./menu', () => ({
      createApplicationMenu: vi.fn(() => ({}))
    }))

    // Mock @electron-toolkit/utils
    vi.doMock('@electron-toolkit/utils', () => ({
      electronApp: {
        setAppUserModelId: vi.fn()
      },
      optimizer: {
        watchWindowShortcuts: vi.fn()
      },
      is: mockIs
    }))

    // Mock icon
    vi.doMock('../../resources/icon.png?asset', () => ({
      default: '/path/to/icon.png'
    }))

    // Mock service modules
    vi.doMock('./services/FileService', () => ({
      fileService: {
        setProjectPath: vi.fn() // issue #59: clear project state on destroy
      }
    }))
    vi.doMock('./services/FileWatcherService', () => ({
      fileWatcherService: {
        dispose: vi.fn(),
        setProjectPath: vi.fn(), // issue #59: clear project state on destroy
        cleanupForWebContentsId: vi.fn(() => Promise.resolve()) // issue #59
      }
    }))
    vi.doMock('./services/DirectoryWatcherService', () => ({
      directoryWatcherService: {
        dispose: vi.fn(),
        setProjectPath: vi.fn(), // issue #59: clear project state on destroy
        cleanupForWebContentsId: vi.fn(() => Promise.resolve()) // issue #59
      }
    }))
    vi.doMock('./services/TerminalService', () => ({
      terminalService: {
        dispose: vi.fn(),
        cleanupForWebContentsId: vi.fn() // issue #59
      }
    }))
    vi.doMock('./services/SettingsService', () => ({
      settingsService: {
        cleanupStaleProjects: vi.fn(() => Promise.resolve())
      }
    }))

    // Mock IPC handler registration
    vi.doMock('./ipc/file-handlers', () => ({
      registerFileHandlers: vi.fn()
    }))
    vi.doMock('./ipc/file-watcher-handlers', () => ({
      registerFileWatcherHandlers: vi.fn()
    }))
    vi.doMock('./ipc/directory-watcher-handlers', () => ({
      registerDirectoryWatcherHandlers: vi.fn()
    }))
    vi.doMock('./ipc/settings-handlers', () => ({
      registerSettingsHandlers: vi.fn()
    }))
    vi.doMock('./ipc/terminal-handlers', () => ({
      registerTerminalHandlers: vi.fn()
    }))
    vi.doMock('./ipc/import-handlers', () => ({
      registerImportHandlers: vi.fn(),
      registerDocumentImportHandlers: vi.fn()
    }))
    vi.doMock('./services/import', () => ({
      DependencyDetector: vi.fn().mockImplementation(() => ({
        detect: vi.fn().mockResolvedValue({ libreOffice: false, imageMagick: false })
      })),
      converterRegistry: {
        updateConverterExtensions: vi.fn(),
        getExtensionsByConversionType: vi.fn().mockReturnValue({ requiresConversion: ['pdf'], passthrough: [] })
      },
      getExtensionsForDependencies: vi.fn().mockReturnValue([])
    }))
    vi.doMock('../shared/ipc/import-channels', () => ({
      IMPORT_CHANNELS: {
        DOCUMENT: 'import:document',
        DOCUMENT_PROGRESS: 'import:documentProgress',
        DOCUMENT_CANCEL: 'import:documentCancel',
        GET_DOCUMENT_EXTENSIONS: 'import:getDocumentExtensions',
        DEPENDENCIES_READY: 'import:dependenciesReady'
      }
    }))
    vi.doMock('../shared/ipc/import-schema', () => ({}))
    vi.doMock('./ipc/git-handlers', () => ({
      registerGitHandlers: vi.fn()
    }))
    vi.doMock('./ipc/pdf-handlers', () => ({
      registerPdfHandlers: vi.fn()
    }))
    vi.doMock('./ipc/docx-handlers', () => ({
      registerDocxHandlers: vi.fn()
    }))
    vi.doMock('./ipc/global-settings-handlers', () => ({
      registerGlobalSettingsHandlers: vi.fn()
    }))

    // Mock GlobalSettingsService
    vi.doMock('./services/GlobalSettingsService', () => ({
      globalSettingsService: {
        initialize: vi.fn(() => Promise.resolve()),
        getSettings: vi.fn(() => ({ logging: { level: 'info', console: true } })),
        getSetting: vi.fn((key: string) => {
          if (key === 'logging') return { level: 'info', console: true }
          return undefined
        }),
        onSettingsChanged: vi.fn()
      }
    }))

    // Mock LoggingService
    vi.doMock('./services/LoggingService', () => ({
      loggingService: {
        initialize: vi.fn(() => Promise.resolve()),
        cleanupOldLogs: vi.fn(() => Promise.resolve()),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        // #60: the crash/hang trail logs through the same logger object.
        fatal: vi.fn()
      }
    }))

    // Mock renderer crash/hang handlers (#60) — wiring is asserted here, the
    // handler behaviour itself in rendererCrashHandlers.test.ts.
    mockRegisterAppCrashLogging = vi.fn()
    mockRegisterWindowResponsiveness = vi.fn()
    mockRegisterWindowErrorSignals = vi.fn()
    vi.doMock('./utils/rendererCrashHandlers', () => ({
      registerAppCrashLogging: mockRegisterAppCrashLogging,
      registerWindowResponsiveness: mockRegisterWindowResponsiveness,
      registerWindowErrorSignals: mockRegisterWindowErrorSignals
    }))

    // Mock logging handlers
    vi.doMock('./ipc/logging-handlers', () => ({
      registerLoggingHandlers: vi.fn()
    }))

    // Mock quit handlers — the registered callback is the renderer's answer to
    // `quit:requested`, driven directly by the close-timeout tests (#60).
    mockRegisterQuitHandlers = vi.fn()
    vi.doMock('./ipc/quit-handlers', () => ({
      registerQuitHandlers: mockRegisterQuitHandlers
    }))

    // Mock project lock handlers
    vi.doMock('./ipc/project-lock-handlers', () => ({
      registerProjectLockHandlers: vi.fn()
    }))

    // Mock ProjectLockService
    vi.doMock('./services/ProjectLockService', () => ({
      projectLockService: {
        acquireLock: vi.fn(() => Promise.resolve({ status: 'acquired' })),
        releaseLock: vi.fn(() => Promise.resolve()),
        checkLock: vi.fn(() => Promise.resolve({ status: 'unlocked' })),
        requestFocus: vi.fn(() => Promise.resolve(true)),
        cleanupStaleLocks: vi.fn(() => Promise.resolve(0)),
        dispose: vi.fn(() => Promise.resolve())
      }
    }))

    // Mock GitWatcherService
    vi.doMock('./services/GitWatcherService', () => ({
      gitWatcherService: {
        dispose: vi.fn(() => Promise.resolve()),
        getLastEventTimestamp: vi.fn(() => 0),
        isWatching: vi.fn(() => false),
        cleanupForWebContentsId: vi.fn(() => Promise.resolve())
      }
    }))

    // Mock GitPollingService
    vi.doMock('./services/GitPollingService', () => ({
      gitPollingService: {
        dispose: vi.fn(),
        setWatcherCoordination: vi.fn(),
        cleanupForWebContentsId: vi.fn()
      }
    }))

    // Mock git-watcher-handlers
    vi.doMock('./ipc/git-watcher-handlers', () => ({
      registerGitWatcherHandlers: vi.fn()
    }))

    // Mock LocalWhisperService
    vi.doMock('./services/LocalWhisperService', () => ({
      localWhisperService: {
        transcribe: vi.fn()
      }
    }))

    // Mock WhisperModelManager
    vi.doMock('./services/WhisperModelManager', () => ({
      whisperModelManager: {
        ensureBinary: vi.fn(),
        ensureModel: vi.fn(),
        listInstalledModels: vi.fn(() => Promise.resolve([])),
        getModelInfo: vi.fn(() => ({ size: 0, installed: false })),
        deleteModel: vi.fn()
      }
    }))

    // Mock GitStatusService — disposed as part of the before-quit shutdown (#60).
    vi.doMock('./services/GitStatusService', () => ({
      gitStatusService: {
        dispose: vi.fn(() => Promise.resolve())
      }
    }))

    // Mock claude-status handlers (#216) — its disposer joins the same
    // before-quit race, and the real one owns a chokidar watcher.
    vi.doMock('./ipc/claude-status-handlers', () => ({
      registerClaudeStatusHandlers: vi.fn(() => ({
        dispose: vi.fn(() => Promise.resolve())
      }))
    }))

    // Mock safe console
    vi.doMock('./utils/safeConsole', () => ({
      installSafeConsole: vi.fn()
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
    delete process.env.ERFANA_E2E_FORCE_CRASH
  })

  describe('Window Title Configuration', () => {
    it('should set title to "ERFANA v{version}" in production mode', async () => {
      // Set production mode
      mockIs.dev = false
      mockIs.prod = true

      // Import after mocks are set up
      await import('./index')

      // Verify BrowserWindow was called
      expect(mockBrowserWindow).toHaveBeenCalled()

      // Get the config passed to BrowserWindow
      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      // Verify title includes version in production
      expect(windowConfig.title).toBe('ERFANA v0.3.7')
    })

    it('should include the version in development mode too', async () => {
      // Set development mode
      mockIs.dev = true
      mockIs.prod = false

      // Import after mocks are set up
      await import('./index')

      // Verify BrowserWindow was called
      expect(mockBrowserWindow).toHaveBeenCalled()

      // Get the config passed to BrowserWindow
      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      // Pre-load title is "ERFANA v{version}" in all modes; the renderer takes
      // over with the project-aware title once the page loads.
      expect(windowConfig.title).toBe('ERFANA v0.3.7')
    })

    it('should read version from app.getVersion()', async () => {
      // Set production mode
      mockIs.dev = false
      mockIs.prod = true

      // Set a different version
      mockApp.getVersion.mockReturnValue('1.2.3')

      // Import after mocks are set up
      await import('./index')

      // Verify app.getVersion was called
      expect(mockApp.getVersion).toHaveBeenCalled()

      // Get the config passed to BrowserWindow
      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      // Verify title uses the version from app.getVersion()
      expect(windowConfig.title).toBe('ERFANA v1.2.3')
    })

    it('should handle different version formats correctly', async () => {
      // Set production mode
      mockIs.dev = false

      const versions = ['0.1.0', '1.0.0', '2.5.13', '10.20.30']

      for (const version of versions) {
        vi.clearAllMocks()
        vi.resetModules()

        mockApp.getVersion.mockReturnValue(version)

        // Re-setup mocks
        vi.doMock('electron', () => ({
          app: mockApp,
          shell: { openExternal: vi.fn() },
          BrowserWindow: mockBrowserWindow,
          Menu: {
            buildFromTemplate: vi.fn(() => ({})),
            setApplicationMenu: vi.fn()
          },
          ipcMain: {
            on: vi.fn(),
            handle: vi.fn(),
            removeHandler: vi.fn()
          },
          webContents: {
            fromId: vi.fn(() => null)
          },
          protocol: { registerSchemesAsPrivileged: vi.fn() }
        }))

        vi.doMock('./menu', () => ({
          createApplicationMenu: vi.fn(() => ({}))
        }))

        vi.doMock('@electron-toolkit/utils', () => ({
          electronApp: { setAppUserModelId: vi.fn() },
          optimizer: { watchWindowShortcuts: vi.fn() },
          is: mockIs
        }))

        await import('./index')

        const windowConfig = mockBrowserWindow.mock.calls[0][0]
        expect(windowConfig.title).toBe(`ERFANA v${version}`)
      }
    })
  })

  describe('Window Configuration', () => {
    it('should create window with correct dimensions', async () => {
      mockIs.dev = false

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      expect(windowConfig.width).toBe(1400)
      expect(windowConfig.height).toBe(900)
    })

    it('should create window with autoHideMenuBar enabled', async () => {
      mockIs.dev = false

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      expect(windowConfig.autoHideMenuBar).toBe(true)
    })

    it('should create window with show: false initially', async () => {
      mockIs.dev = false

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      // Window should be hidden initially, shown in ready-to-show handler
      expect(windowConfig.show).toBe(false)
    })

    it('should set up ready-to-show handler', async () => {
      mockIs.dev = false

      await import('./index')

      // Verify 'on' was called with 'ready-to-show'
      expect(createdWindow.on).toHaveBeenCalledWith('ready-to-show', expect.any(Function))
    })

    it('should set a backgroundColor so the window does not flash before first paint', async () => {
      mockIs.dev = false

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      expect('backgroundColor' in windowConfig).toBe(true)
      expect(typeof windowConfig.backgroundColor).toBe('string')
    })

    it('should paint the pre-load frame in the renderer --color-brand-black token', async () => {
      mockIs.dev = false

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      // A drifted hex here is a visible seam on every cold start, so the
      // assertion is against the token file rather than a copied literal.
      expect(String(windowConfig.backgroundColor).toLowerCase()).toBe(readBrandBlackToken())
    })
  })

  describe('Renderer Crash Instrumentation (#60)', () => {
    it('should register app-level crash logging exactly once', async () => {
      mockIs.dev = false

      await import('./index')

      expect(mockRegisterAppCrashLogging).toHaveBeenCalledTimes(1)
    })

    it('should register responsiveness logging for the created window', async () => {
      mockIs.dev = false

      await import('./index')

      expect(mockRegisterWindowResponsiveness).toHaveBeenCalledTimes(1)
      expect(mockRegisterWindowResponsiveness).toHaveBeenCalledWith(createdWindow)
    })

    it('should register entry-module error signals for the created window', async () => {
      mockIs.dev = false

      await import('./index')

      expect(mockRegisterWindowErrorSignals).toHaveBeenCalledTimes(1)
      expect(mockRegisterWindowErrorSignals).toHaveBeenCalledWith(createdWindow)
    })
  })

  describe('Close Confirmation Timeout (#60)', () => {
    /**
     * Mirrors `QUIT_CONFIRM_TIMEOUT_MS` in `src/main/index.ts`, which is module
     * private. Advancing by this much is what makes the deadline fire; the
     * `- 1` case below is what proves it had not fired yet.
     */
    const QUIT_CONFIRM_TIMEOUT_MS = 2_000

    /** Runs `createWindow` and hands back its registered `close` handler. */
    async function loadAndGetCloseHandler(): Promise<(event: any) => void> {
      mockIs.dev = false
      await import('./index')
      await flushStartup()

      const handler = createdWindow.on.mock.calls.find(
        ([event]: [string]) => event === 'close'
      )?.[1]
      expect(handler).toBeInstanceOf(Function)
      return handler
    }

    it('should ask the renderer to confirm before closing', async () => {
      const closeHandler = await loadAndGetCloseHandler()
      const event = { preventDefault: vi.fn() }

      closeHandler(event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(createdWindow.webContents.send).toHaveBeenCalledWith('quit:requested', {
        reason: 'close'
      })
      expect(createdWindow.destroy).not.toHaveBeenCalled()
    })

    it('should close on the FIRST click when the renderer has already crashed', async () => {
      // The reported defect: after a crash the click latched the quit state,
      // sent into the void and left the window open — only the second click
      // closed it.
      const closeHandler = await loadAndGetCloseHandler()
      createdWindow.webContents.isCrashed.mockReturnValue(true)
      const event = { preventDefault: vi.fn() }

      closeHandler(event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(createdWindow.webContents.send).not.toHaveBeenCalledWith(
        'quit:requested',
        expect.anything()
      )
    })

    it('should not read webContents off a destroyed window', async () => {
      // Electron throws "Object has been destroyed" on the `webContents`
      // getter of a destroyed window, which is why `isRendererGone` tests
      // `isDestroyed()` FIRST. Reversing those two lines turns a close on a
      // torn-down window into an uncaught main-process exception.
      const closeHandler = await loadAndGetCloseHandler()
      createdWindow.isDestroyed.mockReturnValue(true)
      Object.defineProperty(createdWindow, 'webContents', {
        configurable: true,
        get() {
          throw new Error('Object has been destroyed')
        }
      })
      const event = { preventDefault: vi.fn() }

      expect(() => closeHandler(event)).not.toThrow()
      // Gone renderer: the close proceeds instead of latching the quit state.
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('should close anyway when a crashed renderer never answers', async () => {
      // Crash between the click and the deadline: the confirmation can never
      // arrive, so the bounded wait completes the close.
      const closeHandler = await loadAndGetCloseHandler()
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      expect(createdWindow.destroy).not.toHaveBeenCalled()

      createdWindow.webContents.isCrashed.mockReturnValue(true)
      vi.advanceTimersByTime(QUIT_CONFIRM_TIMEOUT_MS)

      expect(createdWindow.destroy).toHaveBeenCalledTimes(1)
      expect(mockApp.quit).toHaveBeenCalled()
    })

    it('should not force the close before the timeout elapses', async () => {
      const closeHandler = await loadAndGetCloseHandler()
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      createdWindow.webContents.isCrashed.mockReturnValue(true)
      vi.advanceTimersByTime(QUIT_CONFIRM_TIMEOUT_MS - 1)

      expect(createdWindow.destroy).not.toHaveBeenCalled()
    })

    it('should never force the close while the renderer is alive', async () => {
      // The user is reading the unsaved-changes dialog. Forcing the close here
      // would discard their work — the timeout must not fire on a live renderer.
      const closeHandler = await loadAndGetCloseHandler()
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      vi.advanceTimersByTime(60_000)

      expect(createdWindow.destroy).not.toHaveBeenCalled()
      expect(mockApp.quit).not.toHaveBeenCalled()
    })

    it('should still honour a late confirmation from a live renderer', async () => {
      const closeHandler = await loadAndGetCloseHandler()
      const onQuitResponse = mockRegisterQuitHandlers.mock.calls[0][0]
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      vi.advanceTimersByTime(60_000)
      onQuitResponse(true) // user finally picked "Quit"

      expect(createdWindow.destroy).toHaveBeenCalledTimes(1)
    })

    it('should not destroy an already-destroyed window on timeout', async () => {
      const closeHandler = await loadAndGetCloseHandler()
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      createdWindow.webContents.isDestroyed.mockReturnValue(true)
      createdWindow.isDestroyed.mockReturnValue(true)
      vi.advanceTimersByTime(QUIT_CONFIRM_TIMEOUT_MS)

      expect(createdWindow.destroy).not.toHaveBeenCalled()
      expect(mockApp.quit).toHaveBeenCalled()
    })

    it('should cancel the timeout when the renderer cancels the quit', async () => {
      const closeHandler = await loadAndGetCloseHandler()
      const onQuitResponse = mockRegisterQuitHandlers.mock.calls[0][0]
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      onQuitResponse(false) // user picked "Cancel" in the confirm dialog
      createdWindow.webContents.isCrashed.mockReturnValue(true) // crash afterwards
      vi.advanceTimersByTime(10_000)

      expect(createdWindow.destroy).not.toHaveBeenCalled()
    })

    it('should not double-destroy when the renderer confirms the quit', async () => {
      const closeHandler = await loadAndGetCloseHandler()
      const onQuitResponse = mockRegisterQuitHandlers.mock.calls[0][0]
      vi.useFakeTimers()

      closeHandler({ preventDefault: vi.fn() })
      onQuitResponse(true) // user picked "Quit"
      vi.advanceTimersByTime(10_000)

      expect(createdWindow.destroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Bounded Shutdown (#60)', () => {
    /**
     * Imports `index.ts`, returns its `before-quit` handler plus a cleanup that
     * removes the shutdown-scoped `uncaughtException` listener it installs —
     * leaving it attached would swallow failures in later tests.
     */
    async function loadAndGetBeforeQuit(): Promise<{
      run: (event: any) => Promise<void>
      cleanup: () => void
    }> {
      mockIs.dev = false
      const before = process.listeners('uncaughtException')
      await import('./index')
      await flushStartup()

      const handler = mockApp.on.mock.calls.find(
        ([event]: [string]) => event === 'before-quit'
      )?.[1]
      expect(handler).toBeInstanceOf(Function)

      return {
        run: handler,
        cleanup: () => {
          for (const listener of process.listeners('uncaughtException')) {
            if (!before.includes(listener)) {
              process.removeListener('uncaughtException', listener)
            }
          }
        }
      }
    }

    it('should reach app.exit(0) when every disposer settles', async () => {
      const { run, cleanup } = await loadAndGetBeforeQuit()

      try {
        await run({ preventDefault: vi.fn() })
        expect(mockApp.exit).toHaveBeenCalledWith(0)
      } finally {
        cleanup()
      }
    })

    it('should release the project lock before the best-effort disposers', async () => {
      const { projectLockService } = (await import('./services/ProjectLockService')) as any
      const { terminalService } = (await import('./services/TerminalService')) as any
      const { run, cleanup } = await loadAndGetBeforeQuit()

      try {
        await run({ preventDefault: vi.fn() })

        expect(projectLockService.dispose).toHaveBeenCalledTimes(1)
        expect(projectLockService.dispose.mock.invocationCallOrder[0]).toBeLessThan(
          terminalService.dispose.mock.invocationCallOrder[0]
        )
      } finally {
        cleanup()
      }
    })

    it('should reach app.exit(0) even when the lock disposal never settles', async () => {
      // A wedged unlink (unreachable network share) used to leave the app alive
      // with no window, because before-quit awaited the disposer forever.
      const { projectLockService } = (await import('./services/ProjectLockService')) as any
      projectLockService.dispose.mockReturnValue(new Promise(() => {}))

      const { run, cleanup } = await loadAndGetBeforeQuit()

      try {
        vi.useFakeTimers()
        const shutdown = run({ preventDefault: vi.fn() })

        // Mirrors LOCK_DISPOSE_TIMEOUT_MS then SHUTDOWN_TIMEOUT_MS in
        // src/main/index.ts — both bounds are module private there.
        await vi.advanceTimersByTimeAsync(1_000) // LOCK_DISPOSE_TIMEOUT_MS
        await vi.advanceTimersByTimeAsync(2_000) // SHUTDOWN_TIMEOUT_MS
        await shutdown

        expect(mockApp.exit).toHaveBeenCalledWith(0)
      } finally {
        cleanup()
      }
    })

    it('should reach app.exit(0) when the lock disposal rejects', async () => {
      const { projectLockService } = (await import('./services/ProjectLockService')) as any
      projectLockService.dispose.mockRejectedValue(new Error('EBUSY'))

      const { run, cleanup } = await loadAndGetBeforeQuit()

      try {
        await run({ preventDefault: vi.fn() })
        expect(mockApp.exit).toHaveBeenCalledWith(0)
      } finally {
        cleanup()
      }
    })
  })

  describe('E2E Crash Flag (#60)', () => {
    it('should pass the crash flag to the renderer when ERFANA_E2E_FORCE_CRASH=1', async () => {
      mockIs.dev = false
      process.env.ERFANA_E2E_FORCE_CRASH = '1'

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      expect(windowConfig.webPreferences.additionalArguments).toContain('--erfana-force-crash')
    })

    it('should not pass the crash flag when the env var is unset', async () => {
      mockIs.dev = false

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      expect(windowConfig.webPreferences.additionalArguments ?? []).not.toContain(
        '--erfana-force-crash'
      )
    })

    it('should ignore the env var in a packaged build', async () => {
      mockIs.dev = false
      mockApp.isPackaged = true
      process.env.ERFANA_E2E_FORCE_CRASH = '1'

      await import('./index')

      const windowConfig = mockBrowserWindow.mock.calls[0][0]

      expect(windowConfig.webPreferences.additionalArguments ?? []).not.toContain(
        '--erfana-force-crash'
      )
    })
  })

  describe('Application Menu Configuration', () => {
    it('should set application menu on startup', async () => {
      mockIs.dev = false

      // Get mocked modules
      const { Menu } = await import('electron')
      const { createApplicationMenu } = await import('./menu')

      await import('./index')

      // Verify createApplicationMenu was called
      expect(createApplicationMenu).toHaveBeenCalledTimes(1)

      // Verify Menu.setApplicationMenu was called with the menu
      expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
      expect(Menu.setApplicationMenu).toHaveBeenCalledWith({})
    })
  })

  describe('WebGL Configuration', () => {
    it('should append WebGL command line switches', async () => {
      mockIs.dev = false

      await import('./index')

      // Verify WebGL switches were added
      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('enable-webgl')
      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('enable-webgl2-compute-context')
      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist')
    })
  })
})
