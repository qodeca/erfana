// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's parse pipeline, shared by the preview (react-markdown,
 * renderer) and main's comment render check (spec 024, architecture note
 * § 1 and § 5): the same remark plugins, the same raw-HTML step and the same
 * sanitize schema, so "the rendered tree is unchanged" means the same thing
 * in both places.
 *
 * Pure and DOM-free: it runs in the renderer and in main's parse worker. It
 * never loads YAML – frontmatter is split off by a regular expression only
 * (§ 8 C19); the preview parses the YAML itself.
 *
 * The presentation steps that follow sanitize in the preview (heading ids,
 * line shift, link collection – `previewRehypePlugins.ts`) are not part of this
 * module: the render check compares the tree after parse and sanitize, before
 * any presentation plugin (024-NFR-008).
 *
 * @module shared/markdown/previewPipeline
 */
import type { Root as HastRoot } from 'hast'
import { defaultSchema } from 'hast-util-sanitize'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified, type PluggableList } from 'unified'

/**
 * YAML frontmatter at the very start of the text: `---`, the YAML, `---`.
 * The preview's frontmatter parser uses this same expression.
 */
export const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/

/** Where the frontmatter ends and the Markdown body starts. */
export interface FrontmatterSplit {
  /** The YAML between the fences, or null when the text has no frontmatter. */
  readonly yaml: string | null
  /** The Markdown the preview renders. */
  readonly body: string
  /** UTF-16 offset of the body's first character in the text passed in. */
  readonly bodyOffset: number
  /** Lines the frontmatter takes, fences included (0 without frontmatter). */
  readonly frontmatterLineCount: number
}

/**
 * Split frontmatter off `text`, exactly as the preview does. A BOM is not
 * stripped here: callers that hold a BOM pass the text after it and add its
 * length to offsets themselves (one coordinate system, § 8 C11).
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const match = text.match(FRONTMATTER_REGEX)
  if (!match) return { yaml: null, body: text, bodyOffset: 0, frontmatterLineCount: 0 }
  const [, yaml, body] = match
  return {
    yaml,
    body,
    bodyOffset: text.length - body.length,
    frontmatterLineCount: yaml.split(/\r?\n/).length + 2
  }
}

/** The preview's sanitize schema: GitHub's defaults plus `tel:` links. */
export const PREVIEW_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), 'tel']
  }
}

const REMARK_PLUGINS_BASE: PluggableList = [remarkGfm]
const REMARK_PLUGINS_WITH_BREAKS: PluggableList = [remarkGfm, remarkBreaks]

/**
 * The remark plugins, by the "preserve line breaks" setting. Module-level
 * arrays, so react-markdown sees the same object on every render.
 */
export function previewRemarkPlugins(breaks: boolean): PluggableList {
  return breaks ? REMARK_PLUGINS_WITH_BREAKS : REMARK_PLUGINS_BASE
}

/**
 * The rehype steps every preview tree goes through, in order: raw HTML is
 * parsed, then sanitized. Nothing that runs after them may add markup from the
 * document. Never use `rehypeRaw` without `rehypeSanitize`.
 */
export const PREVIEW_REHYPE_CORE: PluggableList = [rehypeRaw, [rehypeSanitize, PREVIEW_SANITIZE_SCHEMA]]

/** The options react-markdown passes to remark-rehype; the shared chain uses the same. */
export const PREVIEW_REMARK_REHYPE_OPTIONS = { allowDangerousHtml: true } as const

/** The pinned plugin list, by name – a test fails if it changes without review (§ 8 C19). */
export const PREVIEW_PIPELINE_STEPS = [
  'remark-parse',
  'remark-gfm',
  'remark-breaks (when the setting is on)',
  'remark-rehype (allowDangerousHtml)',
  'rehype-raw',
  'rehype-sanitize (PREVIEW_SANITIZE_SCHEMA)'
] as const

/**
 * The preview's tree for a Markdown body, after parse and sanitize: what
 * react-markdown renders, before the presentation plugins. Parse and compare
 * only – nothing in the document is executed.
 */
export function previewTree(body: string, options: { breaks: boolean }): HastRoot {
  const processor = unified()
    .use(remarkParse)
    .use(previewRemarkPlugins(options.breaks))
    .use(remarkRehype, PREVIEW_REMARK_REHYPE_OPTIONS)
    .use(PREVIEW_REHYPE_CORE)
  return processor.runSync(processor.parse(body)) as HastRoot
}
