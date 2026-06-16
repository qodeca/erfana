// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main process test setup
 *
 * Cleans up the test log directory after all tests complete.
 * LoggingService uses a temp directory when VITEST is set to avoid
 * polluting production logs with expected test errors.
 */
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, vi } from 'vitest'
import { installFlakeGuard } from './flakeGuard'

// Global default mock for the `electron` module.
//
// The npm `electron` package entry (node_modules/electron/index.js) resolves and
// returns the binary path on load, throwing "Electron failed to install correctly"
// when that binary is absent — which happens on CI runners whose Electron download
// failed. Any main-process unit test that transitively imports `electron` (e.g.
// ConverterRegistry → LiteParseConverter → `import { app } from 'electron'`) then
// fails to even load the suite. Mocking it here shields every main test from that
// flake. Test files that declare their own `vi.mock('electron', …)` still override
// this per-file default.
vi.mock('electron', () => {
  const fn = (): ReturnType<typeof vi.fn> => vi.fn()
  return {
    app: {
      isPackaged: false,
      getAppPath: fn(),
      getPath: fn(),
      getName: fn(),
      getVersion: fn(),
      on: fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      quit: fn(),
      relaunch: fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      setAppUserModelId: fn()
    },
    ipcMain: { handle: fn(), on: fn(), removeHandler: fn(), removeAllListeners: fn() },
    ipcRenderer: { invoke: fn(), on: fn(), send: fn(), removeAllListeners: fn() },
    BrowserWindow: vi.fn(),
    dialog: { showOpenDialog: fn(), showSaveDialog: fn(), showMessageBox: fn() },
    shell: { openPath: fn(), openExternal: fn(), showItemInFolder: fn() },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: fn(),
      decryptString: fn()
    },
    nativeImage: { createFromPath: fn(), createFromBuffer: fn() },
    desktopCapturer: { getSources: vi.fn(() => Promise.resolve([])) },
    screen: { getAllDisplays: vi.fn(() => []), getPrimaryDisplay: fn() },
    clipboard: { writeText: fn(), readText: fn() },
    Menu: vi.fn(),
    MenuItem: vi.fn()
  }
})

// Surface intermittent unhandled rejections / uncaught exceptions firing
// after teardown (e.g. async `worker_threads` cleanup races, leaked
// `setTimeout` from production code). See `flakeGuard.ts` for rationale.
installFlakeGuard('main')

afterAll(async () => {
  try {
    await rm(join(tmpdir(), 'erfana-test-logs'), { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors - directory may not exist
  }
})
