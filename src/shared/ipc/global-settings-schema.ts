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
 *
 * Controls the real-time git status polling fallback. (The prior `@see Issue
 * #74` reference was incorrect — #74 is the HTML preview feature — so it has
 * been removed rather than pointing at the wrong tracker item.)
 */
export const GitStatusSettingsSchema = z.object({
  /** Enable polling for git status updates */
  pollingEnabled: z.boolean().default(true),
  /** Polling interval in milliseconds (3000-10000ms, default 5000ms) */
  pollingInterval: z.number().min(3000).max(10000).default(5000)
})
export type GitStatusSettings = z.infer<typeof GitStatusSettingsSchema>

/**
 * HTML preview configuration (Issue #74).
 *
 * A single global toggle: when `enabled` flips false the preview service
 * destroys every live view (AC21 global-off). Per-project host approvals live
 * separately in `.erfana/settings.json` (see `preview-settings-schema.ts`).
 */
export const HtmlPreviewSettingsSchema = z.object({
  /** Master switch for the HTML preview feature. */
  enabled: z.boolean().default(true)
})
export type HtmlPreviewSettings = z.infer<typeof HtmlPreviewSettingsSchema>

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
  /** HTML preview configuration (Issue #74) */
  htmlPreview: HtmlPreviewSettingsSchema.default(() => ({ enabled: true }))
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
