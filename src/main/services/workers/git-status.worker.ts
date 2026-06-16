// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git status worker thread
 *
 * Runs git status computation off the main Electron thread using worker_threads.
 * Supports two strategies: isomorphic-git (portable) and native git (fast for large repos).
 *
 * @see Spec #022 - Git status thread offloading
 */

import { parentPort } from 'worker_threads'
import * as git from 'isomorphic-git'
import fs from 'fs'
import { isAbsolute, join, normalize } from 'path'
import { stat, access } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createEmptyGitStatusResponse } from '../../../shared/ipc/git-schema'
import type { GitStatusResponse, GitDisplayStatus, GitFileEntry, GitStatusCounts } from '../../../shared/ipc/git-schema'
import type { GitStatusStrategy } from '../../interfaces/IGitStatusWorker'
import { GIT_STATUS } from '../../../shared/constants'

const execFileAsync = promisify(execFile)

const GIT_STATUS_CAP = 10_000

// Git binary allowlist – checked before falling back to `where git` / `which git`.
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
    'C:\\ProgramData\\chocolatey\\bin\\git.exe',
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
const GIT_LIVENESS_TIMEOUT = 2_000
const BRANCH_DETECT_TIMEOUT = 5_000

// -- Message types -----------------------------------------------------------

interface WorkerMessage { type: 'execute'; id: number; projectPath: string; strategy: GitStatusStrategy }

// Consecutive native-git failures that count as transient before we give up
// and fall back to isomorphic-git. Without this, a *permanently* failing native
// path (corrupt repo, maxBuffer overflow on a huge tree, `safe.directory`
// rejection) would loop forever returning "temporarily unavailable" and the
// circuit breaker would never trip (the worker returns a successful result).
const TRANSIENT_STRIKE_LIMIT = 3

// -- Module state ------------------------------------------------------------

let nativeGitPath: string | null = null
let gitPathResolved = false
let gitPathResolvedAt = 0

// Counts consecutive *transient* native failures across calls. Reset on any
// successful native call. Module-scoped (one worker thread serves all projects)
// is deliberately coarse: an N-strike fallback to iso is a global safety valve,
// not per-project routing.
let consecutiveTransientFailures = 0

/** Exported for tests – reset the transient-failure counter. */
export function resetTransientFailureCount(): void {
  consecutiveTransientFailures = 0
}

// -- Message listener --------------------------------------------------------

if (!parentPort) {
  throw new Error('git-status.worker.ts must run inside a worker_threads Worker')
}

parentPort.on('message', (msg: WorkerMessage) => {
  handleExecute(msg.id, msg.projectPath, msg.strategy)
})

// -- Execute handler ---------------------------------------------------------

async function handleExecute(id: number, projectPath: string, strategy: GitStatusStrategy): Promise<void> {
  // Defense-in-depth: lightweight path validation (primary validation is in IPC handler)
  const normalizedPath = normalize(projectPath)
  if (!isAbsolute(normalizedPath) || normalizedPath !== projectPath) {
    parentPort!.postMessage({ type: 'error', id, error: 'Invalid project path' })
    return
  }

  try {
    let data: GitStatusResponse
    if (strategy === 'native-git') {
      const gitPath = await resolveGitPath()
      if (!gitPath) {
        // No git binary on this machine: isomorphic-git is the only option.
        // This is the ONE case where line-ending false-positives are possible –
        // statusMatrix() cannot replicate git's autocrlf/.gitattributes
        // normalization – and it is the accepted trade-off for a git-less host.
        console.warn('git-status.worker: native git not available, falling back to isomorphic-git')
        data = await executeIsomorphicGit(projectPath)
      } else {
        try {
          data = await executeNativeGit(projectPath, gitPath)
          consecutiveTransientFailures = 0
        } catch (nativeError) {
          data = await handleNativeFailure(nativeError, projectPath)
        }
      }
    } else {
      data = await executeIsomorphicGit(projectPath)
    }
    parentPort!.postMessage({ type: 'result', id, data })
  } catch (error) {
    parentPort!.postMessage({ type: 'error', id, error: error instanceof Error ? error.message : 'Unknown worker error' })
  }
}

