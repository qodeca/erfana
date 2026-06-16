// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { z } from 'zod'

/**
 * Schema for dropdown option in prompt frontmatter
 */
const DropdownOptionSchema = z.object({
  /** Internal value used in template variables */
  value: z.string().min(1),
  /** Display label shown to user */
  label: z.string().min(1)
})

/**
 * Schema for dropdown configuration in prompt frontmatter
 */
const DropdownSchema = z.object({
  /** Label displayed above the dropdown */
  label: z.string().min(1),
  /** Array of options (at least one required) */
  options: z.array(DropdownOptionSchema).min(1),
  /** Default selected value (optional, defaults to first option) */
  defaultValue: z.string().optional()
})

/**
 * Zod schema for prompt template frontmatter validation
 * This ensures all templates have required metadata in correct format
 */
export const PromptFrontmatterSchema = z.object({
  /** The area where this prompt appears (e.g., markdown-preview, code-editor) */
  area: z.enum(['markdown-preview', 'code-editor', 'global', 'diagram-viewer']),

  /** Optional sub-area for more specific placement */
  subArea: z.enum(['context-menu', 'toolbar', 'command-palette', 'mermaid-error', 'mermaid-direction', 'chat']).optional(),

  /** Optional unique identifier. If not provided, ID is generated from name */
  id: z.string().min(1).optional(),

  /** Display name shown in the UI */
  name: z.string().min(1, 'Name is required'),

  /** Icon identifier (maps to Lucide icon component) */
  icon: z.string().min(1, 'Icon is required'),

  /** Which panel to send the rendered prompt to (Copilot removed; always terminal) */
  targetPanel: z.literal('terminal').optional(),

  /** Whether to send immediately without user review */
  sendDirectly: z.boolean().optional().default(false),

  /** Whether to automatically execute (send Enter) after pasting to terminal */
  autoExecute: z.boolean().optional().default(false),

  /** Order for sorting in menus (lower numbers appear first, supports decimals for insertion) */
  order: z.number().min(0).optional().default(0),

  /** Whether this prompt is enabled (can be toggled off) */
  enabled: z.boolean().optional().default(true),

  /** Whether this prompt requires user input before rendering */
  requiresInput: z.boolean().optional().default(false),

  /** Label for the input field when requiresInput is true */
  inputLabel: z.string().optional(),

  /** Placeholder text for the input field */
  inputPlaceholder: z.string().optional(),

  /** Dropdown configuration for selection-based prompts */
  dropdown: DropdownSchema.optional(),

  /** Whether textarea is optional (allows submission with empty text when dropdown is present) */
  textareaOptional: z.boolean().optional(),

  /**
   * Whether this prompt mutates the source document.
   * When true, a canonical "apply to document" footer is composed onto the
   * rendered prompt (see prompts/applyFooter.ts), instructing the CLI agent to
   * edit the file in place rather than print the result to the terminal.
   */
  mutatesDocument: z.boolean().optional().default(false)
})

/**
 * TypeScript type inferred from the Zod schema
 * Use this for type-safe access to frontmatter data
 */
export type PromptFrontmatter = z.infer<typeof PromptFrontmatterSchema>

/**
 * Validate and parse frontmatter data
 * @param data - Raw frontmatter object from YAML parsing
 * @returns Validated and typed frontmatter
 * @throws ZodError if validation fails
 */
export function validateFrontmatter(data: unknown): PromptFrontmatter {
  return PromptFrontmatterSchema.parse(data)
}

/**
 * Safe validation that returns success/error instead of throwing
 * @param data - Raw frontmatter object from YAML parsing
 * @returns Validation result with data or error
 */
export function safeParseFrontmatter(data: unknown) {
  return PromptFrontmatterSchema.safeParse(data)
}
