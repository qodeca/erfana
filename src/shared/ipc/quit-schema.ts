// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { z } from 'zod'

// Request from main to renderer to check if quit should proceed
export const QuitConfirmRequestSchema = z.object({
  reason: z.enum(['close', 'quit', 'shutdown']).optional()
})
export type QuitConfirmRequest = z.infer<typeof QuitConfirmRequestSchema>

// Response from renderer to main with quit decision
export const QuitConfirmResponseSchema = z.object({
  proceed: z.boolean()
})
export type QuitConfirmResponse = z.infer<typeof QuitConfirmResponseSchema>

/**
 * Shared contract for the preload `quit` bridge.
 *
 * Implemented by `window.api.quit` (preload, `quitBridge.ts`) and consumed by
 * the renderer quit gateway.
 */
export interface QuitBridge {
  /** Main asks whether to quit (window close or app quit); returns the unsubscribe function. */
  onQuitRequested(callback: (data: { reason?: string }) => void): () => void
  /** Fire-and-forget: `true` to quit, `false` to cancel. */
  sendQuitResponse(proceed: boolean): void
}
