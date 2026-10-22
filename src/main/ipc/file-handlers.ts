// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { dialog, shell, type OpenDialogOptions } from 'electron'
import { lstat, stat, realpath } from 'fs/promises'
import path from 'path'
import { ProjectService, type OpenContext } from '../services/ProjectService'
import { fileService } from '../services/FileService'
import { fileWatcherService } from '../services/FileWatcherService'
import { directoryWatcherService } from '../services/DirectoryWatcherService'
import { settingsService } from '../services/SettingsService'
import { projectSettingsService } from '../services/ProjectSettingsService'
import { globalSettingsService } from '../services/GlobalSettingsService'
import { projectLockService } from '../services/ProjectLockService'
import type { ProjectSessionInfo } from '../../shared/ipc/schema'
import {
  CheckConflictRequestSchema,
  CloseProjectRequestSchema,
  CopyItemRequestSchema,
  CreateEntryRequestSchema,
  FindByNameRequestSchema,
  MoveItemRequestSchema,
  OpenProjectByPathRequestSchema,
  PathRequestSchema,
  ReadDirectoryRequestSchema,
  RenameRequestSchema,
  ValidatePathRequestSchema,
  WriteFileRequestSchema,
  payloadArgs,
  type FileStats,
  type FindByNameResponse
} from '../../shared/ipc/file-schema'
import {
  ImageReadRequestSchema,
  type ImageReadResponse
} from '../../shared/ipc/file-image-schema'
import { logger } from '../services/LoggingService'
import { withErrorCodeMarker } from '../../shared/errorCodeMarker'
import { fileExists } from '../utils/fileUtils'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { isInsideRoot } from '../utils/pathCompare'
import { isSystemPath } from '../utils/systemPathBlock'
import { restoreParentDirectory } from '../services/file/restoreParentDirectory'
import { registerConfinedHandle } from './confinement/registerConfinedHandle'
import { isTrustedSender } from './senderValidation'
import { registerHandle } from './registry'
import { rememberDialogResult, withLastDirectory } from '../utils/lastDialogDirectory'
import { FILE_CHANNELS } from '../../shared/ipc/file-channels'

// REFACTORING (todo017): Create ProjectService singleton for orchestration
// Thin adapter pattern: IPC handler depends on service, not orchestration logic
// Exported: the composition root reads the session from it (preview teardown, window close)
export const projectService = new ProjectService(
  fileService,
  fileWatcherService,
  directoryWatcherService,
  settingsService,
  projectSettingsService,
  projectLockService
)

// Issue #211 (design D7): the global `files.exclude` list is merged ahead of
// each project's list. Read lazily, so it reflects the settings loaded at app
// start, whenever a project is opened.
projectSettingsService.setGlobalExcludeProvider(
  () => globalSettingsService.getSetting('files').exclude
)

/**
 * The canonical form of `target` for a comparison: the real path of the nearest
 * folder that exists, plus the missing tail. Falls back to `target` itself when
 * nothing can be resolved. `/etc` and `/private/etc` therefore agree.
 */
async function canonicalForCheck(target: string): Promise<string> {
  const tail: string[] = []
  let probe = target
  for (;;) {
    try {
      const real = await realpath(probe)
      return tail.length > 0 ? path.join(real, ...tail) : real
    } catch (error) {
      const up = path.dirname(probe)
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT' || up === probe) return target
      tail.unshift(path.basename(probe))
      probe = up
    }
  }
}

/** What `file:validatePath` answers. */
interface ValidatePathResult {
  exists: boolean
  absolutePath?: string
  isFile?: boolean
  /** Whether the file lies inside the open project (symbolic links resolved) */
  insideProject?: boolean
  error?: string
}

/**
 * Common logic for opening a project by path
 * Used by both file:openProject (dialog) and file:openProjectByPath (direct)
 *
 * REFACTORING (todo017): Simplified to thin adapter delegating to ProjectService
 */
async function openProjectByPath(
  newProjectPath: string,
  ctx: OpenContext
): Promise<string> {
  const result = await projectService.switchProject(newProjectPath, ctx)

  if (!result.success) {
    // focused_existing is a success case - existing window was focused
    // Don't throw an error, just return the path silently
    if (result.error === 'focused_existing') {
      return result.path
    }
    const message = result.error || 'Unknown error'
    // The code rides on the message, so the renderer can word the refusal (see getUserFriendlyMessage)
    throw new Error(result.errorCode ? withErrorCodeMarker(message, result.errorCode) : message)
  }

  return result.path
}

