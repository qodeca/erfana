// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File IPC schemas – the shapes of a project-tree node and of a file's stats,
 * and the object payloads of the `file:*` invoke channels.
 *
 * These lived twice (`src/preload/index.ts` and `FileService.ts`) and the
 * renderer imported the preload copy. They live here so main, preload and
 * renderer share one definition without the renderer reaching into main.
 */
import { z } from 'zod'
import type { ProjectChanged, ProjectSessionInfo } from './schema'
import type { ImageReadRequest, ImageReadResponse } from './file-image-schema'
import type {
  ExternalFileCopyRequest,
  ExternalFileCopyResponse,
  ExternalFileMoveBatchRequest,
  ExternalFileMoveBatchResponse,
  ExternalFileMoveRequest,
  ExternalFileMoveResponse,
  ExternalFileValidateRequest,
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
  isSymlink: z.boolean().optional(),
  /**
   * A folder the walk did not read: an ignored one (`watcher.ignoreList`), or
   * one past the walk's entry cap. Its `children` is empty, not its contents –
   * the tree asks for them (`file:readDirectory` on this path) when the folder
   * is expanded. Absent on every folder that was read.
   */
  lazy: z.literal(true).optional()
})

export type FileNode = z.infer<typeof FileNodeSchema>

export const FileStatsSchema = z.object({
  size: z.number(),
  modified: z.date(),
  created: z.date()
})

export type FileStats = z.infer<typeof FileStatsSchema>

/**
 * Wire shapes of the `file:*` invoke channels. Each channel that takes
 * arguments takes ONE object, validated strictly in the main process: a key
 * that is not listed is refused, not ignored. Path values are only checked to be
 * strings here; where a path may lead is decided in the main process against the
 * open project.
 */

/** Longest entry name accepted; matches the filename check in the main process. */
export const ENTRY_NAME_MAX_CHARS = 255

const pathField = (message: string) => z.string({ error: message })

/**
 * A file or folder name (not a path). Rejected rather than stripped when it
 * holds a separator or NUL, so the name the user typed is the one that is used.
 */
const entryNameField = (message: string) =>
  z
    .string({ error: message })
    .min(1, message)
    .max(ENTRY_NAME_MAX_CHARS, message)
    .refine((name) => !name.includes('/') && !name.includes('\\') && !name.includes('\0'), message)
    // `.` and `..` name a folder, not an entry inside one; names Win32 would trim to them
    // (`.. `, `...`) are refused in the main process, where the platform is known
    .refine((name) => name !== '.' && name !== '..', message)

/** The one-element tuple a handler registers for a channel that takes a single object. */
export const payloadArgs = <T extends z.ZodType>(request: T) => z.tuple([request])

/** `file:readDirectory` */
export const ReadDirectoryRequestSchema = z.strictObject({
  dirPath: pathField('Invalid directory path')
})
export type ReadDirectoryRequest = z.infer<typeof ReadDirectoryRequestSchema>

/** `file:readFile`, `file:getStats`, `file:exists`, `file:deleteFile`, `file:deleteFolder`, `file:revealInFileManager` */
export const PathRequestSchema = z.strictObject({ filePath: pathField('Invalid file path') })
export type PathRequest = z.infer<typeof PathRequestSchema>

/**
 * `file:writeFile`. `createParentDirs` is the explicit "Save to restore it" of a
 * tab whose folder is gone; only a literal `true` turns it on. `generation` is
 * the project session generation the file was opened under: the write is
 * refused when the session has moved on.
 */
export const WriteFileRequestSchema = z.strictObject({
  filePath: pathField('Invalid file path'),
  content: z.string({ error: 'Invalid file content' }),
  createParentDirs: z.literal(true).optional(),
  generation: z.number().int().optional()
})
export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>

/** `file:createFile`, `file:createFolder` */
export const CreateEntryRequestSchema = z.strictObject({
  dirPath: pathField('Invalid directory path'),
  name: entryNameField('Invalid name')
})
export type CreateEntryRequest = z.infer<typeof CreateEntryRequestSchema>

/** `file:rename` */
export const RenameRequestSchema = z.strictObject({
  oldPath: pathField('Invalid path'),
  newName: entryNameField('Invalid name')
})
export type RenameRequest = z.infer<typeof RenameRequestSchema>

/** `file:moveItem` */
export const MoveItemRequestSchema = z.strictObject({
  sourcePath: pathField('Invalid source path'),
  targetParentPath: pathField('Invalid target path'),
  newName: entryNameField('Invalid new name').optional(),
  replaceExisting: z.boolean({ error: 'Invalid replaceExisting flag' }).optional()
})
export type MoveItemRequest = z.infer<typeof MoveItemRequestSchema>

