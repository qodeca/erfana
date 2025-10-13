import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerFileWatcherHandlers } from './ipc/file-watcher-handlers'
import { registerDirectoryWatcherHandlers } from './ipc/directory-watcher-handlers'
import { registerClaudeCodeHandlers } from './ipc/claude-code-handlers'
import { registerSettingsHandlers } from './ipc/settings-handlers'
import { fileWatcherService } from './services/FileWatcherService'
import { directoryWatcherService } from './services/DirectoryWatcherService'

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    title: 'Erfana',
    roundedCorners: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set application name (shows in macOS menu bar)
  app.setName('Erfana')

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.erfana')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register IPC handlers
  registerFileHandlers()
  registerFileWatcherHandlers()
  registerDirectoryWatcherHandlers()
  registerClaudeCodeHandlers()
  registerSettingsHandlers()

  // Create main window
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Cleanup file watchers and directory watchers before app quits
app.on('before-quit', async () => {
  console.log('🛑 App quitting, cleaning up watchers...')
  await fileWatcherService.dispose()
  await directoryWatcherService.dispose()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