/**
 * Classify a native-git failure and return the appropriate GitStatusResponse.
 *
 * Three buckets:
 *  - ENOENT: distinguish a vanished project folder (return empty, leave the
 *    git-path cache alone) from a missing binary (reset cache, fall back to
 *    isomorphic-git for this one call). EACCES is treated the same as
 *    binary-ENOENT – re-probe + fall back.
 *  - Durable: maxBuffer overflow, dubious-ownership / safe.directory,
 *    not-a-repo, corrupt – conditions that will not self-heal. Return a result
 *    with `isGitRepo:false` and a generic actionable message so the renderer
 *    surfaces a stable error rather than a flickering "temporarily unavailable".
 *  - Transient: everything else (timeouts, FD exhaustion, transient exit).
 *    Return a "temporarily unavailable" result and count toward the N-strike
 *    fallback to isomorphic-git, so a *persistent* failure cannot loop forever
 *    while masquerading as success at the circuit breaker.
 *
 * Error strings are kept generic: the underlying `nativeError.message` from
 * execFile typically embeds the absolute git binary path and the project path,
 * which would leak into the renderer UI and bypass the LoggingService
 * redaction policy (see CLAUDE.md). The error CODE is logged here for
 * diagnostics; the path-bearing message is not interpolated into the response.
 */
async function handleNativeFailure(nativeError: unknown, projectPath: string): Promise<GitStatusResponse> {
  const errObj = nativeError as NodeJS.ErrnoException & { stderr?: string | Buffer; killed?: boolean }
  const code = errObj.code
  const stderr = typeof errObj.stderr === 'string' ? errObj.stderr : errObj.stderr?.toString() ?? ''

  if (code === 'ENOENT') {
    // ENOENT can mean either the binary is missing *or* the spawn cwd does not
    // exist. Disambiguate before invalidating the resolver cache.
    let cwdGone = false
    try { await access(projectPath) } catch { cwdGone = true }
    if (cwdGone) {
      // Project folder was deleted between the service's `.git` check and our
      // spawn – return empty, leave the resolver cache untouched.
      return createEmptyGitStatusResponse()
    }
    console.warn('git-status.worker: resolved git binary missing at spawn (code ENOENT), re-probing + falling back')
    resetGitPathCache()
    consecutiveTransientFailures = 0
    return executeIsomorphicGit(projectPath)
  }

  if (code === 'EACCES') {
    // Binary is not executable (permissions changed, AV quarantine swap, …).
    // Treat like binary-ENOENT: re-probe + fall back this one call.
    console.warn('git-status.worker: git binary not executable (code EACCES), re-probing + falling back')
    resetGitPathCache()
    consecutiveTransientFailures = 0
    return executeIsomorphicGit(projectPath)
  }

  if (isDurableNativeError(code, stderr)) {
    console.warn('git-status.worker: native git reported a durable error', { code, signature: durableSignature(stderr) })
    consecutiveTransientFailures = 0
    return { ...createEmptyGitStatusResponse(), error: durableMessage(stderr) }
  }

  // Transient: FD exhaustion, timeout/kill, transient non-zero exit, etc.
  consecutiveTransientFailures++
  if (consecutiveTransientFailures >= TRANSIENT_STRIKE_LIMIT) {
    // The native path has been failing for several consecutive calls. Better to
    // serve a *possibly* stale (CRLF-false-positive on Windows) iso result than
    // to keep returning "temporarily unavailable" indefinitely.
    console.warn('git-status.worker: native git transient threshold reached, falling back to isomorphic-git', { strikes: consecutiveTransientFailures })
    consecutiveTransientFailures = 0
    return executeIsomorphicGit(projectPath)
  }
  console.warn('git-status.worker: native git failed transiently', { code: code ?? 'unknown', killed: errObj.killed === true, strikes: consecutiveTransientFailures })
  return { ...createEmptyGitStatusResponse(), isGitRepo: true, error: 'Git status temporarily unavailable. Retrying…' }
}

/**
 * Is this error a *durable* condition (won't self-heal across retries)?
 *
 * Distinct from "transient" so we can surface a stable, actionable message
 * instead of looping on "temporarily unavailable" forever.
 */
