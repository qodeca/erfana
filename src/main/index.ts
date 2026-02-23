import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { spawnNewInstance } from './utils/spawnNewInstance'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerFileWatcherHandlers } from './ipc/file-watcher-handlers'
import { registerDirectoryWatcherHandlers } from './ipc/directory-watcher-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerTerminalHandlers } from './ipc/terminal-handlers'
import { registerImportHandlers } from './ipc/import-handlers'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerGitWatcherHandlers } from './ipc/git-watcher-handlers'
import { registerPdfHandlers } from './ipc/pdf-handlers'
import { registerDocxHandlers } from './ipc/docx-handlers'
import { registerScreenshotHandlers } from './ipc/screenshot-handlers'
import { registerShellHandlers } from './ipc/shell-handlers'
import { registerCameraHandlers } from './ipc/camera-handlers'
import { registerGlobalSettingsHandlers } from './ipc/global-settings-handlers'
import { registerLoggingHandlers } from './ipc/logging-handlers'
import { registerQuitHandlers } from './ipc/quit-handlers'
import { registerProjectLockHandlers } from './ipc/project-lock-handlers'
import { registerExternalFileHandlers } from './ipc/external-file-handlers'
import { createApplicationMenu } from './menu'
import { fileService } from './services/FileService'
import { fileWatcherService } from './services/FileWatcherService'
import { directoryWatcherService } from './services/DirectoryWatcherService'
import { terminalService } from './services/TerminalService'
import { settingsService } from './services/SettingsService'
import { globalSettingsService } from './services/GlobalSettingsService'
import { loggingService, logger } from './services/LoggingService'
import { gitWatcherService } from './services/GitWatcherService'
import { gitPollingService } from './services/GitPollingService'
import { projectLockService } from './services/ProjectLockService'
import { installSafeConsole } from './utils/safeConsole'

// Install safe console logging to prevent EPIPE crashes
// Must be called before any other code that uses console.log
installSafeConsole()

// Strip --new-window flag to prevent infinite spawn loops
// Must happen before any window creation
const newWindowArgIndex = process.argv.indexOf('--new-window')
if (newWindowArgIndex !== -1) {
  process.argv.splice(newWindowArgIndex, 1)
}

// Quit confirmation state
let isQuitting = false
let mainWindowRef: BrowserWindow | null = null

// WebGL Command Line Switches (originally added for Electron 33+)
// Fixes WebGL context creation issues and terminal flickering in production builds
// TODO: Test if still needed with Electron 39+ (Chromium 142)
app.commandLine.appendSwitch('enable-webgl')
app.commandLine.appendSwitch('enable-webgl2-compute-context')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

