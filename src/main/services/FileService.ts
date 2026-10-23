// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readdir, readFile, writeFile, stat, realpath, rm, mkdir, rename as fsRename, cp, copyFile } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, extname, basename, relative, sep, resolve as resolvePath } from 'path'
import type { IFileService } from '../interfaces/IFileService'
import { SymlinkDetector } from '../utils/SymlinkDetector'
import { RollbackHandler } from '../utils/RollbackHandler'
import { assertValidUserFilename } from '../utils/validateFilename'
import {
  MAX_SPLIT_DEPTH,
  MAX_WALK_HINTS,
  toRootRelative,
  type ProjectPathFilter
} from '../utils/projectPathFilter'
import { DEFAULT_TREE_HIDDEN_PATTERNS } from '../../shared/constants'
import {
  createCoalescingRunner,
  type CoalescedRunInfo,
  type CoalescingRunner
} from '../../shared/coalescingRunner'
import { stablePathDigest } from '../../shared/stablePathDigest'
import { redactQuotedPaths } from '../../shared/redactQuotedPaths'
import { redactPath } from '../utils/redactUserInput'
import { logger } from './LoggingService'
import { atomicWriteText, isAtomicTempName } from '../utils/atomicWrite'
import { IMAGE_EXTENSIONS, readImage } from './file/imageRead'
import { childPath } from '../utils/childPath'
import { createConcurrencyLimit, type ConcurrencyLimit } from '../utils/concurrencyLimit'
import { createFindByNameGate, startFindByName, type FindByNameResult } from './file/findByName'
import { isInsideRoot, isSamePath, normaliseResolved } from '../utils/pathCompare'
import { getPlatformConfig } from './watcher/PlatformConfig'
import type { ImageReadResponse } from '../../shared/ipc/file-image-schema'
import type { ProjectSession } from './session/ProjectSession'
import type { FileNode, LazyKind } from '../../shared/ipc/file-schema'

export type { FileNode }

// Maximum number of auto-numbered copies before rejecting operation (e.g., file.md, file (1).md, ... file (999).md)
export const MAX_COPY_ATTEMPTS = 1000

/**
 * A tree walk still running after this long logs one
 * `readDirectory still running` warning (#208) – on a hung walk (for example
 * an unreachable network drive) it is the only trace that the path is blocked.
 */
export const READ_DIRECTORY_SLOW_WARN_MS = 60_000

/**
 * The single-flight key for a tree walk (#208): `C:/x`, `C:\x`, `C:\x\` and a
 * relative path share one key. Case is deliberately NOT folded: on a
 * case-sensitive volume `/x/Proj` and `/x/proj` are different folders, and the
 * follow-up walk uses the latest caller's path, so folding could hand a
 * caller the other folder's tree.
 */
const readDirectoryKey = (dirPath: string): string => resolvePath(dirPath)

/**
 * Arm the one-shot `still running` warning for one walk. Unref'd so it never
 * keeps the process alive; the caller clears it when the walk settles.
 */
function armSlowWalkWarning(readId: number, pathDigest: string, start: number): NodeJS.Timeout {
  const timer = setTimeout(() => {
    logger.warn('FileService: readDirectory still running', {
      readId,
      pathDigest,
      elapsedMs: Math.round(performance.now() - start)
    })
  }, READ_DIRECTORY_SLOW_WARN_MS)
  timer.unref()
  return timer
}

/**
 * Top-level folders are split by the Windows watcher's plan anyway, so only a
 * dropped folder at two or more segments is a walk hint (#211, design D1).
 */
const MIN_WALK_HINT_SEGMENTS = 2

/**
 * The walk hints of one root walk (#211, design D1): the topmost dropped
 * folders at two or more segments. `ProjectPathFilter.replaceWalkHints` does
 * the capping; this keeps one hint past {@link MAX_WALK_HINTS} and the first
 * one deeper than {@link MAX_SPLIT_DEPTH}, so the filter still sees – and
 * reports as `planCapped` – that something was left out, while a tree with
 * thousands of nested `node_modules` costs a bounded list.
 */
class WalkHintCollector {
  private readonly hints: string[] = []
  private firstTooDeep: string | null = null

  add(rel: string, segments: number): void {
    if (segments < MIN_WALK_HINT_SEGMENTS) return
    if (segments > MAX_SPLIT_DEPTH) {
      if (this.firstTooDeep === null) this.firstTooDeep = rel
    } else if (this.hints.length <= MAX_WALK_HINTS) {
      this.hints.push(rel)
    }
  }

  toList(): string[] {
    return this.firstTooDeep === null ? [...this.hints] : [...this.hints, this.firstTooDeep]
  }
}

/**
 * What one walk applies and counts, built once at walk start: a setter called
 * mid-walk applies to the next walk.
 */
