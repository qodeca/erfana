// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Regenerates the HTML Preview comments v1 fixtures from the real serializer
 * and parser (docs/designs/comments/html-preview-comments.md: G-001–G-003 in §12,
 * X-001 in §16):
 *
 *   - `v1/<case>.block.txt`: the golden serializations of GOLDEN_CASES;
 *   - `v1-compat/<page>.html` and `<page>.expected.json`: the compat pages
 *     (compat.ts) and the parser's reading of each;
 *   - `v1.lock.json`: the SHA-256 of every file in `v1/` and `v1-compat/`;
 *   - `e2e/fixtures/html-preview-corpus/comments/agent-review/*.html`: the
 *     three agent-review pages (agentReview.ts).
 *
 * It then prints the facts agent-review/RUBRIC.md states (rubricFacts.ts);
 * RUBRIC.md itself is edited by hand. With `--examples <dir>` it also writes
 * the examples of docs/html-comments/format-v1.md into `<dir>`.
 *
 * Run from the repository root: `npm run fixtures:html-comments`, which
 * bundles this file with esbuild and runs the bundle with node. With the
 * format unchanged every file comes out byte-identical to the committed one;
 * any diff is a format change, made only on purpose (G-003).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  analyzeCommentDocument,
  applySplice,
  escapeJsonForComment,
  planInsert,
  serializeBlock,
  type CommentData
} from '../../index'
import { ADA, GRACE, VIEW, fixedId, makeComment, makeReply, projectState } from '../commentTestData'
import { GOLDEN_CASES } from '../v1/cases'
import { buildAgentReview } from './agentReview'
import { buildCompat } from './compat'
import { printRubricFacts } from './rubricFacts'

// Repository-relative, resolved against the working directory (npm runs a
// script from the repository root).
const FIXTURES_DIR = 'src/shared/htmlComments/__fixtures__'
const AGENT_REVIEW_DIR = 'e2e/fixtures/html-preview-corpus/comments/agent-review'
const USAGE = 'usage: npm run fixtures:html-comments [-- --examples <dir>]'

const ROOT = repoRoot()
const FIX = join(ROOT, FIXTURES_DIR)

/** The working directory, once it is known to be this repository's root: a stray run writes nothing. */
function repoRoot(): string {
  const root = process.cwd()
  if (!existsSync(join(root, FIXTURES_DIR, 'v1', 'cases.ts'))) {
    throw new Error(`run from the repository root (${USAGE}); the working directory is ${root}`)
  }
  return root
}

/** The `--examples` directory, absolute, or undefined when the option is not given. */
function parseExamplesDir(args: string[]): string | undefined {
  let examples: string | undefined
  try {
    examples = parseArgs({ args, options: { examples: { type: 'string' } } }).values.examples
  } catch (error) {
    console.error(USAGE)
    throw error
  }
  if (examples === undefined) return undefined
  if (examples.trim() === '') throw new Error(`--examples needs a directory; ${USAGE}`)
  return resolve(examples)
}

const esc = (code: number): string => '\\' + 'u' + code.toString(16).padStart(4, '0')
const NON_ASCII = new RegExp('[' + esc(0x7f) + '-' + esc(0xffff) + ']', 'g')

/** JSON with every non-ASCII code unit escaped, so fixture files stay plain ASCII. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(NON_ASCII, (c) => esc(c.charCodeAt(0))) + '\n'
}

/** Writes v1/<case>.block.txt for every golden case (G-001). */
function goldens(): void {
  const dir = join(FIX, 'v1')
  for (const c of GOLDEN_CASES) {
    const result = serializeBlock(c.data, c.layout)
    if (!result.ok) throw new Error(`golden ${c.name}: ${result.reason}`)
    writeFileSync(join(dir, `${c.name}.block.txt`), result.block, 'utf8')
  }
}

/** Writes v1.lock.json: the hash of every file in v1/ and v1-compat/, so run it after both are written (G-003). */
function lock(): void {
  const files: Record<string, string> = {}
  for (const sub of ['v1', 'v1-compat']) {
    for (const name of readdirSync(join(FIX, sub)).sort()) {
      const bytes = readFileSync(join(FIX, sub, name))
      files[`${sub}/${name}`] = createHash('sha256').update(bytes).digest('hex')
    }
  }
  writeFileSync(join(FIX, 'v1.lock.json'), JSON.stringify({ algorithm: 'sha256', files }, null, 2) + '\n')
}

