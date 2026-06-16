// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for variableFactory.ts
 */

import { describe, it, expect } from 'vitest'
import {
  createPromptVariables,
  computeFileRef,
  PromptVariableBuilder,
  promptVars
} from './variableFactory'

describe('variableFactory', () => {
  describe('createPromptVariables()', () => {
    it('should create variables with defaults when no input provided', () => {
      const vars = createPromptVariables()

      expect(vars.selectedText).toBe('')
      expect(vars.filePath).toBe('')
      expect(vars.fullDocument).toBe('')
      expect(vars.startLine).toBeUndefined()
      expect(vars.endLine).toBeUndefined()
      expect(vars.lineRange).toBeUndefined()
      expect(vars.fileRef).toBeUndefined()
    })

    it('should set provided values', () => {
      const vars = createPromptVariables({
        selectedText: 'Hello world',
        filePath: '/path/to/file.md',
        fullDocument: 'Full content here'
      })

      expect(vars.selectedText).toBe('Hello world')
      expect(vars.filePath).toBe('/path/to/file.md')
      expect(vars.fullDocument).toBe('Full content here')
    })

    it('should compute lineRange from startLine only', () => {
      const vars = createPromptVariables({
        filePath: '/file.md',
        startLine: 10
      })

      expect(vars.lineRange).toBe('line 10')
    })

    it('should compute lineRange from startLine and endLine (same)', () => {
      const vars = createPromptVariables({
        filePath: '/file.md',
        startLine: 10,
        endLine: 10
      })

      expect(vars.lineRange).toBe('line 10')
    })

    it('should compute lineRange from startLine and endLine (different)', () => {
      const vars = createPromptVariables({
        filePath: '/file.md',
        startLine: 10,
        endLine: 15
      })

      expect(vars.lineRange).toBe('lines 10-15')
    })

    it('should compute fileRef from filePath and startLine', () => {
      const vars = createPromptVariables({
        filePath: '/path/to/file.md',
        startLine: 10
      })

      expect(vars.fileRef).toBe('@/path/to/file.md:10')
    })

    it('should compute fileRef from filePath and line range', () => {
      const vars = createPromptVariables({
        filePath: '/path/to/file.md',
        startLine: 10,
        endLine: 15
      })

      expect(vars.fileRef).toBe('@/path/to/file.md:10-15')
    })

    it('should not compute fileRef when filePath is empty', () => {
      const vars = createPromptVariables({
        startLine: 10,
        endLine: 15
      })

      expect(vars.fileRef).toBeUndefined()
    })

    it('should set optional mermaid fields', () => {
      const vars = createPromptVariables({
        mermaidCode: 'graph TD; A-->B',
        mermaidError: 'Syntax error at line 1'
      })

      expect(vars.mermaidCode).toBe('graph TD; A-->B')
      expect(vars.mermaidError).toBe('Syntax error at line 1')
    })

    it('should set userInput', () => {
      const vars = createPromptVariables({
        userInput: 'Make it more concise'
      })

      expect(vars.userInput).toBe('Make it more concise')
    })

    it('should set importedFilePath', () => {
      const vars = createPromptVariables({
        importedFilePath: '/import/document.md'
      })

      expect(vars.importedFilePath).toBe('/import/document.md')
    })

    it('should set direction fields', () => {
      const vars = createPromptVariables({
        targetDirection: 'LR',
        directionLabel: 'Left to Right'
      })

      expect(vars.targetDirection).toBe('LR')
      expect(vars.directionLabel).toBe('Left to Right')
    })

    it('should set userInstruction', () => {
      const vars = createPromptVariables({
        userInstruction: 'Add a new node C connected to B'
      })

      expect(vars.userInstruction).toBe('Add a new node C connected to B')
    })
  })

  describe('computeFileRef()', () => {
    it('should return undefined for empty filePath', () => {
      expect(computeFileRef('')).toBeUndefined()
      expect(computeFileRef('', 10)).toBeUndefined()
      expect(computeFileRef('', 10, 15)).toBeUndefined()
    })

    it('should return undefined when no line numbers provided', () => {
      expect(computeFileRef('/path/to/file.md')).toBeUndefined()
    })

    it('should return single line reference', () => {
      expect(computeFileRef('/path/to/file.md', 10)).toBe('@/path/to/file.md:10')
    })

    it('should return single line reference when start equals end', () => {
      expect(computeFileRef('/path/to/file.md', 10, 10)).toBe('@/path/to/file.md:10')
    })

    it('should return range reference when start differs from end', () => {
      expect(computeFileRef('/path/to/file.md', 10, 15)).toBe('@/path/to/file.md:10-15')
    })

    it('should handle paths with special characters', () => {
      expect(computeFileRef('/path/to/my file.md', 5)).toBe('@/path/to/my file.md:5')
    })
  })

  describe('PromptVariableBuilder', () => {
    it('should build variables with text', () => {
      const vars = new PromptVariableBuilder()
        .text('Hello world')
        .build()

      expect(vars.selectedText).toBe('Hello world')
    })

    it('should build variables with file', () => {
      const vars = new PromptVariableBuilder()
        .file('/path/to/file.md')
        .build()

      expect(vars.filePath).toBe('/path/to/file.md')
    })

    it('should build variables with document', () => {
      const vars = new PromptVariableBuilder()
        .document('Full document content')
        .build()

      expect(vars.fullDocument).toBe('Full document content')
    })

    it('should build variables with single line', () => {
      const vars = new PromptVariableBuilder()
        .file('/file.md')
        .lines(10)
        .build()

      expect(vars.startLine).toBe(10)
      expect(vars.endLine).toBe(10)
      expect(vars.lineRange).toBe('line 10')
    })

    it('should build variables with line range', () => {
      const vars = new PromptVariableBuilder()
        .file('/file.md')
        .lines(10, 15)
        .build()

      expect(vars.startLine).toBe(10)
      expect(vars.endLine).toBe(15)
      expect(vars.lineRange).toBe('lines 10-15')
    })

    it('should build variables with project', () => {
      const vars = new PromptVariableBuilder()
        .project('/path/to/project')
        .build()

      expect(vars.projectPath).toBe('/path/to/project')
    })

    it('should build variables with mermaid code only', () => {
      const vars = new PromptVariableBuilder()
        .mermaid('graph TD; A-->B')
        .build()

      expect(vars.mermaidCode).toBe('graph TD; A-->B')
      expect(vars.mermaidError).toBeUndefined()
    })

    it('should build variables with mermaid code and error', () => {
      const vars = new PromptVariableBuilder()
        .mermaid('graph TD; A-->', 'Syntax error')
        .build()

      expect(vars.mermaidCode).toBe('graph TD; A-->')
      expect(vars.mermaidError).toBe('Syntax error')
    })

    it('should build variables with userInput', () => {
      const vars = new PromptVariableBuilder()
        .userInput('Make it shorter')
        .build()

      expect(vars.userInput).toBe('Make it shorter')
    })

    it('should build variables with instruction', () => {
      const vars = new PromptVariableBuilder()
        .instruction('Add node C')
        .build()

      expect(vars.userInstruction).toBe('Add node C')
    })

    it('should build variables with imported path', () => {
      const vars = new PromptVariableBuilder()
        .imported('/import/doc.pdf')
        .build()

      expect(vars.importedFilePath).toBe('/import/doc.pdf')
    })

    it('should build variables with direction', () => {
      const vars = new PromptVariableBuilder()
        .direction('TB', 'Top to Bottom')
        .build()

      expect(vars.targetDirection).toBe('TB')
      expect(vars.directionLabel).toBe('Top to Bottom')
    })

    it('should support fluent chaining', () => {
      const vars = new PromptVariableBuilder()
        .text('Selected text')
        .file('/path/to/file.md')
        .document('Full content')
        .lines(10, 15)
        .project('/project')
        .userInput('User input')
        .build()

      expect(vars.selectedText).toBe('Selected text')
      expect(vars.filePath).toBe('/path/to/file.md')
      expect(vars.fullDocument).toBe('Full content')
      expect(vars.startLine).toBe(10)
      expect(vars.endLine).toBe(15)
      expect(vars.projectPath).toBe('/project')
      expect(vars.userInput).toBe('User input')
      expect(vars.lineRange).toBe('lines 10-15')
      expect(vars.fileRef).toBe('@/path/to/file.md:10-15')
    })
  })

  describe('promptVars()', () => {
    it('should return a new builder instance', () => {
      const builder = promptVars()

      expect(builder).toBeInstanceOf(PromptVariableBuilder)
    })

    it('should work with fluent API', () => {
      const vars = promptVars()
        .text('Hello')
        .file('/file.md')
        .build()

      expect(vars.selectedText).toBe('Hello')
      expect(vars.filePath).toBe('/file.md')
    })
  })
})
