/**
 * Locate the active Claude Code transcript file for a given working directory.
 *
 * Claude Code writes transcripts to `~/.claude/projects/<ENC>/<sessionUuid>.jsonl`
 * (one dir per cwd, encoded via {@link encodeProjectDir}). The active session is
 * the most-recently-modified REGULAR `*.jsonl` file in that dir, excluding the
 * `subagents/` subtree.
 *
 * Security (§8/§10): all reads must stay within the once-resolved realpath of
 * `~/.claude/projects`. We `lstat` every entry and skip symlinks / non-regular
 * files, then `fs.realpath` the chosen file and assert it is still a prefixed
 * child of the realpath'd root — defeating symlink-escape. This function NEVER
 * throws: every failure path returns `null` (fail-closed → bar hides).
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §8, §10
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeProjectDir } from './encodeCwd'

/** Subdirectory holding sidechain/subagent transcripts — excluded from selection. */
const SUBAGENTS_DIR = 'subagents'

/**
 * Clock-skew tolerance (ms) applied below the `minMtimeMs` floor. `ps lstart` has
 * one-second granularity while mtimes are sub-second, so a transcript written in
 * the same wall-clock second as the process start can carry an mtime a few hundred
 * ms under the floor; 2s absorbs that without re-admitting genuinely stale files
 * (which predate the launch by minutes/hours). See #216 (fresh-launch fix).
 */
const MTIME_SKEW_MS = 2000

/**
 * Cached realpath of `~/.claude/projects`. Resolved once (the homedir and the
 * realpath of the projects root do not change within a process lifetime) and
 * reused as the security prefix for every read.
 */
let cachedRoot: string | null = null

/**
 * Resolve the realpath of `~/.claude/projects`, caching the result in module
 * scope. The returned root is the prefix all transcript reads must stay within.
 *
 * If the directory does not yet exist, `fs.realpath` throws; we fall back to the
 * non-resolved `path.join(...)` so callers still get a stable, absolute root
 * (downstream `locateLatestTranscript` will simply find no entries and return
 * `null`).
 */
export async function resolveProjectsRoot(): Promise<string> {
  if (cachedRoot !== null) return cachedRoot

  const joined = path.join(os.homedir(), '.claude', 'projects')
  try {
    cachedRoot = await fs.realpath(joined)
  } catch {
    cachedRoot = joined
  }
  return cachedRoot
}

/** Clear the module-scope realpath cache. Test-only. */
export function __resetRootCacheForTests(): void {
  cachedRoot = null
}

/**
 * Assert that `candidate` is a prefixed child of `root` (strictly inside, not
 * equal to it). Uses `root + path.sep` so a sibling like `<root>-evil` cannot
 * pass the prefix test.
 */
function isInsideRoot(candidate: string, root: string): boolean {
  return candidate.startsWith(root + path.sep)
}

/**
 * Locate the active transcript `.jsonl` for `cwd`, or `null`.
 *
 * @param cwd Absolute working directory whose `<ENC>` transcript dir to scan.
 * @param opts.root Override the projects root (test injection). Defaults to the
 *   realpath of `~/.claude/projects`. Preferred over an env override for
 *   testability — a temp root is passed directly in tests.
 * @param opts.minMtimeMs Optional floor (epoch ms, typically the running
 *   `claude` process's start time): entries last modified before
 *   `minMtimeMs - MTIME_SKEW_MS` are skipped. This stops a freshly-launched
 *   session — whose own transcript does not exist until its first turn — from
 *   picking up a *prior* session's stale transcript (#216). Omit to disable the
 *   floor (graceful degrade when the start time is unknown).
 * @returns The validated absolute path of the newest eligible regular `*.jsonl`,
 *   or `null` if the dir is missing / has no eligible file / the choice escapes
 *   the root. Never throws.
 */
export async function locateLatestTranscript(
  cwd: string,
  opts?: { root?: string; minMtimeMs?: number }
): Promise<string | null> {
  try {
    const root = opts?.root ?? (await resolveProjectsRoot())
    const minMtimeMs = opts?.minMtimeMs
    const encDir = path.join(root, encodeProjectDir(cwd))

    let entries: string[]
    try {
      entries = await fs.readdir(encDir)
    } catch {
      return null
    }

    let newestPath: string | null = null
    let newestName: string | null = null
    let newestMtimeMs = -Infinity

    for (const name of entries) {
      if (name === SUBAGENTS_DIR) continue
      if (!name.endsWith('.jsonl')) continue

      const entryPath = path.join(encDir, name)

      // lstat (NOT stat) so symlinks are detected and skipped — a symlink could
      // point outside the root (§10).
      let stat: import('node:fs').Stats
      try {
        stat = await fs.lstat(entryPath)
      } catch {
        continue
      }

      if (!stat.isFile()) continue // skips symlinks, dirs, sockets, etc.

      // Process-start-time floor (#216): a transcript modified before the running
      // claude launched cannot belong to it, so exclude it. Skew-tolerant so a
      // same-second first write is not lost to sub-second-vs-1s granularity.
      if (minMtimeMs !== undefined && stat.mtimeMs < minMtimeMs - MTIME_SKEW_MS) continue

      // Strictly-newer wins; on an EXACT mtime tie, break deterministically by
      // preferring the lexicographically greater filename so the selection no
      // longer depends on readdir ordering (which is FS/platform dependent).
      if (
        stat.mtimeMs > newestMtimeMs ||
        (stat.mtimeMs === newestMtimeMs && (newestName === null || name > newestName))
      ) {
        newestMtimeMs = stat.mtimeMs
        newestName = name
        newestPath = entryPath
      }
    }

    if (newestPath === null) return null

    // Realpath the winner and re-assert it stays within the realpath'd root.
    let resolved: string
    try {
      resolved = await fs.realpath(newestPath)
    } catch {
      return null
    }

    if (!isInsideRoot(resolved, root)) return null

    return resolved
  } catch {
    return null
  }
}
