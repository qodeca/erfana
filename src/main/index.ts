// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawnNewInstance } from './utils/spawnNewInstance'
import { installIpcSenderGate } from './ipc/ipcSenderGate'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerFileWatcherHandlers } from './ipc/file-watcher-handlers'
import { registerDirectoryWatcherHandlers } from './ipc/directory-watcher-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { registerTerminalHandlers } from './ipc/terminal-handlers'
import { registerImportHandlers, registerDocumentImportHandlers } from './ipc/import-handlers'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerGitWatcherHandlers } from './ipc/git-watcher-handlers'
import { registerPdfHandlers } from './ipc/pdf-handlers'
import { registerDocxHandlers } from './ipc/docx-handlers'
import { registerScreenshotHandlers } from './ipc/screenshot-handlers'
import { registerShellHandlers } from './ipc/shell-handlers'
import { registerSystemHandlers } from './ipc/system-handlers'
import { registerCameraHandlers } from './ipc/camera-handlers'
import { registerGlobalSettingsHandlers } from './ipc/global-settings-handlers'
import { registerLoggingHandlers } from './ipc/logging-handlers'
import { registerQuitHandlers } from './ipc/quit-handlers'
import { registerProjectLockHandlers } from './ipc/project-lock-handlers'
import { registerExternalFileHandlers } from './ipc/external-file-handlers'
import { registerTranscriptionHandlers } from './ipc/transcription-handlers'
import { registerClipboardHandlers } from './ipc/clipboard-handlers'
import { registerImageExportHandlers } from './ipc/image-export-handlers'
import { registerClaudeStatusHandlers } from './ipc/claude-status-handlers'
import { registerPreviewHandlers } from './ipc/preview-handlers'
import { registerPreviewScheme } from './services/preview/previewScheme'
import { DependencyDetector, converterRegistry, getExtensionsForDependencies } from './services/import'
import { FORCE_CRASH_ARG } from '../shared/constants'
import { IMPORT_CHANNELS } from '../shared/ipc/import-channels'
import type { DependencyReadyEvent } from '../shared/ipc/import-schema'
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
import { gitStatusService } from './services/GitStatusService'
import { installSafeConsole } from './utils/safeConsole'
import { isBenignShutdownTimerError } from './utils/isBenignShutdownTimerError'
import {
  registerAppCrashLogging,
  registerWindowErrorSignals,
  registerWindowResponsiveness
} from './utils/rendererCrashHandlers'

// Install safe console logging to prevent EPIPE crashes
// Must be called before any other code that uses console.log
installSafeConsole()

// Register the `erfana-preview://` privileged scheme (#74). MUST run before
// `app.whenReady()`, so it lives here at module scope beside the other pre-ready
// setup (`registerSchemesAsPrivileged` is a no-op once the app is ready).
registerPreviewScheme()

// Strip --new-window flag to prevent infinite spawn loops
// Must happen before any window creation
const newWindowArgIndex = process.argv.indexOf('--new-window')
if (newWindowArgIndex !== -1) {
  process.argv.splice(newWindowArgIndex, 1)
}

// Quit confirmation state
let isQuitting = false
let mainWindowRef: BrowserWindow | null = null

/**
 * How long the close flow waits for the renderer's `quit:confirmResponse`
 * before deciding on its own (#60).
 *
 * The confirmation is a renderer round-trip, so a dead renderer never answers.
 * Without a bound the `isQuitting` latch stays set with the window still open:
 * the first close click appears to do nothing and only the second one — which
 * short-circuits on the latch — actually closes.
 *
 * The deadline only *forces* the close when the renderer is provably gone
 * ({@link isRendererGone}). Silence from a live renderer means the user is
 * reading the unsaved-changes dialog, and closing under them would destroy
 * their work; that case is logged and keeps waiting. Two seconds is long
 * enough for a healthy renderer to answer the handshake.
 */
const QUIT_CONFIRM_TIMEOUT_MS = 2_000

/**
 * Pending confirmation deadline, cleared as soon as the renderer answers.
 *
 * ONE timer for the process, because this app opens ONE main window
 * (`createWindow` is called once at startup and once from macOS `activate` when
 * none is open, and `mainWindowRef` is likewise a single slot). Were a second
 * window ever added, a second close would overwrite this handle and the first
 * window's deadline would be cancelled instead of its own — at which point this
 * belongs in per-window state, not a module variable.
 */
