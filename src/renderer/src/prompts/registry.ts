import type { PromptConfig } from './types'
import { parseTemplates } from './parser'

// Import markdown templates as raw strings using Vite's ?raw suffix
// These are bundled at build time, no runtime file I/O required
import elaborateTemplate from './templates/elaborate.md?raw'
import rewriteTemplate from './templates/rewrite.md?raw'
import simplifyTemplate from './templates/simplify.md?raw'
import improveTemplate from './templates/improve.md?raw'
import mermaidBugReportTemplate from './templates/mermaid-bug-report.md?raw'

/**
 * Parse all template files with frontmatter
 * This dynamically builds the registry from template metadata
 */
const parsedTemplates = parseTemplates([
  { raw: elaborateTemplate, filename: 'elaborate.md' },
  { raw: rewriteTemplate, filename: 'rewrite.md' },
  { raw: simplifyTemplate, filename: 'simplify.md' },
  { raw: improveTemplate, filename: 'improve.md' },
  { raw: mermaidBugReportTemplate, filename: 'mermaid-bug-report.md' }
])

console.log('📝 Parsed templates:', parsedTemplates.length)
parsedTemplates.forEach((t) => {
  console.log(
    `  - ${t.id}: ${t.frontmatter.name} (area: ${t.frontmatter.area}, subArea: ${t.frontmatter.subArea})`
  )
})

/**
 * Registry of all available prompt templates
 * Built dynamically from parsed template frontmatter
 * Each prompt is identified by a unique ID (slugified from name)
 */
export const PROMPT_REGISTRY: Record<string, PromptConfig> = parsedTemplates.reduce(
  (acc, parsed) => {
    acc[parsed.id] = {
      id: parsed.id,
      label: parsed.frontmatter.name,
      icon: parsed.frontmatter.icon,
      targetPanel: parsed.frontmatter.targetPanel || 'claude',
      sendDirectly: parsed.frontmatter.sendDirectly || false,
      template: parsed.content, // Content without frontmatter
      // Add additional metadata from frontmatter
      area: parsed.frontmatter.area,
      subArea: parsed.frontmatter.subArea,
      order: parsed.frontmatter.order || 0,
      enabled: parsed.frontmatter.enabled !== false,
      description: parsed.frontmatter.description,
      shortcut: parsed.frontmatter.shortcut
    }
    return acc
  },
  {} as Record<string, PromptConfig>
)

/**
 * Get a specific prompt configuration by ID
 * @param id - The prompt ID
 * @returns The prompt configuration or null if not found
 */
export function getPrompt(id: string): PromptConfig | null {
  return PROMPT_REGISTRY[id] || null
}

/**
 * Get all available prompt configurations as an array
 * @returns Array of all prompt configurations
 */
export function getAllPrompts(): PromptConfig[] {
  return Object.values(PROMPT_REGISTRY)
}

/**
 * Get all prompt IDs
 * @returns Array of all prompt IDs
 */
export function getAllPromptIds(): string[] {
  return Object.keys(PROMPT_REGISTRY)
}

/**
 * Get prompts filtered by area, sorted by order
 * @param area - The area to filter by (e.g., 'markdown-preview', 'code-editor', 'global')
 * @param subArea - Optional sub-area to filter by (e.g., 'context-menu', 'toolbar')
 * @returns Array of prompt configurations matching the area and optionally sub-area, sorted by order
 */
export function getPromptsForArea(area: string, subArea?: string): PromptConfig[] {
  const allPrompts = Object.values(PROMPT_REGISTRY)
  console.log(`🔍 getPromptsForArea('${area}', '${subArea}')`)
  console.log(`  Total prompts in registry: ${allPrompts.length}`)

  const filtered = allPrompts.filter((prompt) => {
    const areaMatch = prompt.area === area
    const subAreaMatch = subArea ? prompt.subArea === subArea : true
    const enabledMatch = prompt.enabled !== false
    console.log(
      `  - ${prompt.id}: area=${prompt.area} (${areaMatch}), subArea=${prompt.subArea} (${subAreaMatch}), enabled=${prompt.enabled} (${enabledMatch})`
    )
    return areaMatch && subAreaMatch && enabledMatch
  })

  console.log(`  Filtered prompts: ${filtered.length}`)
  return filtered.sort((a, b) => (a.order || 0) - (b.order || 0))
}
