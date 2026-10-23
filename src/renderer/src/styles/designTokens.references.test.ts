// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every `var(--name)` the renderer reads must name a property that exists
 * (issue #82).
 *
 * THE BUG CLASS. An undefined custom property inside a shorthand makes the whole
 * declaration invalid at computed-value time, so every longhand falls back to
 * its initial value: `border: 1px solid var(--color-border)` paints no border at
 * all, not a wrong-coloured one. Type checks, ESLint and jsdom tests (which
 * resolve no custom properties) are all blind to it. `--color-bg-subtle`,
 * `--color-syntax-keyword` and `--color-syntax-number` shipped that way (#45),
 * and so did `--color-border` in the preview chrome (#114).
 * `HtmlPreviewPanel.tokens.test.ts` guarded one panel; this guards them all.
 *
 * What is scanned:
 * - every `.css` file under `src/renderer/` (all of the app's stylesheets live
 *   there), and
 * - every non-test `.ts` / `.tsx` file under `src/renderer/`, read through
 *   TypeScript's parser, for `var(--…)` inside string and template literals
 *   (inline styles, style strings) and for the z-index token names passed as
 *   `zIndex: '--z-…'` to the overlay stack.
 *
 * What counts as defined:
 * - a property declared in `styles/design-tokens.css`, or
 * - a **documented local property** – listed in {@link LOCAL_PROPERTIES} with
 *   the reason it is not a design token – that is also declared in some
 *   scanned stylesheet or set from a script (`style={{ '--x': … }}` or
 *   `style.setProperty('--x', …)`).
 *
 * A literal fallback (`var(--a, 32px)`) does not excuse `--a`: #114 found a
 * property with a fallback that nothing could ever set, so the indirection did
 * nothing. A name built at runtime (`` `var(--${name})` ``) cannot be checked
 * here; none exist today, and the floor assertions below are what would notice
 * the scan going quiet.
 *
 * Limits: stylesheets are read with a regex, as in `cssAudit.ts`, and there is
 * no cascade – a property defined on one element and read on an unrelated one
 * passes.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, RENDERER_SRC, rendererStylesheets, stripComments } from '../test-utils/cssAudit'

/** One source file and where it came from, for failure messages. */
interface Source {
  /** Repo-relative path, forward slashes */
  file: string
  /** Raw text */
  text: string
}

/** One reference to a property, located for the failure message. */
interface Reference {
  /** The custom property read, e.g. `--color-text-muted` */
  token: string
  /** Repo-relative file that reads it */
  file: string
}

/**
 * A custom property that is deliberately NOT a design token.
 *
 * `name` is exact, or a prefix ending in `*`. Adding an entry is the
 * documentation: say where it is set and why it is local.
 */
interface LocalProperty {
  /** `--exact-name` or `--prefix-*` */
  name: string
  /** Why it lives outside `design-tokens.css`, and who sets it */
  why: string
}

/**
 * The ledger of local custom properties.
 *
 * An entry that matches no reference fails the test, so this list cannot rot
 * into a blanket exemption.
 */
const LOCAL_PROPERTIES: readonly LocalProperty[] = [
  {
    name: '--dialog-*',
    why:
      'Dialog.css declares these on .dialog-overlay as aliases of design tokens, so every ' +
      'dialog (CameraDialog.css included) reads one dialog palette.'
  },
  {
    name: '--tree-level',
    why:
      'Set inline per row by ProjectTreeNode and TreePlaceholderRow; ProjectTree.css turns ' +
      'it into indentation with spacing tokens.'
  }
]

/** What one script reads and sets, taken from its syntax tree. */
interface ScriptTokens {
  /** Properties read: `var(--x)` inside any string, and `zIndex: '--z-…'` */
  reads: string[]
  /** Properties set: a `'--x'` style-object key, or `setProperty('--x', …)` */
  sets: Set<string>
}

/**
 * Read a script through TypeScript's parser rather than a regex.
 *
 * Only the CONTENTS of string literals and template-literal text are searched,
 * so a comment that quotes `var(--x)` is never a reference, and a string that
 * contains `/*` cannot hide the code after it – the defect a regex comment
 * stripper had.
 *
 * Also collects the z-index token names handed to the overlay stack as plain
 * strings (`zIndex: '--z-context-menu'`): `readZIndexToken` resolves them at
 * runtime and returns 0 for an undefined name, which silently drops the
 * overlay to the bottom of the Escape order.
 *
 * @param source - The script
 * @returns What it reads and sets
 */
function scanScript(source: Source): ScriptTokens {
  const kind = source.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const tree = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, false, kind)
  const reads: string[] = []
  const sets = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      reads.push(...readsIn(node.text))
    }
    if (ts.isPropertyAssignment(node)) {
      const name = node.name
      if ((ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) && name.text.startsWith('--')) {
        sets.add(name.text)
      }
      if (
        ts.isIdentifier(name) &&
        name.text === 'zIndex' &&
        ts.isStringLiteralLike(node.initializer) &&
        /^--z-[\w-]+$/.test(node.initializer.text)
      ) {
        reads.push(node.initializer.text)
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'setProperty' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.startsWith('--')
    ) {
      sets.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { reads, sets }
}

/**
 * The scripts that read a design token today. Pinned by name, on top of the
 * count floor, so a scan that silently stops seeing one of them fails here.
 */
const KNOWN_TOKEN_READERS = [
  'src/renderer/src/components/Dialog/CameraDialog.tsx',
  'src/renderer/src/components/Dialog/PromptDialog.tsx',
  'src/renderer/src/components/Editor/MarkdownEditorPanel/components/EditorErrorBoundary.tsx',
  'src/renderer/src/providers/search/MonacoSearchProvider.ts',
  'src/renderer/src/utils/gitStatus.logic.ts',
  // These two hand the overlay stack a z-index token name as a string.
  'src/renderer/src/components/ContextMenu/ContextMenu.tsx',
  'src/renderer/src/components/Settings/SettingsOverlay.tsx'
] as const

/**
 * Every custom property a text reads through `var()`, fallbacks included:
 * `var(--a, var(--b))` yields both names.
 *
 * @param text - Comment-free source
 * @returns The property names, in source order, duplicates kept
 */
function readsIn(text: string): string[] {
  return [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
}

/**
 * Every custom property a stylesheet declares.
 *
 * @param css - Comment-free stylesheet text
 * @returns The declared names
 */
function declaredInCss(css: string): Set<string> {
  return new Set([...css.matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)].map((match) => match[1]))
}

/**
 * Whether a ledger entry covers a property name.
 *
 * @param entry - Ledger entry
 * @param token - Property name
 * @returns True for an exact match, or a prefix match on a `*` entry
 */
function covers(entry: LocalProperty, token: string): boolean {
  return entry.name.endsWith('*') ? token.startsWith(entry.name.slice(0, -1)) : entry.name === token
}

/** What the audit found; every list is empty on a healthy tree. */
interface AuditResult {
  /** Read but declared nowhere – the silent-drop defect */
  undefinedRefs: Reference[]
  /** Read, declared locally, but not in the ledger – an undocumented local */
  undocumented: Reference[]
  /** Ledger entries that match no reference */
  stale: string[]
  /** Distinct references seen, for the guard-the-guard floors */
  referenceCount: number
}

/**
 * Hold a set of sources to the rule in this file's header.
 *
 * Pure, so the fixtures below can prove it catches what it claims to.
 *
 * @param input - The token sheet, the stylesheets, the scripts, and the ledger
 * @returns The findings
 */
function auditTokenReferences(input: {
  tokenSheet: string
  stylesheets: readonly Source[]
  scripts: readonly Source[]
  local: readonly LocalProperty[]
}): AuditResult {
  const tokens = declaredInCss(stripComments(input.tokenSheet))
  const localDefinitions = new Set<string>()
  const references: Reference[] = []

  for (const sheet of input.stylesheets) {
    const css = stripComments(sheet.text)
    for (const name of declaredInCss(css)) localDefinitions.add(name)
    for (const token of readsIn(css)) references.push({ token, file: sheet.file })
  }
  for (const script of input.scripts) {
    const { reads, sets } = scanScript(script)
    for (const name of sets) localDefinitions.add(name)
    for (const token of reads) references.push({ token, file: script.file })
  }

  const unique = new Map<string, Reference>()
  for (const ref of references) unique.set(`${ref.token} ${ref.file}`, ref)
  const distinct = [...unique.values()].sort(
    (a, b) => a.token.localeCompare(b.token) || a.file.localeCompare(b.file)
  )

  const undefinedRefs: Reference[] = []
  const undocumented: Reference[] = []
  for (const ref of distinct) {
    if (tokens.has(ref.token)) continue
    if (!localDefinitions.has(ref.token)) {
      undefinedRefs.push(ref)
    } else if (!input.local.some((entry) => covers(entry, ref.token))) {
      undocumented.push(ref)
    }
  }
  const stale = input.local
    .filter((entry) => !distinct.some((ref) => !tokens.has(ref.token) && covers(entry, ref.token)))
    .map((entry) => entry.name)

  return { undefinedRefs, undocumented, stale, referenceCount: distinct.length }
}

/**
 * Every non-test `.ts` / `.tsx` file under the renderer source tree.
 *
 * @returns The scripts, sorted by path so failures are stable
 */
function rendererScripts(): Source[] {
  const out: Source[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Test helpers and fixtures quote token names on purpose.
        if (!['__test__', '__tests__', 'test-utils'].includes(entry.name)) walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push({
          file: relative(REPO_ROOT, full).split('\\').join('/'),
          text: readFileSync(full, 'utf8')
        })
      }
    }
  }
  walk(RENDERER_SRC)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

const TOKEN_SHEET = readFileSync(resolve(RENDERER_SRC, 'styles/design-tokens.css'), 'utf8')

/** Render findings one per line, so a failure names the file to fix. */
function describeRefs(refs: readonly Reference[]): string[] {
  return refs.map((ref) => `${ref.token} in ${ref.file}`)
}

describe('design token references (#82)', () => {
  const stylesheets = rendererStylesheets().map((sheet) => ({ file: sheet.file, text: sheet.css }))
  const scripts = rendererScripts()
  const result = auditTokenReferences({
    tokenSheet: TOKEN_SHEET,
    stylesheets,
    scripts,
    local: LOCAL_PROPERTIES
  })

  it('scans a real tree, so an empty result means something', () => {
    // Guard the guard: "no undefined tokens" is also what a scan that read
    // nothing reports. Floors sit a little under today's counts: 50 sheets,
    // 340 scripts, 1129+ distinct token-and-file references, 199 tokens.
    expect(stylesheets.length).toBeGreaterThanOrEqual(45)
    expect(scripts.length).toBeGreaterThan(300)
    expect(result.referenceCount).toBeGreaterThan(1000)
    expect(declaredInCss(stripComments(TOKEN_SHEET)).size).toBeGreaterThan(180)
  })

  it.each(KNOWN_TOKEN_READERS)('still sees the token reads in %s', (file) => {
    const script = scripts.find((candidate) => candidate.file === file)
    expect(script, `${file} moved or was renamed: update KNOWN_TOKEN_READERS`).toBeDefined()
    expect(scanScript(script as Source).reads.length).toBeGreaterThan(0)
  })

  it('reads no custom property that is defined nowhere', () => {
    expect(
      describeRefs(result.undefinedRefs),
      'These names are declared in no stylesheet and set by no script, so the browser drops ' +
        'the declaration that reads them. Point each at a token in design-tokens.css.'
    ).toEqual([])
  })

  it('reads a non-token property only when the ledger documents it', () => {
    expect(
      describeRefs(result.undocumented),
      'These are defined outside design-tokens.css. Use a design token, or add the property ' +
        'to LOCAL_PROPERTIES in this file with the reason it is local.'
    ).toEqual([])
  })

  it('keeps no stale entry in the local-property ledger', () => {
    expect(result.stale).toEqual([])
  })
})

describe('auditTokenReferences catches what it claims to', () => {
  const tokenSheet = ':root { --color-text: #fff; --space-4: 8px; }'

  it('flags an undefined token in a stylesheet, even behind a fallback', () => {
    const result = auditTokenReferences({
      tokenSheet,
      stylesheets: [
        { file: 'a.css', text: '.a { border: 1px solid var(--color-border); width: var(--w, 4px); }' }
      ],
      scripts: [],
      local: []
    })
    expect(describeRefs(result.undefinedRefs)).toEqual(['--color-border in a.css', '--w in a.css'])
  })

  it('flags an undefined token in an inline style, and reads both names of a nested fallback', () => {
    const result = auditTokenReferences({
      tokenSheet,
      stylesheets: [],
      scripts: [
        {
          file: 'B.tsx',
          text: "<div style={{ color: 'var(--color-nope, var(--color-text))' }} />"
        }
      ],
      local: []
    })
    expect(describeRefs(result.undefinedRefs)).toEqual(['--color-nope in B.tsx'])
  })

  it('ignores token names quoted in comments', () => {
    const result = auditTokenReferences({
      tokenSheet,
      stylesheets: [{ file: 'c.css', text: '/* was var(--color-gone) */ .c { color: var(--color-text); }' }],
      scripts: [{ file: 'C.ts', text: "// var(--color-gone)\n/** var(--also-gone) */\nconst x = 1" }],
      local: []
    })
    expect(result.undefinedRefs).toEqual([])
  })

  it('accepts a documented local property and rejects an undocumented one', () => {
    const input = {
      tokenSheet,
      stylesheets: [
        { file: 'd.css', text: '.d { --d-gap: var(--space-4); gap: var(--d-gap); padding: var(--level); }' }
      ],
      scripts: [{ file: 'D.tsx', text: "<li style={{ '--level': 2 } as React.CSSProperties} />" }]
    }
    const documented = auditTokenReferences({
      ...input,
      local: [
        { name: '--d-*', why: 'fixture' },
        { name: '--level', why: 'fixture' }
      ]
    })
    expect(documented.undefinedRefs).toEqual([])
    expect(documented.undocumented).toEqual([])

    const bare = auditTokenReferences({ ...input, local: [] })
    expect(describeRefs(bare.undocumented)).toEqual(['--d-gap in d.css', '--level in d.css'])
  })

  it('reports a ledger entry that nothing reads', () => {
    const result = auditTokenReferences({
      tokenSheet,
      stylesheets: [{ file: 'e.css', text: '.e { color: var(--color-text); }' }],
      scripts: [],
      local: [{ name: '--retired-*', why: 'fixture' }]
    })
    expect(result.stale).toEqual(['--retired-*'])
  })

  it('is not blinded by a string that contains a comment opener', () => {
    // A regex stripper read `'/*'` as the start of a comment and swallowed
    // everything up to the next `*/`, including this reference.
    const result = auditTokenReferences({
      tokenSheet,
      stylesheets: [],
      scripts: [
        {
          file: 'F.ts',
          text: "const glob = 'src/**/*.md'\nconst colour = 'var(--color-hidden)'\n/* a real comment */"
        }
      ],
      local: []
    })
    expect(describeRefs(result.undefinedRefs)).toEqual(['--color-hidden in F.ts'])
  })

  it('reads template literals too', () => {
    const result = auditTokenReferences({
      tokenSheet,
      stylesheets: [],
      scripts: [{ file: 'G.ts', text: 'const n = 2\nconst s = `calc(var(--space-gone) * ${n})`' }],
      local: []
    })
    expect(describeRefs(result.undefinedRefs)).toEqual(['--space-gone in G.ts'])
  })

  it('flags a z-index token name handed to the overlay stack that does not exist', () => {
    const result = auditTokenReferences({
      tokenSheet: ':root { --z-modal: 1000; }',
      stylesheets: [],
      scripts: [
        {
          file: 'H.tsx',
          text:
            "useOverlayStackEntry(ref, { active: true, zIndex: '--z-modal', onEscape })\n" +
            "useOverlayStackEntry(ref, { active: true, zIndex: '--z-menu-typo', onEscape })"
        }
      ],
      local: []
    })
    expect(describeRefs(result.undefinedRefs)).toEqual(['--z-menu-typo in H.tsx'])
  })
})