interface WalkScope {
  readonly hiddenPatterns: readonly string[]
  /** The project filter; null without a project or for a walk outside it. */
  readonly filter: ProjectPathFilter | null
  /** Collects walk hints; set only when the walk's base is the project root. */
  readonly hints: WalkHintCollector | null
  excludedEntryCount: number
  /** Real folders already entered through a link in this walk (case-folded key) */
  readonly enteredLinkTargets: Set<string>
  /** Bounds the walk's `readdir` calls in flight ({@link WALK_READ_CONCURRENCY}) */
  readonly reads: ConcurrencyLimit
  /** Rows built so far, checked against {@link MAX_WALK_ENTRIES} */
  entryCount: number
  /** Folders actually listed (`readdir` calls), for the `completed` line */
  folderReadCount: number
  /** Folder rows left lazy – ignored, or not reached before the cap */
  lazyFolderCount: number
  /** The cap left at least one folder lazy */
  entryCapReached: boolean
  /** A shallow walk: only the base folder is listed, every sub-folder is lazy */
  readonly shallow: boolean
}

/** One folder of a walk. */
interface WalkDir {
  readonly path: string
  /**
   * Where the folder is read when that differs from `path`: the real folder of
   * a link, or a folder below one. Node paths are always built from `path`.
   */
  readonly readPath?: string
  readonly depth: number
  /** Project-relative, `/`-separated; null when no filter applies. */
  readonly rel: string | null
  /** This folder or an ancestor is dropped by the filter: no hints below it. */
  readonly dropped: boolean
  /**
   * Real folders of the links this folder was reached through, outermost first.
   * Empty for a folder reached by plain folders only.
   */
  readonly linkChain?: readonly string[]
}

/**
 * Folder links (junctions, directory symlinks) a walk follows one inside the
 * other. A deeper chain is shown as a folder but not entered.
 */
export const MAX_LINK_DEPTH = 8

/**
 * Folder links one walk enters in all. Each real folder is entered once, and
 * past this many the remaining links show as folders but are not entered, so
 * a tree of folders linked to each other costs a bounded walk.
 */
export const MAX_ENTERED_LINKS = 200

/**
 * Folder reads one walk keeps in flight (review finding 32). The walk used to
 * read one folder at a time; a few dozen in flight keep the disk and libuv's
 * thread pool busy without opening thousands of handles at once.
 */
export const WALK_READ_CONCURRENCY = 24

/**
 * Rows one walk lists before it stops reading further folders. A folder whose
 * turn comes after that is left lazy – shown, its children read when it is
 * expanded – so a huge project still opens with a bounded first tree. Reads
 * already in flight still finish, so a walk may list up to
 * {@link WALK_READ_CONCURRENCY} folders' worth of rows past the cap.
 */
export const MAX_WALK_ENTRIES = 50_000

/**
 * One collator for every sort. `a.localeCompare(b)` with no locale and no
 * options is specified as `new Intl.Collator().compare(a, b)`, so the order is
 * unchanged – without setting up a collator on each of the walk's comparisons.
 */
const nameCollator = new Intl.Collator()

/** The tree's order: folders first, then by name. */
export function compareTreeNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return nameCollator.compare(a.name, b.name)
}

/** A walk's scope and its first folder – null when the base itself is excluded. */
interface WalkPlan {
  readonly scope: WalkScope
  readonly base: WalkDir | null
}

const joinRelative = (parentRel: string, name: string): string =>
  parentRel === '' ? name : `${parentRel}/${name}`

/**
 * Hidden by name (the walk's snapshot), an atomic-save temp file, or excluded by the project filter.
 * Tested before a node is built, so an excluded folder is never read. Only the
 * entry itself is tested against the exclude list: the walk never enters an
 * excluded folder, so no ancestor can be one.
 */
function isSkippedEntry(name: string, rel: string | null, scope: WalkScope): boolean {
  if (scope.hiddenPatterns.includes(name)) return true
  // A save in flight (or left by a crash): never part of the tree
  if (isAtomicTempName(name)) return true
  if (rel === null || scope.filter === null || !scope.filter.isEntryExcluded(rel)) return false
  scope.excludedEntryCount++
  return true
}

/**
 * A folder the walk enters but the directory watcher still drops – hidden by
 * the filter's own list or ignored (`src/dist`). Evaluated only while hints
 * are collected; exclusion is not re-tested, the walk already skipped those.
 */
function isDroppedFolder(rel: string | null, scope: WalkScope): boolean {
  if (scope.hints === null || scope.filter === null || rel === null) return false
  return scope.filter.isHidden(rel) || scope.filter.isIgnored(rel)
}

/**
 * An ignored folder (`watcher.ignoreList`, on whole segments): shown, but not
 * read by the walk – its row reads it when expanded. Applies whenever the
 * project filter does, so an expanded ignored folder's own sub-folders stay
 * lazy as well, one level per expand.
 */
function isLazyFolder(rel: string | null, scope: WalkScope): boolean {
  return rel !== null && scope.filter !== null && scope.filter.isIgnoredFolder(rel)
}

/** The segments of a link's real target below the project's real root. */
const targetSegments = (target: string, realRoot: string): string[] =>
  relative(realRoot, target).split(sep).filter(Boolean)

/**
 * Store a completed root walk's hints on its filter, replacing the previous
 * ones. Returns how many the filter kept – 0 for any other walk, which leaves
 * the stored hints alone.
 */
function recordWalkHints(scope: WalkScope): number {
  if (scope.hints === null || scope.filter === null) return 0
  scope.filter.replaceWalkHints(scope.hints.toList())
  return scope.filter.getWalkHints().length
}

