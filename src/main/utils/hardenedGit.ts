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
import { join, posix, win32 } from 'node:path'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

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
  'LANG',
  // User-level git config lives under XDG_CONFIG_HOME when it is set.
  'XDG_CONFIG_HOME',
  // `where.exe` resolves bare names through PATHEXT.
  'PATHEXT'
] as const

/**
 * Variables set unconditionally on the git child. `GIT_NO_LAZY_FETCH` and
 * `GIT_ALLOW_PROTOCOL=none` stop git fetching missing objects of a partial
 * clone through a child process driven by the repository's own remote settings
 * (env vars rather than flags so older git versions honour them too).
 */
export const GIT_FIXED_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_ALLOW_PROTOCOL: 'none'
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

/** Line-ending config keys that Git for Windows sets in its system file. */
const EOL_KEYS = ['core.autocrlf', 'core.eol', 'core.safecrlf']
const EOL_VALUES: Record<string, readonly string[]> = {
  'core.autocrlf': ['true', 'false', 'input'],
  'core.eol': ['lf', 'crlf', 'native'],
  'core.safecrlf': ['true', 'false', 'warn']
}
const EOL_REGEXP = '^core\\.(autocrlf|eol|safecrlf)$'

/**
 * One listing for everything the isolation needs: filter drivers, line-ending
 * keys already set, and the keys that mark a promisor remote / partial clone.
 */
const ISOLATION_CONFIG_REGEXP =
  '^(filter\\.|core\\.(autocrlf|eol|safecrlf)$|remote\\..*\\.promisor$|extensions\\.partialclone$)'

/**
 * Build the child env from the allowlist plus {@link GIT_FIXED_ENV}.
 * `includeSystemConfig` drops `GIT_CONFIG_NOSYSTEM` for the one spawn that reads
 * the system config file.
 */
export function buildGitEnv(options: { includeSystemConfig?: boolean } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of GIT_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  const merged = { ...env, ...GIT_FIXED_ENV } as NodeJS.ProcessEnv
  if (options.includeSystemConfig) delete merged['GIT_CONFIG_NOSYSTEM']
  return merged
}

/** Spawn options common to every hardened spawn (cwd is never the repo). */
export function hardenedSpawnOptions(options: { includeSystemConfig?: boolean } = {}): {
  cwd: string
  env: NodeJS.ProcessEnv
  shell: false
  windowsHide: true
} {
  return { cwd: tmpdir(), env: buildGitEnv(options), shell: false, windowsHide: true }
}

/** Whether `name` is safe to splice into a `-c filter.<name>.<key>=` override. */
export function isSafeFilterName(name: string): boolean {
  return FILTER_NAME_PATTERN.test(name)
}

export interface ParsedIsolationListing {
  /** Distinct filter-driver names declared in the effective config. */
  filterNames: string[]
  /** Line-ending keys (`core.autocrlf` / `core.eol` / `core.safecrlf`) set outside the system file. */
  eolKeysSet: Set<string>
}

/**
 * Parse the output of `config --null --name-only --get-regexp` for
 * {@link ISOLATION_CONFIG_REGEXP} (NUL-separated keys). A filter name is
 * everything between the leading `filter.` and the final `.<variable>`.
 *
 * Returns `null` (the caller fails closed) when a key is malformed, a name fails
 * validation, or the config declares a promisor remote / partial clone: such a
 * repository makes git fetch missing objects through a child process that reads
 * the repository's own remote settings.
 */
export function parseIsolationListing(output: string): ParsedIsolationListing | null {
  const filterNames = new Set<string>()
  const eolKeysSet = new Set<string>()
  for (const key of output.split('\0')) {
    if (key.length === 0) continue
    const lower = key.toLowerCase()
    if (EOL_KEYS.includes(lower)) {
      eolKeysSet.add(lower)
      continue
    }
    const lastDot = key.lastIndexOf('.')
    if (!lower.startsWith(FILTER_KEY_PREFIX) || lastDot < FILTER_KEY_PREFIX.length) {
      return null
    }
    const name = key.slice(FILTER_KEY_PREFIX.length, lastDot)
    if (!isSafeFilterName(name)) return null
    filterNames.add(name)
  }
  return { filterNames: [...filterNames], eolKeysSet }
}

/**
 * Parse `config --system --null --get-regexp` output (`key\nvalue\0` records)
 * into `key=value` strings, keeping only recognised line-ending keys with
 * recognised values.
 */
export function parseSystemEolConfig(output: string): string[] {
  const result: string[] = []
  for (const record of output.split('\0')) {
    const newline = record.indexOf('\n')
    if (newline < 0) continue
    const key = record.slice(0, newline).toLowerCase()
    const value = record.slice(newline + 1).trim().toLowerCase()
    if (EOL_VALUES[key]?.includes(value)) result.push(`${key}=${value}`)
  }
  return result
}

/**
 * Leading args that isolate a run from repository config. `-C` selects the
 * repo, so the spawn cwd can stay outside it. `extraConfig` entries are
 * `key=value` strings passed through as `-c`.
 */
