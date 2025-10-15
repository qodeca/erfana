/**
 * Variables available for use in prompt templates
 * These are passed to Handlebars for interpolation
 */
export interface PromptVariables {
  /** The selected text from the markdown preview */
  selectedText: string

  /** Absolute path to the source file */
  filePath: string

  /** Full content of the markdown document */
  fullDocument: string

  /** Starting line number (1-indexed) */
  startLine?: number

  /** Ending line number (1-indexed) */
  endLine?: number

  /** Formatted line range string (e.g., "line 10" or "lines 10-15") */
  lineRange?: string

  /** File reference string for Claude (e.g., "@file:10" or "@file:10-15") */
  fileRef?: string

  /** Path to the project directory */
  projectPath?: string

  /** Mermaid diagram error message (for error reporting) */
  mermaidError?: string

  /** Mermaid diagram code that failed to render (for error reporting) */
  mermaidCode?: string
}

/**
 * Configuration for a single prompt template
 */
export interface PromptConfig {
  /** Unique identifier for this prompt */
  id: string

  /** Display label shown in the context menu */
  label: string

  /** Icon identifier (maps to Lucide icon component) */
  icon: string

  /** Which panel to send the rendered prompt to */
  targetPanel?: 'claude' | 'terminal'

  /** Whether to send immediately without user review */
  sendDirectly?: boolean

  /** The Handlebars template string */
  template: string

  /** The area where this prompt appears (from frontmatter) */
  area?: string

  /** Optional sub-area for more specific placement (from frontmatter) */
  subArea?: string

  /** Order for sorting in menus (lower numbers appear first) */
  order?: number

  /** Whether this prompt is enabled (can be toggled off) */
  enabled?: boolean

  /** Optional description/tooltip for this prompt */
  description?: string

  /** Optional keyboard shortcut (e.g., "Cmd+Shift+E") */
  shortcut?: string
}