/**
 * The exclude matcher's overrun counter. It counts for the whole project
 * session, so a walk logs the difference across its own run.
 */
const matcherOverruns = (scope: WalkScope): number =>
  scope.filter?.excludeMatcher.budgetExceeded ?? 0

/**
 * Name searches in flight in the whole process, shared by every window and
 * terminal: at most two at once, one search per project, folder and name
 * (review of #320).
 */
const findByNameGate = createFindByNameGate()

export class FileService implements IFileService {
  private projectPath: string | null = null
  private session: Pick<ProjectSession, 'current'> | null = null
  private symlinkDetector = new SymlinkDetector()
  private rollbackHandler = new RollbackHandler()

  // Dynamic hidden patterns (configurable per-project via .erfana/settings.json)
  private hiddenPatterns: string[] = [...DEFAULT_TREE_HIDDEN_PATTERNS]

  // One-time flag for logging active hidden patterns per project
  private hasLoggedPatterns = false

  // The project's exclude/hidden/ignore filter (#211); null → no exclusion
  private pathFilter: ProjectPathFilter | null = null

  // Per-path single-flight for tree walks (#208). An entry exists exactly
  // while that path has a walk running (plus at most one queued).
  private readonly readRunners = new Map<string, CoalescingRunner<FileNode[]>>()
  // key → readId of the walk now running, for the "joined" log line
  private readonly activeReadIds = new Map<string, number>()
  private readSequence = 0

  /**
   * Set custom hidden patterns (called by ProjectService after loading settings)
   */
  setHiddenPatterns(patterns: string[]): void {
    this.hiddenPatterns = patterns
  }

  /**
   * Get current hidden patterns
   */
  getHiddenPatterns(): string[] {
    return [...this.hiddenPatterns]
  }

  /**
   * Set the project's path filter (#211; called by ProjectService on project
   * open, with the same instance the directory watcher gets). A tree walk
   * skips excluded entries without reading them, and every completed walk of
   * the project root stores its walk hints on this filter
   * (`filter.getWalkHints()`). It applies only while its root is the current
   * project path, and only to walks inside it. Snapshotted per walk.
   *
   * @param filter - the filter, or null for no exclusion
   */
  setPathFilter(filter: ProjectPathFilter | null): void {
    this.pathFilter = filter
  }

  setProjectPath(path: string): void {
    this.projectPath = path
    this.hasLoggedPatterns = false
  }

  /** The open-project session, read for the root's canonical form (see `isProjectRoot`) */
  bindSession(session: Pick<ProjectSession, 'current'>): void {
    this.session = session
  }

  getProjectPath(): string | null {
    return this.projectPath
  }

  /**
   * Read the full tree under `dirPath`, single-flight per path (#208).
   *
   * No two walks of the same path ever overlap. A call made while a walk of
   * that path runs never joins the running walk: every such call shares one
   * follow-up walk that starts after the running one settles, so it sees
   * every change made before its call. N overlapping callers cost at most one
   * extra walk. Different paths are not serialised against each other.
   *
   * @param dirPath - Directory to read; separators, a trailing separator and
   *   relative segments do not change which walk it joins, but case does
   * @param options - `shallow`: list `dirPath` only, every sub-folder lazy
   *   (`capped`, or `ignored`) – how the tree expands a lazy folder. A shallow
   *   and a full walk of one path are separate single-flight runs.
   * @returns The tree, directories first; rejects only if the root cannot be read
   */
  async readDirectory(dirPath: string, options: { shallow?: boolean } = {}): Promise<FileNode[]> {
    const shallow = options.shallow === true
    const pathKey = readDirectoryKey(dirPath)
    const key = shallow ? `${pathKey}\0shallow` : pathKey
    const pathDigest = stablePathDigest(pathKey)
    let runner = this.readRunners.get(key)
    if (runner) {
      logger.info('FileService: readDirectory joined follow-up read', {
        pathDigest,
        behindReadId: this.activeReadIds.get(key)
      })
    } else {
      const created = createCoalescingRunner<FileNode[]>({
        onIdle: () => {
          if (this.readRunners.get(key) === created) this.readRunners.delete(key)
          this.activeReadIds.delete(key)
        }
      })
      this.readRunners.set(key, created)
      runner = created
    }
    return runner.run((info) => this.performRead(dirPath, key, pathDigest, info, shallow))
  }

