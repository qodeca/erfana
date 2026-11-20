// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether `.erfana/browser` was committed (spec 025, ADR 0009 decision 3): a
 * profile that `git ls-files` lists came with the repository and is set aside
 * however its marker looks.
 *
 * The project may be an untrusted repository, so git runs hardened
 * (`utils/hardenedGit.ts`: allowlisted env, hooks and fsmonitor off, cwd
 * outside the repo). `ls-files` reads only the index; it runs no filter.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  HARDENED_GIT_HELPER_TIMEOUT_MS,
  buildHardeningArgs,
  hardenedSpawnOptions,
  resolveGitBinary
} from '../../utils/hardenedGit'
import { logger } from '../LoggingService'
import { BROWSER_DIR_REL } from './browserProfilePaths'

const execFileAsync = promisify(execFile)

/** git's exit code for a fatal error – "not a git repository" among them. */
const GIT_FATAL_EXIT = 128
const LS_FILES_MAX_BUFFER = 1024 * 1024

export interface GitRunner {
  resolveGit(): Promise<string | null>
  run(gitPath: string, args: string[]): Promise<{ stdout: string }>
}

const defaultRunner: GitRunner = {
  resolveGit: resolveGitBinary,
  run: (gitPath, args) =>
    execFileAsync(gitPath, args, {
      ...hardenedSpawnOptions(),
      timeout: HARDENED_GIT_HELPER_TIMEOUT_MS,
      maxBuffer: LS_FILES_MAX_BUFFER,
      encoding: 'utf8'
    })
}

/**
 * True when git tracks anything under `.erfana/browser` in `canonical`.
 *
 * No git, or a folder git cannot read as a repository (exit 128), counts as
 * not tracked: the marker check still guards a copied profile there. So does
 * any other exit code: a git that exits non-zero gave no listing. On macOS
 * that is the common case of `/usr/bin/git` being Apple's stand-in with no
 * Command Line Tools installed (exit 1, or 69 for an unaccepted Xcode
 * licence); reading it as "tracked" set every profile aside on every launch.
 * A failure with no exit code (a timeout, an output overflow, a spawn error)
 * counts as tracked – fail closed, the profile is set aside.
 */
export async function isBrowserFolderTrackedByGit(canonical: string, runner: GitRunner = defaultRunner): Promise<boolean> {
  const gitPath = await runner.resolveGit()
  if (gitPath === null) return false
  try {
    const { stdout } = await runner.run(gitPath, [
      ...buildHardeningArgs(canonical),
      'ls-files',
      '-z',
      '--',
      BROWSER_DIR_REL
    ])
    return stdout.length > 0
  } catch (error) {
    // Code and signal only: the message repeats the command line, project path included
    const { code, signal } = error as { code?: unknown; signal?: unknown }
    if (code === GIT_FATAL_EXIT) return false
    if (typeof code === 'number' && (signal === null || signal === undefined)) {
      logger.warn('Browser profile: git ls-files exited without a listing; treating the profile as not committed', { code: String(code) })
      return false
    }
    logger.warn('Browser profile: git ls-files failed; treating the profile as committed', {
      code: String(code ?? 'unknown'),
      signal: String(signal ?? '')
    })
    return true
  }
}
