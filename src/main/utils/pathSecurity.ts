// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import nodePath, { isAbsolute, normalize, resolve, dirname, win32, type PlatformPath } from 'path'
import { lstat, readlink, access, constants } from 'fs/promises'
import { homedir, hostname } from 'os'
import { AppError, ErrorCode } from '../../shared/errors'
import { normaliseResolved } from './pathCompare'

/**
 * Path Security Utilities
 *
 * Uses standardized AppError with ErrorCode enum
 *
 * Validates project paths to prevent:
 * - Path traversal attacks (../, ../../, etc.)
 * - Access to system directories (/System, /usr, /etc, etc.)
 * - Symlink attacks (symlinks to sensitive directories)
 * - Non-absolute or malformed paths
 */

// Re-export for backwards compatibility
export { AppError as PathSecurityError }

/**
 * List of system directories that should never be opened as projects
 */
const SYSTEM_DIRECTORIES = [
  '/System',
  '/Library',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/tmp',
  '/private',
  '/dev',
  '/proc'
]

/**
 * Where "the system" and "the user's home" are, for one platform. Injectable, so
 * the Windows rules run on every host.
 */
export interface SystemPathContext {
  platform: NodeJS.Platform
  flavour: PlatformPath
  env: Readonly<Record<string, string | undefined>>
  home: string
  /** This machine's name, so `\\<name>\C$\...` is known to be local; defaults to `os.hostname()` */
  hostname?: string
}

const hostContext = (): SystemPathContext => ({
  platform: process.platform,
  flavour: nodePath,
  env: process.env,
  home: homedir()
})

/** Environment variables naming the Windows system folders. */
const WINDOWS_SYSTEM_ENV = [
  'SystemRoot',
  'windir',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ProgramData'
] as const

/** Used when the environment does not name them. */
const WINDOWS_SYSTEM_FALLBACK = ['C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData']

/**
 * The system folders (and, by the rule in {@link isSystemDirectory}, everything
 * below them). On Windows they come from the environment; a value is used only
 * when it is an absolute path that is not a volume root, so a bad variable
 * cannot block a whole drive.
 */
function systemDirectories(ctx: SystemPathContext): string[] {
  if (ctx.platform !== 'win32') return SYSTEM_DIRECTORIES
  const fromEnv = WINDOWS_SYSTEM_ENV.map((name) => ctx.env[name]).filter(
    (value): value is string =>
      typeof value === 'string' &&
      ctx.flavour.isAbsolute(value) &&
      !isFilesystemRoot(value, ctx.flavour)
  )
  return [...fromEnv, ...WINDOWS_SYSTEM_FALLBACK]
}

/**
 * List of sensitive user directories that should be protected. Built with the
 * platform's own separator, so they compare equal to a normalised path.
 */
function getSensitiveUserDirectories(ctx: SystemPathContext): string[] {
  const join = ctx.flavour.join
  return [
    join(ctx.home, '.ssh'),
    join(ctx.home, '.gnupg'),
    join(ctx.home, '.aws'),
    join(ctx.home, '.config', 'gcloud'),
    join(ctx.home, 'Library', 'Keychains'),
    join(ctx.home, 'Library', 'Application Support', 'Google', 'Chrome'),
    join(ctx.home, 'Library', 'Application Support', 'Firefox')
  ]
}

const LOCAL_HOST_NAMES = ['localhost', '127.0.0.1', '::1', '[::1]']
const ADMIN_SHARE = /^[\\/]{2}([^\\/]+)[\\/]+([A-Za-z])\$(?:[\\/]+(.*))?$/

/**
 * `\\localhost\C$\Windows` is `C:\Windows` reached by another name. On Windows a
 * path through this machine's own administrative share (by `localhost`, a
 * loopback address, or the machine's name) is mapped to its drive path, so the
 * system-folder list sees it. The share itself is not refused: a project below
 * it opens. Other hosts, and other platforms, are left as they are.
 */