  /**
   * One actual walk: snapshot the hidden patterns and the path filter, walk,
   * record the walk hints, log the outcome. Every line carries `readId` and
   * `pathDigest` (never the readable path), so `main.log` can pair a walk's
   * lines and group them per project; the exclude fields are counts only.
   */
  private async performRead(
    dirPath: string,
    key: string,
    pathDigest: string,
    info: CoalescedRunInfo,
    shallow: boolean
  ): Promise<FileNode[]> {
    const readId = ++this.readSequence
    this.activeReadIds.set(key, readId)
    // Snapshot at walk start: a pattern or filter change mid-walk applies to the next walk.
    const hiddenPatterns = [...this.hiddenPatterns]
    const { scope, base } = this.planWalk(dirPath, hiddenPatterns, shallow)
    const budgetBefore = matcherOverruns(scope)
    const runContext = {
      readId,
      pathDigest,
      followUp: info.followUp,
      callers: info.callers,
      // Only on an expand read, so the full walk's lines are as before
      ...(shallow ? { shallow: true } : {})
    }
    logger.info('FileService: readDirectory started', runContext)

    const start = performance.now()
    const slowWarning = armSlowWalkWarning(readId, pathDigest, start)

    try {
      // The base folder is never left lazy, so a lazy kind never comes back here
      const walked = base === null ? [] : await this._readDirectoryInternal(base, scope)
      const result = typeof walked === 'string' ? [] : walked
      const walkHintCount = recordWalkHints(scope)
      const durationMs = Math.round(performance.now() - start)
      const counts = this.countNodes(result)

      logger.info('FileService: readDirectory completed', {
        durationMs,
        fileCount: counts.files,
        dirCount: counts.dirs,
        hiddenPatternCount: hiddenPatterns.length,
        maxDepth: counts.maxDepth,
        excludePatternCount: scope.filter?.excludeMatcher.size ?? 0,
        excludedEntryCount: scope.excludedEntryCount,
        walkHintCount,
        matcherBudgetExceeded: matcherOverruns(scope) - budgetBefore,
        folderReadCount: scope.folderReadCount,
        lazyFolderCount: scope.lazyFolderCount,
        entryCapReached: scope.entryCapReached,
        ...runContext
      })

      // Log hidden patterns once per project – the snapshot this walk used
      if (!this.hasLoggedPatterns) {
        this.hasLoggedPatterns = true
        logger.debug('FileService: hidden patterns active', { patterns: hiddenPatterns })
      }

      return result
    } catch (error) {
      logger.warn('FileService: readDirectory failed', {
        readId,
        pathDigest,
        durationMs: Math.round(performance.now() - start)
      })
      throw error
    } finally {
      clearTimeout(slowWarning)
    }
  }

  /**
   * The scope and base folder of one walk of `dirPath`. The path filter applies
   * only while its root is the current project path (not after a close or to a
   * stale filter) and only when `dirPath` is inside it; the walk's base is then
   * `dirPath`'s project-relative path, and hints are collected only when that
   * base is the root itself. A base that is itself excluded is not read at all.
   */
  private planWalk(dirPath: string, hiddenPatterns: readonly string[], shallow = false): WalkPlan {
    const filter = this.pathFilter
    const baseRel =
      filter !== null &&
      !!this.projectPath &&
      readDirectoryKey(filter.root) === readDirectoryKey(this.projectPath)
        ? toRootRelative(filter.root, dirPath)
        : null
    const scope: WalkScope = {
      hiddenPatterns,
      filter: baseRel === null ? null : filter,
      // A shallow walk sees one level: its hints would replace the full ones
      hints: baseRel === '' && !shallow ? new WalkHintCollector() : null,
      excludedEntryCount: 0,
      enteredLinkTargets: new Set<string>(),
      reads: createConcurrencyLimit(WALK_READ_CONCURRENCY),
      entryCount: 0,
      folderReadCount: 0,
      lazyFolderCount: 0,
      entryCapReached: false,
      shallow
    }
    if (baseRel !== null && baseRel !== '' && scope.filter?.isExcluded(baseRel)) {
      scope.excludedEntryCount = 1
      return { scope, base: null }
    }
    return { scope, base: { path: dirPath, depth: 0, rel: baseRel, dropped: false } }
  }

  /**
   * Count files, directories, and max depth in a tree
   */
  private countNodes(nodes: FileNode[]): { files: number; dirs: number; maxDepth: number } {
    let files = 0
    let dirs = 0
    let maxDepth = 0

    const walk = (items: FileNode[], depth: number): void => {
      for (const item of items) {
        if (item.type === 'file') files++
        else {
          dirs++
          if (item.children && item.children.length > 0) {
            if (depth + 1 > maxDepth) maxDepth = depth + 1
            walk(item.children, depth + 1)
          }
        }
      }
    }

    walk(nodes, 0)
    return { files, dirs, maxDepth }
  }

  /**
   * List one folder and build its rows. Its sub-folders are read in parallel,
   * each taking a slot of the walk's limiter for its own `readdir` only, so a
   * folder never holds a slot while it waits on its children. The base folder
   * is always read; any other folder is not – it comes back `capped` (lazy) –
   * in a shallow walk, or when its turn comes once the walk has listed
   * {@link MAX_WALK_ENTRIES} entries.
   */
  private async _readDirectoryInternal(dir: WalkDir, scope: WalkScope): Promise<FileNode[] | LazyKind> {
    if (dir.depth > 0 && scope.shallow) return 'capped'
    // Checked before queueing too, so a folder past the cap never waits for a
    // slot: the queue holds at most one entry per folder row listed
    if (dir.depth > 0 && scope.entryCount >= MAX_WALK_ENTRIES) {
      scope.entryCapReached = true
      return 'capped'
    }
    const entries = await scope.reads.run(async () => {
      if (dir.depth > 0 && scope.entryCount >= MAX_WALK_ENTRIES) return null
      scope.folderReadCount++
      return readdir(dir.readPath ?? dir.path, { withFileTypes: true })
    })
    if (entries === null) {
      scope.entryCapReached = true
      return 'capped'
    }

    const nodes = await Promise.all(entries.map((entry) => this.buildNode(entry, dir, scope)))
    // Sort: directories first, then files alphabetically
    return nodes.filter((node): node is FileNode => node !== null).sort(compareTreeNodes)
  }

