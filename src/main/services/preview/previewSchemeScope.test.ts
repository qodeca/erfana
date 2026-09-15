// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scheme-scope tripwire (issue #124 WI-13; design part 2 §2.1, design §8 "CSP").
 *
 * Preview responses carry no `frame-ancestors`: no value admits an opaque,
 * sandboxed parent without admitting every parent (spike S2). That is safe ONLY
 * while `erfana-preview:` is handled on the preview partition sessions – never
 * on the global `protocol` or the default session – because then the only
 * documents that can frame a preview page are preview pages, and Erfana writes
 * their `frame-src`. This test scans the production sources under `src/main`
 * and fails as soon as that stops being true.
 *
 * It is a SYNTACTIC scan (the TypeScript parser, no type checker), so it is
 * conservative wherever it cannot resolve a value: a handler call on a protocol
 * object whose scheme it cannot prove to be another scheme counts as handling
 * the preview scheme. The scanner is tested on its own first, so a scan that
 * silently found nothing could not pass. What it cannot see – a protocol object
 * and its scheme BOTH passed through aliases, or a handler reached through
 * `Reflect` – stays a review item.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const MAIN_ROOT = resolve(__dirname, '..', '..')
const REPO_ROOT = resolve(MAIN_ROOT, '..', '..')

const PREVIEW_SCHEME = 'erfana-preview'

/** The one sanctioned site, and the only module allowed to reach it. */
const HANDLER_FILE = 'src/main/services/preview/PreviewProtocolHandler.ts'
const FACTORY_FILE = 'src/main/services/preview/PreviewSessionFactory.ts'
const HANDLER_MODULE = /(?:^|\/)PreviewProtocolHandler(?:\.[cm]?[jt]s)?$/

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const NON_PRODUCTION_DIR = /(?:^|[\\/])__(?:tests|mocks|fixtures)__[\\/]/

/** Electron's legacy and intercept APIs: a scheme handler whatever the receiver. */
const PROTOCOL_ONLY_METHODS = new Set([
  'registerFileProtocol',
  'registerBufferProtocol',
  'registerStringProtocol',
  'registerHttpProtocol',
  'registerStreamProtocol',
  'interceptFileProtocol',
  'interceptBufferProtocol',
  'interceptStringProtocol',
  'interceptHttpProtocol',
  'interceptStreamProtocol'
])
/** `protocol.handle` – also `ipcMain.handle`, so the receiver decides. */
const HANDLE = 'handle'

const SCOPE_MESSAGE = [
  'erfana-preview must be handled only by attach() in PreviewProtocolHandler.ts, on the',
  'preview partition session it is given. Preview responses carry no frame-ancestors',
  '(issue #124, spike S2), so a handler on the global protocol or the default session',
  'would let a non-preview document frame preview pages. A handler call whose scheme',
  'the scan cannot resolve counts too: name another scheme with a string literal or a',
  'same-file const.'
].join(' ')

/** A site that installs, or may install, a handler for the preview scheme. */
interface SchemeSite {
  readonly file: string
  readonly receiver: string
  readonly method: string
  readonly form: 'call' | 'reference' | 'destructure'
}

type SchemeArg = 'preview' | 'other' | 'unknown'

function parse(file: string, text: string): ts.SourceFile {
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/** Every node under `root`, depth first. */
function nodesOf(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    nodes.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return nodes
}

/** Strip parentheses, `as`, `satisfies`, `!` and `<T>` casts. */
function unwrap(node: ts.Expression): ts.Expression {
  let inner = node
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isTypeAssertionExpression(inner)
  ) {
    inner = inner.expression
  }
  return inner
}

function literalText(node: ts.Expression): string | undefined {
  const inner = unwrap(node)
  return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)
    ? inner.text
    : undefined
}

/** The last name in `x`, `a.x` or `a['x']`. */
function lastName(node: ts.Expression): string | undefined {
  const inner = unwrap(node)
  if (ts.isIdentifier(inner)) return inner.text
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text
  if (ts.isElementAccessExpression(inner)) return literalText(inner.argumentExpression)
  return undefined
}

function isProtocolLike(receiver: ts.Expression): boolean {
  return /protocol$/i.test(lastName(receiver) ?? '')
}

/**
 * Names bound exactly once in the file, to a `const` string literal. A name
 * bound twice, or bound any other way (a `let`, a parameter, a destructured
 * name), maps to `null`: the scan does not trust it.
 */
