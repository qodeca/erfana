// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { z } from 'zod'

// Project change event payload
export const ProjectChangedSchema = z.object({
  oldPath: z.string().nullable(),
  newPath: z.string().nullable(),
  // The main-owned session's generation after this change; +1 per open or close
  generation: z.number().int().nonnegative(),
})
export type ProjectChanged = z.infer<typeof ProjectChangedSchema>

// `file:getSession` reply: what the renderer may know of the open project
export const ProjectSessionInfoSchema = z.object({
  root: z.string(),
  generation: z.number().int().nonnegative(),
})
export type ProjectSessionInfo = z.infer<typeof ProjectSessionInfoSchema>

// Terminal event payloads live in ./terminal-schema; re-exported for existing importers
export {
  TerminalDataSchema,
  TerminalExitSchema,
  TerminalErrorSchema,
  type TerminalData,
  type TerminalExit,
  type TerminalError
} from './terminal-schema'
