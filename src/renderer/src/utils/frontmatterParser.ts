// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import yaml from 'js-yaml'
import { logger } from './logger'

/**
 * Represents parsed YAML frontmatter data.
 * Values can be primitives, arrays, or nested objects.
 */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue }

export interface FrontmatterData {
  [key: string]: FrontmatterValue
}

export interface ExtractedFrontmatter {
  /** Parsed frontmatter data, or null if none found or invalid */
  frontmatter: FrontmatterData | null
  /** The markdown body without frontmatter */
  body: string
  /** Number of lines the frontmatter occupies (for scroll sync) */
  frontmatterLineCount: number
  /** Whether parsing failed (for fallback rendering) */
  parseError: boolean
  /** Raw frontmatter YAML (for fallback code block) */
  rawFrontmatter: string | null
}

/**
 * Regex to match YAML frontmatter at the start of a document.
 * Matches:
 * ---
 * key: value
 * ---
 * content...
 */
const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/

/** Maximum frontmatter size in bytes (100KB) to prevent DoS via large YAML */
const MAX_FRONTMATTER_SIZE = 100_000

/**
 * Extracts YAML frontmatter from markdown content.
 *
 * @param content - Raw markdown content
 * @returns Extracted frontmatter data and body content
 *
 * @example
 * const { frontmatter, body } = extractFrontmatter(`---
 * title: My Doc
 * ---
 * # Content`)
 * // frontmatter = { title: 'My Doc' }
 * // body = '# Content'
 */
export function extractFrontmatter(content: string): ExtractedFrontmatter {
  const match = content.match(FRONTMATTER_REGEX)

  if (!match) {
    return {
      frontmatter: null,
      body: content,
      frontmatterLineCount: 0,
      parseError: false,
      rawFrontmatter: null
    }
  }

  const [, frontmatterYaml, body] = match

  // Count lines in frontmatter block (including --- delimiters)
  const frontmatterLineCount = frontmatterYaml.split(/\r?\n/).length + 2

  // Prevent DoS via extremely large YAML
  if (frontmatterYaml.length > MAX_FRONTMATTER_SIZE) {
    logger.warn('[frontmatterParser] Frontmatter exceeds size limit: ' + frontmatterYaml.length + ' bytes')
    return {
      frontmatter: null,
      body,
      frontmatterLineCount,
      parseError: true,
      rawFrontmatter: frontmatterYaml.slice(0, 1000) + '\n... (truncated, exceeds 100KB limit)'
    }
  }

  try {
    const data = yaml.load(frontmatterYaml, {
      schema: yaml.JSON_SCHEMA
    }) as FrontmatterData | null

    // Handle empty frontmatter (just ---)
    if (data === null || typeof data !== 'object') {
      return {
        frontmatter: null,
        body,
        frontmatterLineCount,
        parseError: false,
        rawFrontmatter: frontmatterYaml
      }
    }

    return {
      frontmatter: data,
      body,
      frontmatterLineCount,
      parseError: false,
      rawFrontmatter: frontmatterYaml
    }
  } catch (error) {
    // Invalid YAML - log for debugging and return raw for fallback rendering
    logger.warn('[frontmatterParser] Failed to parse YAML', { error })
    return {
      frontmatter: null,
      body,
      frontmatterLineCount,
      parseError: true,
      rawFrontmatter: frontmatterYaml
    }
  }
}

/**
 * Formats a frontmatter value for display.
 * Handles arrays, objects, and primitives.
 */
export function formatFrontmatterValue(value: FrontmatterValue): string {
  if (value === null) {
    return ''
  }

  if (Array.isArray(value)) {
    return value.map((v) => formatFrontmatterValue(v)).join(', ')
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}