function isDurableNativeError(code: unknown, stderr: string): boolean {
  // maxBuffer overflow on the status output: on a repo big enough to exceed the
  // 5 MB cap, every refresh will overflow until the cap is raised. Not transient.
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return true
  const s = stderr.toLowerCase()
  if (s.includes('dubious ownership')) return true               // safe.directory rejection
  if (s.includes('not a git repository')) return true            // .git unreadable / corrupt
  if (s.includes('unable to read tree')) return true             // corrupt object DB
  if (s.includes('bad object')) return true                      // corrupt ref / object
  return false
}

function durableSignature(stderr: string): string {
  const s = stderr.toLowerCase()
  if (s.includes('dubious ownership')) return 'safe.directory'
  if (s.includes('not a git repository')) return 'not-a-repo'
  if (s.includes('unable to read tree') || s.includes('bad object')) return 'corrupt'
  return 'durable'
}

function durableMessage(stderr: string): string {
  const sig = durableSignature(stderr)
  switch (sig) {
    case 'safe.directory': return 'Git refused this folder (dubious ownership). Add it to safe.directory in your git config.'
    case 'not-a-repo': return 'This folder is no longer a usable git repository.'
    case 'corrupt': return 'The git repository data appears corrupted. Run `git fsck`.'
    default: return 'Git status is unavailable for this repository.'
  }
}

// -- isomorphic-git strategy -------------------------------------------------