function constStrings(source: ts.SourceFile): Map<string, string | null> {
  const bound = new Map<string, string | null>()
  for (const node of nodesOf(source)) {
    let name: string | undefined
    let value: string | null = null
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      name = node.name.text
      const isConst =
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0
      value = isConst && node.initializer ? (literalText(node.initializer) ?? null) : null
    } else if ((ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
      name = node.name.text
    }
    if (name !== undefined) bound.set(name, bound.has(name) ? null : value)
  }
  return bound
}

function schemeOf(
  arg: ts.Expression | undefined,
  consts: ReadonlyMap<string, string | null>
): SchemeArg {
  if (arg === undefined) return 'unknown'
  const inner = unwrap(arg)
  if (lastName(inner) === 'PREVIEW_SCHEME') return 'preview'
  const value = literalText(inner) ?? (ts.isIdentifier(inner) ? consts.get(inner.text) : undefined)
  if (value === undefined || value === null) return 'unknown'
  return value.toLowerCase().replace(/:$/, '') === PREVIEW_SCHEME ? 'preview' : 'other'
}

/** `x.handle`, `x['registerFileProtocol']` and the like, called or not. */
function siteOfMember(
  node: ts.Node,
  consts: ReadonlyMap<string, string | null>
): Omit<SchemeSite, 'file'> | undefined {
  let receiver: ts.Expression
  let method: string | undefined
  if (ts.isPropertyAccessExpression(node)) {
    receiver = node.expression
    method = node.name.text
  } else if (ts.isElementAccessExpression(node)) {
    receiver = node.expression
    method = literalText(node.argumentExpression)
  } else {
    return undefined
  }
  if (method === undefined || (method !== HANDLE && !PROTOCOL_ONLY_METHODS.has(method))) {
    return undefined
  }
  const parent = node.parent
  const call = ts.isCallExpression(parent) && parent.expression === node ? parent : undefined
  const scheme = call === undefined ? 'unknown' : schemeOf(call.arguments[0], consts)
  // On a protocol object anything not provably another scheme counts; a
  // `handle` elsewhere (it is also `ipcMain.handle`) counts only when it is
  // called with the preview scheme itself.
  const onProtocol = PROTOCOL_ONLY_METHODS.has(method) || isProtocolLike(receiver)
  const counts = onProtocol ? scheme !== 'other' : scheme === 'preview'
  if (!counts) return undefined
  return { receiver: receiver.getText(), method, form: call === undefined ? 'reference' : 'call' }
}

/** `const { handle } = session.protocol` and the like. */
function siteOfBinding(node: ts.Node): Omit<SchemeSite, 'file'> | undefined {
  if (!ts.isBindingElement(node) || !ts.isObjectBindingPattern(node.parent)) return undefined
  const key = node.propertyName ?? node.name
  const method = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined
  const declaration = node.parent.parent
  const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined
  const fromProtocol = initializer !== undefined && isProtocolLike(initializer)
  if (
    method === undefined ||
    !(PROTOCOL_ONLY_METHODS.has(method) || (method === HANDLE && fromProtocol))
  ) {
    return undefined
  }
  return { receiver: initializer?.getText() ?? '(parameter)', method, form: 'destructure' }
}

function scanSource(file: string, source: ts.SourceFile): SchemeSite[] {
  const consts = constStrings(source)
  const sites: SchemeSite[] = []
  for (const node of nodesOf(source)) {
    const site = siteOfMember(node, consts) ?? siteOfBinding(node)
    if (site !== undefined) sites.push({ file, ...site })
  }
  return sites
}

function scanCode(code: string): SchemeSite[] {
  return scanSource('virtual.ts', parse('virtual.ts', code))
}

function isHandlerModule(specifier: ts.Expression): boolean {
  const text = literalText(specifier)
  return text !== undefined && HANDLER_MODULE.test(text)
}

/** Whether a file can reach the handler's `attach` at run time (a type import cannot). */
function importsAttach(source: ts.SourceFile): boolean {
  const namesAttach = (elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]): boolean =>
    elements.some(el => !el.isTypeOnly && (el.propertyName ?? el.name).text === 'attach')
  return nodesOf(source).some(node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (!isHandlerModule(node.moduleSpecifier) || clause === undefined || clause.isTypeOnly) {
        return false
      }
      if (clause.name !== undefined) return true
      const bindings = clause.namedBindings
      if (bindings === undefined) return false
      return ts.isNamespaceImport(bindings) || namesAttach(bindings.elements)
    }
    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier
      if (specifier === undefined || !isHandlerModule(specifier) || node.isTypeOnly) return false
      const clause = node.exportClause
      return clause === undefined || ts.isNamespaceExport(clause) || namesAttach(clause.elements)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const loads =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require')
      const [first] = node.arguments
      return loads && first !== undefined && isHandlerModule(first)
    }
    return false
  })
}

