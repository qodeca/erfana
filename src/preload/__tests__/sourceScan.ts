// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Syntax-tree scans behind the sealed preview-page preload's contract tests
 * (`previewPage.contract.test.ts`, `overlayCore.contract.test.ts`; spec 024
 * § 8 C15, 024-NFR-005 item 1; docs/adrs/0006-overlay-core-in-the-sealed-preload.md).
 *
 * Every rule here reads the TypeScript syntax tree, never the text: a regex
 * misses `export … from`, `require()`, `import()` and multi-line imports, and
 * is fooled by the same words in a comment or a string. Module paths are
 * resolved the way the bundler resolves them, so `./x`, `./x.ts` and
 * `../folder/x` cannot dress one file up as another.
 */
import { resolve } from 'node:path'
import ts from 'typescript'

/** One module the source names: an import, a re-export, a `require()` or an `import()`. */
export interface ModuleReference {
  /** The specifier as written; `<computed>` when it is not a string literal. */
  readonly specifier: string
  /** The bindings named: `default`, `*`, or each imported or re-exported name; empty for a bare or dynamic load. */
  readonly names: readonly string[]
  /** 1-based line, for failure messages. */
  readonly line: number
}

const COMPUTED = '<computed>'

/** Resolution as the preload bundle sees it (Vite: bundler resolution, ES modules). */
const RESOLVE_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true
}

/** `path` absolute, with `/` separators, lower-cased on Windows: comparable across `path` and `typescript`. */
export function comparablePath(path: string): string {
  const absolute = resolve(path).replace(/\\/g, '/')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function sourceFile(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function specifierOf(node: ts.Expression | undefined): string {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : COMPUTED
}

function importNames(clause: ts.ImportClause | undefined): string[] {
  if (clause === undefined) return []
  const names = clause.name === undefined ? [] : ['default']
  const bindings = clause.namedBindings
  if (bindings === undefined) return names
  if (ts.isNamespaceImport(bindings)) return [...names, '*']
  return [...names, ...bindings.elements.map(element => (element.propertyName ?? element.name).text)]
}

function exportNames(clause: ts.NamedExportBindings | undefined): string[] {
  if (clause === undefined) return ['*']
  if (ts.isNamespaceExport(clause)) return ['*']
  return clause.elements.map(element => (element.propertyName ?? element.name).text)
}

function isRequireCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === 'require'
}

/** The module `node` names, if it names one. */
function referenceOf(node: ts.Node): Omit<ModuleReference, 'line'> | null {
  if (ts.isImportDeclaration(node)) {
    return { specifier: specifierOf(node.moduleSpecifier), names: importNames(node.importClause) }
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
    return { specifier: specifierOf(node.moduleSpecifier), names: exportNames(node.exportClause) }
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return { specifier: specifierOf(node.moduleReference.expression), names: ['default'] }
  }
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequireCall(node))) {
    return { specifier: specifierOf(node.arguments[0]), names: [] }
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return { specifier: specifierOf(node.argument.literal as ts.Expression), names: [] }
  }
  return null
}

/** Every module `text` names, in source order. Comments and strings never count. */
export function moduleReferences(fileName: string, text: string): ModuleReference[] {
  const file = sourceFile(fileName, text)
  const found: ModuleReference[] = []
  const visit = (node: ts.Node): void => {
    const reference = referenceOf(node)
    if (reference !== null) {
      found.push({ ...reference, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/**
 * The file a relative `specifier` in `fromFile` loads, as {@link comparablePath};
 * `null` when it is not relative or resolves to nothing.
 */
export function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
  const resolved = ts.resolveModuleName(specifier, fromFile, RESOLVE_OPTIONS, ts.sys).resolvedModule
  return resolved === undefined ? null : comparablePath(resolved.resolvedFileName)
}

/**
 * Identifiers that name no binding in scope: a member (`a.b`, `A.B`,
 * `{ b: a } = …`) or the `const` of `as const`.
 */
function isMemberName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node
  if (ts.isQualifiedName(parent)) return parent.right === node
  if (ts.isBindingElement(parent)) return parent.propertyName === node
  return ts.isTypeReferenceNode(parent) && ts.isConstTypeReference(parent)
}

/** Pure ECMAScript the core may use; nothing a host (DOM, Node, Electron) adds. */
const ALLOWED_GLOBALS: ReadonlySet<string> = new Set(['Math'])
/** Members of an allowed global that are not pure. */
const IMPURE_MEMBERS: ReadonlySet<string> = new Set(['Math.random'])

/**
 * For each file of `files` (name → text): every identifier that is not bound
 * inside that file and is not one of {@link ALLOWED_GLOBALS}, as
 * `name (line n)`. The program sees the ES2022 library only – no DOM, no
 * `@types/node` – so a host global either resolves to nothing or to a library
 * declaration, and fails either way.
 */
export function freeIdentifiers(files: ReadonlyMap<string, string>): Map<string, string[]> {
  const options: ts.CompilerOptions = { ...RESOLVE_OPTIONS, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [], strict: true }
  const host = ts.createCompilerHost(options, true)
  const virtual = new Map([...files].map(([name, text]) => [comparablePath(name), text]))
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, language, ...rest) => {
    const text = virtual.get(comparablePath(name))
    return text === undefined ? getSourceFile(name, language, ...rest) : sourceFile(name, text)
  }
  const fileExists = host.fileExists.bind(host)
  host.fileExists = name => virtual.has(comparablePath(name)) || fileExists(name)
  const program = ts.createProgram([...files.keys()], options, host)
  const checker = program.getTypeChecker()
  const result = new Map<string, string[]>()
  for (const name of files.keys()) {
    const file = program.getSourceFile(name)
    if (file === undefined) throw new Error(`not in the program: ${name}`)
    const free: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isMemberName(node)) {
        const local = checker.getSymbolAtLocation(node)?.declarations?.some(d => d.getSourceFile() === file) === true
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
        if (!local && !ALLOWED_GLOBALS.has(node.text)) free.push(`${node.text} (line ${line})`)
        if (ts.isPropertyAccessExpression(node.parent) && IMPURE_MEMBERS.has(node.parent.getText(file))) {
          free.push(`${node.parent.getText(file)} (line ${line})`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    result.set(name, free)
  }
  return result
}

/** Whether `node` runs code when evaluated: a call, a `new`, a tagged template, an assignment or a `delete`. */
function runsCode(node: ts.Node): boolean {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return false
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) return true
  if (ts.isDeleteExpression(node) || ts.isAwaitExpression(node)) return true
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true
  return ts.forEachChild(node, runsCode) === true
}

/** Why a top-level statement is not a plain declaration, or `null` when it is one. */
function loadEffectOf(statement: ts.Statement): string | null {
  if (ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return null
  }
  if (!ts.isVariableStatement(statement)) return ts.SyntaxKind[statement.kind]
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return 'a module-level `let` or `var`'
  const running = statement.declarationList.declarations.find(d => d.initializer !== undefined && runsCode(d.initializer))
  return running === undefined ? null : `a module-level value computed by running code (${running.name.getText()})`
}

/**
 * The top-level statements of `text` that do something on load, as
 * `what (line n)`: anything but a function, an interface, a type alias or a
 * `const` whose value runs no code.
 */
export function loadEffects(fileName: string, text: string): string[] {
  const file = sourceFile(fileName, text)
  return file.statements.flatMap(statement => {
    const effect = loadEffectOf(statement)
    const line = file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1
    return effect === null ? [] : [`${effect} (line ${line})`]
  })
}
