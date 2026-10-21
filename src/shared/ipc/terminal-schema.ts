// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal IPC schemas.
 *
 * Request shapes are checked in the main process before a handler acts. The
 * response and event shapes document the wire. `terminal:create` answers
 * `{ success: true, terminalId, shellKind }` or `{ success: false, error }`,
 * never null: the failure branch always carries the reason.
 */
import { z } from 'zod'

/** Largest single write to a terminal, in characters (1 Mi). */
export const TERMINAL_WRITE_MAX_CHARS = 1_048_576

/** Largest column or row count accepted. */
export const TERMINAL_MAX_DIM = 2000

/** Most live terminals one window may hold. */
export const TERMINAL_MAX_PER_WINDOW = 32

/** Longest `cwd` accepted; matches the path limit used by the file checks. */
const TERMINAL_CWD_MAX_CHARS = 32_767

/** `terminal-<counter>`; the counter is assigned by the main process. */
export const TerminalIdSchema = z.string().regex(/^terminal-\d{1,9}$/, 'Invalid terminal id')
export type TerminalId = z.infer<typeof TerminalIdSchema>

const dimension = z.number().int().min(1).max(TERMINAL_MAX_DIM)

/**
 * Strict: the shell and its environment are chosen by the main process, so a
 * request that names them is refused rather than ignored.
 */
export const TerminalCreateRequestSchema = z
  .object({
    cwd: z.string().min(1).max(TERMINAL_CWD_MAX_CHARS).optional(),
    cols: dimension,
    rows: dimension
  })
  .strict()
export type TerminalCreateRequest = z.infer<typeof TerminalCreateRequestSchema>

export const ShellKindSchema = z.enum(['posix', 'powershell', 'cmd'])

export const TerminalCreateResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    terminalId: TerminalIdSchema,
    shellKind: ShellKindSchema
  }),
  z.object({ success: z.literal(false), error: z.string() })
])
export type TerminalCreateResponse = z.infer<typeof TerminalCreateResponseSchema>

export const TerminalWriteRequestSchema = z.object({
  terminalId: TerminalIdSchema,
  data: z.string().max(TERMINAL_WRITE_MAX_CHARS)
})
export type TerminalWriteRequest = z.infer<typeof TerminalWriteRequestSchema>

export const TerminalResizeRequestSchema = z.object({
  terminalId: TerminalIdSchema,
  cols: dimension,
  rows: dimension
})
export type TerminalResizeRequest = z.infer<typeof TerminalResizeRequestSchema>

/** `{ terminalId }`, as `terminal:clearComplete` sends it. */
export const TerminalIdRequestSchema = z.object({ terminalId: TerminalIdSchema })
export type TerminalIdRequest = z.infer<typeof TerminalIdRequestSchema>

export const TerminalInfoResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    info: z.object({ id: z.string(), cwd: z.string(), title: z.string() })
  }),
  z.object({ success: z.literal(false), error: z.string() })
])
export type TerminalInfoResponse = z.infer<typeof TerminalInfoResponseSchema>

export const TerminalListResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    terminals: z.array(z.object({ id: z.string(), title: z.string() }))
  }),
  z.object({ success: z.literal(false), error: z.string() })
])
export type TerminalListResponse = z.infer<typeof TerminalListResponseSchema>

/**
 * `terminal:getActivity`: whether a program other than the shell is running.
 * `known: false` means the platform cannot tell (`busy` is then false).
 */
export const TerminalActivityResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), busy: z.boolean(), known: z.boolean() }),
  z.object({ success: z.literal(false), error: z.string() })
])
export type TerminalActivityResponse = z.infer<typeof TerminalActivityResponseSchema>

// Event payloads (main -> the owning window)
export const TerminalDataSchema = z.object({
  terminalId: z.string(),
  data: z.string()
})
export type TerminalData = z.infer<typeof TerminalDataSchema>

export const TerminalExitSchema = z.object({
  terminalId: z.string(),
  exitCode: z.number(),
  signal: z.number().optional()
})
export type TerminalExit = z.infer<typeof TerminalExitSchema>

export const TerminalErrorSchema = z.object({
  terminalId: z.string(),
  error: z.string()
})
export type TerminalError = z.infer<typeof TerminalErrorSchema>
