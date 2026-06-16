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