let quitConfirmTimer: ReturnType<typeof setTimeout> | null = null

/** Cancels the pending confirmation deadline, if any. */
function cancelQuitConfirmTimeout(): void {
  if (quitConfirmTimer === null) return
  clearTimeout(quitConfirmTimer)
  quitConfirmTimer = null
}

/**
 * Whether the window's renderer can no longer run JavaScript, and therefore
 * can never answer an IPC round trip.
 *
 * `isCrashed()` is the discriminator that keeps the close timeout safe: a live
 * renderer that stays silent is deliberating over the confirm dialog, a gone
 * one will never reply.
 *
 * @param win - The window whose renderer is being checked
 */
function isRendererGone(win: BrowserWindow): boolean {
  // Reading `win.webContents` off a destroyed window throws, so test the
  // window first.
  if (win.isDestroyed()) return true
  const { webContents } = win
  return webContents.isDestroyed() || webContents.isCrashed()
}

/** Claude status handler bundle (#216); disposed on app shutdown. */
let claudeStatusHandlers: { dispose: () => Promise<void> } | null = null

/** HTML preview handler bundle (#74); disposed on app shutdown. */
let previewHandlers: { dispose: () => Promise<void> } | null = null

// WebGL Command Line Switches (originally added for Electron 33+)
// Fixes WebGL context creation issues and terminal flickering in production builds
// TODO: Test if still needed with Electron 39+ (Chromium 142)
app.commandLine.appendSwitch('enable-webgl')
app.commandLine.appendSwitch('enable-webgl2-compute-context')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

/**
 * Builds the extra renderer arguments for this launch.
 *
 * The flag is read back by the preload script from `process.argv` and re-exposed
 * to the renderer over the context bridge — the same mechanism the screenshot
 * overlay uses for its token, so the renderer can never set it, only the process
 * launcher can.
 *
 * Gated on `!app.isPackaged` as well as the env var, so a shipped build ignores
 * `ERFANA_E2E_FORCE_CRASH` outright.
 */