export function registerFileHandlers(): void {
  const session = projectService.session

  // Open project folder via dialog
  registerHandle(FILE_CHANNELS.openProject, async (event) => {
    const result = await dialog.showOpenDialog(withLastDirectory<OpenDialogOptions>({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Project Folder',
      buttonLabel: 'Open Project'
    }))

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    rememberDialogResult(result.filePaths)
    const newProjectPath = result.filePaths[0]
    return await openProjectByPath(newProjectPath, { senderId: event.sender?.id ?? null, source: 'dialog' })
  })

  // Open project folder by path (for recent projects, etc.). The value must be
  // an absolute path; the project itself is validated by `ProjectService`.
  registerConfinedHandle(
    FILE_CHANNELS.openProjectByPath,
    {
      schema: payloadArgs(OpenProjectByPathRequestSchema),
      paths: { projectPath: { arg: 0, key: 'projectPath', mode: 'external', check: 'none' } },
      handler: async ({ event }, [{ projectPath }]) =>
        await openProjectByPath(projectPath, { senderId: event.sender?.id ?? null, source: 'recent' })
    },
    session
  )

  // The open project as the main process holds it; null when none is open
  registerHandle(FILE_CHANNELS.getSession, async (): Promise<ProjectSessionInfo | null> => {
    const snapshot = projectService.session.current()
    return snapshot ? { root: snapshot.root, generation: snapshot.generation } : null
  })

  // Every handler below states which arguments are paths and what each may be
  // (see ./confinement). The checks run in the main process, against the open
  // project, before the handler body: the renderer's word for where a path
  // leads is never taken. Handlers act on the checked canonical path (`real`)
  // and answer with paths built from the one the renderer sent (`requested`).

  // Read directory structure
  registerConfinedHandle(
    FILE_CHANNELS.readDirectory,
    {
      schema: payloadArgs(ReadDirectoryRequestSchema),
      paths: { dirPath: { arg: 0, key: 'dirPath', mode: 'project', mustExist: true } },
      staleCheck: 'after',
      handler: async ({ sender }, [request], { dirPath }) => {
        try {
          const start = performance.now()
          // The tree's node paths are built from the walk's base, so the walk takes
          // the path as sent; it was shown to resolve inside the project.
          // #210: a successful read of a paused root shows every change dropped
          // before it began, so the watcher need not catch up on those at resume.
          const commitRead = directoryWatcherService.beginTreeRead(dirPath.requested, sender.id)
          // Finding [29]: the tree on screen is what a rename-style save is judged against
          const knownRead = directoryWatcherService.beginKnownEntriesRead(dirPath.requested)
          let result: Awaited<ReturnType<typeof fileService.readDirectory>>
          try {
            result = await fileService.readDirectory(dirPath.requested, { shallow: request.shallow === true })
          } catch (error) {
            knownRead.cancel()
            throw error
          }
          commitRead()
          knownRead.commit(result)
          const durationMs = Math.round(performance.now() - start)
          logger.info('file:readDirectory IPC completed', {
            durationMs,
            dirPath: redactPath(dirPath.requested)
          })
          return result
        } catch (error) {
          logger.error('Error reading directory', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Find files by name below a project folder (finding [32], PR #320 review):
  // the terminal's fallback for a bare file name the incomplete tree does not
  // hold. Confined like a tree read; the search itself is bounded in results,
  // folders and time, and never follows a link (`file/findByName`).
  registerConfinedHandle(
    FILE_CHANNELS.findByName,
    {
      schema: payloadArgs(FindByNameRequestSchema),
      paths: { dirPath: { arg: 0, key: 'dirPath', mode: 'project', mustExist: true } },
      staleCheck: 'after',
      handler: async (_ctx, [{ name }], { dirPath }): Promise<FindByNameResponse> => {
        const start = performance.now()
        const result = await fileService.findByName(dirPath.requested, name)
        // Counts only: the name and the paths are the user's
        logger.info('file:findByName completed', {
          durationMs: Math.round(performance.now() - start),
          resultCount: result.paths.length,
          truncated: result.truncated
        })
        return { paths: result.paths, truncated: result.truncated }
      }
    },
    session
  )

  // Read file content.
  //
  // Confined to the open project, symlinks resolved: the file watcher re-reads
  // a watched path automatically now, so a one-shot user-initiated read became
  // a repeating one an outside party can clock (issue #70, security MEDIUM-2).
  registerConfinedHandle(
    FILE_CHANNELS.readFile,
    {
      schema: payloadArgs(PathRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', kind: 'file' } },
      handler: async (_ctx, _args, { filePath }) => {
        try {
          return await fileService.readFile(filePath.real)
        } catch (error) {
          logger.error('Error reading file', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Write file content
  //
  // `options.createParentDirs` is the explicit restore of a tab whose file was
  // deleted together with its folder; only a literal `true` turns it on. The
  // logged copy of the error drops the path (the renderer gets the original).
  // The root itself is never a file to write, and a link inside the project
  // that points outside is refused like a read through it is.
  registerConfinedHandle(
    FILE_CHANNELS.writeFile,
    {
      schema: payloadArgs(WriteFileRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', allowRoot: false, access: 'change' } },
      // The tab was opened under one project; a write after a switch must not land in the next one
      expectedGeneration: ([request]) => request.generation,
      handler: async (_ctx, [{ content, createParentDirs }], { filePath }) => {
        try {
          if (createParentDirs) {
            await restoreParentDirectory(filePath)
          }
          await fileService.writeFile(filePath.real, content)
          return true
        } catch (error) {
          logger.error('Error writing file', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Get file stats.
  //
  // Deliberately NOT confined to the project: the external-file import shortcut
  // stats the paths the user picked in the native dialog, which are outside the
  // project by definition (spec #012, ProjectTree.handleImportShortcut). What is
  // enforced is that a path that *looks* in-project may not resolve out of it
  // through a symlink, so the watcher's automatic re-stat of a watched file
  // cannot be pointed elsewhere (issue #70).
  registerConfinedHandle(
    FILE_CHANNELS.getStats,
    {
      schema: payloadArgs(PathRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'external', check: 'escape' } },
      handler: async (_ctx, _args, { filePath }): Promise<FileStats> => {
        try {
          const stats = await fileService.getFileStats(filePath.real)
          return {
            size: stats.size,
            modified: stats.mtime,
            created: stats.birthtime
          } satisfies FileStats
        } catch (error) {
          // ENOENT is an expected caller condition (e.g. a markdown link whose
          // target doesn't exist). Log at debug; surface real failures at error.
          // NOTE: this shared handler only debug-logs ENOENT — callers that treat a
          // missing file as a real problem must log their own severity at the call
          // site (e.g. ImageViewerPanel and ProjectTree warn; link checks use
          // file:exists instead).
          if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            logger.debug('file:getStats target not found', {
              filePath: redactPath(filePath.requested),
              code: 'ENOENT'
            })
          } else {
            logger.error('Error getting file stats', redactedLogError(error))
          }
          throw error
        }
      }
    },
    session
  )

  // Existence check that never throws (fs.access). Used by callers that only
  // need a boolean (e.g. markdown link resolution) — avoids the noise and
  // fragile error-string parsing of catching file:getStats' ENOENT. A value that
  // is not a usable absolute path is "does not exist".
  registerConfinedHandle(
    FILE_CHANNELS.exists,
    {
      schema: payloadArgs(PathRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'external', check: 'escape' } },
      onRefusal: () => false,
      handler: async (_ctx, _args, { filePath }): Promise<boolean> => fileExists(filePath.real)
    },
    session
  )

  // Get current project path
  registerHandle(FILE_CHANNELS.getProjectPath, async () => {
    return fileService.getProjectPath()
  })

  // Close current project. A renderer that closes because it saw the folder
  // disappear sends the generation it last saw; if a newer project was opened
  // since, that stale close does nothing.
  registerHandle(FILE_CHANNELS.closeProject, async (event, request?: unknown) => {
    const parsed = CloseProjectRequestSchema.optional().safeParse(request)
    if (!parsed.success) {
      throw new Error('Invalid close request')
    }
    const generation = parsed.data?.expectedGeneration
    await projectService.close({
      senderId: event.sender?.id ?? null,
      reason: generation === undefined ? 'user' : 'project-deleted',
      expectedGeneration: generation
    })
    return true
  })

  // #210: each mutation below reports what it changed via noteInternalChange
  // after success, so a paused directory watcher does not count its own events
  // as missed external changes.

  // Create new file
  registerConfinedHandle(
    FILE_CHANNELS.createFile,
    {
      schema: payloadArgs(CreateEntryRequestSchema),
      paths: { dirPath: { arg: 0, key: 'dirPath', mode: 'project', mustExist: true, kind: 'directory', access: 'change' } },
      handler: async (_ctx, [{ name: fileName }], { dirPath }) => {
        try {
          const created = await fileService.createFile(dirPath.real, fileName)
          const createdFilePath = path.join(dirPath.requested, path.basename(created))
          directoryWatcherService.noteInternalChange({ path: createdFilePath, kind: 'added', subtree: false })
          return createdFilePath
        } catch (error) {
          // Redact user-typed filename before logging (INVALID_FILENAME embeds it);
          // re-throw the ORIGINAL error so the renderer toast keeps the full name.
          logger.error('Error creating file', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Create new folder
  registerConfinedHandle(
    FILE_CHANNELS.createFolder,
    {
      schema: payloadArgs(CreateEntryRequestSchema),
      paths: { dirPath: { arg: 0, key: 'dirPath', mode: 'project', mustExist: true, kind: 'directory', access: 'change' } },
      handler: async (_ctx, [{ name: folderName }], { dirPath }) => {
        try {
          const created = await fileService.createFolder(dirPath.real, folderName)
          const createdFolderPath = path.join(dirPath.requested, path.basename(created))
          directoryWatcherService.noteInternalChange({ path: createdFolderPath, kind: 'added', subtree: false })
          return createdFolderPath
        } catch (error) {
          // Redact user-typed name before logging (INVALID_FILENAME embeds it);
          // re-throw the ORIGINAL error so the renderer toast keeps the full name.
          logger.error('Error creating folder', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Delete file. The entry itself is checked, not what it points at: a link
  // inside the project is removed as a link and nothing outside is touched.
  registerConfinedHandle(
    FILE_CHANNELS.deleteFile,
    {
      schema: payloadArgs(PathRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project-entry', access: 'change' } },
      handler: async (_ctx, _args, { filePath }) => {
        try {
          await fileService.deleteFile(filePath.real)
          directoryWatcherService.noteInternalChange({ path: filePath.requested, kind: 'removed', subtree: true })
          return true
        } catch (error) {
          logger.error('Error deleting file', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Delete folder
  registerConfinedHandle(
    FILE_CHANNELS.deleteFolder,
    {
      schema: payloadArgs(PathRequestSchema),
      paths: { folderPath: { arg: 0, key: 'filePath', mode: 'project-entry', access: 'change' } },
      handler: async (_ctx, _args, { folderPath }) => {
        try {
          await fileService.deleteFolder(folderPath.real)
          directoryWatcherService.noteInternalChange({ path: folderPath.requested, kind: 'removed', subtree: true })
          return true
        } catch (error) {
          logger.error('Error deleting folder', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Rename file or folder
  registerConfinedHandle(
    FILE_CHANNELS.rename,
    {
      schema: payloadArgs(RenameRequestSchema),
      paths: { oldPath: { arg: 0, key: 'oldPath', mode: 'project-entry', access: 'change' } },
      handler: async (_ctx, [{ newName }], { oldPath }) => {
        try {
          const renamed = await fileService.rename(oldPath.real, newName)
          const newPath = path.join(path.dirname(oldPath.requested), path.basename(renamed))
          directoryWatcherService.noteInternalChange(
            { path: oldPath.requested, kind: 'removed', subtree: true },
            { path: newPath, kind: 'added', subtree: true }
          )
          return newPath
        } catch (error) {
          // Redact user-typed name before logging (INVALID_FILENAME embeds it);
          // re-throw the ORIGINAL error so the renderer toast keeps the full name.
          logger.error('Error renaming', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Move file or folder
  registerConfinedHandle(
    FILE_CHANNELS.moveItem,
    {
      schema: payloadArgs(MoveItemRequestSchema),
      paths: {
        sourcePath: { arg: 0, key: 'sourcePath', mode: 'project-entry', access: 'change' },
        targetParentPath: {
          arg: 0,
          key: 'targetParentPath',
          mode: 'project',
          mustExist: true,
          kind: 'directory',
          access: 'change'
        }
      },
      handler: async (_ctx, [{ newName, replaceExisting }], { sourcePath, targetParentPath }) => {
        try {
          const moved = await fileService.moveItem(
            sourcePath.real,
            targetParentPath.real,
            newName,
            replaceExisting
          )
          const newPath = path.join(targetParentPath.requested, path.basename(moved.path))
          directoryWatcherService.noteInternalChange(
            { path: sourcePath.requested, kind: 'removed', subtree: true },
            { path: newPath, kind: 'added', subtree: true },
            // The replaced item at the destination was removed first
            ...(replaceExisting ? [{ path: newPath, kind: 'removed' as const, subtree: true }] : [])
          )
          return { ...moved, path: newPath }
        } catch (error) {
          logger.error('Error moving item', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Copy file or folder
  registerConfinedHandle(
    FILE_CHANNELS.copyItem,
    {
      schema: payloadArgs(CopyItemRequestSchema),
      paths: {
        // What the copy reads must lie inside the project (links followed) ...
        sourcePath: { arg: 0, key: 'sourcePath', mode: 'project' },
        // ... but a link is copied as a link, so the copy starts from the entry itself
        sourceEntry: { arg: 0, key: 'sourcePath', mode: 'project-entry' },
        targetParentPath: {
          arg: 0,
          key: 'targetParentPath',
          mode: 'project',
          mustExist: true,
          kind: 'directory',
          access: 'change'
        }
      },
      handler: async (_ctx, [{ newName }], { sourcePath, sourceEntry, targetParentPath }) => {
        try {
          // A folder link is copied as a link; a file link is copied as the content the
          // check resolved, so the target is not read again through the link
          const linkToFolder = await (async (): Promise<boolean> => {
            try {
              return (
                (await lstat(sourceEntry.real)).isSymbolicLink() &&
                (await stat(sourcePath.real)).isDirectory()
              )
            } catch {
              // Missing or unreadable: the copy itself reports it
              return false
            }
          })()
          const copied = await fileService.copyItem(
            linkToFolder ? sourceEntry.real : sourcePath.real,
            targetParentPath.real,
            newName ?? path.basename(sourceEntry.requested)
          )
          const newPath = path.join(targetParentPath.requested, path.basename(copied.path))
          directoryWatcherService.noteInternalChange({ path: newPath, kind: 'added', subtree: true })
          return { ...copied, path: newPath }
        } catch (error) {
          logger.error('Error copying item', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Check name conflict. A folder that is not there has no conflict.
  registerConfinedHandle(
    FILE_CHANNELS.checkConflict,
    {
      schema: payloadArgs(CheckConflictRequestSchema),
      paths: { targetParentPath: { arg: 0, key: 'targetParentPath', mode: 'project' } },
      handler: async (_ctx, [{ itemName }], { targetParentPath }) => {
        try {
          return await fileService.checkNameConflict(targetParentPath.real, itemName)
        } catch (error) {
          logger.error('Error checking conflict', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Read an image, or answer "unchanged" when the caller already holds the
  // current bytes (issue #70). This is the only base64 read channel - the
  // unconditional file:readAsBase64 it replaced is gone.
  //
  // The path is resolved against the open project, symlinks included, so an
  // in-project link to an out-of-project file is refused (the image viewer
  // re-reads on every disk change, which made that a repeating read, issue
  // #70). The check runs before the stat, so an out-of-project path is refused
  // without this handler disclosing anything about it.
  //
  // The skip exists because the image viewer re-reads on every disk change and
  // the base64 encode blocks the main-process event loop; see
  // src/main/services/file/imageRead.ts for why the version is safe to trust.
  registerConfinedHandle(
    FILE_CHANNELS.readImage,
    {
      schema: payloadArgs(ImageReadRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project' } },
      handler: async (_ctx, [{ knownVersion }], { filePath }): Promise<ImageReadResponse> => {
        try {
          const parsed = ImageReadRequestSchema.safeParse({ filePath: filePath.real, knownVersion })
          if (!parsed.success) {
            throw new Error(parsed.error.issues.map((issue) => issue.message).join(', '))
          }

          const result = await fileService.readImage(parsed.data.filePath, parsed.data.knownVersion)
          if (result.status === 'unchanged') {
            // No path in the log line: the version carries no user content, and
            // this is the hot path of an agent rewriting an asset in a loop.
            logger.debug('file:readImage unchanged, skipped re-encode', { version: result.version })
          }
          return result
        } catch (error) {
          logger.error('Error reading image', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )

  // Reveal a file or folder in the native OS file manager (Finder / Explorer).
  //
  // Display-only and non-throwing by design: the outcome is surfaced as an
  // advisory toast, so this returns '' on success or a human-readable error
  // string — it does NOT throw like the mutating file:* handlers. An untrusted
  // sender is a silent no-op returning '' (the safe outcome for a reveal).
  // `shell.showItemInFolder` reveals the item in its containing folder, so a
  // folder/root node is highlighted in its parent rather than opened.
  //
  // The path is confined to the open project with symlinks resolved, so an
  // in-project link cannot point the reveal at an out-of-project target; the
  // check also subsumes the existence check.
  registerConfinedHandle(
    FILE_CHANNELS.revealInFileManager,
    {
      schema: payloadArgs(PathRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', mustExist: true } },
      senderGate: {
        allow: (event) => {
          const trusted = isTrustedSender(event)
          if (!trusted) {
            logger.warn('Rejected file:revealInFileManager from untrusted sender', {
              url: event.senderFrame?.url
            })
          }
          return trusted
        },
        denied: () => ''
      },
      onRefusal: (error): string => {
        switch (error.code) {
          case 'INVALID_PATH':
            return 'Invalid path'
          case 'NO_PROJECT':
            return 'No project is open'
          case 'OUTSIDE_PROJECT':
            return 'Cannot reveal items outside the project'
          case 'NOT_FOUND':
            return 'Item no longer exists on disk'
          default:
            return 'Cannot reveal this item'
        }
      },
      handler: async (_ctx, _args, { filePath }): Promise<string> => {
        shell.showItemInFolder(filePath.real)
        return ''
      }
    },
    session
  )

  // Validate file path exists and return info
  // Note: validates absolute paths from terminal output, inside the project or not.
  // The request carries no project root; the answer says whether the file lies
  // inside the project the main process has open (`insideProject`).
  // This is acceptable because:
  // 1. Terminal output comes from user-initiated commands (not external input)
  // 2. The user can already see and access any file path shown in their terminal
  // 3. This handler only checks existence, it doesn't read or modify files
  registerConfinedHandle(
    FILE_CHANNELS.validatePath,
    {
      schema: payloadArgs(ValidatePathRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'external', check: 'none' } },
      onRefusal: (error): ValidatePathResult => ({ exists: false, error: error.message }),
      handler: async ({ session: snapshot }, [{ filePath: trimmedPath }], { filePath }): Promise<ValidatePathResult> => {
        try {
          // One string for the system-folder check and the stat: the canonical path
          const resolvedPath = filePath.requested
          const canonicalPath = await canonicalForCheck(resolvedPath)

          // Security check: block system-critical paths even without projectRoot
          // Defense-in-depth: prevent validation of sensitive system directories
          const isBlockedPath = isSystemPath([resolvedPath, canonicalPath], process.platform, process.env)
          if (isBlockedPath) {
            return { exists: false, error: 'Access to system paths not allowed' }
          }

          // Check if file exists and is a file (not directory)
          const stats = await stat(canonicalPath)
          if (!stats.isFile()) {
            return { exists: false, error: 'Path is not a file' }
          }

          return {
            exists: true,
            absolutePath: trimmedPath,
            isFile: true,
            insideProject:
              snapshot !== null &&
              isInsideRoot(canonicalPath, snapshot.realRoot, snapshot.caseSensitive)
          }
        } catch (error) {
          // ENOENT means file doesn't exist - this is expected, not an error
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { exists: false }
          }
          // Other errors (permissions, etc.)
          return {
            exists: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }
    },
    session
  )
}
