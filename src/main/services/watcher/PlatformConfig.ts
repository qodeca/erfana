/**
 * PlatformConfig - Platform-specific watcher configuration
 *
 * Based on VS Code's platform handling in parcelWatcher.ts
 *
 * Key platform differences:
 * - macOS: Case-insensitive, fsevents backend, exclude ~/Library/Containers
 * - Windows: Case-insensitive, long path support needed
 * - Linux: Case-sensitive, inotify limits to check
 */

import { platform, homedir } from 'os'
import { execSync } from 'child_process'
import path from 'path'

export interface PlatformWatcherConfig {
  /**
   * Whether paths should be compared case-insensitively
   */
  caseSensitive: boolean

  /**
   * Paths to exclude on this platform (beyond user excludes)
   */
  platformExcludes: string[]

  /**
   * Recommended buffer limits for this platform
   */
  recommendedBufferLimit: number

  /**
   * Recommended chunk size for this platform
   */
  recommendedChunkSize: number

  /**
   * Platform name for logging
   */
  platformName: string

  /**
   * Whether native watching is reliable on this platform
   */
  nativeWatchingReliable: boolean
}

/**
 * Get inotify max_user_watches limit on Linux
 */
function getLinuxInotifyLimit(): number | null {
  if (platform() !== 'linux') return null

  try {
    const result = execSync('cat /proc/sys/fs/inotify/max_user_watches', {
      encoding: 'utf8',
      timeout: 1000
    })
    return parseInt(result.trim(), 10)
  } catch {
    return null
  }
}

/**
 * Check if inotify limit is sufficient
 */
export function checkLinuxInotifyLimit(): {
  sufficient: boolean
  current: number | null
  recommended: number
  command: string
} {
  const current = getLinuxInotifyLimit()
  const recommended = 524288 // VS Code recommended value

  return {
    sufficient: current !== null && current >= 100000,
    current,
    recommended,
    command: `echo fs.inotify.max_user_watches=${recommended} | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`
  }
}

/**
 * Get platform-specific watcher configuration
 */
export function getPlatformConfig(): PlatformWatcherConfig {
  const os = platform()

  switch (os) {
    case 'darwin':
      return {
        caseSensitive: false,
        platformExcludes: [
          // macOS: Exclude Containers to prevent access dialogs (VS Code pattern)
          path.join(homedir(), 'Library/Containers')
        ],
        recommendedBufferLimit: 30000,
        recommendedChunkSize: 500,
        platformName: 'macOS',
        nativeWatchingReliable: true
      }

    case 'win32':
      return {
        caseSensitive: false,
        platformExcludes: [],
        recommendedBufferLimit: 30000,
        recommendedChunkSize: 500,
        platformName: 'Windows',
        nativeWatchingReliable: true
      }

    case 'linux':
      return {
        caseSensitive: true,
        platformExcludes: [],
        recommendedBufferLimit: 30000,
        recommendedChunkSize: 500,
        platformName: 'Linux',
        // Linux native watching depends on inotify limits
        nativeWatchingReliable: true
      }

    default:
      return {
        caseSensitive: true,
        platformExcludes: [],
        recommendedBufferLimit: 10000,
        recommendedChunkSize: 100,
        platformName: os,
        nativeWatchingReliable: false
      }
  }
}

/**
 * Normalize path for platform-specific comparison
 */
export function normalizePlatformPath(filePath: string): string {
  const config = getPlatformConfig()
  let normalized = path.normalize(filePath)

  if (!config.caseSensitive) {
    normalized = normalized.toLowerCase()
  }

  return normalized
}

/**
 * Check if a path should be excluded based on platform
 */
export function isPlatformExcluded(filePath: string): boolean {
  const config = getPlatformConfig()
  const normalizedPath = normalizePlatformPath(filePath)

  for (const exclude of config.platformExcludes) {
    const normalizedExclude = normalizePlatformPath(exclude)
    if (normalizedPath.startsWith(normalizedExclude)) {
      return true
    }
  }

  return false
}

/**
 * Check if path is a Windows long path (>260 chars)
 */
export function isWindowsLongPath(filePath: string): boolean {
  if (platform() !== 'win32') return false
  return filePath.length > 260
}

/**
 * Get platform diagnostics for debugging
 */
export function getPlatformDiagnostics(): Record<string, unknown> {
  const config = getPlatformConfig()
  const diagnostics: Record<string, unknown> = {
    platform: config.platformName,
    caseSensitive: config.caseSensitive,
    nativeWatchingReliable: config.nativeWatchingReliable,
    platformExcludes: config.platformExcludes
  }

  if (platform() === 'linux') {
    const inotify = checkLinuxInotifyLimit()
    diagnostics.inotify = {
      current: inotify.current,
      recommended: inotify.recommended,
      sufficient: inotify.sufficient
    }
    if (!inotify.sufficient) {
      diagnostics.inotifyWarning =
        'inotify limit may be too low for large projects. Run: ' + inotify.command
    }
  }

  return diagnostics
}
