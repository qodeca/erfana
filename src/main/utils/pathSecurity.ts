// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { isAbsolute, normalize, resolve, dirname, sep } from 'path'
import { lstat, readlink, access, constants } from 'fs/promises'
import { homedir } from 'os'
import { AppError, ErrorCode } from '../../shared/errors'

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
 * List of sensitive user directories that should be protected
 */
function getSensitiveUserDirectories(): string[] {
  const home = homedir()
  return [
    `${home}/.ssh`,
    `${home}/.gnupg`,
    `${home}/.aws`,
    `${home}/.config/gcloud`,
    `${home}/Library/Keychains`,
    `${home}/Library/Application Support/Google/Chrome`,
    `${home}/Library/Application Support/Firefox`
  ]
}

/**
 * Check if a path points to a system or sensitive directory
 *
 * SECURITY FIX: Use platform-specific path separator instead of hardcoded '/'
 */
export function isSystemDirectory(path: string): boolean {
  const normalized = normalize(path)

  // Check system directories
  for (const sysDir of SYSTEM_DIRECTORIES) {
    if (normalized === sysDir || normalized.startsWith(sysDir + sep)) {
      return true
    }
  }

  // Check sensitive user directories
  for (const sensitiveDir of getSensitiveUserDirectories()) {
    if (normalized === sensitiveDir || normalized.startsWith(sensitiveDir + sep)) {
      return true
    }
  }

  return false
}

/**
 * Validate that a path is safe to use as a project directory
 *
 * Checks:
 * - Path is a non-empty string
 * - Path is absolute (not relative)
 * - Path doesn't contain path traversal patterns
 * - Path is not a system or sensitive directory
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
    if (isSystemDirectory(resolvedTarget)) {
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