function localAdminShareToDrive(value: string, ctx: SystemPathContext): string {
  if (ctx.platform !== 'win32') return value
  const plain = normaliseResolved(value, { path: ctx.flavour, platform: ctx.platform })
  const match = ADMIN_SHARE.exec(plain)
  if (!match) return value
  const host = match[1].toLowerCase()
  const self = (ctx.hostname ?? hostname()).toLowerCase()
  if (!LOCAL_HOST_NAMES.includes(host) && host !== self) return value
  return `${match[2]}:\\${match[3] ?? ''}`
}

/** The form paths are compared in: normalised, no trailing separator past the root, folded on Windows. */
function comparable(value: string, ctx: SystemPathContext): string {
  const normalized = ctx.flavour.normalize(value)
  const root = ctx.flavour.parse(normalized).root
  let n = normalized
  while (n.length > root.length && n.endsWith(ctx.flavour.sep)) n = n.slice(0, -1)
  return ctx.platform === 'win32' ? n.toLowerCase() : n
}

/**
 * Check if a path points to a system or sensitive directory: one of them, or
 * anything below one, at a separator boundary (`/usr` and `/usr/local`, not
 * `/usrx`). On Windows the comparison ignores case.
 *
 * SECURITY FIX: Use platform-specific path separator instead of hardcoded '/'
 */
export function isSystemDirectory(
  path: string,
  ctx: SystemPathContext = hostContext()
): boolean {
  const normalized = comparable(localAdminShareToDrive(path, ctx), ctx)
  const directories = [...systemDirectories(ctx), ...getSensitiveUserDirectories(ctx)]
  return directories.some((directory) => {
    const dir = comparable(directory, ctx)
    return normalized === dir || normalized.startsWith(dir + ctx.flavour.sep)
  })
}

/**
 * Whether a path is the top of a volume or share: `/`, `C:\`, `\\srv\share\`.
 * Such a folder is not a project, and every path on the volume lies inside it,
 * so it would turn the project boundary into no boundary at all.
 */
export function isFilesystemRoot(path: string, flavour: PlatformPath = nodePath): boolean {
  // `\\?\C:\` and `\\?\UNC\srv\share\` name the same roots as `C:\` and `\\srv\share\`
  const platform = flavour === win32 ? 'win32' : process.platform
  const normalized = flavour.normalize(normaliseResolved(path, { path: flavour, platform }))
  return normalized === flavour.parse(normalized).root
}

const ROOT_REFUSED_MESSAGE = 'Cannot open the top of a drive, volume or network share as a project'

/**
 * The project folder as the filesystem names it (`realpath`) must also be
 * acceptable: a link or junction can lead a harmless typed path to a volume
 * root or a system folder. Call it with the canonical path, before the open
 * commits.
 *
 * @throws AppError (`PATH_SYSTEM_DIR`) for a volume root or a system folder
 */
export function assertAcceptableProjectRoot(realRoot: string): void {
  if (isFilesystemRoot(realRoot)) {
    throw new AppError(ROOT_REFUSED_MESSAGE, ErrorCode.PATH_SYSTEM_DIR)
  }
  if (isSystemDirectory(realRoot)) {
    throw new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
  }
}

/**
 * Validate that a path is safe to use as a project directory
 *
 * Checks:
 * - Path is a non-empty string
 * - Path is absolute (not relative)
 * - Path doesn't contain path traversal patterns
 * - Path is not a system or sensitive directory
 * - Path is not the root of a volume or share
 * - Path is accessible (exists and readable)
 *
 * SECURITY NOTE: TOCTOU Limitation
 *
 * This validation checks path accessibility at validation time, but permissions
 * could change between check (validation) and actual use (file operations).
 * This is an inherent limitation of filesystem operations known as TOCTOU
 * (Time-of-Check-Time-of-Use).
 *
 * Mitigation: All filesystem operations include proper error handling at use-site
 * to catch permission changes, file deletions, or other state changes that occur
 * after validation.
 *
 * @throws AppError if validation fails
 */
