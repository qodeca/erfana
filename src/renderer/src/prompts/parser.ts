// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import yaml from 'js-yaml'
import { safeParseFrontmatter, type PromptFrontmatter } from './schema'
import { logger } from '../utils/logger'

/**
 * Parsed template with validated frontmatter and content
 */
export interface ParsedTemplate {
  /** Unique identifier (slugified from name) */
  id: string

  /** Validated frontmatter metadata */
  frontmatter: PromptFrontmatter

  /** Template content (Handlebars template without frontmatter) */
  content: string

  /** Full raw template including frontmatter */
  raw: string

  /** Original filename */
  filename: string
}

/**
 * Parse a markdown template with YAML frontmatter
 * @param raw - Raw template string with YAML frontmatter
 * @param filename - Original filename (for error reporting)
 * @returns Parsed and validated template
 * @throws Error if frontmatter is invalid
 *
 * @example
 * const template = parseTemplate(rawContent, 'explain.md')
 * console.log(template.frontmatter.name) // "Explain"
 * console.log(template.content) // Handlebars template content
 */
export function parseTemplate(raw: string, filename: string): ParsedTemplate {
  // Extract frontmatter manually (format: ---\nYAML\n---\ncontent)
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
  const match = raw.match(frontmatterRegex)

  if (!match) {
    throw new Error(`No frontmatter found in ${filename}. Templates must start with YAML frontmatter.`)
  }

  const [, frontmatterYaml, content] = match

  // Parse YAML frontmatter
  let data: unknown
  try {
    data = yaml.load(frontmatterYaml, { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    throw new Error(`Failed to parse YAML in ${filename}: ${error}`)
  }

  // Validate frontmatter with Zod schema
  const result = safeParseFrontmatter(data)

  if (!result.success) {
    const errorMessage = `Invalid frontmatter in ${filename}: ${result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')}`
    logger.error(errorMessage)
    throw new Error(
      `Invalid template frontmatter in ${filename}: ${result.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ')}`
    )
  }

  // Use custom ID from frontmatter if provided, otherwise generate from name
  const id = result.data.id || slugify(result.data.name)

  return {
    id,
    frontmatter: result.data,
    content: content.trim(),
    raw,
    filename
  }
}

/**
 * Convert a string to URL-safe slug format
 * @param str - String to slugify
 * @returns Lowercase, hyphenated string
 *
 * @example
 * slugify("Ask to Explain") // "ask-to-explain"
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
}

/**
 * Parse multiple templates and return array of parsed templates
 * Skips invalid templates and logs errors
 * @param templates - Array of raw template strings with filenames
 * @returns Array of successfully parsed templates
 */
export function parseTemplates(
  templates: Array<{ raw: string; filename: string }>
): ParsedTemplate[] {
  const parsed: ParsedTemplate[] = []

  for (const { raw, filename } of templates) {
    try {
      parsed.push(parseTemplate(raw, filename))
    } catch (error) {
      logger.error(`Skipping invalid template ${filename}:`, error instanceof Error ? error : undefined)
      // Continue parsing other templates
    }
  }

  return parsed
}
