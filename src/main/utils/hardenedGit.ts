// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared helpers for running the native `git` binary against a folder whose
 * contents we do not control.
 *
 * A repository owns its `.git/config`, `.gitattributes`, hooks and working
 * tree, and several config keys (`core.fsmonitor`, `filter.<n>.*`, hooks,
 * `include.path`) make git run commands on its own. Everything here narrows
 * what a spawned git can be steered by:
 *
 *  - an env ALLOWLIST ({@link buildGitEnv}) instead of the full process env;
 *  - config overrides ({@link buildHardeningArgs}) that neutralise the keys above,
 *    including every `filter.<name>` driver the repo declares;
 *  - a spawn cwd outside the repo (`os.tmpdir()`) with `-C <root>` selecting it;
 *  - an absolute `which` / `where.exe` ({@link findOnPath}) so a planted
 *    binary in the current directory cannot answer the lookup.
 *
 * Imported by the git-status worker, which is its own bundle entry
 * (`electron.vite.config.ts`), so this module must NOT import `electron` or the
 * main-process logger.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/**
 * The ONLY environment variables copied from the parent into the git child. The
 * variables in {@link GIT_FIXED_ENV} are added on top. An allowlist is the only
 * form whose test is writable as "no other `GIT_*` variable is present"
 * (design NEW-13): `GIT_TRACE*`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
 * `GIT_PROXY_COMMAND` and `GIT_CEILING_DIRECTORIES` cannot reach the child.
 */
export const GIT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'TEMP',
  'TMP',
  'LANG'
] as const

/** Variables set unconditionally on the git child. */
export const GIT_FIXED_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0'
} as const

/** The platform null device, used to redirect `core.hooksPath`. */
export const GIT_NULL_DEVICE = devNull

/**
 * Command-line include override. An EMPTY `include.path=` is rejected by git
 * ("relative config includes must come from files", exit 128), so the null
 * device is used instead. Includes found in repo config are not disabled by
 * this; the point is that every dangerous key is overridden on the command line,
 * which outranks any file (included or not).
 */
export const GIT_INCLUDE_OVERRIDE = `include.path=${devNull}`

/** Timeout (ms) for the short helper spawns (config listing, finder). */
export const HARDENED_GIT_HELPER_TIMEOUT_MS = 5_000

/** Config-listing output cap (bytes); a repo with absurd config fails closed. */
const CONFIG_LIST_MAX_BUFFER = 1024 * 1024

/** A conservative filter-driver name: no whitespace, `=`, quotes or control chars. */
const FILTER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

const FILTER_KEY_PREFIX = 'filter.'

/** Build the child env from the allowlist plus {@link GIT_FIXED_ENV}. */
export function buildGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of GIT_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  return { ...env, ...GIT_FIXED_ENV }
}

/** Spawn options common to every hardened spawn (cwd is never the repo). */
export function hardenedSpawnOptions(): {
  cwd: string
  env: NodeJS.ProcessEnv
  shell: false
  windowsHide: true
} {
  return { cwd: tmpdir(), env: buildGitEnv(), shell: false, windowsHide: true }
}

/** Whether `name` is safe to splice into a `-c filter.<name>.<key>=` override. */
export function isSafeFilterName(name: string): boolean {
  return FILTER_NAME_PATTERN.test(name)
}

/**
 * Extract the distinct filter-driver names from
 * `config --null --name-only --get-regexp '^filter\.'` output (NUL-separated
 * keys such as `filter.lfs.clean`). The name is everything between the leading
 * `filter.` and the final `.<variable>`. Returns `null` when a key is malformed
 * or a name fails validation, so the caller fails closed rather than skip it.
 */
export function parseFilterNames(output: string): string[] | null {
  const names = new Set<string>()
  for (const key of output.split('\0')) {
    if (key.length === 0) continue
    const lastDot = key.lastIndexOf('.')
    if (!key.toLowerCase().startsWith(FILTER_KEY_PREFIX) || lastDot < FILTER_KEY_PREFIX.length) {
      return null
    }
    const name = key.slice(FILTER_KEY_PREFIX.length, lastDot)
    if (!isSafeFilterName(name)) return null
    names.add(name)
  }
  return [...names]
}

/**
 * Leading args that isolate a run from repository config. `-C` selects the
 * repo, so the spawn cwd can stay outside it.
 */
export function buildHardeningArgs(root: string, filterNames: readonly string[] = []): string[] {
  const args = [
    '--no-pager',
    '--no-optional-locks',
    '-C',
    root,
    '-c',
    'core.fsmonitor=false',
    '-c',
    `core.hooksPath=${GIT_NULL_DEVICE}`,
    '-c',
    GIT_INCLUDE_OVERRIDE
  ]
  for (const name of filterNames) {
    args.push(
      '-c',
      `filter.${name}.clean=`,
      '-c',
      `filter.${name}.smudge=`,
      '-c',
      `filter.${name}.process=`,
      '-c',
      `filter.${name}.required=false`
    )
  }
  return args
}

/**
 * List the filter drivers declared in the repository's effective config, run
 * with the base hardening. Resolves to `null` (fail closed) when the listing
 * errors or yields a name that does not validate; exit 1 (no match) is an empty
 * list.
 */
export async function listFilterNames(gitPath: string, root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      gitPath,
      [...buildHardeningArgs(root), 'config', '--null', '--name-only', '--get-regexp', '^filter\\.'],
      { ...hardenedSpawnOptions(), timeout: HARDENED_GIT_HELPER_TIMEOUT_MS, maxBuffer: CONFIG_LIST_MAX_BUFFER }
    )
    return parseFilterNames(stdout.toString())
  } catch (error) {
    // `config --get-regexp` exits 1 when nothing matches.
    if ((error as { code?: unknown }).code === 1) return []
    return null
  }
}

/** Absolute path of the platform lookup tool (`which` / `where.exe`). */
export function resolveFinderBinary(): string {
  return process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'where.exe')
    : '/usr/bin/which'
}

/**
 * Run the absolute finder for `name` from a safe cwd and return its output
 * lines (trimmed, non-empty). Rejects when the finder fails.
 */
export async function findOnPath(
  name: string,
  timeout: number = HARDENED_GIT_HELPER_TIMEOUT_MS
): Promise<string[]> {
  const { stdout } = await execFileAsync(resolveFinderBinary(), [name], {
    ...hardenedSpawnOptions(),
    timeout
  })
  return stdout
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