  /** One entry's row, its children read when it is a folder; null when the entry is skipped. */
  private async buildNode(entry: Dirent, dir: WalkDir, scope: WalkScope): Promise<FileNode | null> {
    const rel = dir.rel === null ? null : joinRelative(dir.rel, entry.name)
    let isDirectory = entry.isDirectory()
    // Skip hidden (.erfana/settings.json) and excluded (files.exclude) entries
    if (isSkippedEntry(entry.name, rel, scope)) {
      if (isDirectory && rel !== null && !dir.dropped) scope.hints?.add(rel, dir.depth + 1)
      return null
    }
    // Counted before any await, so the cap sees every row listed so far
    scope.entryCount++

    const fullPath = join(dir.path, entry.name)
    // A junction or directory symlink reads as a link, not a folder: it is a
    // folder row only when its target is a folder inside the project
    let linkTarget: string | null = null
    if (!isDirectory && this.symlinkDetector.checkDirent(entry)) {
      // Its stat and realpath share the walk's slots with the folder reads
      linkTarget = await scope.reads.run(() => this.resolveFolderLink(fullPath))
      isDirectory = linkTarget !== null
    }
    const node: FileNode = {
      name: entry.name,
      path: fullPath,
      type: isDirectory ? 'directory' : 'file'
    }
    // Flag symlinks for UI indication/security awareness
    if (this.symlinkDetector.checkDirent(entry)) {
      node.isSymlink = true
    }

    if (node.type === 'file') {
      node.extension = extname(entry.name)
    }

    // Recursively read subdirectories; an ignored or capped one is left lazy
    if (node.type === 'directory') {
      const children =
        linkTarget === null
          ? await this.readChildDirectory(fullPath, rel, dir, scope)
          : await this.readLinkedDirectory(fullPath, linkTarget, rel, dir, scope)
      if (typeof children === 'string') {
        node.children = []
        node.lazy = children
        scope.lazyFolderCount++
      } else {
        node.children = children
      }
    }

    return node
  }

  /**
   * The real folder a link leads to, when it is a folder inside the open
   * project; null for everything else (a file link, a broken link, a link out
   * of the project, no project open), which stay file rows as before. The
   * walk therefore never follows a link out of the project.
   */
  private async resolveFolderLink(linkPath: string): Promise<string | null> {
    const snapshot = this.session?.current() ?? null
    if (!snapshot) return null
    try {
      if (!(await stat(linkPath)).isDirectory()) return null
      const target = normaliseResolved(await realpath(linkPath))
      return isInsideRoot(target, snapshot.realRoot, snapshot.caseSensitive) ? target : null
    } catch {
      return null
    }
  }

  /**
   * Whether the project-relative path of a link's real target passes through a
   * hidden name or an excluded entry, so a link cannot show what the tree hides.
   */
  private isHiddenOrExcludedTarget(target: string, realRoot: string, scope: WalkScope): boolean {
    let rel = ''
    for (const segment of targetSegments(target, realRoot)) {
      rel = joinRelative(rel, segment)
      if (scope.hiddenPatterns.includes(segment) || isAtomicTempName(segment)) return true
      if (scope.filter?.isEntryExcluded(rel)) return true
    }
    return false
  }

  /**
   * Read a folder reached through a link. It is entered unless that would loop
   * (the target is, or contains, the folder the link sits in, or was already
   * entered through another link) or the chain is too deep; then it is a folder
   * row with no children. A link that is, or leads to, an ignored folder is
   * left lazy (`ignored`) instead of entered, and so is one whose target this
   * walk already entered through another link (`linked`), or one past
   * {@link MAX_ENTERED_LINKS} (`capped`): the row can still be expanded.
   */
  private async readLinkedDirectory(
    fullPath: string,
    target: string,
    rel: string | null,
    parent: WalkDir,
    scope: WalkScope
  ): Promise<FileNode[] | LazyKind> {
    const snapshot = this.session?.current() ?? null
    const chain = parent.linkChain ?? []
    if (!snapshot || chain.length >= MAX_LINK_DEPTH || chain.includes(target)) return []
    // A link must not reach what the tree hides or excludes by another name
    if (this.isHiddenOrExcludedTarget(target, snapshot.realRoot, scope)) return []
    try {
      const parentPath = parent.readPath ?? parent.path
      const parentReal = normaliseResolved(await scope.reads.run(() => realpath(parentPath)))
      // The link's target contains the folder the link is in: entering it loops
      if (isInsideRoot(parentReal, target, snapshot.caseSensitive)) return []
    } catch {
      return []
    }
    // Each real folder once per walk, and a bounded number of links in all.
    // Tested and taken with no await in between: sibling folders are read in
    // parallel, and two links to one folder must not both pass the test.
    const key = snapshot.caseSensitive ? target : target.toLowerCase()
    // Not a loop: the folder is shown elsewhere (`linked`), or the bound was reached (`capped`)
    if (scope.enteredLinkTargets.has(key)) return 'linked'
    if (scope.enteredLinkTargets.size >= MAX_ENTERED_LINKS) return 'capped'
    const depth = parent.depth + 1
    const dropped = parent.dropped || isDroppedFolder(rel, scope)
    if (dropped && !parent.dropped && rel !== null) scope.hints?.add(rel, depth)
    const targetRel = targetSegments(target, snapshot.realRoot).join('/')
    if (isLazyFolder(rel, scope) || isLazyFolder(targetRel, scope)) return 'ignored'
    scope.enteredLinkTargets.add(key)
    try {
      return await this._readDirectoryInternal(
        { path: fullPath, readPath: target, depth, rel, dropped, linkChain: [...chain, target] },
        scope
      )
    } catch (error) {
      logger.warn('FileService: readDirectory error recovered', {
        path: redactPath(fullPath),
        error: redactQuotedPaths(error instanceof Error ? error.message : String(error))
      })
      return []
    }
  }