export function buildHardeningArgs(
  root: string,
  filterNames: readonly string[] = [],
  extraConfig: readonly string[] = []
): string[] {
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
  for (const entry of extraConfig) {
    args.push('-c', entry)
  }
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

/** System line-ending config per git binary; it only changes when git is reinstalled. */
const systemEolCache = new Map<string, Promise<string[]>>()

/** Exported for tests – drop the memoised system line-ending config. */
export function resetSystemEolCache(): void {
  systemEolCache.clear()
}

/**
 * `GIT_CONFIG_NOSYSTEM=1` also drops Git for Windows' system `core.autocrlf`,
 * which would make CRLF checkouts read as modified. Read the system file's
 * line-ending keys (the one spawn that leaves NOSYSTEM unset) so they can be
 * passed back as explicit values. Any failure yields no values.
 */
async function readSystemEolConfig(gitPath: string): Promise<string[]> {
  let pending = systemEolCache.get(gitPath)
  if (!pending) {
    pending = execFileAsync(
      gitPath,
      ['--no-pager', '--no-optional-locks', 'config', '--system', '--null', '--get-regexp', EOL_REGEXP],
      {
        ...hardenedSpawnOptions({ includeSystemConfig: true }),
        timeout: HARDENED_GIT_HELPER_TIMEOUT_MS,
        maxBuffer: CONFIG_LIST_MAX_BUFFER
      }
    ).then(
      ({ stdout }) => parseSystemEolConfig(stdout.toString()),
      () => []
    )
    systemEolCache.set(gitPath, pending)
  }
  return pending
}

export interface IsolationConfig {
  filterNames: string[]
  /** `key=value` entries to pass as `-c` (system line-ending config not set elsewhere). */
  extraConfig: string[]
}

/**
 * Inspect the repository's effective config (run with the base hardening) and
 * derive what the hardened status run needs. Resolves to `null` (fail closed;
 * the caller must not run native git) when the listing errors, a name does not
 * validate, or the repo is a promisor / partial clone. Exit 1 (no match) is an
 * empty config.
 */
export async function listIsolationConfig(gitPath: string, root: string): Promise<IsolationConfig | null> {
  let parsed: ParsedIsolationListing | null
  try {
    const { stdout } = await execFileAsync(
      gitPath,
      [...buildHardeningArgs(root), 'config', '--null', '--name-only', '--get-regexp', ISOLATION_CONFIG_REGEXP],
      { ...hardenedSpawnOptions(), timeout: HARDENED_GIT_HELPER_TIMEOUT_MS, maxBuffer: CONFIG_LIST_MAX_BUFFER }
    )
    parsed = parseIsolationListing(stdout.toString())
  } catch (error) {
    // `config --get-regexp` exits 1 when nothing matches.
    if ((error as { code?: unknown }).code !== 1) return null
    parsed = { filterNames: [], eolKeysSet: new Set() }
  }
  if (parsed === null) return null

  const eolKeysSet = parsed.eolKeysSet
  const system = await readSystemEolConfig(gitPath)
  // A value set at global/repo level outranks the system file; only fill gaps.
  const extraConfig = system.filter((entry) => !eolKeysSet.has(entry.slice(0, entry.indexOf('='))))
  return { filterNames: parsed.filterNames, extraConfig }
}

// Git binary allowlist – checked before falling back to `where.exe` / `which`.
// Priority order per platform: most-popular install location first.
// On Windows, `fs.access(X_OK)` is *existence-only* (no POSIX execute-bit),
// so a second `git --version` liveness probe is required to reject bad files.
// See #160 (Windows git allowlist) for context.
//
// `USERPROFILE` is validated to start with `C:\Users\` before the Scoop path
// is added — guards against an attacker setting a poisoned `USERPROFILE`
// (e.g. via a malicious shortcut) to redirect the Scoop probe to an
// arbitrary directory under their control.
function buildWin32GitPaths(): string[] {
  const fixed = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    'C:\\ProgramData\\chocolatey\\bin\\git.exe'
  ]
  const userProfile = process.env.USERPROFILE
  if (userProfile && /^[A-Za-z]:\\Users\\[^\\]+\\?$/i.test(userProfile.replace(/\\$/, '') + '\\')) {
    fixed.push(`${userProfile}\\scoop\\apps\\git\\current\\cmd\\git.exe`)
  }
  return fixed
}
const WIN32_GIT_PATHS = buildWin32GitPaths()
const POSIX_GIT_PATHS = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']
const GIT_PATH_ALLOWLIST = process.platform === 'win32' ? WIN32_GIT_PATHS : POSIX_GIT_PATHS
const GIT_LIVENESS_TIMEOUT_MS = 2_000

/**
 * Verify that `candidate` is a real git binary. On Windows `access(X_OK)`
 * degrades to existence-only, so a `--version` liveness probe rejects truncated
 * or renamed files. POSIX retains full `X_OK` semantics.
 */
async function isExecutableGit(candidate: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await access(candidate, constants.F_OK)
      await execFileAsync(candidate, ['--version'], {
        ...hardenedSpawnOptions(),
        timeout: GIT_LIVENESS_TIMEOUT_MS
      })
      return true
    }
    await access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve an absolute git binary: the fixed install-location allowlist first,
 * then the absolute `which` / `where.exe` run from a safe cwd (a bare finder
 * name could be answered by a planted binary). Only an absolute hit is
 * accepted; returns `null` when git is not found. Not cached – callers cache.
 */
export async function resolveGitBinary(): Promise<string | null> {
  for (const candidate of GIT_PATH_ALLOWLIST) {
    if (await isExecutableGit(candidate)) return candidate
  }
  try {
    const [first] = await findOnPath('git')
    return first && (process.platform === 'win32' ? win32 : posix).isAbsolute(first) ? first : null
  } catch {
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
