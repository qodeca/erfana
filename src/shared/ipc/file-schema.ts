// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File IPC schemas – the shapes of a project-tree node and of a file's stats.
 *
 * These lived twice (`src/preload/index.ts` and `FileService.ts`) and the
 * renderer imported the preload copy. They live here so main, preload and
 * renderer share one definition without the renderer reaching into main.
 */
import { z } from 'zod'
import type { ProjectChanged, ProjectSessionInfo } from './schema'
import type { ImageReadResponse } from './file-image-schema'
import type {
  ConflictResolution,
  ExternalFileCopyResponse,
  ExternalFileMoveResponse,
  ExternalFileValidateResponse
} from './external-file-schema'

export const FileNodeSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  // Recursive through a getter (zod 4), so the inferred type stays exact.
  get children() {
    return z.array(FileNodeSchema).optional()
  },
  extension: z.string().optional(),
  isSymlink: z.boolean().optional()
})

export type FileNode = z.infer<typeof FileNodeSchema>

export const FileStatsSchema = z.object({
  size: z.number(),
  modified: z.date(),
  created: z.date()
})

export type FileStats = z.infer<typeof FileStatsSchema>

/**
 * Wire shapes of the `file:*` invoke channels, as positional tuples: the
 * renderer calls them with positional arguments, so the wire is unchanged.
 * Path arguments are only checked to be strings here; where a path may lead is
 * decided in the main process against the open project.
 */

/** Longest entry name accepted; matches the filename check in the main process. */
export const ENTRY_NAME_MAX_CHARS = 255

const pathArg = (message: string) => z.string({ error: message })

/**
 * A file or folder name (not a path). Rejected rather than stripped when it
 * holds a separator or NUL, so the name the user typed is the one that is used.
 */
const entryNameArg = (message: string) =>
  z
    .string({ error: message })
    .min(1, message)
    .max(ENTRY_NAME_MAX_CHARS, message)
    .refine((name) => !name.includes('/') && !name.includes('\\') && !name.includes('\0'), message)
    // `.` and `..` name a folder, not an entry inside one; names Win32 would trim to them
    // (`.. `, `...`) are refused in the main process, where the platform is known
    .refine((name) => name !== '.' && name !== '..', message)

export const PathArgsSchema = z.tuple([pathArg('Invalid file path')])
export const ReadDirectoryArgsSchema = z.tuple([pathArg('Invalid directory path')])
export const ReadImageArgsSchema = z.tuple([pathArg('Invalid file path'), z.string().optional()])
export const WriteFileArgsSchema = z.tuple([
  pathArg('Invalid file path'),
  z.string({ error: 'Invalid file content' }),
  z.strictObject({ createParentDirs: z.literal(true).optional() }).optional()
])
export const CreateEntryArgsSchema = z.tuple([
  pathArg('Invalid directory path'),
  entryNameArg('Invalid name')
])
export const RenameArgsSchema = z.tuple([pathArg('Invalid path'), entryNameArg('Invalid name')])
export const MoveItemArgsSchema = z.tuple([
  pathArg('Invalid source path'),
  pathArg('Invalid target path'),
  entryNameArg('Invalid new name').optional(),
  z.boolean({ error: 'Invalid replaceExisting flag' }).optional()
])
export const CopyItemArgsSchema = z.tuple([
  pathArg('Invalid source path'),
  pathArg('Invalid target path'),
  entryNameArg('Invalid new name').optional()
])
export const CheckConflictArgsSchema = z.tuple([
  pathArg('Invalid target path'),
  z.string({ error: 'Invalid item name' }).min(1, 'Invalid item name')
])
export const OpenProjectByPathArgsSchema = z.tuple([
  z
    .string({ error: 'Invalid project path: must be a non-empty string' })
    .trim()
    .min(1, 'Invalid project path: path is empty after trimming')
])
export const ValidatePathArgsSchema = z.tuple([
  z
    .string({ error: 'Invalid file path' })
    .min(1, 'Invalid file path')
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'Empty file path')),
  z.string().optional()
])

/** What `file:moveItem` and `file:copyItem` answer: where the item landed. */
export interface FileTransferResult {
  path: string
  isSymlink?: boolean
}

/** What `file:validatePath` answers. */
export interface ValidatePathResult {
  exists: boolean
  absolutePath?: string
  isFile?: boolean
  insideProject?: boolean
  error?: string
}

/**
 * Shared contract for the preload `file` bridge.
 *
 * Implemented by `window.api.file` (preload, `fileBridge.ts`) and consumed by
 * the renderer file gateway. One definition keeps the preload, its typing and
 * the renderer's view of it from drifting.
 */
export interface FileBridge {
  /** Native folder picker, then open. `null` when the user cancels. */
  openProject(): Promise<string | null>
  openProjectByPath(projectPath: string): Promise<string>
  getSession(): Promise<ProjectSessionInfo | null>
  readDirectory(dirPath: string): Promise<FileNode[]>
  readFile(filePath: string): Promise<string>
  /** `createParentDirs`: the explicit "Save to restore it" of a tab whose folder is gone */
  writeFile(
    filePath: string,
    content: string,
    options?: { createParentDirs?: true }
  ): Promise<boolean>
  getStats(filePath: string): Promise<FileStats>
  exists(filePath: string): Promise<boolean>
  getProjectPath(): Promise<string | null>
  createFile(dirPath: string, fileName: string): Promise<string>
  createFolder(dirPath: string, folderName: string): Promise<string>
  deleteFile(filePath: string): Promise<boolean>
  deleteFolder(folderPath: string): Promise<boolean>
  rename(oldPath: string, newName: string): Promise<string>
  revealInFileManager(filePath: string): Promise<string>
  moveItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string,
    replaceExisting?: boolean
  ): Promise<FileTransferResult>
  copyItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string
  ): Promise<FileTransferResult>
  checkConflict(targetParentPath: string, itemName: string): Promise<boolean>
  /** `projectRoot` is ignored: the main process uses the open project. */
  validatePath(filePath: string, projectRoot?: string): Promise<ValidatePathResult>
  /**
   * Read an image, or learn it has not changed since `knownVersion`
   * @see Issue #70 - preview tabs show stale content when the file changes
   */
  readImage(filePath: string, knownVersion?: string): Promise<ImageReadResponse>
  /** Validate an external file for drop into the project. `projectRoot` is ignored. */
  validateExternal(sourcePath: string, projectRoot: string): Promise<ExternalFileValidateResponse>
  /** Copy an external file into the project. `projectRoot` is ignored. */
  copyFromExternal(
    sourcePath: string,
    targetFolder: string,
    projectRoot: string,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileCopyResponse>
  /** Move an external file into the project. `projectRoot` is ignored. */
  moveFromExternal(
    sourcePath: string,
    targetFolder: string,
    projectRoot: string,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileMoveResponse>
  /** Native file picker for external files; `null` when cancelled. */
  selectExternalFiles(): Promise<{ paths: string[] } | null>
  /** Subscribe to project open/close; returns the unsubscribe function. */
  onProjectChanged(callback: (data: ProjectChanged) => void): () => void
  /** `expectedGeneration`: close only if the project session is still at it */
  closeProject(expectedGeneration?: number): Promise<boolean>
}