  /**
   * Read one sub-folder of a walk; an unreadable one becomes an empty folder.
   * A folder the watcher drops (hidden by the filter or ignored) is still shown,
   * and becomes a walk hint – unless an ancestor already is one. An ignored one
   * is not read (`ignored`: lazy); the row reads it when the user expands it.
   */
  private async readChildDirectory(
    fullPath: string,
    rel: string | null,
    parent: WalkDir,
    scope: WalkScope
  ): Promise<FileNode[] | LazyKind> {
    const depth = parent.depth + 1
    const dropped = parent.dropped || isDroppedFolder(rel, scope)
    if (dropped && !parent.dropped && rel !== null) scope.hints?.add(rel, depth)
    if (isLazyFolder(rel, scope)) return 'ignored'
    try {
      return await this._readDirectoryInternal(
        {
          path: fullPath,
          readPath: parent.readPath === undefined ? undefined : join(parent.readPath, basename(fullPath)),
          depth,
          rel,
          dropped,
          linkChain: parent.linkChain
        },
        scope
      )
    } catch (error) {
      logger.warn('FileService: readDirectory error recovered', {
        path: redactPath(fullPath),
        error: redactQuotedPaths(error instanceof Error ? error.message : String(error))
      })
      return []
    }
  }

  /**
   * Files named `name` (case-insensitive) below `dirPath`, bounded – the
   * terminal's fallback for a name the incomplete tree does not hold. Applies
   * the tree's rules – hidden names and, inside the project, its exclude list
   * and its ignored folders (left lazy by the walk, so not searched either);
   * never follows a link. Searches share the process-wide gate, and one asked
   * under a project that has since changed ends. See `file/findByName`.
   *
   * @param dirPath - A folder the caller has confined to the project; results are built from it
   * @param name - A plain file name
   * @param readPath - Where `dirPath` is read (its real path), when that differs
   * @param generation - The project session generation the request was checked
   *   under (the handler's snapshot); the session's current one when left out
   */
  async findByName(
    dirPath: string,
    name: string,
    readPath?: string,
    generation: number | null = this.session?.current()?.generation ?? null
  ): Promise<FindByNameResult> {
    const hiddenPatterns = [...this.hiddenPatterns]
    const { scope } = this.planWalk(dirPath, hiddenPatterns)
    const filter = scope.filter
    const baseRel = filter === null ? null : toRootRelative(filter.root, dirPath)
    const isCurrent = (): boolean => (this.session?.current()?.generation ?? null) === generation
    // The requested spelling too: the answer's paths are built from it
    const key = [generation, readDirectoryKey(readPath ?? dirPath), dirPath, name.toLowerCase()].join('\0')
    return findByNameGate.run(key, () =>
      startFindByName(dirPath, name, {
        baseRel,
        readBase: readPath,
        isCurrent,
        skip: (entryName, rel, isDirectory) =>
          hiddenPatterns.includes(entryName) ||
          isAtomicTempName(entryName) ||
          (rel !== null && filter !== null && (filter.isEntryExcluded(rel) || (isDirectory && filter.isIgnoredFolder(rel))))
      })
    )
  }

