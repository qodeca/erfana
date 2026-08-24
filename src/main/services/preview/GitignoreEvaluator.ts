// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hardened `git check-ignore` evaluator (Issue #74, work item 26).
 *
 * The preview eligibility chain must know whether a candidate `.html` file is
 * gitignored. `git check-ignore` is the correct oracle, but a **malicious
 * repository** (threat T2) controls `.git/config`, `.gitignore`, hooks and the
 * working tree, and several git config keys and `GIT_*` environment variables
 * turn `check-ignore` into arbitrary command execution or an arbitrary-path file
 * append. This module runs git as narrowly as possible:
 *
 *  - **Absolute git path, resolved once** from a SAFE cwd (never a bare `git`
 *    against an untrusted current directory, which would let a planted `git`
 *    binary run).
 *  - **cwd is NOT inside the repo** (an OS temp dir), with `-C <root>` selecting
 *    the repository — so a `.git`-relative config include cannot be steered by
 *    the current directory.
 *  - **Config overrides** neutralise the known code-execution key
 *    (`core.fsmonitor=`), redirect hooks to the null device
 *    (`core.hooksPath=<NULL_DEVICE>`) and disable ad-hoc includes
 *    (`include.path=`); `GIT_CONFIG_NOSYSTEM=1` drops system config.
 *  - **Env is an ALLOWLIST**, not a blocklist (design NEW-13): only
 *    {@link GIT_ENV_ALLOWLIST} plus `GIT_CONFIG_NOSYSTEM` survive, so
 *    `GIT_TRACE*` (an arbitrary-path append primitive), `GIT_WORK_TREE`,
 *    `GIT_INDEX_FILE`, `GIT_PROXY_COMMAND` and `GIT_CEILING_DIRECTORIES` cannot
 *    reach the child.
 *  - `shell: false`, `windowsHide: true`, and a hard `timeout`.
 *
 * **Fails open** (treats the file as NOT ignored) whenever git is unavailable or
 * misbehaves: the fixed excluded-directory list already covers the dangerous
 * cases, and failing closed would make `.html` un-previewable on every non-git
 * project. Exit 0 = ignored, 1 = not ignored, anything else = fail open.
 *
 * @see docs/designs/sd-074-html-preview.md §1.5, §2.8 (control table, risk 9)
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join } from 'node:path'
import { devNull, tmpdir } from 'node:os'

const execFileAsync = promisify(execFile)

/**
 * The ONLY environment variables passed to the git child, plus
 * `GIT_CONFIG_NOSYSTEM=1` added separately. An allowlist is the only form whose
 * test is writable as "no `GIT_*` variable other than `GIT_CONFIG_NOSYSTEM` is
 * present" (design NEW-13).
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

/** Per-invocation timeout (ms). */
const GIT_TIMEOUT_MS = 2000

/** Default TTL for the per-(root,path) result cache (ms). */
const DEFAULT_CACHE_TTL_MS = 5000

/** Exit code git returns when the path is NOT ignored. */
const EXIT_NOT_IGNORED = 1

/** The exec surface, injectable so tests never spawn a real git. */
export type GitExecFn = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    shell: false
    timeout: number
    windowsHide: true
  }
) => Promise<{ stdout: string; stderr: string }>

export interface GitignoreEvaluatorDeps {
  /** Exec implementation (real promisified `execFile` by default). */
  exec?: GitExecFn
  /** Resolves the absolute git path once; returns `null` when git is absent. */
  resolveGitPath?: (tempDir: string) => Promise<string | null>
  /** Safe cwd for the git child (defaults to `os.tmpdir()`; NEVER the repo). */
  tempDir?: () => string
  /** Clock for TTL expiry (defaults to `Date.now`). */
  now?: () => number
  /** Result-cache TTL in ms. */
  cacheTtlMs?: number
}

