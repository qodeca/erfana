// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schema for ~/.erfana/settings.json validation
 *
 * @see GlobalSettingsService.ts - uses this for validation
 * @see Issue #50 - global settings service
 */
import { z } from 'zod'
import { hasRefusedIdentityChar } from '../comments/identity'
import { TranscriptionSettingsSchema } from './transcription-schema'
import { FilesSettingsSchema } from './files-exclude-schema'
import type { IpcAck } from './schema'

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
  enabled: z.boolean().default(true),
  /**
   * HTML Preview comments (docs/designs/comments/html-preview-comments.md §3 "Feature
   * flag", §18). Absent means on – read it through
   * {@link isHtmlPreviewCommentsEnabled}. Lenient, like `files`: a malformed
   * block resolves to on instead of tripping the corruption reset that would
   * replace every other setting.
   */
  comments: z
    .object({ enabled: z.boolean().catch(true) })
    .catch(() => ({ enabled: true }))
    .optional()
})
export type HtmlPreviewSettings = z.infer<typeof HtmlPreviewSettingsSchema>

/**
 * Whether HTML Preview comments are on (`htmlPreview.comments.enabled`,
 * default on). Off restores today's preview exactly: raw serving, no comment
 * UI and the frozen session policy (design §3, §18).
 */
export function isHtmlPreviewCommentsEnabled(settings: Pick<GlobalSettings, 'htmlPreview'>): boolean {
  return settings.htmlPreview.comments?.enabled !== false
}

/**
 * Terminal screen-reader mode (lens review [23]).
 *
 * - `auto` – on while the OS reports a screen reader (macOS, Windows), else off
 * - `on` – always on, for a screen reader Electron cannot detect (Linux)
 * - `off` – always off, for a tool Chromium mistakes for a screen reader
 */
export const TerminalScreenReaderModeSchema = z.enum(['auto', 'on', 'off'])
export type TerminalScreenReaderMode = z.infer<typeof TerminalScreenReaderModeSchema>

/**
 * Terminal configuration. Lenient like `files`: a missing or malformed value
 * resolves to the default instead of tripping the corruption reset that would
 * replace every other setting.
 */
export const TerminalSettingsSchema = z
  .object({
    screenReaderMode: TerminalScreenReaderModeSchema.catch('auto')
  })
  .catch(() => ({ screenReaderMode: 'auto' as const }))
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>

/**
 * The reviewer's identity for HTML Preview comments (docs/designs/
 * html-preview-comments.md §7.9, decision 3): written into the HTML file next
 * to each comment. App-level only – never a project's `.erfana/`, so a cloned
 * repository cannot preset who you are (§9.1 S20). Main reads it at Save; the
 * renderer never sends an author (§7.5 step 2).
 *
 * Lenient like `terminal` when READ: a missing or malformed value resolves to
 * "not set" instead of tripping the corruption reset. A name or email over its
 * cap, one that is not a string, or one carrying a control or invisible
 * character (`REFUSED_IN_IDENTITY`, the writer's own rule) reads as unset.
 *
 * Strict when WRITTEN: a Settings write of `comments` must pass
 * {@link CommentIdentityWriteSchema} (`GLOBAL_SETTINGS_WRITE_SCHEMAS`), so a
 * refused value is an error the form can show, never a silent "unset".
 */
const AuthorNameSchema = z
  .string()
  .max(100, 'The name is longer than 100 characters.')
  .refine(name => !hasRefusedIdentityChar(name), 'The name contains a control or invisible character.')
const AuthorEmailSchema = z
  .string()
  .max(254, 'The email is longer than 254 characters.')
  .refine(email => !hasRefusedIdentityChar(email), 'The email contains a control or invisible character.')

export const CommentIdentitySettingsSchema = z
  .object({
    authorName: AuthorNameSchema.optional().catch(undefined),
    authorEmail: AuthorEmailSchema.optional().catch(undefined),
    /** The one-time privacy notice was shown (§3 "Privacy notice", §10.7). */
    identityNoticeSeen: z.boolean().catch(false)
  })
  .catch(() => ({ identityNoticeSeen: false }))
export type CommentIdentitySettings = z.infer<typeof CommentIdentitySettingsSchema>

/** What a Settings write of `comments` must be: the read schema's rules, as errors. */
export const CommentIdentityWriteSchema = z.object({
  authorName: AuthorNameSchema.optional(),
  authorEmail: AuthorEmailSchema.optional(),
  identityNoticeSeen: z.boolean()
})

/**
 * Settings whose WRITE is checked strictly before the lenient read schema
 * applies: a value these refuse is a validation error, not silently dropped.
 */
export const GLOBAL_SETTINGS_WRITE_SCHEMAS: Readonly<Partial<Record<string, z.ZodType>>> = {
  comments: CommentIdentityWriteSchema
}

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
  htmlPreview: HtmlPreviewSettingsSchema.default(() => ({ enabled: true })),
  /**
   * `files.exclude` (Issue #211, design D7). Lenient: a missing or malformed
   * section resolves to `{ exclude: [] }`, so it never triggers the corruption
   * reset that would replace every other setting.
   */
  files: FilesSettingsSchema,
  /** Terminal configuration (lens review [23]) */
  terminal: TerminalSettingsSchema,
  /** HTML Preview comments: the reviewer's identity (lenient, see the schema) */
  comments: CommentIdentitySettingsSchema
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

/**
 * Shared contract for the preload `globalSettings` bridge.
 *
 * Implemented by `window.api.globalSettings` (preload, `settingsBridge.ts`)
 * and consumed by the renderer settings gateway.
 */
export interface GlobalSettingsBridge {
  /** All global settings from ~/.erfana/settings.json */
  get(): Promise<{ success: boolean; settings?: GlobalSettings; error?: string }>
  /** Set one setting; sent as `{ key, value }`. */
  set(key: string, value: unknown): Promise<IpcAck>
  /** Reset every global setting to its default. */
  reset(): Promise<IpcAck>
  /** Subscribe to setting changes; returns the unsubscribe function. */
  onSettingsChanged(callback: (data: GlobalSettingsChanged) => void): () => void
}
