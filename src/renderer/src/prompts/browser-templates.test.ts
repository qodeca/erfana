// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { getAllPrompts, getPrompt, getPromptsForArea } from './registry'
import { promptRenderer } from './renderer'
import {
  BROWSER_CAPTURE_FOOTER,
  BROWSER_CAPTURE_VARIABLES,
  pickBrowserCaptureVariables,
  withPromptFooter
} from './browserCaptureFooter'
import { MUTATE_DOCUMENT_FOOTER } from './applyFooter'
import type { PromptVariables } from './types'

/** Template ids from the spec 025 naming contract "Prompt template ids". */
const BROWSER_TEMPLATE_IDS = ['browser-explain', 'browser-ask', 'browser-change', 'browser-prompt'] as const

const CONTEXT_REF = '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d.md'
const SCREENSHOT_REF = '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d.png'
const CROP_REF = '@.erfana/browser/captures/20261103-101500Z-0a1b2c3d-crop.png'

/** Render a browser template the way executePromptTemplate does. */
function render(id: string, variables: Partial<PromptVariables>): string {
  const config = getPrompt(id)
  if (!config) throw new Error(`missing template ${id}`)
  return promptRenderer.render(
    withPromptFooter(config.template, config),
    pickBrowserCaptureVariables({ selectedText: '', filePath: '', fullDocument: '', ...variables })
  )
}

/** Every `{{…}}` token in a template, reduced to the variable it reads. */
function tokenNames(template: string): string[] {
  return [...template.matchAll(/\{\{([^}]*)\}\}/g)]
    .map(([, inner]) => inner.trim())
    .filter((inner) => inner !== '/if')
    .map((inner) => inner.replace(/^#if\s+/, ''))
}

describe('browser prompt templates', () => {
  describe.each(BROWSER_TEMPLATE_IDS)('%s', (id) => {
    it('is registered with autoExecute, browserCapture and without mutatesDocument', () => {
      const config = getPrompt(id)
      expect(config).not.toBeNull()
      expect(config?.area).toBe('browser')
      expect(config?.autoExecute).toBe(true)
      expect(config?.browserCapture).toBe(true)
      expect(config?.mutatesDocument).toBe(false)
      expect(config?.enabled).toBe(true)
    })

    it('reads only userInput, contextRef, screenshotRef and cropRef', () => {
      const names = tokenNames(getPrompt(id)!.template)
      expect(names.length).toBeGreaterThan(0)
      for (const name of names) expect(BROWSER_CAPTURE_VARIABLES).toContain(name)
    })

    it('renders the context file and screenshot references and the browser-capture footer', () => {
      const rendered = render(id, { contextRef: CONTEXT_REF, screenshotRef: SCREENSHOT_REF, cropRef: CROP_REF, userInput: 'x' })
      expect(rendered).toContain(CONTEXT_REF)
      expect(rendered).toContain(SCREENSHOT_REF)
      expect(rendered).toContain(CROP_REF)
      expect(rendered.endsWith(BROWSER_CAPTURE_FOOTER)).toBe(true)
      expect(rendered).not.toContain(MUTATE_DOCUMENT_FOOTER)
    })

    it('drops the crop line when there is no crop', () => {
      const rendered = render(id, { contextRef: CONTEXT_REF, screenshotRef: SCREENSHOT_REF, userInput: 'x' })
      expect(rendered).not.toContain('Element crop:')
      expect(rendered).toContain(CONTEXT_REF)
    })

    it('025-AC-036 keeps text from non-capture variables out of the rendered prompt', () => {
      const marker = 'INJECT-7f3a'
      const rendered = render(id, {
        selectedText: marker,
        filePath: marker,
        fullDocument: marker,
        fileRef: marker,
        userInstruction: marker,
        contextRef: CONTEXT_REF,
        screenshotRef: SCREENSHOT_REF,
        userInput: 'x'
      })
      expect(rendered).not.toContain(marker)
    })
  })

  it('flags only the four browser templates as browserCapture', () => {
    const flagged = getAllPrompts().filter((p) => p.browserCapture).map((p) => p.id).sort()
    expect(flagged).toEqual([...BROWSER_TEMPLATE_IDS].sort())
  })

  it('025-AC-030 lists exactly Explain, Ask…, Change… and Prompt…, in that order', () => {
    expect(getPromptsForArea('browser').map((p) => p.label)).toEqual(['Explain', 'Ask…', 'Change…', 'Prompt…'])
    expect(getPromptsForArea('browser').map((p) => p.id)).toEqual([...BROWSER_TEMPLATE_IDS])
  })

  it('025-AC-031 needs an instruction for Ask, Change and Prompt but not for Explain', () => {
    expect(getPrompt('browser-explain')?.requiresInput).toBe(false)
    expect(getPrompt('browser-ask')?.requiresInput).toBe(true)
    expect(getPrompt('browser-change')?.requiresInput).toBe(true)
    expect(getPrompt('browser-prompt')?.requiresInput).toBe(true)
  })

  it.each(['browser-ask', 'browser-change', 'browser-prompt'])('%s carries the user instruction', (id) => {
    const rendered = render(id, { contextRef: CONTEXT_REF, screenshotRef: SCREENSHOT_REF, userInput: 'label cut off' })
    expect(rendered).toContain('label cut off')
  })

  it('025-AC-032 browser-change asks the agent to locate and edit the source that renders the element', () => {
    const rendered = render('browser-change', { contextRef: CONTEXT_REF, screenshotRef: SCREENSHOT_REF, userInput: 'label cut off' })
    expect(rendered).toContain('Locate the source in this project that renders the element')
    expect(rendered).toContain('edit it to make the change above')
  })

  it('025-AC-032 a {{x}} token in the instruction arrives as text', () => {
    const rendered = render('browser-prompt', {
      contextRef: CONTEXT_REF,
      screenshotRef: SCREENSHOT_REF,
      userInput: 'keep {{x}} and {{contextRef}} and {{#if userInput}}y{{/if}} literal'
    })
    expect(rendered).toContain('keep {{x}} and {{contextRef}} and {{#if userInput}}y{{/if}} literal')
  })

  it('keeps a multi-line instruction intact for the paste', () => {
    const rendered = render('browser-ask', { contextRef: CONTEXT_REF, screenshotRef: SCREENSHOT_REF, userInput: 'why?\nand how?' })
    expect(rendered).toContain('why?\nand how?')
  })

  it.each(['browser-explain', 'browser-ask'])('%s tells the agent not to edit files', (id) => {
    expect(getPrompt(id)?.template).toContain('Do NOT edit')
  })
})
