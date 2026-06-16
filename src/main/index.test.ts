// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Main Process Window Creation Tests
 *
 * Tests for window creation, title configuration, and app initialization.
 * Focus on user-facing functionality like version display in title bar.
 */

describe('Main Process - Window Creation', () => {
  let mockBrowserWindow: any
  let mockApp: any
  let mockIs: any
  let createdWindow: any

  beforeEach(() => {
    // Reset modules to allow fresh imports
    vi.resetModules()

    // Mock BrowserWindow
    createdWindow = {
      on: vi.fn(),
      show: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: {
        id: 1,
        setWindowOpenHandler: vi.fn(),
        on: vi.fn() // Required for destroyed event handler (issue #59)
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
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      // #216: claude-status handler attaches/detaches a browser-window-created
      // listener for future-window cleanup.
      removeListener: vi.fn(),
      commandLine: {
        appendSwitch: vi.fn()
      },
      quit: vi.fn(),
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
      }
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
        error: vi.fn()
      }
    }))

    // Mock logging handlers
    vi.doMock('./ipc/logging-handlers', () => ({
      registerLoggingHandlers: vi.fn()
    }))

    // Mock quit handlers
    vi.doMock('./ipc/quit-handlers', () => ({
      registerQuitHandlers: vi.fn()
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

    // Mock safe console
    vi.doMock('./utils/safeConsole', () => ({
      installSafeConsole: vi.fn()
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
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
          }
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
