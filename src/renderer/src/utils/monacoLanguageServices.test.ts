// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { disableWorkerLanguageServices } from './monacoLanguageServices'

/** Build a stub language-service defaults object with spied setters. */
function makeDefaults() {
  return {
    setOptions: vi.fn(),
    setModeConfiguration: vi.fn(),
    setDiagnosticsOptions: vi.fn()
  }
}

/** Build a mock `monaco-editor` namespace exposing only the language defaults. */
function makeMonaco() {
  const cssDefaults = makeDefaults()
  const scssDefaults = makeDefaults()
  const lessDefaults = makeDefaults()
  const htmlDefaults = makeDefaults()
  const jsonDefaults = makeDefaults()
  const typescriptDefaults = makeDefaults()
  const javascriptDefaults = makeDefaults()

  const monaco = {
    languages: {
      css: { cssDefaults, scssDefaults, lessDefaults },
      html: { htmlDefaults },
      json: { jsonDefaults },
      typescript: { typescriptDefaults, javascriptDefaults }
    }
  }

  return {
    monaco: monaco as unknown as typeof import('monaco-editor'),
    cssDefaults,
    scssDefaults,
    lessDefaults,
    htmlDefaults,
    jsonDefaults,
    typescriptDefaults,
    javascriptDefaults
  }
}

describe('disableWorkerLanguageServices', () => {
  it('disables validation and providers on the CSS/SCSS/LESS defaults', () => {
    const m = makeMonaco()
    disableWorkerLanguageServices(m.monaco)

    for (const defaults of [m.cssDefaults, m.scssDefaults, m.lessDefaults]) {
      expect(defaults.setOptions).toHaveBeenCalledWith({ validate: false })
      expect(defaults.setModeConfiguration).toHaveBeenCalledTimes(1)
      expect(defaults.setModeConfiguration.mock.calls[0][0]).toMatchObject({
        completionItems: false,
        hovers: false,
        diagnostics: false
      })
    }
  })

  it('disables the worker-backed providers on the HTML defaults', () => {
    const m = makeMonaco()
    disableWorkerLanguageServices(m.monaco)

    expect(m.htmlDefaults.setModeConfiguration).toHaveBeenCalledTimes(1)
    expect(m.htmlDefaults.setModeConfiguration.mock.calls[0][0]).toMatchObject({
      completionItems: false,
      links: false
    })
  })

  it('disables validation and providers on the JSON defaults', () => {
    const m = makeMonaco()
    disableWorkerLanguageServices(m.monaco)

    expect(m.jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({ validate: false })
    expect(m.jsonDefaults.setModeConfiguration).toHaveBeenCalledTimes(1)
  })

  it('suppresses diagnostics on the TypeScript and JavaScript defaults', () => {
    const m = makeMonaco()
    disableWorkerLanguageServices(m.monaco)

    for (const defaults of [m.typescriptDefaults, m.javascriptDefaults]) {
      expect(defaults.setDiagnosticsOptions).toHaveBeenCalledWith({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true
      })
    }
  })
})