function createWindow(): BrowserWindow {
  // Create the browser window.
  // In production, show version in title bar for easy identification
  const windowTitle = is.dev ? 'ERFANA' : `ERFANA v${app.getVersion()}`

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    title: windowTitle,
    roundedCorners: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox: true is the default since Electron 20 (2022)
      // Renderer process is sandboxed for security, preload scripts work correctly
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true
      // experimentalFeatures removed - not needed for current functionality
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Handle window close with confirmation
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    // If webContents is already destroyed (e.g., during E2E test teardown),
    // let the close proceed without attempting to show a confirmation dialog
    if (mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    isQuitting = true
    mainWindow.webContents.send('quit:requested', { reason: 'close' })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Cleanup services when webContents is destroyed (window close or dev refresh - issue #59)
  // This prevents stale watchers and terminal processes from accumulating
  // CRITICAL: Must also clear project state so new window can re-open the same project
  const webContentsId = mainWindow.webContents.id
  mainWindow.webContents.on('destroyed', () => {
    logger.info('WebContents destroyed, cleaning up services', { webContentsId })

    // CRITICAL FIX (issue #59): Clear project state in services
    // Without this, ProjectService.isSameProject() returns true and does 'noop'
    // when user clicks same project in new window, causing empty file tree
    fileService.setProjectPath('')
    fileWatcherService.setProjectPath('')
    directoryWatcherService.setProjectPath('')

    // Cleanup watcher services asynchronously
    // Pattern: Fire-and-forget with error logging - cleanup must not block the destroyed event
    // Errors are logged but don't halt further cleanup operations
    fileWatcherService.cleanupForWebContentsId(webContentsId).catch((err) => {
      logger.error('Error cleaning up file watchers', err instanceof Error ? err : undefined)
    })

    directoryWatcherService.cleanupForWebContentsId(webContentsId).catch((err) => {
      logger.error('Error cleaning up directory watchers', err instanceof Error ? err : undefined)
    })

    // Cleanup terminals owned by this webContents (synchronous)
    try {
      terminalService.cleanupForWebContentsId(webContentsId)
    } catch (err) {
      logger.error('Error cleaning up terminals', err instanceof Error ? err : undefined)
    }

    // Cleanup git watcher (async fire-and-forget pattern - issue #106)
    gitWatcherService.cleanupForWebContentsId(webContentsId).catch((err) => {
      logger.error('Error cleaning up git watcher', err instanceof Error ? err : undefined)
    })

    // Cleanup git polling (synchronous - issue #106)
    try {
      gitPollingService.cleanupForWebContentsId(webContentsId)
    } catch (err) {
      logger.error('Error cleaning up git polling', err instanceof Error ? err : undefined)
    }

    logger.info('Service cleanup initiated for webContents', { webContentsId })
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Store reference for quit handling
  mainWindowRef = mainWindow

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set application name (shows in macOS menu bar)
  app.setName('ERFANA')

  // Set application menu with Edit roles for native clipboard support
  // Required for Cmd+C/V to work in textarea and input elements
  Menu.setApplicationMenu(createApplicationMenu())

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.erfana')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize global settings service (creates ~/.erfana/settings.json if needed)
  await globalSettingsService.initialize()

  // Initialize logging service (after global settings so level is loaded)
  await loggingService.initialize()

  // Wire up git polling service coordination with watcher service (DIP pattern)
  gitPollingService.setWatcherCoordination(
    () => gitWatcherService.getLastEventTimestamp(),
    () => gitWatcherService.isWatching()
  )

  // Register IPC handlers
  registerFileHandlers()
  registerFileWatcherHandlers()
  registerDirectoryWatcherHandlers()
  registerSettingsHandlers()
  registerTerminalHandlers()
  registerImportHandlers()
  registerGitHandlers()
  registerGitWatcherHandlers()
  registerPdfHandlers()
  registerDocxHandlers()
  registerScreenshotHandlers()
  registerShellHandlers()
  registerCameraHandlers()
  registerGlobalSettingsHandlers()
  registerLoggingHandlers()
  registerProjectLockHandlers()
  registerExternalFileHandlers()

  // RELIABILITY FIX (todo012): Clean up stale projects on startup
  // This runs asynchronously but doesn't block window creation
  settingsService.cleanupStaleProjects().catch((error) => {
    logger.error('Failed to cleanup stale projects on startup', error instanceof Error ? error : undefined)
  })

  // Cleanup old logs (fire-and-forget, 7-day retention)
  loggingService.cleanupOldLogs().catch((error) => {
    logger.error('Failed to cleanup old logs', error instanceof Error ? error : undefined)
  })

  // Fire-and-forget stale lock cleanup - doesn't block startup
  projectLockService.cleanupStaleLocks().catch((error) => {
    logger.error('Failed to cleanup stale locks', error instanceof Error ? error : undefined)
  })

  // Create main window
  createWindow()

  // Register quit confirmation handler
  registerQuitHandlers((proceed) => {
    try {
      if (proceed && mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.destroy()
        app.quit()
      } else {
        isQuitting = false
      }
    } catch (error) {
      logger.error('Error during quit', error instanceof Error ? error : undefined)
      isQuitting = false // Reset flag to allow retry
    }
  })

  // macOS dock menu with "New Window" option
  if (process.platform === 'darwin') {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'New Window',
        click: (): void => {
          spawnNewInstance()
        }
      }
    ])
    app.dock?.setMenu(dockMenu)
  }

  // Windows taskbar jump list with "New Window" task
  if (process.platform === 'win32') {
    app.setJumpList([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            title: 'New Window',
            description: 'Open a new Erfana window',
            program: process.execPath,
            args: '--new-window',
            iconPath: process.execPath,
            iconIndex: 0
          }
        ]
      }
    ])
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed
// Note: On macOS, apps typically stay active but we want consistent quit behavior
// since confirmation already happened via close handler
app.on('window-all-closed', () => {
  app.quit()
})

// Cleanup file watchers, directory watchers, terminals, git watchers, and project locks before app quits
// NOTE: Electron's before-quit doesn't await async handlers, so cleanup is best-effort.
// Lock files may remain stale on forced quit - they will be cleaned up on next startup.
app.on('before-quit', async () => {
  logger.info('App quitting, cleaning up services')
  await fileWatcherService.dispose()
  await directoryWatcherService.dispose()
  await terminalService.dispose()
  await gitWatcherService.dispose()
  gitPollingService.dispose()
  await projectLockService.dispose()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
