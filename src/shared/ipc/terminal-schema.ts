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

/**
 * How much parsed output the renderer collects before it acknowledges it
 * (32 KiB). Kept below the main process's low watermark, so output that was
 * parsed but not yet reported can never keep a PTY paused.
 */
export const TERMINAL_OUTPUT_ACK_STEP_CHARS = 32 * 1024

/** Largest single acknowledgement accepted (16 Mi characters). */
export const TERMINAL_OUTPUT_ACK_MAX_CHARS = 16 * 1024 * 1024

/**
 * `terminal:ackOutput`: the renderer has parsed `bytes` more characters of the
 * terminal's output (counted as `string.length`, like the main process counts
 * what it sent). Strict, and ignored unless it comes from the owning window.
 */
export const TerminalOutputAckRequestSchema = z
  .object({
    terminalId: TerminalIdSchema,
    bytes: z.number().int().min(1).max(TERMINAL_OUTPUT_ACK_MAX_CHARS)
  })
  .strict()
export type TerminalOutputAckRequest = z.infer<typeof TerminalOutputAckRequestSchema>

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

/** `{ success, error? }`, what `terminal:write` and `terminal:kill` answer. */
export interface TerminalAckResponse {
  success: boolean
  error?: string
}

/** `terminal:isAvailable`: whether node-pty loaded, and a terminal's init state. */
export interface TerminalAvailabilityResponse {
  success: boolean
  available: boolean
  initialized?: boolean
  error?: string
}

/**
 * Shared contract for the preload `terminal` bridge.
 *
 * Implemented by `window.api.terminal` (preload, `terminalBridge.ts`, typed as
 * this contract) and consumed by the renderer terminal gateway. The event
 * subscriptions return their unsubscribe function.
 */
export interface TerminalBridge {
  isAvailable(terminalId?: string): Promise<TerminalAvailabilityResponse>
  /** The response carries `shellKind`, so pasted paths can be quoted for the right shell. */
  create(config: TerminalCreateRequest): Promise<TerminalCreateResponse>
  write(terminalId: string, data: string): Promise<TerminalAckResponse>
  /** Fire-and-forget. */
  resize(terminalId: string, cols: number, rows: number): void
  kill(terminalId: string): Promise<TerminalAckResponse>
  getInfo(terminalId: string): Promise<TerminalInfoResponse>
  list(): Promise<TerminalListResponse>
  /** Whether a program other than the shell is running in the terminal. */
  getActivity(terminalId: string): Promise<TerminalActivityResponse>
  onData(callback: (data: TerminalData) => void): () => void
  onExit(callback: (data: TerminalExit) => void): () => void
  onError(callback: (data: TerminalError) => void): () => void
  /** The clear handshake runs outside the normal data filter. */
  onClear(callback: (data: TerminalIdRequest) => void): () => void
  /** Confirm that a clear was processed. */
  markClearComplete(terminalId: string): void
  /** Fire-and-forget: report that xterm has parsed `bytes` more characters of output. */
  ackOutput(terminalId: string, bytes: number): void
}