/** `file:copyItem` */
export const CopyItemRequestSchema = z.strictObject({
  sourcePath: pathField('Invalid source path'),
  targetParentPath: pathField('Invalid target path'),
  newName: entryNameField('Invalid new name').optional()
})
export type CopyItemRequest = z.infer<typeof CopyItemRequestSchema>

/** `file:checkConflict` */
export const CheckConflictRequestSchema = z.strictObject({
  targetParentPath: pathField('Invalid target path'),
  itemName: z.string({ error: 'Invalid item name' }).min(1, 'Invalid item name')
})
export type CheckConflictRequest = z.infer<typeof CheckConflictRequestSchema>

/** `file:openProjectByPath` */
export const OpenProjectByPathRequestSchema = z.strictObject({
  projectPath: z
    .string({ error: 'Invalid project path: must be a non-empty string' })
    .trim()
    .min(1, 'Invalid project path: path is empty after trimming')
})
export type OpenProjectByPathRequest = z.infer<typeof OpenProjectByPathRequestSchema>

/** `file:validatePath` */
export const ValidatePathRequestSchema = z.strictObject({
  filePath: z
    .string({ error: 'Invalid file path' })
    .min(1, 'Invalid file path')
    .transform((value) => value.trim())
    .pipe(z.string().min(1, 'Empty file path'))
})
export type ValidatePathRequest = z.infer<typeof ValidatePathRequestSchema>

/**
 * `file:closeProject`. A renderer that closes because it saw the folder
 * disappear sends the generation it last saw; the whole payload may be left out.
 */
export const CloseProjectRequestSchema = z.strictObject({
  expectedGeneration: z.number().int().optional()
})
export type CloseProjectRequest = z.infer<typeof CloseProjectRequestSchema>

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
 * the renderer's view of it from drifting. Every method that takes arguments
 * takes one request object.
 */
export interface FileBridge {
  /** Native folder picker, then open. `null` when the user cancels. */
  openProject(): Promise<string | null>
  openProjectByPath(request: OpenProjectByPathRequest): Promise<string>
  getSession(): Promise<ProjectSessionInfo | null>
  readDirectory(request: ReadDirectoryRequest): Promise<FileNode[]>
  readFile(request: PathRequest): Promise<string>
  /**
   * `createParentDirs`: the explicit "Save to restore it" of a tab whose folder is gone.
   * `generation`: the project session generation the file was opened under; the write
   * is refused with `PROJECT_CHANGED` when the open project is a newer one.
   */
  writeFile(request: WriteFileRequest): Promise<boolean>
  getStats(request: PathRequest): Promise<FileStats>
  exists(request: PathRequest): Promise<boolean>
  getProjectPath(): Promise<string | null>
  createFile(request: CreateEntryRequest): Promise<string>
  createFolder(request: CreateEntryRequest): Promise<string>
  deleteFile(request: PathRequest): Promise<boolean>
  deleteFolder(request: PathRequest): Promise<boolean>
  rename(request: RenameRequest): Promise<string>
  revealInFileManager(request: PathRequest): Promise<string>
  moveItem(request: MoveItemRequest): Promise<FileTransferResult>
  copyItem(request: CopyItemRequest): Promise<FileTransferResult>
  checkConflict(request: CheckConflictRequest): Promise<boolean>
  validatePath(request: ValidatePathRequest): Promise<ValidatePathResult>
  /**
   * Read an image, or learn it has not changed since `knownVersion`
   * @see Issue #70 - preview tabs show stale content when the file changes
   */
  readImage(request: ImageReadRequest): Promise<ImageReadResponse>
  /** Validate an external file for drop into the project. */
  validateExternal(request: ExternalFileValidateRequest): Promise<ExternalFileValidateResponse>
  /** Copy an external file into the open project. */
  copyFromExternal(request: ExternalFileCopyRequest): Promise<ExternalFileCopyResponse>
  /** Move an external file into the open project (one confirmation box). */
  moveFromExternal(request: ExternalFileMoveRequest): Promise<ExternalFileMoveResponse>
  /**
   * Move several external files into the open project. One request, so one
   * confirmation box names them all (larger batches get one box per ten files).
   */
  moveBatchFromExternal(request: ExternalFileMoveBatchRequest): Promise<ExternalFileMoveBatchResponse>
  /** Native file picker for external files; `null` when cancelled. */
  selectExternalFiles(): Promise<{ paths: string[] } | null>
  /** Subscribe to project open/close; returns the unsubscribe function. */
  onProjectChanged(callback: (data: ProjectChanged) => void): () => void
  /** `expectedGeneration`: close only if the project session is still at it */
  closeProject(request?: CloseProjectRequest): Promise<boolean>
}