export interface IGitignoreEvaluator {
  /**
   * Whether `relPath` (relative to `projectRoot`) is gitignored. Fails open
   * (returns `false`) when git is unavailable or errors.
   */
  isIgnored(projectRoot: string, relPath: string): Promise<boolean>
  /** Drop any cached results (e.g. on project switch). */
  clearCache(): void
}

/** Default exec: real `execFile`, promisified, stdout/stderr coerced to strings. */
const defaultExec: GitExecFn = (file, args, options) =>
  execFileAsync(file, [...args], options).then((r) => ({
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString()
  }))

/**
 * Default git-path resolver: `which git` (POSIX) / `where git` (win32) run from
 * a SAFE cwd with an absolute finder binary. Returns the first absolute hit or
 * `null`.
 */
async function defaultResolveGitPath(tempDir: string): Promise<string | null> {
  const isWin = process.platform === 'win32'
  const finder = isWin
    ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'where.exe')
    : '/usr/bin/which'
  try {
    const { stdout } = await execFileAsync(finder, ['git'], {
      cwd: tempDir,
      shell: false,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS
    })
    const first = stdout
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    return first && isAbsolute(first) ? first : null
  } catch {
    return null
  }
}

/** Build the child env from the allowlist plus `GIT_CONFIG_NOSYSTEM`. */
function buildGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of GIT_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  env['GIT_CONFIG_NOSYSTEM'] = '1'
  return env
}

interface CacheEntry {
  value: boolean
  expires: number
}

export class GitignoreEvaluator implements IGitignoreEvaluator {
  private readonly exec: GitExecFn
  private readonly resolveGitPath: (tempDir: string) => Promise<string | null>
  private readonly tempDir: () => string
  private readonly now: () => number
  private readonly cacheTtlMs: number

  private gitPathPromise: Promise<string | null> | null = null
  private readonly cache = new Map<string, CacheEntry>()

  constructor(deps: GitignoreEvaluatorDeps = {}) {
    this.exec = deps.exec ?? defaultExec
    this.resolveGitPath = deps.resolveGitPath ?? defaultResolveGitPath
    this.tempDir = deps.tempDir ?? (() => tmpdir())
    this.now = deps.now ?? Date.now
    this.cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  }

  async isIgnored(projectRoot: string, relPath: string): Promise<boolean> {
    const cacheKey = `${projectRoot}\u0000${relPath}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expires > this.now()) {
      return cached.value
    }

    const value = await this.evaluate(projectRoot, relPath)
    this.cache.set(cacheKey, { value, expires: this.now() + this.cacheTtlMs })
    return value
  }

  clearCache(): void {
    this.cache.clear()
  }

  /** One hardened `git check-ignore` invocation; fails open on any anomaly. */
  private async evaluate(projectRoot: string, relPath: string): Promise<boolean> {
    const tempDir = this.tempDir()

    // Resolve git ONCE and cache the promise; a null result fails open.
    if (this.gitPathPromise === null) {
      this.gitPathPromise = this.resolveGitPath(tempDir)
    }
    const gitPath = await this.gitPathPromise
    if (gitPath === null) {
      return false
    }

    const args = [
      '-C',
      projectRoot,
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=',
      '-c',
      `core.hooksPath=${devNull}`,
      '-c',
      'include.path=',
      'check-ignore',
      '--quiet',
      '--',
      relPath
    ] as const

    try {
      await this.exec(gitPath, args, {
        cwd: tempDir,
        env: buildGitEnv(),
        shell: false,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true
      })
      // Resolved without throwing → exit 0 → ignored.
      return true
    } catch (error) {
      // `execFile` rejects with the exit code on `error.code` for a non-zero
      // exit; exit 1 is the definitive "not ignored", anything else fails open.
      const code = (error as { code?: unknown }).code
      if (code === EXIT_NOT_IGNORED) {
        return false
      }
      return false
    }
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createGitignoreEvaluator(
  deps: GitignoreEvaluatorDeps = {}
): IGitignoreEvaluator {
  return new GitignoreEvaluator(deps)
}
