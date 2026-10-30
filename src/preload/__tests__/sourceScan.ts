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
/** The specifier of a `require` named but not called (`const r = require`): a load the scan cannot follow. */
export const BARE_REQUIRE = '<require>'

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

/**
 * `require` used other than as the callee of a call (`const r = require`,
 * `f(require)`, `{ require }`): an alias would load a module the call rule
 * never sees. A member name (`x.require`) is not the binding.
 */
function isBareRequire(node: ts.Node): boolean {
  if (!ts.isIdentifier(node) || node.text !== 'require') return false
  const parent = node.parent
  if (ts.isCallExpression(parent) && parent.expression === node) return false
  return !(ts.isPropertyAccessExpression(parent) && parent.name === node)
}

/** The module `node` names, if it names one. */
function referenceOf(node: ts.Node): Omit<ModuleReference, 'line'> | null {
  if (isBareRequire(node)) return { specifier: BARE_REQUIRE, names: [] }
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

/**
 * Every module `text` names, in source order, plus every bare `require` as
 * {@link BARE_REQUIRE}. Comments and strings never count.
 */
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
/** A global the core may name only for this one member (module-level constants are frozen with it). */
const ALLOWED_GLOBAL_MEMBERS: ReadonlySet<string> = new Set(['Object.freeze'])
/** Members of an allowed global that are not pure. */
const IMPURE_MEMBERS: ReadonlySet<string> = new Set(['Math.random'])
/**
 * Names that climb from any value to `Function` or a shared prototype
 * (`Math.max.constructor('return this')()` is the global object): banned
 * wherever they appear, as a member or a key.
 */
const PROTOTYPE_CHAIN_NAMES: ReadonlySet<string> = new Set(['constructor', 'prototype', '__proto__'])

/** Whether `name` is a TypeScript source module the scans read: `pinLayout.ts`, `pins.test.ts` – never `.d.ts`, `.js` or another kind. */
export function isTypeScriptSourceName(name: string): boolean {
  return /^[A-Za-z]+(\.[A-Za-z]+)*\.ts$/.test(name) && !name.endsWith('.d.ts')
}

interface ScanProgram {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  /** The program's file for each name of `files`. */
  readonly sources: ReadonlyMap<string, ts.SourceFile>
}

/**
 * `files` (name → text) as one program against the ES2022 library alone – no
 * DOM, no `@types/node` – so a host global either resolves to nothing or to a
 * library declaration.
 */
function scanProgram(files: ReadonlyMap<string, string>): ScanProgram {
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
  const sources = new Map<string, ts.SourceFile>()
  for (const name of files.keys()) {
    const file = program.getSourceFile(name)
    if (file === undefined) throw new Error(`not in the program: ${name}`)
    sources.set(name, file)
  }
  return { program, checker: program.getTypeChecker(), sources }
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
}

function hasDeclareModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) === true
}

/**
 * The symbol an identifier reads. In a shorthand property (`{ document }`)
 * that is the value it copies, not the property it declares – which would
 * otherwise count as bound in the file.
 */
function readSymbol(checker: ts.TypeChecker, node: ts.Identifier): ts.Symbol | undefined {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    return checker.getShorthandAssignmentValueSymbol(parent)
  }
  return checker.getSymbolAtLocation(node)
}

/** `Global.member` when `node` is the object of a member access, else `null`. */
function globalMemberOf(node: ts.Identifier): string | null {
  const parent = node.parent
  return ts.isPropertyAccessExpression(parent) && parent.expression === node ? `${node.text}.${parent.name.text}` : null
}

/** What is wrong with an identifier that names a binding: empty when it is bound in `file` or an allowed global. */
function freeNameOf(node: ts.Identifier, file: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const local = readSymbol(checker, node)?.declarations?.some(d => d.getSourceFile() === file) === true
  const member = globalMemberOf(node)
  const found: string[] = []
  const allowed = ALLOWED_GLOBALS.has(node.text) || (member !== null && ALLOWED_GLOBAL_MEMBERS.has(member))
  if (!local && !allowed) found.push(node.text)
  if (!local && member !== null && IMPURE_MEMBERS.has(member)) found.push(member)
  return found
}

/** Everything in `file` that names or reaches past the file itself, without the line. */
function escapesOf(node: ts.Node, file: ts.SourceFile, checker: ts.TypeChecker): string[] {
  if (hasDeclareModifier(node)) return ['a `declare` statement']
  if (ts.isElementAccessExpression(node)) return ['an element access']
  if (!ts.isIdentifier(node)) return []
  if (PROTOTYPE_CHAIN_NAMES.has(node.text)) return [node.text]
  return isMemberName(node) ? [] : freeNameOf(node, file, checker)
}

/** A declaration file, or a `/// <reference …>`: each can bring names in that the file does not bind. */
function referencesOf(file: ts.SourceFile): string[] {
  const directives = [...file.referencedFiles, ...file.typeReferenceDirectives, ...file.libReferenceDirectives]
  const found = directives.map(d => `/// <reference ${d.fileName}> (line ${file.getLineAndCharacterOfPosition(d.pos).line + 1})`)
  return file.fileName.endsWith('.d.ts') ? ['a declaration file', ...found] : found
}

