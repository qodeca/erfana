// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Factory for creating PromptVariables with consistent defaults and computed fields
 *
 * Benefits:
 * - Consistent defaults across all callers
 * - Automatic computation of derived fields (lineRange, fileRef)
 * - Builder pattern for complex construction
 * - Type-safe with IDE autocomplete
 */

import { formatLineRange } from './helpers'
import type { PromptVariables } from './types'

/**
 * Input for creating PromptVariables
 * All fields are optional - factory provides sensible defaults
 */
export interface PromptVariableInput {
  selectedText?: string
  filePath?: string
  fullDocument?: string
  startLine?: number
  endLine?: number
  projectPath?: string
  mermaidError?: string
  mermaidCode?: string
  userInput?: string
  importedFilePath?: string
  targetDirection?: string
  directionLabel?: string
  userInstruction?: string
}

/**
 * Create PromptVariables with defaults and computed fields
 *
 * Automatically computes:
 * - lineRange: "line 10" or "lines 10-15" from startLine/endLine
 * - fileRef: "@/path/to/file:10-15" from filePath and line numbers
 *
 * @param input - Partial input with values to set
 * @returns Complete PromptVariables object
 *
 * @example
 * // Simple usage
 * const vars = createPromptVariables({
 *   selectedText: 'Hello world',
 *   filePath: '/path/to/file.md'
 * })
 *
 * @example
 * // With line numbers (auto-computes lineRange and fileRef)
 * const vars = createPromptVariables({
 *   selectedText: 'Selected content',
 *   filePath: '/path/to/file.md',
 *   startLine: 10,
 *   endLine: 15
 * })
 * // vars.lineRange === "lines 10-15"
 * // vars.fileRef === "@/path/to/file.md:10-15"
 */
export function createPromptVariables(input: PromptVariableInput = {}): PromptVariables {
  const {
    selectedText = '',
    filePath = '',
    fullDocument = '',
    startLine,
    endLine,
    projectPath,
    mermaidError,
    mermaidCode,
    userInput,
    importedFilePath,
    targetDirection,
    directionLabel,
    userInstruction
  } = input

  // Compute derived fields (convert empty string to undefined)
  const lineRange = formatLineRange(startLine, endLine) || undefined
  const fileRef = computeFileRef(filePath, startLine, endLine)

  return {
    selectedText,
    filePath,
    fullDocument,
    startLine,
    endLine,
    lineRange,
    fileRef,
    projectPath,
    mermaidError,
    mermaidCode,
    userInput,
    importedFilePath,
    targetDirection,
    directionLabel,
    userInstruction
  }
}

/**
 * Compute file reference string for Claude Code
 *
 * @param filePath - Path to the file
 * @param startLine - Starting line number (optional)
 * @param endLine - Ending line number (optional)
 * @returns File reference string (e.g., "@/path/file.md:10-15") or undefined
 */
export function computeFileRef(
  filePath: string,
  startLine?: number,
  endLine?: number
): string | undefined {
  if (!filePath) return undefined

  if (startLine !== undefined && endLine !== undefined && startLine !== endLine) {
    return `@${filePath}:${startLine}-${endLine}`
  } else if (startLine !== undefined) {
    return `@${filePath}:${startLine}`
  }

  return undefined
}

/**
 * Builder for creating PromptVariables with fluent API
 *
 * @example
 * const vars = new PromptVariableBuilder()
 *   .text('Selected content')
 *   .file('/path/to/file.md')
 *   .lines(10, 15)
 *   .mermaid('graph TD; A-->B', 'Syntax error')
 *   .build()
 */
export class PromptVariableBuilder {
  private input: PromptVariableInput = {}

  /**
   * Set selected text
   */
  text(selectedText: string): this {
    this.input.selectedText = selectedText
    return this
  }

  /**
   * Set file path
   */
  file(filePath: string): this {
    this.input.filePath = filePath
    return this
  }

  /**
   * Set full document content
   */
  document(fullDocument: string): this {
    this.input.fullDocument = fullDocument
    return this
  }

  /**
   * Set line range
   */
  lines(startLine: number, endLine?: number): this {
    this.input.startLine = startLine
    this.input.endLine = endLine ?? startLine
    return this
  }

  /**
   * Set project path
   */
  project(projectPath: string): this {
    this.input.projectPath = projectPath
    return this
  }

  /**
   * Set Mermaid diagram context (code and optional error)
   */
  mermaid(code: string, error?: string): this {
    this.input.mermaidCode = code
    if (error !== undefined) {
      this.input.mermaidError = error
    }
    return this
  }

  /**
   * Set user input
   */
  userInput(input: string): this {
    this.input.userInput = input
    return this
  }

  /**
   * Set user instruction (for AI requests)
   */
  instruction(instruction: string): this {
    this.input.userInstruction = instruction
    return this
  }

  /**
   * Set imported file path
   */
  imported(filePath: string): this {
    this.input.importedFilePath = filePath
    return this
  }

  /**
   * Set target direction for Mermaid diagrams
   */
  direction(target: string, label: string): this {
    this.input.targetDirection = target
    this.input.directionLabel = label
    return this
  }

  /**
   * Build the PromptVariables object
   */
  build(): PromptVariables {
    return createPromptVariables(this.input)
  }
}

/**
 * Create a new builder instance
 *
 * @example
 * const vars = promptVars()
 *   .text('Hello world')
 *   .file('/path/to/file.md')
 *   .lines(10, 15)
 *   .build()
 */
export function promptVars(): PromptVariableBuilder {
  return new PromptVariableBuilder()
}