function namesImportedFrom(source: ts.SourceFile, module: string): string[] {
  return source.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || literalText(statement.moduleSpecifier) !== module) {
      return []
    }
    const bindings = statement.importClause?.namedBindings
    return bindings !== undefined && ts.isNamedImports(bindings)
      ? bindings.elements.map(el => el.name.text)
      : []
  })
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current
  }
  return undefined
}

interface MainSource {
  readonly file: string
  readonly source: ts.SourceFile
}

let mainSourcesCache: readonly MainSource[] | undefined

/** Every production source under `src/main`, parsed once, with a repo-relative POSIX path. */
function mainSources(): readonly MainSource[] {
  mainSourcesCache ??= readdirSync(MAIN_ROOT, { recursive: true, encoding: 'utf8' })
    .filter(rel => SOURCE_FILE.test(rel) && !TEST_FILE.test(rel) && !NON_PRODUCTION_DIR.test(rel))
    .map(rel => join(MAIN_ROOT, rel))
    .filter(abs => statSync(abs).isFile())
    .map(abs => {
      const file = relative(REPO_ROOT, abs).split(sep).join('/')
      return { file, source: parse(file, readFileSync(abs, 'utf8')) }
    })
  return mainSourcesCache
}

function mainSource(file: string): ts.SourceFile {
  const found = mainSources().find(entry => entry.file === file)
  if (found === undefined) throw new Error(`${file} is not among the scanned sources`)
  return found.source
}

const COUNTED: ReadonlyArray<readonly [string, string]> = [
  ['the global protocol with the literal scheme', "protocol.handle('erfana-preview', h)"],
  [
    'the default session with the constant',
    'session.defaultSession.protocol.handle(PREVIEW_SCHEME, h)'
  ],
  [
    'an unresolved scheme on a protocol object',
    'function f(s: string) { ses.protocol.handle(s, h) }'
  ],
  ['a legacy register API on any receiver', 'anything.registerFileProtocol(scheme, h)'],
  [
    'an intercept API with the scheme',
    "electron.protocol.interceptStreamProtocol('erfana-preview', h)"
  ],
  ['element access', "protocol['handle'](PREVIEW_SCHEME, h)"],
  ['an aliased protocol object with the constant', 'p.handle(PREVIEW_SCHEME, h)'],
  [
    'an aliased protocol object with a same-file const',
    "const S = 'erfana-preview'\np.handle(S, h)"
  ],
  ['the scheme in capitals with a colon', "protocol.handle('Erfana-Preview:', h)"],
  [
    'a const shadowed by a parameter',
    "const S = 'app'\nfunction f(S: string) { protocol.handle(S, h) }"
  ],
  ['a let, which can be reassigned', "let S = 'app'\nprotocol.handle(S, h)"],
  ['a template with a substitution', 'protocol.handle(`${prefix}-preview`, h)'],
  ['a detached method reference', 'const bound = session.protocol.handle.bind(session.protocol)'],
  ['a destructured handle', 'const { handle } = session.protocol']
]

const IGNORED: ReadonlyArray<readonly [string, string]> = [
  ['an IPC handler with a literal channel', "ipcMain.handle('preview:open', h)"],
  [
    'an IPC handler with a variable channel',
    'function r(channel: string) { ipcMain.handle(channel, h) }'
  ],
  ['another scheme as a literal', "protocol.handle('app', h)"],
  ['another scheme as a same-file const', "const APP = 'app'\nprotocol.handle(APP, h)"],
  ['unhandle', 'session.protocol.unhandle(PREVIEW_SCHEME)'],
  ['a comment', '// protocol.handle(PREVIEW_SCHEME, h)'],
  ['a string', "const doc = 'protocol.handle(PREVIEW_SCHEME, h)'"],
  ['registering privileges', 'protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_SCHEME }])']
]