async function executeIsomorphicGit(projectPath: string): Promise<GitStatusResponse> {
  try {
    const gitDir = join(projectPath, '.git')
    try {
      await stat(gitDir)
      // NOTE: do NOT short-circuit when `.git` is a file – worktrees and
      // submodules use a gitdir-pointer file. Let isomorphic-git try; if it
      // cannot resolve the pointer it will throw and we'll surface an error
      // response from the outer catch rather than silently report no-repo.
    } catch {
      return createEmptyGitStatusResponse()
    }

    // Branch detection
    let branch: string | null = null
    let isDetached = false
    try {
      const name = await git.currentBranch({ fs, dir: projectPath, fullname: false })
      if (!name) {
        isDetached = true
        try { branch = (await git.resolveRef({ fs, dir: projectPath, ref: 'HEAD' })).substring(0, 7) } catch { branch = null }
      } else {
        branch = name
      }
    } catch { /* continue without branch */ }

    // Fresh cache per call: a persistent cache accumulates isomorphic-git internal
    // objects that trigger V8 cppgc thread-safety assertions in worker threads.
    const matrix = await git.statusMatrix({ fs, dir: projectPath, cache: {} })
    const mapped = mapStatusMatrix(matrix, projectPath)

    return { isGitRepo: true, branch, isDetached, files: mapped.entries, counts: mapped.counts, truncated: mapped.truncated }
  } catch (error) {
    return { ...createEmptyGitStatusResponse(), error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// -- Native git strategy -----------------------------------------------------

/**
 * Run `git status --porcelain=v1 --branch -z --no-renames -uall` ONCE and read
 * both the branch state (via the leading `## …` header) and the per-file
 * entries from a single spawn.
 *
 * Why one command:
 *  - Halves process-creation cost per refresh (no separate `rev-parse --abbrev-ref`).
 *  - `--branch` reports the *unborn* state (`## No commits yet on <name>`),
 *    so a freshly-`git init`ed repo with no commits still gets correct status
 *    + untracked listings instead of failing in `rev-parse HEAD`.
 *  - `-uall` lists individual untracked *files*, not just the parent directory,
 *    so new files inside a brand-new folder each get their own decoration.
 *
 * A conditional second spawn (`rev-parse HEAD`) runs only when the header
 * indicates detached HEAD, to resolve a 7-char SHA for parity with the
 * isomorphic-git path.
 */
async function executeNativeGit(projectPath: string, gitPath: string): Promise<GitStatusResponse> {
  // Serialize execFile calls (not Promise.all) to reduce peak FD usage from 6 to 3.
  // On large repos the directory watcher already consumes most available FDs;
  // parallel child process spawns can tip the system into EMFILE.
  const statusResult = await execFileAsync(
    gitPath,
    ['status', '--porcelain=v1', '--branch', '-z', '--no-renames', '-uall'],
    { cwd: projectPath, maxBuffer: GIT_STATUS.NATIVE_GIT_MAX_BUFFER, timeout: GIT_STATUS.NATIVE_GIT_TIMEOUT }
  )

  const header = parseBranchHeader(statusResult.stdout)
  const files = parsePorcelainOutput(statusResult.stdout, projectPath)

  let branch: string | null = header.branch
  // For detached HEAD, resolve the actual commit SHA (parity with isomorphic-git path).
  // An unborn branch (just-init repo) is NOT detached – we keep the branch name.
  if (header.isDetached) {
    try {
      const { stdout } = await execFileAsync(gitPath, ['rev-parse', 'HEAD'], { cwd: projectPath, timeout: BRANCH_DETECT_TIMEOUT })
      branch = stdout.trim().substring(0, 7)
    } catch {
      branch = null
    }
  }

  const counts: GitStatusCounts = { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 }
  for (const file of files) {
    if (file.status !== 'unmodified' && file.status in counts) {
      counts[file.status as keyof GitStatusCounts]++
    }
  }

  return { isGitRepo: true, branch, isDetached: header.isDetached, files, counts, truncated: false }
}

/**
 * Parse the leading `## <something>\0` branch header from `git status
 * --porcelain=v1 --branch -z` output. Three shapes git emits:
 *
 *   `## main` / `## main...origin/main [ahead 1, behind 2]` → normal branch.
 *   `## HEAD (no branch)`                                    → detached HEAD.
 *   `## No commits yet on main`                              → unborn branch (just `git init`).
 *
 * Exported for tests.
 */
export function parseBranchHeader(output: string): { branch: string | null; isDetached: boolean; isUnborn: boolean } {
  if (!output) return { branch: null, isDetached: false, isUnborn: false }
  // The branch header is the first NUL-delimited part; defensively scan in case
  // git ever emits stray output before it.
  for (const part of output.split('\0')) {
    if (!part.startsWith('## ')) {
      // No branch header at all – return safe defaults.
      if (part.length >= 4) return { branch: null, isDetached: false, isUnborn: false }
      continue
    }
    const rest = part.slice(3)
    if (rest === 'HEAD (no branch)') return { branch: 'HEAD', isDetached: true, isUnborn: false }
    const unborn = rest.match(/^No commits yet on (.+)$/)
    if (unborn) return { branch: unborn[1], isDetached: false, isUnborn: true }
    // Normal: strip everything after `...` (upstream tracking) and after a space (ahead/behind).
    const name = rest.split('...')[0].split(' ')[0]
    return { branch: name || null, isDetached: false, isUnborn: false }
  }
  return { branch: null, isDetached: false, isUnborn: false }
}

// -- Git path resolution -----------------------------------------------------

/**
 * Verify that `candidate` is a real git binary.
 *
 * On Windows, `fs.access(X_OK)` degrades to existence-only (no POSIX
 * execute-bit semantics), so a non-binary file at the expected path would
 * pass. We add a `git --version` liveness probe to reject truncated or
 * renamed files. POSIX retains full `X_OK` semantics.
 */
async function isExecutableGit(candidate: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await access(candidate, fs.constants.F_OK)
      await execFileAsync(candidate, ['--version'], { timeout: GIT_LIVENESS_TIMEOUT })
      return true
    }
    await access(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Exported for testing in isolation (see `git-resolver.test.ts`). Tests can
 * call `resetGitPathCache()` + `resolveGitPath()` directly without routing
 * through the `worker_threads` message boundary.
 */
export function resetGitPathCache(): void {
  nativeGitPath = null
  gitPathResolved = false
  gitPathResolvedAt = 0
}

export async function resolveGitPath(): Promise<string | null> {
  // Return cached result if: successfully resolved, OR failed but cooldown hasn't elapsed
  if (gitPathResolved && (nativeGitPath !== null || Date.now() - gitPathResolvedAt < GIT_STATUS.GIT_PATH_RETRY_COOLDOWN)) {
    return nativeGitPath
  }

  for (const candidate of GIT_PATH_ALLOWLIST) {
    if (await isExecutableGit(candidate)) {
      nativeGitPath = candidate
      gitPathResolved = true
      gitPathResolvedAt = Date.now()
      return nativeGitPath
    }
  }

  const findCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(findCmd, ['git'], { timeout: BRANCH_DETECT_TIMEOUT })
    nativeGitPath = stdout.trim().split('\n')[0] || null
  } catch {
    nativeGitPath = null
  }
  gitPathResolved = true
  gitPathResolvedAt = Date.now()
  return nativeGitPath
}

// -- Porcelain parser (exported for testing) ---------------------------------

/**
 * Parse NUL-delimited `git status --porcelain -z` output into GitFileEntry[].
 * Format per entry: `XY<space>filepath\0`
 */
export function parsePorcelainOutput(output: string, projectPath: string): GitFileEntry[] {
  if (!output) return []

  const entries: GitFileEntry[] = []
  for (const part of output.split('\0')) {
    if (part.length < 4) continue
    // `--branch` emits a leading `## <branch-info>` part that is not a file
    // entry – skip it so the entry loop is unaffected by the new flag.
    if (part.startsWith('## ')) continue
    const xy = part.substring(0, 2)
    const filepath = part.substring(3)
    if (!filepath) continue
    const mapped = mapXYToStatus(xy)
    if (mapped) entries.push({ path: join(projectPath, filepath), status: mapped.status, staged: mapped.staged })
  }
  return entries
}

function mapXYToStatus(xy: string): { status: GitDisplayStatus; staged: boolean } | null {
  if (['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(xy)) return { status: 'conflicted', staged: false }
  switch (xy) {
    case 'M ': return { status: 'modified', staged: true }
    case ' M': return { status: 'modified', staged: false }
    case 'MM': return { status: 'modified', staged: false }
    case 'A ': return { status: 'staged', staged: true }
    case 'AM': return { status: 'staged', staged: true }
    case 'D ': return { status: 'deleted', staged: true }
    case ' D': return { status: 'deleted', staged: false }
    case '??': return { status: 'untracked', staged: false }
    case '!!': return null
  }
  // Typechange (`T` in X or Y) – symlink↔file, exec-bit flip. Surface as
  // modified so the file gets decorated; treat the worktree side as dominant
  // (parity with the ` M`/`M ` convention: staged iff the worktree column is blank).
  if (xy[0] === 'T' || xy[1] === 'T') {
    return { status: 'modified', staged: xy[1] === ' ' }
  }
  // Unknown but present codes – default to modified rather than dropping the
  // file with a warn-spam log. Better to over-decorate than to miss a change.
  return { status: 'modified', staged: xy[1] === ' ' }
}

// -- statusMatrix mapper (ports logic from GitStatusService) -----------------

type StatusMatrixRow = [string, number, number, number]
interface MappedFiles { entries: GitFileEntry[]; counts: GitStatusCounts; truncated: boolean }

function mapStatusMatrix(matrix: StatusMatrixRow[], projectPath: string): MappedFiles {
  const entries: GitFileEntry[] = []
  const counts: GitStatusCounts = { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 }
  let truncated = false

  for (const [filepath, HEAD, workdir, stage] of matrix) {
    if (entries.length >= GIT_STATUS_CAP) { truncated = true; break }

    let status: GitDisplayStatus
    let isStaged = false

    if (HEAD === 0 && workdir === 2 && stage === 0) {
      status = 'untracked'; counts.untracked++
    } else if (HEAD === 1 && workdir === 2 && stage === 1) {
      status = 'modified'; counts.modified++
    } else if (HEAD === 0 && workdir === 2 && (stage === 2 || stage === 3)) {
      // New file, added to the index – matches native `A ` → status:'staged'.
      status = 'staged'; isStaged = true; counts.staged++
    } else if (HEAD === 1 && workdir === 2 && (stage === 2 || stage === 3)) {
      // Tracked file modified in worktree AND staged differently. Native git
      // reports this as `M ` (modified, staged). Aligning the iso fallback so
      // the badge and counters agree across strategies (lens review #17).
      status = 'modified'; isStaged = true; counts.modified++
    } else if (HEAD === 1 && workdir === 0 && stage === 1) {
      status = 'deleted'; counts.deleted++
    } else if (HEAD === 1 && workdir === 0 && stage === 0) {
      status = 'deleted'; isStaged = true; counts.deleted++
    } else if (HEAD === 1 && workdir === 1 && stage === 1) {
      continue // unmodified
    } else {
      continue // unknown
    }

    entries.push({ path: join(projectPath, filepath), status, staged: isStaged })
  }

  return { entries, counts, truncated }
}

