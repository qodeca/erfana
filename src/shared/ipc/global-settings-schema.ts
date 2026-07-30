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
 * Graph engine configuration (global, user-level)
 *
 * Only the FR-042 MCP rate limit lives here — the per-project exclude list is
 * project settings, not global. Every field is `.optional()`, and the section
 * itself is attached with `.optional()` rather than `.default()` unlike every
 * other section above, so parsing an existing `~/.erfana/settings.json` does
 * not materialise a `graph` key and nothing new is written back.
 *
 * @see Issue #21 - graph R1 architecture (schema); #30 consumes it
 * @see specs/designs/sd-021-cross-cutting.md §9.1 row 6a
 */
export const GraphGlobalSettingsSchema = z.object({
  /** Advisory MCP requests-per-minute ceiling; defaults to `MCP.RATE_LIMIT_PER_MINUTE`. */
  mcpRateLimitPerMinute: z.number().int().min(1).max(10_000).optional()
})
export type GraphGlobalSettings = z.infer<typeof GraphGlobalSettingsSchema>

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
  })),
  /** Graph engine configuration — optional, so it is never written by default */
  graph: GraphGlobalSettingsSchema.optional()
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