export async function validateProjectPath(projectPath: string): Promise<void> {
  // Check path is a valid string
  if (!projectPath || typeof projectPath !== 'string') {
    throw new AppError('Project path must be a non-empty string', ErrorCode.PATH_INVALID)
  }

  // Check path is absolute
  if (!isAbsolute(projectPath)) {
    throw new AppError(
      'Project path must be absolute. Relative paths are not allowed for security reasons.',
      ErrorCode.PATH_NOT_ABSOLUTE
    )
  }

  // Normalize path to resolve any .. or . segments
  const normalized = normalize(projectPath)

  // Check if path is a system directory
  if (isSystemDirectory(normalized)) {
    throw new AppError(
      'Cannot open system or sensitive directories as projects',
      ErrorCode.PATH_SYSTEM_DIR
    )
  }

  // The root of a volume is every path on it
  if (isFilesystemRoot(normalized)) {
    throw new AppError(ROOT_REFUSED_MESSAGE, ErrorCode.PATH_SYSTEM_DIR)
  }

  // Check path is accessible
  try {
    await access(normalized, constants.R_OK | constants.X_OK)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const originalError = error instanceof Error ? error : undefined
    throw new AppError(
      `Cannot access project directory: ${message}`,
      ErrorCode.PATH_NOT_ACCESSIBLE,
      originalError
    )
  }
}

/**
 * Validate a symlink and its target
 *
 * Checks:
 * - If path is a symlink
 * - If symlink target is accessible
 * - If symlink target is not a system/sensitive directory
 *
 * @returns true if path is a symlink, false otherwise
 * @throws AppError if symlink is dangerous
 */
export async function validateSymlink(projectPath: string): Promise<boolean> {
  let stats
  try {
    stats = await lstat(projectPath) // Don't follow symlinks
  } catch {
    // Path doesn't exist or not accessible
    return false
  }

  if (!stats.isSymbolicLink()) {
    return false // Not a symlink, nothing to validate
  }

  // It's a symlink - validate the target
  try {
    const target = await readlink(projectPath)
    // SECURITY FIX: Explicitly handle absolute vs relative symlink targets
    // readlink() can return either absolute or relative paths
    const resolvedTarget = isAbsolute(target)
      ? normalize(target) // Absolute symlink target
      : resolve(dirname(projectPath), target) // Relative symlink target

    // Check if symlink target is a system directory
    if (isSystemDirectory(resolvedTarget) || isFilesystemRoot(resolvedTarget)) {
      throw new AppError(
        'Cannot open symlink to system or sensitive directory',
        ErrorCode.SYMLINK_ATTACK
      )
    }

    // Check symlink target is accessible
    try {
      await access(resolvedTarget, constants.R_OK | constants.X_OK)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const originalError = error instanceof Error ? error : undefined
      throw new AppError(
        `Symlink target is not accessible: ${message}`,
        ErrorCode.PATH_NOT_ACCESSIBLE,
        originalError
      )
    }

    return true // Valid symlink
  } catch (_error) {
    if (_error instanceof AppError) {
      throw _error // Re-throw AppError
    }
    // Other errors (broken symlink, etc.)
    const originalError = _error instanceof Error ? _error : undefined
    throw new AppError(
      `Invalid symlink: ${_error instanceof Error ? _error.message : String(_error)}`,
      ErrorCode.SYMLINK_ATTACK,
      originalError
    )
  }
}

/**
 * Comprehensive path security validation
 *
 * Validates both regular paths and symlinks
 * Use this as the main entry point for path validation
 *
 * @throws AppError if validation fails
 */
export async function validatePath(projectPath: string): Promise<void> {
  // First validate the path itself
  await validateProjectPath(projectPath)

  // Then validate if it's a symlink
  await validateSymlink(projectPath)
}
