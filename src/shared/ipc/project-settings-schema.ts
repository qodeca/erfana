// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schema for .erfana/settings.json validation
 *
 * @see ProjectSettingsService.ts - uses this for validation
 * @see Issue #63 - project-level settings
 */
import { z } from 'zod'

/**
 * Pattern configuration for watcher ignore or tree hidden settings
 */
export const PatternConfigSchema = z.object({
  /**
   * Mode determines how patterns interact with defaults:
   * - 'extend': Merge with default patterns (additive)
   * - 'replace': Override default patterns completely
   */
  mode: z.enum(['extend', 'replace']).default('extend'),
  /**
   * Patterns to match - simple string matching (directory names).
   * Examples: "vendor", ".cache", "tmp", ".git", "node_modules"
   */
  patterns: z.array(z.string()).default([])
})
export type PatternConfig = z.infer<typeof PatternConfigSchema>

/**
 * Watcher configuration - controls which directories chokidar ignores
 */
export const WatcherSettingsSchema = z.object({
  ignoreList: PatternConfigSchema.optional()
}).optional()
export type WatcherSettings = z.infer<typeof WatcherSettingsSchema>

/**
 * Tree configuration - controls which items are hidden in project tree UI
 */
export const TreeSettingsSchema = z.object({
  hiddenPatterns: PatternConfigSchema.optional()
}).optional()
export type TreeSettings = z.infer<typeof TreeSettingsSchema>

/**
 * Root schema for .erfana/settings.json
 */
export const ProjectSettingsSchema = z.object({
  /** JSON Schema reference (ignored, for IDE support) */
  $schema: z.string().optional(),
  /** File watcher configuration */
  watcher: WatcherSettingsSchema,
  /** Project tree UI configuration */
  tree: TreeSettingsSchema
})
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>

/**
 * Parsed and resolved settings (after mode-based merging)
 */
export interface ResolvedProjectSettings {
  watcherIgnorePatterns: string[]
  treeHiddenPatterns: string[]
}
