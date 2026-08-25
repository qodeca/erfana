// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Disable Monaco's worker-backed language services.
 *
 * `monaco-editor` is bundled locally and ships every basic language, but no
 * `MonacoEnvironment`/worker is configured. Switching a model to css/html/json/
 * typescript would otherwise activate rich language services (validation,
 * completion, hovers, symbols, formatting), each of which lazily spins up a web
 * worker that cannot be constructed in this setup.
 *
 * This module turns those services off on the shared language defaults, leaving
 * the main-thread Monarch tokenizer (syntax highlighting) intact.
 */

type Monaco = typeof import('monaco-editor')

/**
 * The subset of a Monaco language-service defaults object this module drives.
 *
 * The rich `monaco.languages.css`/`.html`/`.json`/`.typescript` namespaces are
 * declared by `monaco-editor` as an ambient augmentation of the global `monaco`
 * namespace; the package's module type (`typeof import('monaco-editor')`) still
 * carries the deprecated placeholder stubs for those keys. These structural
 * interfaces mirror the real runtime shape so the setter calls stay type-checked.
 */
interface OptionsDefaults {
  setOptions(options: { validate?: boolean }): void
  setModeConfiguration(config: ModeConfigurationOff): void
}

interface DiagnosticsDefaults {
  setDiagnosticsOptions(options: { validate?: boolean }): void
  setModeConfiguration(config: ModeConfigurationOff): void
}

interface TypeScriptDefaults {
  setDiagnosticsOptions(options: {
    noSemanticValidation?: boolean
    noSyntaxValidation?: boolean
    noSuggestionDiagnostics?: boolean
  }): void
}

type ModeConfigurationOff = Readonly<Record<string, boolean>>

interface LanguageServiceNamespaces {
  css: { cssDefaults: OptionsDefaults; scssDefaults: OptionsDefaults; lessDefaults: OptionsDefaults }
  html: { htmlDefaults: OptionsDefaults }
  json: { jsonDefaults: DiagnosticsDefaults }
  typescript: { typescriptDefaults: TypeScriptDefaults; javascriptDefaults: TypeScriptDefaults }
}

/**
 * A mode configuration with every built-in provider disabled. All of these
 * providers are backed by the language worker, so turning them off prevents the
 * worker from being constructed. Tokenization is not part of this configuration
 * and is unaffected.
 */
const ALL_PROVIDERS_OFF = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  colors: false,
  foldingRanges: false,
  diagnostics: false,
  selectionRanges: false,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  links: false
} as const

/**
 * Disable validation and suggestion (worker-backed) language services on
 * Monaco's css/html/json/typescript defaults.
 *
 * Idempotent and safe to call once at editor bootstrap.
 *
 * @param monaco - The `monaco-editor` namespace.
 */
export function disableWorkerLanguageServices(monaco: Monaco): void {
  const { css, html, json, typescript } =
    monaco.languages as unknown as LanguageServiceNamespaces

  // CSS family: turn off validation and every worker-backed provider.
  for (const defaults of [css.cssDefaults, css.scssDefaults, css.lessDefaults]) {
    defaults.setOptions({ validate: false })
    defaults.setModeConfiguration(ALL_PROVIDERS_OFF)
  }

  // HTML: no validation flag, so only the mode configuration disables the worker.
  html.htmlDefaults.setModeConfiguration(ALL_PROVIDERS_OFF)

  // JSON: turn off schema/syntax validation and every worker-backed provider.
  json.jsonDefaults.setDiagnosticsOptions({ validate: false })
  json.jsonDefaults.setModeConfiguration(ALL_PROVIDERS_OFF)

  // TypeScript / JavaScript: suppress semantic, syntax and suggestion diagnostics.
  for (const defaults of [typescript.typescriptDefaults, typescript.javascriptDefaults]) {
    defaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true
    })
  }
}
