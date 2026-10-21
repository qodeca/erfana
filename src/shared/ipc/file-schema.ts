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