const ATTACH_IMPORTS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['a named import', "import { attach } from './PreviewProtocolHandler'", true],
  ['a renamed import', "import { attach as a } from '../preview/PreviewProtocolHandler'", true],
  ['a namespace import', "import * as handler from './PreviewProtocolHandler'", true],
  ['a re-export', "export { attach } from './PreviewProtocolHandler'", true],
  ['a star re-export', "export * from './PreviewProtocolHandler'", true],
  ['a dynamic import', "async function f() { return import('./PreviewProtocolHandler') }", true],
  ['a require', "const m = require('./PreviewProtocolHandler')", true],
  [
    'a type-only import',
    "import type { PreviewProtocolContext } from './PreviewProtocolHandler'",
    false
  ],
  ['other exports', "import { createConcurrencyLimiter } from './PreviewProtocolHandler'", false],
  ['attach from another module', "import { attach } from './PreviewRequestFilter'", false]
]

describe('previewSchemeScope – the scanner', () => {
  it.each(COUNTED)('counts %s', (_label, code) => {
    expect(scanCode(code)).toHaveLength(1)
  })

  it.each(IGNORED)('ignores %s', (_label, code) => {
    expect(scanCode(code)).toEqual([])
  })

  it('reports the file, the receiver, the method and the form', () => {
    expect(scanCode('session.defaultSession.protocol.handle(PREVIEW_SCHEME, h)')).toEqual([
      {
        file: 'virtual.ts',
        receiver: 'session.defaultSession.protocol',
        method: 'handle',
        form: 'call'
      }
    ])
    expect(scanCode('const { handle } = session.protocol')[0]?.form).toBe('destructure')
    expect(scanCode('const f = session.protocol.handle.bind(session.protocol)')[0]?.form).toBe(
      'reference'
    )
  })

  it.each(ATTACH_IMPORTS)('sees whether %s reaches attach()', (_label, code, expected) => {
    expect(importsAttach(parse('virtual.ts', code))).toBe(expected)
  })
})

describe('previewSchemeScope – src/main', () => {
  it('scans the real production tree (no vacuous pass)', () => {
    const files = mainSources().map(entry => entry.file)
    expect(files.length).toBeGreaterThan(100)
    expect(files).toEqual(expect.arrayContaining([HANDLER_FILE, FACTORY_FILE]))
    expect(files.filter(file => TEST_FILE.test(file))).toEqual([])
  })

  it('handles the preview scheme at exactly one site: session.protocol.handle in the handler', () => {
    const sites = mainSources().flatMap(({ file, source }) => scanSource(file, source))
    expect(sites, SCOPE_MESSAGE).toEqual([
      { file: HANDLER_FILE, receiver: 'session.protocol', method: HANDLE, form: 'call' }
    ])
  })

  it("that site is attach()'s own electron Session parameter, never reassigned", () => {
    const source = mainSource(HANDLER_FILE)
    const calls = nodesOf(source).filter(
      (node): node is ts.CallExpression =>
        ts.isCallExpression(node) && node.expression.getText() === 'session.protocol.handle'
    )
    expect(calls).toHaveLength(1)
    const [call] = calls
    const attach = call === undefined ? undefined : enclosingFunction(call)
    if (attach === undefined || !ts.isFunctionDeclaration(attach)) {
      throw new Error('session.protocol.handle must be called directly inside attach()')
    }
    expect(attach.name?.text).toBe('attach')
    expect(attach.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true)
    const [first] = attach.parameters
    expect(first?.name.getText()).toBe('session')
    expect(first?.type?.getText()).toBe('Session')
    expect(namesImportedFrom(source, 'electron')).toContain('Session')
    const reassigned = nodesOf(attach).some(
      node =>
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isIdentifier(node.left) &&
        node.left.text === 'session'
    )
    expect(reassigned).toBe(false)
  })

  it('only the session factory can reach attach(), so the handler lands on a preview partition', () => {
    const importers = mainSources()
      .filter(({ source }) => importsAttach(source))
      .map(({ file }) => file)
    expect(importers, SCOPE_MESSAGE).toEqual([FACTORY_FILE])
  })

  it('neither the handler nor the factory names the default session; the factory builds partitions', () => {
    for (const file of [HANDLER_FILE, FACTORY_FILE]) {
      const names = nodesOf(mainSource(file))
        .filter(ts.isIdentifier)
        .map(id => id.text)
      expect(names, `${file} must not use session.defaultSession`).not.toContain('defaultSession')
    }
    const called = nodesOf(mainSource(FACTORY_FILE))
      .filter(ts.isCallExpression)
      .map(call => lastName(call.expression))
    expect(called).toContain('fromPartition')
  })
})
