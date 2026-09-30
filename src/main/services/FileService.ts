// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readdir, readFile, writeFile, stat, rm, mkdir, rename as fsRename, cp, copyFile } from 'fs/promises'
import { join, extname, basename, relative, resolve as resolvePath } from 'path'
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
import { logger } from './LoggingService'
import { IMAGE_EXTENSIONS, readImage } from './file/imageRead'
import type { ImageReadResponse } from '../../shared/ipc/file-image-schema'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  isSymlink?: boolean
}

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
}

/** One folder of a walk. */
interface WalkDir {
  readonly path: string
  readonly depth: number
  /** Project-relative, `/`-separated; null when no filter applies. */
  readonly rel: string | null
  /** This folder or an ancestor is dropped by the filter: no hints below it. */
  readonly dropped: boolean
}

/** A walk's scope and its first folder – null when the base itself is excluded. */
interface WalkPlan {
  readonly scope: WalkScope
  readonly base: WalkDir | null
}

const joinRelative = (parentRel: string, name: string): string =>
  parentRel === '' ? name : `${parentRel}/${name}`

/**
 * Hidden by name (the walk's snapshot) or excluded by the project filter.
 * Tested before a node is built, so an excluded folder is never read. Only the
 * entry itself is tested against the exclude list: the walk never enters an
 * excluded folder, so no ancestor can be one.
 */
