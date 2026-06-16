// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for project lock IPC events and payloads
 *
 * Defines lock file structure, acquisition results, and IPC payloads
 * for preventing duplicate project opens across Erfana instances.
 *
 * @see ProjectLockService.ts - main process lock management implementation
 * @see Spec #010 - Multi-instance support specification
 * @see Issue #27 - Multiple independent instances
 */
import { z } from 'zod'

/**
 * Lock file content schema
 *
 * Stored in ~/.erfana/locks/{hash}.lock as JSON
 *
 * Fields:
 * - instanceId: Unique UUID for the Erfana instance
 * - pid: Process ID of the lock holder
 * - timestamp: ISO 8601 timestamp when lock was acquired
 * - hostname: Machine hostname for network drive conflict detection
 * - path: Original project path (for debugging/display)
 * - focus_request: Set to true by another instance to request focus
 * - requester_pid: PID of the process requesting focus
 */
export const LockInfoSchema = z.object({
  instanceId: z.string().uuid(),
  pid: z.number().int().positive(),
  timestamp: z.string().datetime(),
  hostname: z.string(),
  path: z.string(),
  focus_request: z.boolean().optional().default(false),
  requester_pid: z.number().int().positive().optional(),
  lastHeartbeat: z.string().datetime().optional(),
  hmac: z.string().optional()
})
export type LockInfo = z.infer<typeof LockInfoSchema>

/**
 * Lock acquisition result - discriminated union
 *
 * - 'acquired': Lock successfully obtained
 * - 'already_locked': Another instance holds the lock
 * - 'error': Failed to acquire lock due to filesystem error
 */
export const LockResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('acquired'), lockPath: z.string() }),
  z.object({
    status: z.literal('already_locked'),
    holderPid: z.number(),
    holderHostname: z.string()
  }),
  z.object({ status: z.literal('error'), message: z.string() })
])
export type LockResult = z.infer<typeof LockResultSchema>

/**
 * Lock status check result - discriminated union
 *
 * - 'unlocked': No lock file exists or lock is stale
 * - 'locked_by_self': This instance holds the lock
 * - 'locked_by_other': Another instance holds the lock
 * - 'error': Failed to check lock status
 */
export const LockStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unlocked') }),
  z.object({ status: z.literal('locked_by_self'), lockPath: z.string() }),
  z.object({
    status: z.literal('locked_by_other'),
    holderPid: z.number(),
    holderHostname: z.string()
  }),
  z.object({ status: z.literal('error'), message: z.string() })
])
export type LockStatus = z.infer<typeof LockStatusSchema>

// ─────────────────────────────────────────────────────────────────────────────
// IPC Payloads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for 'lock:acquire' IPC request
 */
export const AcquireLockPayloadSchema = z.object({
  projectPath: z.string().min(1)
})
export type AcquireLockPayload = z.infer<typeof AcquireLockPayloadSchema>

/**
 * Payload for 'lock:release' IPC request
 */
export const ReleaseLockPayloadSchema = z.object({
  projectPath: z.string().min(1)
})
export type ReleaseLockPayload = z.infer<typeof ReleaseLockPayloadSchema>

/**
 * Payload for 'lock:check' IPC request
 */
export const CheckLockPayloadSchema = z.object({
  projectPath: z.string().min(1)
})
export type CheckLockPayload = z.infer<typeof CheckLockPayloadSchema>

/**
 * Focus request event sent to renderer when another instance
 * requests this instance to focus on a project
 *
 * Sent via IPC 'lock:focus-requested' channel
 */
export const FocusRequestedEventSchema = z.object({
  projectPath: z.string(),
  requesterPid: z.number()
})
export type FocusRequestedEvent = z.infer<typeof FocusRequestedEventSchema>
