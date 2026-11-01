// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The name git knows, as a suggestion for the identity step (P-F33, 024-FR-022).
 *
 * Main only: the renderer never reaches git. It names nothing – the folder is
 * the open project, the key is fixed – and git runs through the hardened
 * spawn every other git read uses, because a project's `.git/config` is not
 * ours. The value is a repository's or a person's config, so it is held to the
 * rules a typed name meets, and only ever fills a field the person still has
 * to confirm: nothing here writes the name anywhere. Any failure is no
 * suggestion. The value is never logged (C20).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hasRefusedIdentityChar } from '../../../shared/comments/identity'
import { codePointLength } from '../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { buildHardeningArgs, HARDENED_GIT_HELPER_TIMEOUT_MS, hardenedSpawnOptions, resolveGitBinary } from '../../utils/hardenedGit'

const execFileAsync = promisify(execFile)

/** More than any name the field takes; git's answer is cut off here rather than read in full. */
const GIT_NAME_MAX_BUFFER = 4 * 1024

/** Runs git with `args` and answers what it printed. */
export type GitConfigRead = (gitPath: string, args: readonly string[]) => Promise<string>

const readWithGit: GitConfigRead = async (gitPath, args) => {
  const { stdout } = await execFileAsync(gitPath, [...args], { ...hardenedSpawnOptions(), timeout: HARDENED_GIT_HELPER_TIMEOUT_MS, maxBuffer: GIT_NAME_MAX_BUFFER })
  return stdout.toString()
}

/** Whether the name form would take `name`. */
function usable(name: string): boolean {
  return name !== '' && codePointLength(name) <= PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS && !hasRefusedIdentityChar(name)
}

/**
 * `user.name` as git reads it for the project.
 *
 * @param root - The open project's real path.
 * @param read - How git runs; the hardened spawn by default.
 * @param gitBinary - Where git is; {@link resolveGitBinary} by default.
 * @returns The name, or `undefined` when there is none the form would take.
 */
export async function suggestedGitName(root: string, read: GitConfigRead = readWithGit, gitBinary: () => Promise<string | null> = resolveGitBinary): Promise<string | undefined> {
  try {
    const gitPath = await gitBinary()
    if (gitPath === null) return undefined
    const name = (await read(gitPath, [...buildHardeningArgs(root), 'config', '--get', 'user.name'])).replace(/\r?\n$/, '').trim()
    return usable(name) ? name : undefined
  } catch {
    // Exit 1 is "not set"; a missing git, a timeout or a broken config are the same to the reader.
    return undefined
  }
}
