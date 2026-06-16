// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * New instance spawning utilities
 *
 * Provides platform-specific logic for spawning new independent Erfana instances.
 * Used to allow multiple Erfana windows to run simultaneously with separate processes.
 *
 * @see Spec #010 - Multi-instance support specification
 *
 * @example
 * ```typescript
 * import { spawnNewInstance } from './spawnNewInstance'
 *
 * // Spawn a new independent Erfana instance
 * const success = spawnNewInstance()
 * if (!success) {
 *   console.error('Failed to spawn new instance')
 * }
 * ```
 */
import { spawn, type ChildProcess } from 'child_process'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { logger } from '../services/LoggingService'

/**
 * Spawn configuration for platform-specific instance launching.
 */
export interface SpawnConfig {
  /** The command to execute */
  command: string
  /** Arguments to pass to the command */
  args: string[]
  /** Spawn options */
  options: {
    shell?: boolean
    cwd?: string
    detached: boolean
    stdio: 'ignore'
  }
}

/**
 * Gets the spawn configuration for launching a new Erfana instance.
 * Exported for testing purposes.
 *
 * Platform behaviors:
 * - Development: Uses `npm run dev` in the project root
 * - macOS production: Uses `open -n -a` to launch the .app bundle
 * - Windows production: Directly spawns the .exe
 * - Other platforms (dev only — Erfana ships macOS + Windows): spawns the executable directly
 *
 * @returns SpawnConfig object with command, args, and options
 *
 * @example
 * ```typescript
 * const config = getSpawnConfig()
 * console.log(config.command) // 'npm' or 'open' or '/path/to/erfana'
 * ```
 */
export function getSpawnConfig(): SpawnConfig {
  // Development mode - use npm run dev
  if (is.dev) {
    const cwd = app.getAppPath()
    logger.debug('Spawn config: development mode', { cwd })

    return {
      command: 'npm',
      args: ['run', 'dev'],
      options: {
        shell: true,
        cwd,
        detached: true,
        stdio: 'ignore'
      }
    }
  }

  // Production mode - platform-specific
  const exePath = app.getPath('exe')
  logger.debug('Spawn config: production mode', { platform: process.platform, exePath })

  if (process.platform === 'darwin') {
    // macOS: Find the .app bundle from the executable path
    // exe path is: /path/to/Erfana.app/Contents/MacOS/Erfana
    // We need: /path/to/Erfana.app
    const appBundlePath = findMacOSAppBundle(exePath)

    if (!appBundlePath) {
      logger.warn('Could not find macOS app bundle, falling back to exe path', { exePath })
      return {
        command: exePath,
        args: ['--new-window'],
        options: {
          detached: true,
          stdio: 'ignore'
        }
      }
    }

    logger.debug('macOS app bundle found', { appBundlePath })

    return {
      command: 'open',
      args: ['-n', '-a', appBundlePath, '--args', '--new-window'],
      options: {
        detached: true,
        stdio: 'ignore'
      }
    }
  }

  if (process.platform === 'win32') {
    // Windows: Directly spawn the executable
    return {
      command: exePath,
      args: ['--new-window'],
      options: {
        detached: true,
        stdio: 'ignore'
      }
    }
  }

  // Other platforms (dev only — Erfana ships macOS + Windows): spawn the
  // executable directly with the --new-window flag.
  return {
    command: exePath,
    args: ['--new-window'],
    options: {
      detached: true,
      stdio: 'ignore'
    }
  }
}

/**
 * Finds the macOS .app bundle path from an executable path.
 * Traverses up the path to find a directory ending in .app.
 *
 * @param exePath - The executable path (e.g., /path/to/App.app/Contents/MacOS/App)
 * @returns The .app bundle path, or undefined if not found
 *
 * @example
 * ```typescript
 * const bundlePath = findMacOSAppBundle('/path/to/Erfana.app/Contents/MacOS/Erfana')
 * console.log(bundlePath) // '/path/to/Erfana.app'
 * ```
 */
function findMacOSAppBundle(exePath: string): string | undefined {
  const parts = exePath.split('/')

  // Walk backwards through path segments to find .app
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('.app')) {
      return parts.slice(0, i + 1).join('/')
    }
  }

  return undefined
}

/**
 * Spawns a new independent Erfana instance.
 *
 * Uses platform-specific mechanisms to ensure the new instance is fully independent:
 * - Detached process (not tied to parent)
 * - Separate stdio (no pipe inheritance)
 * - Platform-appropriate launch method
 *
 * @returns true on successful spawn, false on error
 *
 * @example
 * ```typescript
 * import { spawnNewInstance } from './spawnNewInstance'
 *
 * // From menu or keyboard shortcut handler
 * function handleNewWindow(): void {
 *   const success = spawnNewInstance()
 *   if (!success) {
 *     showErrorDialog('Failed to open new window')
 *   }
 * }
 * ```
 */
export function spawnNewInstance(): boolean {
  try {
    const config = getSpawnConfig()

    logger.info('Spawning new Erfana instance', {
      command: config.command,
      args: config.args,
      isDev: is.dev,
      platform: process.platform
    })

    const child: ChildProcess = spawn(config.command, config.args, config.options)

    // Detach the child process so it runs independently
    // unref() allows the parent to exit without waiting for the child
    child.unref()

    // Handle spawn errors asynchronously
    child.on('error', (error) => {
      logger.error('Failed to spawn new instance', error, {
        command: config.command,
        args: config.args
      })
    })

    logger.debug('New instance spawn initiated', { pid: child.pid })
    return true
  } catch (error) {
    logger.error(
      'Exception while spawning new instance',
      error instanceof Error ? error : new Error(String(error)),
      {
        isDev: is.dev,
        platform: process.platform
      }
    )
    return false
  }
}
