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