/**
 * For each file of `files` (name → text), as `what (line n)`:
 *
 * - every identifier that is not bound inside that file and is not one of
 *   {@link ALLOWED_GLOBALS} or {@link ALLOWED_GLOBAL_MEMBERS} – a shorthand
 *   property is judged by the value it reads;
 * - `Math.random`;
 * - `constructor`, `prototype` and `__proto__`, and every `x[…]` access, which
 *   reach a global without naming it;
 * - every `declare` (it would make a host global look bound in the file),
 *   `/// <reference>` and declaration file.
 *
 * The program sees the ES2022 library only, so a host global fails whether it
 * resolves to nothing or to a library declaration.
 */
export function freeIdentifiers(files: ReadonlyMap<string, string>): Map<string, string[]> {
  const { checker, sources } = scanProgram(files)
  const result = new Map<string, string[]>()
  for (const [name, file] of sources) {
    const free: string[] = referencesOf(file)
    const visit = (node: ts.Node): void => {
      for (const what of escapesOf(node, file, checker)) free.push(`${what} (line ${lineOf(file, node)})`)
      ts.forEachChild(node, visit)
    }
    visit(file)
    result.set(name, free)
  }
  return result
}

/**
 * For each file of `files`, every syntax or type error the checker reports
 * against the ES2022 library alone, as `message (line n)`. An unresolved name
 * is one; so is anything the name scan above might misread.
 */
export function typeErrors(files: ReadonlyMap<string, string>): Map<string, string[]> {
  const { program, sources } = scanProgram(files)
  const result = new Map<string, string[]>()
  for (const [name, file] of sources) {
    const diagnostics = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
    result.set(
      name,
      diagnostics.map(d => {
        const line = d.start === undefined ? 0 : file.getLineAndCharacterOfPosition(d.start).line + 1
        return `${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (line ${line})`
      })
    )
  }
  return result
}

/** `node` without the type-only wrappers that run nothing: `( )`, `as`, `satisfies`, `<T>`. */
function unwrapped(node: ts.Expression): ts.Expression {
  let at = node
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isTypeAssertionExpression(at)) {
    at = at.expression
  }
  return at
}

/** A string, number or bigint literal, a signed number, `true`, `false` or `null`: reading it runs nothing. */
function isPrimitiveLiteral(node: ts.Expression): boolean {
  const value = unwrapped(node)
  if (ts.isStringLiteral(value) || ts.isNumericLiteral(value) || ts.isBigIntLiteral(value)) return true
  const keyword = value.kind
  if (keyword === ts.SyntaxKind.TrueKeyword || keyword === ts.SyntaxKind.FalseKeyword || keyword === ts.SyntaxKind.NullKeyword) return true
  const signed = ts.isPrefixUnaryExpression(value) && (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken)
  return signed && ts.isNumericLiteral(value.operand)
}

/** `{ a: 1, 'b': -2 }`: plain keys, primitive literal values – no spread, getter, method, shorthand or computed key. */
function isPrimitiveRecord(node: ts.Expression): boolean {
  const value = unwrapped(node)
  return ts.isObjectLiteralExpression(value) && value.properties.every(property =>
    ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) &&
    isPrimitiveLiteral(property.initializer)
  )
}

/** `Object.freeze({ … })` of a {@link isPrimitiveRecord}, called on the global by name. */
function isFrozenPrimitiveRecord(node: ts.Expression): boolean {
  const value = unwrapped(node)
  if (!ts.isCallExpression(value) || value.arguments.length !== 1 || value.typeArguments !== undefined) return false
  const callee = value.expression
  const isFreeze = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Object' && callee.name.text === 'freeze'
  return isFreeze && isPrimitiveRecord(value.arguments[0])
}

/**
 * Why a module-level `const` initializer is not inert, or `null` when it is:
 * a primitive literal, another binding's name, a function (it runs only when
 * called) or `Object.freeze` of a primitive record. Anything else – a call, a
 * member or element read (a getter could run), a spread, a template, an
 * unfrozen object – runs code on load or leaves state the page's world could
 * change.
 */
function initializerEffectOf(declaration: ts.VariableDeclaration): string | null {
  const name = declaration.name.getText()
  if (!ts.isIdentifier(declaration.name)) return `a module-level value computed by running code (${name})`
  if (declaration.initializer === undefined) return null
  const value = unwrapped(declaration.initializer)
  if (isPrimitiveLiteral(value) || ts.isIdentifier(value) || isFrozenPrimitiveRecord(value)) return null
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return null
  if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) return `a module-level object that is not frozen (${name})`
  return `a module-level value computed by running code (${name})`
}

/** Why a top-level statement is not a plain declaration, or `null` when it is one. */
function loadEffectOf(statement: ts.Statement): string | null {
  if (hasDeclareModifier(statement)) return 'a `declare` statement'
  if (ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return null
  }
  if (!ts.isVariableStatement(statement)) return ts.SyntaxKind[statement.kind]
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return 'a module-level `let` or `var`'
  for (const declaration of statement.declarationList.declarations) {
    const effect = initializerEffectOf(declaration)
    if (effect !== null) return effect
  }
  return null
}

/**
 * The top-level statements of `text` that do something on load or hold state,
 * as `what (line n)`: anything but a function, an interface, a type alias or a
 * `const` of a primitive literal, another name, a function or
 * `Object.freeze({ … })` of primitive literals.
 */
export function loadEffects(fileName: string, text: string): string[] {
  const file = sourceFile(fileName, text)
  return file.statements.flatMap(statement => {
    const effect = loadEffectOf(statement)
    return effect === null ? [] : [`${effect} (line ${lineOf(file, statement)})`]
  })
}
