// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import { logger } from '../LoggingService'
import { candidateProjectDirs } from './encodeCwd'

/**
 * Max candidate transcripts returned by {@link locateTranscriptCandidates}. The
 * caller parses them newest-first until one yields a usable turn, so this only
 * needs to be deep enough to skip a metadata-only sidecar (or two) and reach the
 * real conversation file.
 */
export const MAX_CANDIDATES = 6

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
 * Locate the eligible transcript `.jsonl` files for `cwd`, **newest-first**.
 *
 * The caller (ClaudeStatusService) parses these in order and uses the first that
 * yields a usable assistant turn. Returning a ranked list rather than a single
 * newest file is what lets the bar skip a metadata-only sidecar (`ai-title` /
 * `last-prompt` / `mode`, no turns) that Claude Code writes alongside the real
 * transcript and which otherwise wins "newest" and shadows it (the bug this fixes).
 *
 * @param cwd Absolute working directory whose `<ENC>` transcript dir to scan.
 * @param opts.root Override the projects root (test injection). Defaults to the
 *   realpath of `~/.claude/projects`.
 * @param opts.minMtimeMs Optional floor (epoch ms, typically the running
 *   `claude` process's start time): entries last modified before
 *   `minMtimeMs - MTIME_SKEW_MS` are skipped, so a freshly-launched session never
 *   picks up a *prior* session's transcript (#216). Omit to disable the floor.
 * @returns Up to {@link MAX_CANDIDATES} validated absolute paths, newest-first;
 *   `[]` if the dir is missing / has no eligible file. Symlinks and root-escaping
 *   entries are dropped. Never throws.
 */
export async function locateTranscriptCandidates(
  cwd: string,
  opts?: { root?: string; minMtimeMs?: number }
): Promise<string[]> {
  try {
    const root = opts?.root ?? (await resolveProjectsRoot())
    const minMtimeMs = opts?.minMtimeMs

    // Try the primary encoding first, then a normalized alternate (e.g. a
    // trailing-separator-stripped form) — the inferred Windows encoding is lossy,
    // so a single attempt can silently miss. The first candidate dir that exists
    // wins; all candidates derive from this cwd, so a fallback can never resolve a
    // different project's transcript.
    let encDir: string | null = null
    let entries: string[] | null = null
    for (const candidate of candidateProjectDirs(cwd)) {
      const dir = path.join(root, candidate)
      try {
        entries = await fs.readdir(dir)
        encDir = dir
        break
      } catch {
        // This candidate dir is absent — try the next.
      }
    }
    if (encDir === null || entries === null) {
      logger.debug('locateTranscript: no candidate project dir', { cwdBase: path.basename(cwd) })
      return []
    }

    // Collect every eligible regular `.jsonl` (post-floor), with its mtime.
    const eligible: Array<{ path: string; name: string; mtimeMs: number }> = []
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

      eligible.push({ path: entryPath, name, mtimeMs: stat.mtimeMs })
    }

    if (eligible.length === 0) {
      logger.debug('locateTranscript: no eligible .jsonl in dir', { dirBase: path.basename(encDir) })
      return []
    }

    // Newest-first; on an EXACT mtime tie, break deterministically by preferring
    // the lexicographically greater filename (selection no longer depends on
    // readdir ordering, which is FS/platform dependent).
    eligible.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))

    // Realpath-validate each and keep those still inside the realpath'd root,
    // capped to MAX_CANDIDATES. A root-escaping entry is dropped (and surfaced) —
    // a security-boundary rejection, not a benign miss.
    const out: string[] = []
    for (const e of eligible) {
      if (out.length >= MAX_CANDIDATES) break
      let resolved: string
      try {
        resolved = await fs.realpath(e.path)
      } catch {
        continue
      }
      if (!isInsideRoot(resolved, root)) {
        logger.warn('locateTranscript: candidate escapes projects root (rejected)', {
          nameBase: path.basename(e.name)
        })
        continue
      }
      out.push(resolved)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Locate the single newest eligible transcript `.jsonl` for `cwd`, or `null`.
 * Thin back-compat wrapper over {@link locateTranscriptCandidates} (returns the
 * first candidate). Prefer the candidates form for turn-aware selection.
 */
export async function locateLatestTranscript(
  cwd: string,
  opts?: { root?: string; minMtimeMs?: number }
): Promise<string | null> {
  const candidates = await locateTranscriptCandidates(cwd, opts)
  return candidates[0] ?? null
}
