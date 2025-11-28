import { z } from 'zod'

/**
 * Zod schema for prompt template frontmatter validation
 * This ensures all templates have required metadata in correct format
 */
export const PromptFrontmatterSchema = z.object({
  /** The area where this prompt appears (e.g., markdown-preview, code-editor) */
  area: z.enum(['markdown-preview', 'code-editor', 'global', 'diagram-viewer']),

  /** Optional sub-area for more specific placement */
  subArea: z.enum(['context-menu', 'toolbar', 'command-palette', 'mermaid-error', 'mermaid-direction', 'chat']).optional(),

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

  /** Order for sorting in menus (lower numbers appear first) */
  order: z.number().int().min(0).optional().default(0),

  /** Whether this prompt is enabled (can be toggled off) */
  enabled: z.boolean().optional().default(true),

  /** Whether this prompt requires user input before rendering */
  requiresInput: z.boolean().optional().default(false),

  /** Label for the input field when requiresInput is true */
  inputLabel: z.string().optional(),

  /** Placeholder text for the input field */
  inputPlaceholder: z.string().optional()
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
