// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Spike for docs/designs/markdown-preview-comments.md §5.4: where can an
 * `erfana:comment` block go in a Markdown file without changing how it renders?
 *
 * Renders each case before and after inserting a block, with the preview's own
 * pipeline (remark-parse, remark-gfm, remark-rehype, rehype-raw, rehype-sanitize),
 * and compares the trees with whitespace collapsed. The block carries a blank
 * line inside its message – the worst case for list items.
 *
 * Run from the repository root: node docs/spikes/markdown-preview-comments/placement-check.mjs
 */
/* global console */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize)

/** A tiny serializer: tags, properties and collapsed text – positions and comments dropped. */
const serialize = (node) => {
  if (node.type === 'text') return node.value.trim().replace(/\s+/g, ' ')
  if (node.type === 'root') return node.children.map(serialize).join('')
  if (node.type !== 'element') return ''
  const props = Object.keys(node.properties || {}).length ? JSON.stringify(node.properties) : ''
  return `<${node.tagName}${props}>${(node.children || []).map(serialize).join('')}</${node.tagName}>`
}
const render = (md) => serialize(pipeline.runSync(pipeline.parse(md)))

/** A v1-shaped block, every line carrying `prefix` (blank lines keep only its non-blank part). */
const block = (prefix) =>
  [
    '<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa',
    'note to agents: written by Erfana.',
    'status: open',
    'target: <li>',
    'comment by A at 2026-10-28T10:00:00Z:',
    '  Fix this.',
    '',
    '  Second paragraph of the message.',
    '@data {"v":1}',
    '-->'
  ]
    .map((line) => (line ? prefix + line : prefix.replace(/ +$/, '')))
    .join('\n')

const B = block
const cases = {
  'before a paragraph': ['Para one.\n\nPara two.\n', 'Para one.\n\n' + B('') + '\nPara two.\n'],
  'between two lines of one paragraph': ['Para one.\nstill one.\n', 'Para one.\n' + B('') + '\nstill one.\n'],
  'directly after a heading, no blank line': ['# H\ntext\n', '# H\n' + B('') + '\ntext\n'],
  'before a setext heading': ['Title\n=====\n', B('') + '\nTitle\n=====\n'],
  'before a code fence': ['```js\nx\n```\n', B('') + '\n```js\nx\n```\n'],
  'before a thematic break': ['x\n\n---\n', 'x\n\n' + B('') + '\n---\n'],
  'before a raw-HTML block': ['x\n\n<div>y</div>\n', 'x\n\n' + B('') + '\n<div>y</div>\n'],
  'before a whole list': ['- a\n- b\n', B('') + '\n- a\n- b\n'],
  'before list item 2 at column 0': ['- a\n- b\n- c\n', '- a\n' + B('') + '\n- b\n- c\n'],
  'after item 1, indented to its content': ['- a\n- b\n- c\n', '- a\n' + B('  ') + '\n- b\n- c\n'],
  'ordered: after item 1, indented 3': ['1. a\n2. b\n', '1. a\n' + B('   ') + '\n2. b\n'],
  'task list: after item 1': ['- [ ] a\n- [x] b\n', '- [ ] a\n' + B('  ') + '\n- [x] b\n'],
  'nested: after child item 1': ['- a\n  - a1\n  - a2\n- b\n', '- a\n  - a1\n' + B('    ') + '\n  - a2\n- b\n'],
  'loose list: after item 1': ['- a\n\n- b\n', '- a\n' + B('  ') + '\n\n- b\n'],
  'second paragraph inside an item': ['- a\n\n  more\n- b\n', '- a\n\n' + B('  ') + '\n  more\n- b\n'],
  'paragraph after a list': ['- a\n\npara\n', '- a\n\n' + B('') + '\npara\n'],
  'before a whole table': ['Intro\n\n| h |\n|---|\n| 1 |\n', 'Intro\n\n' + B('') + '\n| h |\n|---|\n| 1 |\n'],
  'before table row 2': ['| h |\n|---|\n| 1 |\n| 2 |\n', '| h |\n|---|\n| 1 |\n' + B('') + '\n| 2 |\n'],
  'before a whole block quote': ['> q1\n>\n> q2\n', B('') + '\n> q1\n>\n> q2\n'],
  'inside a block quote, prefixed "> "': ['> q1\n>\n> q2\n', '> q1\n>\n' + B('> ') + '\n> q2\n']
}

let changed = 0
for (const [name, [before, after]] of Object.entries(cases)) {
  const a = render(before)
  const b = render(after)
  if (a === b) {
    console.log(`same     ${name}`)
  } else {
    changed += 1
    console.log(`CHANGED  ${name}\n         before: ${a}\n         after:  ${b}`)
  }
}
console.log(`\n${Object.keys(cases).length} cases, ${changed} changed`)