function isSkippedEntry(name: string, rel: string | null, scope: WalkScope): boolean {
  if (scope.hiddenPatterns.includes(name)) return true
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

export class FileService implements IFileService {
  private projectPath: string | null = null
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
  private readonly projectChangeListeners = new Set<
    (oldPath: string | null, newPath: string | null) => void
  >()

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
    const previousPath = this.projectPath
    this.projectPath = path
    this.hasLoggedPatterns = false

    if (previousPath === path) {
      return
    }
    // Notify on a REAL change only. Subscribers tear down per-project state
    // (the HTML preview destroys every live view), so re-setting the same path
    // must not churn them.
    for (const listener of [...this.projectChangeListeners]) {
      try {
        listener(previousPath, path)
      } catch (error) {
        logger.error(
          'FileService: project-change listener threw',
          error instanceof Error ? error : undefined
        )
      }
    }
  }

  /**
   * Subscribe to project-root changes.
   *
   * Added for the HTML preview's main-side teardown (sd-074b §4.9): the preview
   * handlers accepted a `subscribeProjectChanged` seam from the start, but no
   * producer existed, so the belt-and-braces teardown on project switch never
   * fired and relied entirely on the renderer sending `preview:close`.
   *
   * @param listener - Called with the previous and new project path.
   * @returns An unsubscribe function.
   */
  onProjectPathChanged(
    listener: (oldPath: string | null, newPath: string | null) => void
  ): () => void {
    this.projectChangeListeners.add(listener)
    return () => {
      this.projectChangeListeners.delete(listener)
    }
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
   * @returns The tree, directories first; rejects only if the root cannot be read
   */
  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const key = readDirectoryKey(dirPath)
    const pathDigest = stablePathDigest(key)
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
    return runner.run((info) => this.performRead(dirPath, key, pathDigest, info))
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
    info: CoalescedRunInfo
  ): Promise<FileNode[]> {
    const readId = ++this.readSequence
    this.activeReadIds.set(key, readId)
    // Snapshot at walk start: a pattern or filter change mid-walk applies to the next walk.
    const hiddenPatterns = [...this.hiddenPatterns]
    const { scope, base } = this.planWalk(dirPath, hiddenPatterns)
    const budgetBefore = matcherOverruns(scope)
    const runContext = { readId, pathDigest, followUp: info.followUp, callers: info.callers }
    logger.info('FileService: readDirectory started', runContext)

    const start = performance.now()
    const slowWarning = armSlowWalkWarning(readId, pathDigest, start)

    try {
      const result = base === null ? [] : await this._readDirectoryInternal(base, scope)
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
  private planWalk(dirPath: string, hiddenPatterns: readonly string[]): WalkPlan {
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
      hints: baseRel === '' ? new WalkHintCollector() : null,
      excludedEntryCount: 0
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

  private async _readDirectoryInternal(dir: WalkDir, scope: WalkScope): Promise<FileNode[]> {
    const entries = await readdir(dir.path, { withFileTypes: true })
    const nodes: FileNode[] = []

    for (const entry of entries) {
      const rel = dir.rel === null ? null : joinRelative(dir.rel, entry.name)
      const isDirectory = entry.isDirectory()
      // Skip hidden (.erfana/settings.json) and excluded (files.exclude) entries
      if (isSkippedEntry(entry.name, rel, scope)) {
        if (isDirectory && rel !== null && !dir.dropped) scope.hints?.add(rel, dir.depth + 1)
        continue
      }

      const fullPath = join(dir.path, entry.name)
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

      // Recursively read subdirectories for markdown files
      if (node.type === 'directory') {
        node.children = await this.readChildDirectory(fullPath, rel, dir, scope)
      }

      nodes.push(node)
    }

    // Sort: directories first, then files alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Read one sub-folder of a walk; an unreadable one becomes an empty folder.
   * A folder the watcher drops (hidden by the filter or ignored) is still shown
   * and read, but it becomes a walk hint – unless an ancestor already is one.
   */
  private async readChildDirectory(
    fullPath: string,
    rel: string | null,
    parent: WalkDir,
    scope: WalkScope
  ): Promise<FileNode[]> {
    const depth = parent.depth + 1
    const dropped = parent.dropped || isDroppedFolder(rel, scope)
    if (dropped && !parent.dropped && rel !== null) scope.hints?.add(rel, depth)
    try {
      return await this._readDirectoryInternal({ path: fullPath, depth, rel, dropped }, scope)
    } catch (error) {
      logger.warn('FileService: readDirectory error recovered', { path: fullPath, error: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  async readFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf-8')
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8')
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

    // Ensure .md extension
    if (!fileName.endsWith('.md') && !fileName.endsWith('.markdown')) {
      fileName = `${fileName}.md`
    }

    // #161: reject reserved Windows names (CON, PRN, COM1-9, LPT1-9) and
    // forbidden chars (`<>:"/\|?*` on Windows), trailing dots/spaces,
    // control chars, bidi overrides. POSIX rejects only the universal
    // portability-breaking classes (control chars, bidi, empty, too long).
    assertValidUserFilename(fileName)

    const filePath = join(dirPath, fileName)

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

    const folderPath = join(dirPath, folderName)

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

  async deleteFile(filePath: string): Promise<void> {
    // Verify it's a file, not a directory
    const stats = await stat(filePath)
    if (stats.isDirectory()) {
      throw new Error('Cannot delete a directory using deleteFile. Use deleteFolder instead.')
    }

    // Prevent deleting files outside project
    if (this.projectPath && !filePath.startsWith(this.projectPath)) {
      throw new Error('Cannot delete files outside the project directory')
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
    if (this.projectPath && folderPath === this.projectPath) {
      throw new Error('Cannot delete the project root directory')
    }

    // Prevent deleting folders outside project
    if (this.projectPath && !folderPath.startsWith(this.projectPath)) {
      throw new Error('Cannot delete folders outside the project directory')
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
    const newPath = join(parentDir, newName)

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

    // Prevent renaming files/folders outside project
    if (this.projectPath && !oldPath.startsWith(this.projectPath)) {
      throw new Error('Cannot rename items outside the project directory')
    }

    // Prevent renaming project root
    if (this.projectPath && oldPath === this.projectPath) {
      throw new Error('Cannot rename the project root directory')
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
    const finalName = newName || sourceItemName

    // Validate target parent is a directory
    const targetStats = await stat(targetParentPath)
    if (!targetStats.isDirectory()) {
      throw new Error('Target must be a directory')
    }

    // Construct final target path
    const targetPath = join(targetParentPath, finalName)

    // Prevent moving to the same location
    if (sourcePath === targetPath) {
      throw new Error('Source and target paths are the same')
    }

    // Prevent moving project root
    if (this.projectPath && sourcePath === this.projectPath) {
      throw new Error('Cannot move the project root directory')
    }

    // Prevent moving items outside project
    if (this.projectPath && !sourcePath.startsWith(this.projectPath)) {
      throw new Error('Cannot move items outside the project directory')
    }

    // Prevent moving items to outside project
    if (this.projectPath && !targetParentPath.startsWith(this.projectPath)) {
      throw new Error('Cannot move items to outside the project directory')
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
        const existingItemPath = join(targetParentPath, finalName)
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
    const finalName = newName || sourceItemName

    // Validate target parent is a directory
    const targetStats = await stat(targetParentPath)
    if (!targetStats.isDirectory()) {
      throw new Error('Target must be a directory')
    }

    // Prevent copying items outside project
    if (this.projectPath && !sourcePath.startsWith(this.projectPath)) {
      throw new Error('Cannot copy items outside the project directory')
    }

    // Prevent copying items to outside project
    if (this.projectPath && !targetParentPath.startsWith(this.projectPath)) {
      throw new Error('Cannot copy items to outside the project directory')
    }

    // Handle name conflicts by adding (1), (2), etc.
    let targetPath = join(targetParentPath, finalName)
    let copyNumber = 1

    while (await this.checkNameConflict(targetParentPath, basename(targetPath))) {
      // Extract name and extension
      const ext = extname(finalName)
      const nameWithoutExt = ext ? finalName.slice(0, -ext.length) : finalName

      // Generate new name with copy number
      targetPath = join(targetParentPath, `${nameWithoutExt} (${copyNumber})${ext}`)
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
