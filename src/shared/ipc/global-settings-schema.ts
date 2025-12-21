/**
 * Zod schema for ~/.erfana/settings.json validation
 *
 * @see GlobalSettingsService.ts - uses this for validation
 * @see Issue #50 - global settings service
 */
import { z } from 'zod'

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
 * Root schema for ~/.erfana/settings.json
 */
export const GlobalSettingsSchema = z.object({
  /** JSON Schema reference (ignored, for IDE support) */
  $schema: z.string().optional(),
  /** Logging configuration */
  logging: LoggingSettingsSchema.default(() => ({ level: 'info' as const }))
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
