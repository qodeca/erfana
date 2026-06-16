// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schema for ~/.erfana/settings.json validation
 *
 * @see GlobalSettingsService.ts - uses this for validation
 * @see Issue #50 - global settings service
 */
import { z } from 'zod'
import { TranscriptionSettingsSchema } from './transcription-schema'

/**
 * Logging level enum
 */
export const LoggingLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
export type LoggingLevel = z.infer<typeof LoggingLevelSchema>

/**
 * Logging configuration
 */
export const LoggingSettingsSchema = z.object({
  level: LoggingLevelSchema.default('info')
})
export type LoggingSettings = z.infer<typeof LoggingSettingsSchema>

/**
 * Editor configuration
 */
export const EditorSettingsSchema = z.object({
  /** Preserve single line breaks in preview (converts to <br> tags) */
  preserveLineBreaks: z.boolean().default(false)
})
export type EditorSettings = z.infer<typeof EditorSettingsSchema>

/**
 * Git status configuration
 * @see Issue #74 - real-time git status refresh
 */
export const GitStatusSettingsSchema = z.object({
  /** Enable polling for git status updates */
  pollingEnabled: z.boolean().default(true),
  /** Polling interval in milliseconds (3000-10000ms, default 5000ms) */
  pollingInterval: z.number().min(3000).max(10000).default(5000)
})
export type GitStatusSettings = z.infer<typeof GitStatusSettingsSchema>

/**
 * Root schema for ~/.erfana/settings.json
 */
export const GlobalSettingsSchema = z.object({
  /** JSON Schema reference (ignored, for IDE support) */
  $schema: z.string().optional(),
  /** Logging configuration */
  logging: LoggingSettingsSchema.default(() => ({ level: 'info' as const })),
  /** Editor configuration */
  editor: EditorSettingsSchema.default(() => ({ preserveLineBreaks: false })),
  /** Git status configuration */
  gitStatus: GitStatusSettingsSchema.default(() => ({ pollingEnabled: true, pollingInterval: 5000 })),
  /** Transcription configuration */
  transcription: TranscriptionSettingsSchema.default(() => ({
    backend: 'openai' as const,
    openaiApiKeyStored: false,
    whisperModel: 'base' as const
  }))
})
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>

/**
 * Get default global settings
 */
export function getDefaultGlobalSettings(): GlobalSettings {
  return GlobalSettingsSchema.parse({})
}

/**
 * Event payload for settings changes
 */
export interface GlobalSettingsChanged {
  settings: GlobalSettings
  changedKey: string
  previousValue?: unknown
}