function buildAdditionalArguments(): string[] {
  if (!app.isPackaged && process.env.ERFANA_E2E_FORCE_CRASH === '1') {
    return [FORCE_CRASH_ARG]
  }
  return []
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  // Pre-load title shown in the OS title bar / taskbar until the renderer takes
  // over via document.title (see ProjectManagementContext). Version is always
  // shown for easy build identification.
  const windowTitle = `ERFANA v${app.getVersion()}`

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    title: windowTitle,
    roundedCorners: false,
    // Paint the app's own background before the renderer's first frame so the
    // window never flashes white on open (#60 D). Mirrors the renderer's
    // --color-brand-black; not a fix for the blank-window symptom itself.
    backgroundColor: '#161312',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox: true is the default since Electron 20 (2022)
      // Renderer process is sandboxed for security, preload scripts work correctly
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      additionalArguments: buildAdditionalArguments()
      // experimentalFeatures removed - not needed for current functionality
    }
  })

  // Log renderer hangs for this window (log-only — see rendererCrashHandlers).
  registerWindowResponsiveness(mainWindow)

  // Log entry-module failures: renderer console errors and preload errors are
  // the only trace of a boot failure that happens before any renderer-side
  // handler exists (log-only — see rendererCrashHandlers).
  registerWindowErrorSignals(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Handle window close with confirmation
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    // Nobody can answer a confirmation when the renderer is gone: destroyed
    // (E2E teardown) or crashed (#60). Let the close proceed instead of
    // latching the quit state and swallowing the click.
    if (isRendererGone(mainWindow)) return
    event.preventDefault()
    isQuitting = true
    mainWindow.webContents.send('quit:requested', { reason: 'close' })

    // Bound the wait on the renderer's answer (#60) — see QUIT_CONFIRM_TIMEOUT_MS.
    cancelQuitConfirmTimeout()
    quitConfirmTimer = setTimeout(() => {
      quitConfirmTimer = null
      // The renderer answered "cancel" in the meantime — nothing to force.
      if (!isQuitting) return

      // A throw here would be an uncaught exception inside a timer callback,
      // i.e. a main-process crash on the quit path.
      try {
        if (!isRendererGone(mainWindow)) {
          // The renderer is alive, so the silence is a decision in progress:
          // the confirm dialog is up and the user is reading it. Forcing the
          // close here would discard unsaved work, so leave a trail and keep
          // waiting — the answer still arrives through registerQuitHandlers.
          logger.warn('Quit confirmation still pending after timeout; renderer is alive', {
            timeoutMs: QUIT_CONFIRM_TIMEOUT_MS
          })
          return
        }

        logger.warn('No quit confirmation from renderer (renderer gone), closing anyway', {
          timeoutMs: QUIT_CONFIRM_TIMEOUT_MS
        })
        if (!mainWindow.isDestroyed()) mainWindow.destroy()
        app.quit()
      } catch (error) {
        logger.error(
          'Error closing window after quit-confirmation timeout',
          error instanceof Error ? error : undefined
        )
      }
    }, QUIT_CONFIRM_TIMEOUT_MS)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Lock the main renderer to its initial URL. Any navigation attempt
  // (planted href, deep-link, the area-select hash route, etc.) is denied
  // so the main editor cannot be coerced into mounting the area-select
  // overlay UI (#164 lens-review F[7]).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl) {
      logger.warn('Blocked main-window will-navigate', { from: currentUrl, to: url })
      event.preventDefault()
    }
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

  // Record renderer / child-process deaths (#60 E). Registered once, app-wide,
  // so it also covers the overlay windows, the PDF/DOCX render window and the
  // DOCX utilityProcess. Log-only: no reload, no dialog, no relaunch.
  registerAppCrashLogging()

  // Wire up git polling service coordination with watcher service (DIP pattern)
  gitPollingService.setWatcherCoordination(
    () => gitWatcherService.getLastEventTimestamp(),
    () => gitWatcherService.isWatching()
  )

  // Gate every global ipcMain channel on the app's own top-level renderer
  // BEFORE any handler registers — handlers registered earlier keep the
  // unwrapped path (sd-074b §7).
  installIpcSenderGate()

  // Register IPC handlers
  registerFileHandlers()
  registerFileWatcherHandlers()
  registerDirectoryWatcherHandlers()
  registerSettingsHandlers()
  registerTerminalHandlers()
  registerImportHandlers()
  registerDocumentImportHandlers()
  registerGitHandlers()
  registerGitWatcherHandlers()
  registerPdfHandlers()
  registerDocxHandlers()
  registerScreenshotHandlers()
  registerShellHandlers()
  registerSystemHandlers()
  registerCameraHandlers()
  registerGlobalSettingsHandlers()
  registerLoggingHandlers()
  registerProjectLockHandlers()
  registerExternalFileHandlers()
  registerTranscriptionHandlers()
  registerClipboardHandlers()
  registerImageExportHandlers()
  // Per-terminal Claude Code context status bar (#216). Uses the same
  // terminalService singleton so it can look up the main-owned PTY pid + cwd.
  claudeStatusHandlers = registerClaudeStatusHandlers(terminalService)
  // Running HTML preview (#74). Project path + settings come from main-owned
  // singletons; the graph (WebContentsView sessions, allowlist, watchers) is
  // built inside the composition root.
  previewHandlers = registerPreviewHandlers({
    getProjectPath: () => fileService.getProjectPath(),
    // Main-side teardown on project switch. Until now this seam had no
    // producer, so only the renderer's own `preview:close` tore views down
    // (sd-074b §4.9).
    subscribeProjectChanged: (listener) => fileService.onProjectPathChanged(listener),
    globalSettings: globalSettingsService
  })

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

  // Fire-and-forget: detect system dependencies for LiteParse document import
  // Runs async after window creation so it doesn't block startup
  const dependencyDetector = new DependencyDetector()
  dependencyDetector.detect().then((deps) => {
    const extensions = getExtensionsForDependencies(deps)
    if (extensions.length > 0) {
      converterRegistry.updateConverterExtensions('document', extensions)
    }
    // Notify renderer that dependencies have been detected
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      const payload: DependencyReadyEvent = {
        libreOffice: deps.libreOffice,
        imageMagick: deps.imageMagick,
        extensions: converterRegistry.getExtensionsByConversionType().requiresConversion
      }
      mainWindowRef.webContents.send(IMPORT_CHANNELS.DEPENDENCIES_READY, payload)
    }
  }).catch((error) => {
    logger.error('Failed to detect document import dependencies', error instanceof Error ? error : undefined)
  })

  // Register quit confirmation handler
  registerQuitHandlers((proceed) => {
    // The renderer answered — the close-timeout fallback is no longer needed.
    cancelQuitConfirmTimeout()
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

// Cleanup file watchers, directory watchers, terminals, git watchers, and project locks before app quits.
// Pattern B (F11): preventDefault + sequenced shutdown guarantees lock release before exit.
// isShuttingDown guards against the second before-quit Electron emits after preventDefault.
const SHUTDOWN_TIMEOUT_MS = 2_000

/**
 * Bound on the priority lock release (#60).
 *
 * The release still runs first — the next launch must not wait out heartbeat
 * staleness — but a disposer that never settles (an unreachable network share,
 * a wedged fsync) used to keep `before-quit` awaiting forever, so `app.exit(0)`
 * was never reached and the app stayed alive with no window. Short, because it
 * is a local file unlink on the happy path.
 */
const LOCK_DISPOSE_TIMEOUT_MS = 1_000
let isShuttingDown = false

/**
 * Runs one disposer and returns when it settles or when `timeoutMs` elapses,
 * whichever is first. Never rejects: shutdown must always reach `app.exit(0)`.
 *
 * @param label - Disposer name, used in the log line
 * @param dispose - The disposer to run
 * @param timeoutMs - Upper bound on how long to wait
 */
async function disposeWithin(
  label: string,
  dispose: () => Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const settled = Promise.resolve()
    .then(dispose)
    .then(() => 'settled' as const)
    .catch((err) => {
      logger.warn(`App quit: ${label} threw`, {
        error: err instanceof Error ? err.message : String(err)
      })
      return 'settled' as const
    })

  const outcome = await Promise.race([
    settled,
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
  ])

  if (timer !== undefined) clearTimeout(timer)
  if (outcome === 'timeout') {
    logger.warn(`App quit: ${label} timed out`, { timeoutMs })
  }
}

/**
 * Shutdown-scoped uncaught-exception guard.
 *
 * During teardown a chokidar `awaitWriteFinish` throttle timer (FileWatcherService)
 * can call `setTimeout` just as Node's timer subsystem is being dismantled, throwing
 * a synchronous "reading 'expiry'" TypeError from `node:internal/timers`. We're
 * already exiting, so it's benign – but as an uncaught exception it crashes the main
 * process and leaves file handles locked (the e2e `EBUSY` teardown timeout on Windows).
 *
 * Registering ANY `uncaughtException` listener also suppresses Electron's native crash
 * dialog (Electron only shows it when it is the sole listener), so this handler is
 * installed only for the shutdown window – normal-operation crashes keep the dialog.
 */
function handleShutdownException(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  if (isBenignShutdownTimerError(err)) {
    logger.warn('Suppressed benign timer race during shutdown (chokidar awaitWriteFinish throttle)', {
      error: message
    })
    return
  }
  logger.error(
    'Uncaught exception during shutdown',
    err instanceof Error ? err : undefined,
    { error: message }
  )
}

app.on('before-quit', async (event) => {
  if (isShuttingDown) return
  isShuttingDown = true
  event.preventDefault()

  // Install the guard synchronously, before the first await, so an already-queued
  // chokidar read callback can't crash the process before the handler is registered.
  process.on('uncaughtException', handleShutdownException)

  logger.info('App quitting, cleaning up services')

  // Priority: lock release runs first and alone, so the next launch can open
  // the project without waiting for heartbeat staleness — but bounded, so a
  // disposer that never settles cannot strand the process short of app.exit(0).
  await disposeWithin(
    'projectLockService.dispose()',
    () => projectLockService.dispose(),
    LOCK_DISPOSE_TIMEOUT_MS
  )

  // Best-effort: the remaining disposers run together, bounded by the same
  // helper the lock release uses — so the timer is cleared on both branches and
  // a timeout leaves a log line instead of passing silently.
  // `Promise.allSettled` swallows individual failures so one bad disposer
  // can't cancel the others.
  await disposeWithin(
    'best-effort disposers',
    async () => {
      await Promise.allSettled([
        fileWatcherService.dispose(),
        directoryWatcherService.dispose(),
        terminalService.dispose(),
        claudeStatusHandlers ? claudeStatusHandlers.dispose() : Promise.resolve(),
        previewHandlers ? previewHandlers.dispose() : Promise.resolve(),
        gitWatcherService.dispose(),
        gitStatusService.dispose()
      ])
    },
    SHUTDOWN_TIMEOUT_MS
  )

  // Sync disposer — always runs after the race
  gitPollingService.dispose()

  app.exit(0)
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