  async readFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf-8')
  }

  /**
   * Write a text file. A missing folder is an ENOENT; the explicit "Save to
   * restore it" recreates the folders first (see `file/restoreParentDirectory`).
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    await atomicWriteText(filePath, content)
  }

  async getFileStats(filePath: string) {
    return await stat(filePath)
  }

  isMarkdownFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ext === '.md' || ext === '.markdown'
  }

  /**
   * Check if a file is a supported image file by extension.
   *
   * @param filePath - File path to check
   * @returns True if the file has a supported image extension
   */
  isImageFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
  }

  /**
   * Read an image as a base64 data URL, or report it as unchanged.
   *
   * Used by ImageViewerPanel, which re-reads on every disk change (#70). Pass
   * the `version` from a previous call as `knownVersion` and an unchanged file
   * answers `{ status: 'unchanged' }` without the ~100-200 ms blocking encode
   * and the multi-MB IPC payload. Omit it to force a full read.
   *
   * @param filePath - Absolute path to the image file
   * @param knownVersion - Opaque version the caller already holds bytes for
   * @returns The bytes plus their version, or `unchanged` plus that same version
   * @throws Error if the file is missing, unsupported or over the 50 MB cap
   *
   * @see readImage in ./file/imageRead for why the stat precedes the read
   */
  async readImage(filePath: string, knownVersion?: string): Promise<ImageReadResponse> {
    return await readImage(filePath, knownVersion)
  }


  async createFile(dirPath: string, fileName: string): Promise<string> {
    // Strip path separators FIRST — prevents `../../etc/passwd` style traversal
    // before `join()`. Sibling methods `createFolder` and `rename` already do
    // this; `createFile` was missing the strip until the Phase 2 review.
    fileName = fileName.replace(/[/\\]/g, '')

    if (!fileName) {
      throw new Error('File name cannot be empty')
    }

    // `.` and `..` are folders, not names; checked before `.md` is appended
    if (fileName === '.' || fileName === '..') {
      throw new Error('Invalid name')
    }

    // Ensure .md extension
    if (!fileName.endsWith('.md') && !fileName.endsWith('.markdown')) {
      fileName = `${fileName}.md`
    }

    // #161: reject reserved Windows names (CON, PRN, COM1-9, LPT1-9) and
    // forbidden chars (`<>:"/\|?*` on Windows), trailing dots/spaces,
    // control chars, bidi overrides. POSIX rejects only the universal
    // portability-breaking classes (control chars, bidi, empty, too long).
    assertValidUserFilename(fileName)

    const filePath = childPath(dirPath, fileName)

    // Check if file already exists
    try {
      await stat(filePath)
      throw new Error(`File "${fileName}" already exists`)
    } catch (error) {
      // File doesn't exist - good, we can create it
      const code = (error as { code?: unknown }).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    // Create empty file
    await writeFile(filePath, '', 'utf-8')

    return filePath
  }

  async createFolder(dirPath: string, folderName: string): Promise<string> {
    // Sanitize folder name - remove path separators
    folderName = folderName.replace(/[/\\]/g, '')

    if (!folderName) {
      throw new Error('Folder name cannot be empty')
    }

    // #161: validate reserved names, forbidden chars, etc. (platform-aware).
    assertValidUserFilename(folderName)

    const folderPath = childPath(dirPath, folderName)

    // Check if folder already exists
    try {
      await stat(folderPath)
      throw new Error(`Folder "${folderName}" already exists`)
    } catch (error) {
      // Folder doesn't exist - good, we can create it
      const code = (error as { code?: unknown }).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    // Create folder
    await mkdir(folderPath)

    return folderPath
  }

  /**
   * Whether `candidate` is the open project's root folder. The one defence the
   * service keeps of its own: callers pass paths the IPC layer has already
   * checked against the project, but a handler that skipped that check must
   * still not be able to remove or move the root.
   */
  private isProjectRoot(candidate: string): boolean {
    if (!this.projectPath) return false
    const target = resolvePath(candidate)
    // The session holds the canonical root and the case rule, resolved once at open
    const snapshot = this.session?.current() ?? null
    if (snapshot) {
      return (
        isSamePath(target, snapshot.realRoot, snapshot.caseSensitive) ||
        isSamePath(target, resolvePath(snapshot.root), snapshot.caseSensitive)
      )
    }
    return isSamePath(target, resolvePath(this.projectPath), getPlatformConfig().caseSensitive)
  }

  async deleteFile(filePath: string): Promise<void> {
    // Verify it's a file, not a directory
    const stats = await stat(filePath)
    if (stats.isDirectory()) {
      throw new Error('Cannot delete a directory using deleteFile. Use deleteFolder instead.')
    }

    await rm(filePath)
  }

  async deleteFolder(folderPath: string): Promise<void> {
    // Verify it's a directory
    const stats = await stat(folderPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    // Prevent deleting project root
    if (this.isProjectRoot(folderPath)) {
      throw new Error('Cannot delete the project root directory')
    }

    // Delete folder recursively
    await rm(folderPath, { recursive: true, force: true })
  }

  async rename(oldPath: string, newName: string): Promise<string> {
    // Sanitize new name - remove path separators
    newName = newName.replace(/[/\\]/g, '')

    if (!newName) {
      throw new Error('Name cannot be empty')
    }

    // #161: validate reserved names, forbidden chars, etc. (platform-aware).
    assertValidUserFilename(newName)

    // Get the directory and construct new path
    const { dirname } = await import('path')
    const parentDir = dirname(oldPath)
    const newPath = childPath(parentDir, newName)

    // Check if already exists
    try {
      await stat(newPath)
      throw new Error(`"${newName}" already exists`)
    } catch (error) {
      // File/folder doesn't exist - good, we can rename
      const code = (error as { code?: unknown }).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    // Perform the rename
    const { rename } = await import('fs/promises')
    await rename(oldPath, newPath)

    return newPath
  }

  /**
   * Check if a name conflicts with existing items in target directory (case-insensitive)
   */
  async checkNameConflict(targetParentPath: string, itemName: string): Promise<boolean> {
    try {
      const entries = await readdir(targetParentPath)
      const lowerName = itemName.toLowerCase()
      return entries.some(entry => entry.toLowerCase() === lowerName)
    } catch {
      // If directory doesn't exist or can't be read, no conflict
      return false
    }
  }

  /**
   * Check if a path is a descendant of another path
   */
  private isDescendant(possibleDescendant: string, possibleAncestor: string): boolean {
    const rel = relative(possibleAncestor, possibleDescendant)
    return !rel.startsWith('..') && !join(possibleAncestor, rel).startsWith(possibleDescendant)
  }

  /**
   * Move a file or folder to a new parent directory
   * Uses fs.rename() for same-filesystem moves, falls back to copy+delete for cross-filesystem
   * @param replaceExisting - If true, delete existing item at target before moving
   */
  async moveItem(sourcePath: string, targetParentPath: string, newName?: string, replaceExisting?: boolean): Promise<{ path: string; isSymlink?: boolean }> {
    // Validate source exists and check if it's a symlink
    const sourceStats = await stat(sourcePath)
    const isSymlink = await this.symlinkDetector.checkPath(sourcePath)
    const sourceItemName = basename(sourcePath)
    if (newName) assertValidUserFilename(newName)
    const finalName = newName || sourceItemName

    // Validate target parent is a directory
    const targetStats = await stat(targetParentPath)
    if (!targetStats.isDirectory()) {
      throw new Error('Target must be a directory')
    }

    // Construct final target path
    const targetPath = childPath(targetParentPath, finalName)

    // Prevent moving to the same location
    if (sourcePath === targetPath) {
      throw new Error('Source and target paths are the same')
    }

    // Prevent moving project root
    if (this.isProjectRoot(sourcePath)) {
      throw new Error('Cannot move the project root directory')
    }

    // Prevent circular move (folder into its own descendant)
    if (sourceStats.isDirectory() && this.isDescendant(targetParentPath, sourcePath)) {
      throw new Error('Cannot move a folder into its own subfolder')
    }

    // Check if target already exists (case-insensitive for cross-platform compatibility)
    const conflictExists = await this.checkNameConflict(targetParentPath, finalName)
    if (conflictExists) {
      if (replaceExisting) {
        // Delete existing item before move
        const existingItemPath = childPath(targetParentPath, finalName)
        try {
          const existingStats = await stat(existingItemPath)

          if (existingStats.isDirectory()) {
            await rm(existingItemPath, { recursive: true, force: true })
          } else {
            await rm(existingItemPath)
          }

          logger.info('Replaced existing item', { path: existingItemPath })
        } catch (deleteError) {
          const message = deleteError instanceof Error ? deleteError.message : String(deleteError)
          throw new Error(`Failed to replace existing item: ${message}`)
        }
      } else {
        throw new Error(`An item named "${finalName}" already exists in the target location`)
      }
    }

    // Try fs.rename first (fast, atomic for same filesystem)
    try {
      await fsRename(sourcePath, targetPath)
      return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
    } catch (error) {
      const code = (error as { code?: string }).code

      // EXDEV error means cross-filesystem move, fallback to copy+delete with rollback
      if (code === 'EXDEV') {
        // Copy to target
        if (sourceStats.isDirectory()) {
          await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
        } else {
          await copyFile(sourcePath, targetPath)
        }

        // Delete original after successful copy
        try {
          await rm(sourcePath, { recursive: true, force: true })
        } catch (deleteError) {
          // Rollback: Delete the copied item if original deletion fails
          await this.rollbackHandler.rollbackCopyOnDeleteFailure(
            sourcePath,
            targetPath,
            deleteError
          )
        }

        return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
      }

      // Other errors, rethrow
      throw error
    }
  }

  /**
   * Copy a file or folder to a new location with automatic name conflict resolution
   */
  async copyItem(sourcePath: string, targetParentPath: string, newName?: string): Promise<{ path: string; isSymlink?: boolean }> {
    // Validate source exists and check if it's a symlink
    const sourceStats = await stat(sourcePath)
    const isSymlink = await this.symlinkDetector.checkPath(sourcePath)
    const sourceItemName = basename(sourcePath)
    if (newName) assertValidUserFilename(newName)
    const finalName = newName || sourceItemName

    // Validate target parent is a directory
    const targetStats = await stat(targetParentPath)
    if (!targetStats.isDirectory()) {
      throw new Error('Target must be a directory')
    }

    // Handle name conflicts by adding (1), (2), etc.
    let targetPath = childPath(targetParentPath, finalName)
    let copyNumber = 1

    while (await this.checkNameConflict(targetParentPath, basename(targetPath))) {
      // Extract name and extension
      const ext = extname(finalName)
      const nameWithoutExt = ext ? finalName.slice(0, -ext.length) : finalName

      // Generate new name with copy number
      targetPath = childPath(targetParentPath, `${nameWithoutExt} (${copyNumber})${ext}`)
      copyNumber++

      // Safety limit to prevent infinite loops
      if (copyNumber > MAX_COPY_ATTEMPTS) {
        throw new Error(`Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`)
      }
    }

    // Perform the copy
    if (sourceStats.isDirectory()) {
      await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
    } else {
      await copyFile(sourcePath, targetPath)
    }

    return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
  }
}

/**
 * Factory function to create FileService instance
 * Enables dependency injection and testing
 */
export function createFileService(): IFileService {
  return new FileService()
}

// Singleton instance for backward compatibility
// TODO: Remove after all consumers use dependency injection
export const fileService = createFileService()
