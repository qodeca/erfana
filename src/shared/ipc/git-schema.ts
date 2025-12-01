import { z } from 'zod'

// Git display status for UI
export const GitDisplayStatusSchema = z.enum([
  'modified',    // Orange, M badge
  'untracked',   // Green, U badge
  'deleted',     // Red, D badge
  'staged',      // Green, A badge
  'renamed',     // Purple, R badge (not used by isomorphic-git)
  'conflicted',  // Red, ! badge
  'unmodified',  // No indicator
])
export type GitDisplayStatus = z.infer<typeof GitDisplayStatusSchema>

// File status entry
export const GitFileEntrySchema = z.object({
  path: z.string(),
  status: GitDisplayStatusSchema,
  staged: z.boolean(),
})
export type GitFileEntry = z.infer<typeof GitFileEntrySchema>

// Status counts
export const GitStatusCountsSchema = z.object({
  modified: z.number(),
  untracked: z.number(),
  deleted: z.number(),
  staged: z.number(),
  conflicted: z.number(),
})
export type GitStatusCounts = z.infer<typeof GitStatusCountsSchema>

// Git status response from main process
export const GitStatusResponseSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().nullable(),
  isDetached: z.boolean(),
  files: z.array(GitFileEntrySchema),
  counts: GitStatusCountsSchema,
  truncated: z.boolean(),
  error: z.string().optional(),
})
export type GitStatusResponse = z.infer<typeof GitStatusResponseSchema>