/** Writes the three format-v1.md examples and one escaping sample into `outDir`, for pasting into the spec. */
function examples(outDir: string): void {
  const page =
    '<!doctype html>\n<html lang="en">\n<body>\n  <main>\n    <h1>Pricing</h1>\n    <p>Plans start at <em>10 EUR</em> a month.</p>\n    <button class="cta">Buy now</button>\n  </main>\n</body>\n</html>\n'
  let doc = analyzeCommentDocument(page)
  const button = doc.index.elements.find((e) => e.tag === 'button')!
  const first = planInsert(doc, { targetStart: button.start, data: makeComment(), ws: 'collapse' })
  if (!first.ok) throw new Error(first.reason)
  let text = applySplice(page, first.plan)
  doc = analyzeCommentDocument(text)
  const em = doc.index.elements.find((e) => e.tag === 'em')!
  const midData = makeComment({
    id: fixedId('c-', 77),
    anchor: { tag: 'em', path: 'html > body > main:nth-of-type(1) > p:nth-of-type(1) > em:nth-of-type(1)', quote: { exact: '10 EUR', prefix: 'Plans start at', suffix: 'a month.' } },
    msgs: [{ ...makeComment().msgs[0], id: fixedId('m-', 77), by: GRACE, text: 'Say "9 EUR" here.' }]
  })
  const second = planInsert(doc, { targetStart: em.start, data: midData, ws: 'collapse' })
  if (!second.ok) throw new Error(second.reason)
  text = applySplice(text, second.plan)
  const resolved: CommentData = makeComment({
    id: fixedId('c-', 78),
    status: 'resolved',
    resolved: { by: GRACE, at: '2026-10-27T08:00:00Z' },
    msgs: [makeComment().msgs[0], makeReply(1, 'Agreed, and fix the padding too.'), makeReply(2, 'Done.', ADA)]
  })
  const resolvedBlock = serializeBlock(resolved, { indent: '', eol: '\n' })
  const runtime = makeComment({
    id: fixedId('c-', 79),
    anchor: {
      tag: 'div',
      id: 'deck',
      path: 'html > body > div:nth-of-type(1)',
      runtime: {
        path: 'section:nth-of-type(2) > h2:nth-of-type(1)',
        tag: 'h2',
        quote: { exact: 'Q3 results', prefix: '', suffix: 'Revenue grew' },
        snapshot: '<h2>Q3 results</h2>',
        snapshotSource: 'page'
      }
    },
    view: { ...VIEW, hash: '#2' },
    msgs: [{ ...makeComment().msgs[0], text: 'Rename this slide to "Q3 2026 results".' }]
  })
  const runtimeBlock = serializeBlock(runtime, { indent: '', eol: '\n' })
  if (!resolvedBlock.ok || !runtimeBlock.ok) throw new Error('example serialization failed')
  writeFileSync(join(outDir, 'example-page.html'), text)
  writeFileSync(join(outDir, 'example-resolved.html'), resolvedBlock.block + '\n')
  writeFileSync(join(outDir, 'example-runtime.html'), runtimeBlock.block + '\n')
  writeFileSync(join(outDir, 'example-escape.txt'), escapeJsonForComment('{"text":"a --> b <!-- c & d"}') + '\n')
}

function main(): void {
  const examplesDir = parseExamplesDir(process.argv.slice(2))
  mkdirSync(join(FIX, 'v1'), { recursive: true })
  mkdirSync(join(FIX, 'v1-compat'), { recursive: true })
  goldens()
  buildCompat(join(FIX, 'v1-compat'), (html) => asciiJson(projectState(analyzeCommentDocument(html))))
  lock()
  if (examplesDir !== undefined) {
    mkdirSync(examplesDir, { recursive: true })
    examples(examplesDir)
    console.log(`format-v1.md examples written to ${examplesDir}`)
  }
  const agentReviewDir = join(ROOT, AGENT_REVIEW_DIR)
  buildAgentReview(agentReviewDir)
  console.log(`fixtures written under ${FIXTURES_DIR} and ${AGENT_REVIEW_DIR}`)
  console.log('RUBRIC.md facts (block start line, status, target); compare with agent-review/RUBRIC.md:')
  printRubricFacts(agentReviewDir)
}

main()
