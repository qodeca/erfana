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
const GIT_PATH_ALLOWLIST = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']
const BRANCH_DETECT_TIMEOUT = 5_000

// -- Message types -----------------------------------------------------------

interface WorkerMessage { type: 'execute'; id: number; projectPath: string; strategy: GitStatusStrategy }

// -- Module state ------------------------------------------------------------

let nativeGitPath: string | null = null
let gitPathResolved = false
let gitPathResolvedAt = 0

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
      if (gitPath) {
        try {
          data = await executeNativeGit(projectPath, gitPath)
        } catch (nativeError) {
          const msg = nativeError instanceof Error ? nativeError.message : String(nativeError)
          const isFdError = msg.includes('EBADF') || msg.includes('EMFILE') || msg.includes('ENFILE')
          if (isFdError) {
            // FD exhaustion: do NOT fall back to isomorphic-git – statusMatrix() on a large
            // repo opens thousands of FDs via fs.stat(), which would make the pressure worse.
            // Return a transient error; the next poll cycle will retry when FDs are freed.
            console.warn('git-status.worker: native git hit FD limit, returning transient error:', msg)
            data = { ...createEmptyGitStatusResponse(), isGitRepo: true, error: `Git status temporarily unavailable (${msg})` }
          } else {
            // Non-FD errors (e.g., git binary crashed): fall back to isomorphic-git
            console.warn('git-status.worker: native git failed, falling back to isomorphic-git:', msg)
            data = await executeIsomorphicGit(projectPath)
          }
        }
      } else {
        // FR-004 / AC-006: fall back to isomorphic-git when native git is unavailable
        console.warn('git-status.worker: native git not available, falling back to isomorphic-git')
        data = await executeIsomorphicGit(projectPath)
      }
    } else {
      data = await executeIsomorphicGit(projectPath)
    }
    parentPort!.postMessage({ type: 'result', id, data })
  } catch (error) {
    parentPort!.postMessage({ type: 'error', id, error: error instanceof Error ? error.message : 'Unknown worker error' })
  }
}

// -- isomorphic-git strategy -------------------------------------------------

async function executeIsomorphicGit(projectPath: string): Promise<GitStatusResponse> {
  try {
    const gitDir = join(projectPath, '.git')
    try {
      const stats = await stat(gitDir)
      if (!stats.isDirectory()) return createEmptyGitStatusResponse()
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

async function executeNativeGit(projectPath: string, gitPath: string): Promise<GitStatusResponse> {
  // Serialize execFile calls (not Promise.all) to reduce peak FD usage from 6 to 3.
  // On large repos the directory watcher already consumes most available FDs;
  // parallel child process spawns can tip the system into EMFILE.
  const statusResult = await execFileAsync(gitPath, ['status', '--porcelain', '-z', '--no-renames', '-unormal'], {
    cwd: projectPath, maxBuffer: GIT_STATUS.NATIVE_GIT_MAX_BUFFER, timeout: GIT_STATUS.NATIVE_GIT_TIMEOUT
  })
  const branchResult = await execFileAsync(gitPath, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectPath, timeout: BRANCH_DETECT_TIMEOUT })

  const rawBranch = branchResult.stdout.trim()
  const isDetached = rawBranch === 'HEAD'
  const files = parsePorcelainOutput(statusResult.stdout, projectPath)

  // For detached HEAD, resolve the actual commit SHA (parity with isomorphic-git path)
  let branch: string | null = rawBranch
  if (isDetached) {
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

  return { isGitRepo: true, branch, isDetached, files, counts, truncated: false }
}

// -- Git path resolution -----------------------------------------------------

async function resolveGitPath(): Promise<string | null> {
  // Return cached result if: successfully resolved, OR failed but cooldown hasn't elapsed
  if (gitPathResolved && (nativeGitPath !== null || Date.now() - gitPathResolvedAt < GIT_STATUS.GIT_PATH_RETRY_COOLDOWN)) {
    return nativeGitPath
  }

  for (const candidate of GIT_PATH_ALLOWLIST) {
    try {
      await access(candidate, fs.constants.X_OK)
      nativeGitPath = candidate
      gitPathResolved = true
      gitPathResolvedAt = Date.now()
      return nativeGitPath
    } catch { /* try next */ }
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
    default:
      console.warn(`git-status.worker: unknown porcelain XY code "${xy}"`)
      return null
  }
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
      status = 'staged'; isStaged = true; counts.staged++
    } else if (HEAD === 1 && workdir === 2 && (stage === 2 || stage === 3)) {
      status = 'staged'; isStaged = true; counts.staged++
    } else if (HEAD === 1 && workdir === 0 && stage === 1) {
      status = 'deleted'; counts.deleted++
    } else if (HEAD === 1 && workdir === 0 && stage === 0) {
      status = 'deleted'; isStaged = true; counts.deleted++
    } else if (HEAD === 1 && workdir === 2 && stage === 3) {
      // Note: this branch is unreachable – [1,2,3] is caught by the staged condition
      // above (stage === 2 || stage === 3). Kept for documentation and parity with
      // the original GitStatusService implementation.
      status = 'conflicted'; counts.conflicted++
    } else if (HEAD === 1 && workdir === 1 && stage === 1) {
      continue // unmodified
    } else {
      continue // unknown
    }

    entries.push({ path: join(projectPath, filepath), status, staged: isStaged })
  }

  return { entries, counts, truncated }
}

