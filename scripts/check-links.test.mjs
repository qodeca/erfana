// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the offline link, anchor and wording check (#138, spec § 3.4).
 *
 * Each test names the break it catches: the change to scripts/check-links.mjs
 * that would make it fail. The trust-boundary tests run the checker against a
 * throw-away repository in the OS temp directory through a recording `fs`, so
 * "no file outside the root was touched" is asserted on the actual calls.
 */

import nodeFs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_FILE_BYTES,
  MAX_LINE_CHARS,
  WORDING_RULES,
  checkRepository,
  classifyTarget,
  collectAnchors,
  findWordingIssues,
  githubSlug,
  headingText,
  inFixedScope,
  listTrackedMarkdown,
  run,
  scanLinks
} from './check-links.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let sandbox
let root
let outside

beforeEach(() => {
  sandbox = nodeFs.realpathSync(nodeFs.mkdtempSync(path.join(os.tmpdir(), 'check-links-')))
  root = path.join(sandbox, 'repo')
  outside = path.join(sandbox, 'outside')
  nodeFs.mkdirSync(root)
  nodeFs.mkdirSync(outside)
  nodeFs.writeFileSync(path.join(outside, 'secret.md'), '# Secret\n')
})

afterEach(() => {
  nodeFs.rmSync(sandbox, { recursive: true, force: true })
})

/** Write files (repository-relative path → content) into the temp repository. */
function write(files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    nodeFs.mkdirSync(path.dirname(abs), { recursive: true })
    nodeFs.writeFileSync(abs, content)
  }
}

/** An `fs` that records every call and the paths it was given. */
function recordingFs() {
  const calls = []
  const api = new Proxy(nodeFs, {
    get(target, key) {
      const value = target[key]
      if (typeof value !== 'function') return value
      return (...args) => {
        calls.push({ fn: key, args })
        return value.apply(target, args)
      }
    }
  })
  return { api, calls }
}

/** Every string argument of a recorded call that lies outside the repository root. */
function callsOutsideRoot(calls) {
  return calls
    .flatMap((c) => c.args.filter((a) => typeof a === 'string').map((a) => ({ fn: c.fn, a })))
    .filter(({ a }) => path.isAbsolute(a) && a !== root && !a.startsWith(root + path.sep))
}

function check(files, options = {}) {
  return checkRepository({ root, files, ...options })
}

const messages = (result) => result.findings.map((f) => `${f.file}:${f.line}: ${f.message}`)

// ---------------------------------------------------------------------------
// Heading slugs
// ---------------------------------------------------------------------------

describe('githubSlug', () => {
  it('drops punctuation – a slug function that keeps `?` breaks #what-happens-next', () => {
    expect(githubSlug('What happens next?')).toBe('what-happens-next')
  })

  it('keeps one hyphen per space – collapsing hyphens breaks #keyboard-shortcuts--implementation-notes', () => {
    expect(githubSlug('Keyboard shortcuts – implementation notes')).toBe('keyboard-shortcuts--implementation-notes')
  })

  it('keeps non-ASCII letters and underscores – an ASCII-only class breaks #diátaxis and #tree_view', () => {
    expect(githubSlug('Diátaxis')).toBe('diátaxis')
    expect(githubSlug('tree_view options')).toBe('tree_view-options')
  })
})

describe('headingText', () => {
  it('keeps code-span content literally – stripping `<string>` as a tag broke docs/api-services.md#createfiledirpath-…-promisestring', () => {
    expect(githubSlug(headingText('`createFile(dirPath: string, fileName: string): Promise<string>`'))).toBe(
      'createfiledirpath-string-filename-string-promisestring'
    )
  })

  it('keeps link text and drops its target, drops images, tags and entities – slugging the raw line breaks every linked heading', () => {
    expect(headingText('See [the guide](../guide.md) now')).toBe('See the guide now')
    expect(headingText('![logo](logo.png) Title')).toBe('Title')
    expect(headingText('Press <kbd>Cmd</kbd>+<kbd>J</kbd>')).toBe('Press Cmd+J')
    expect(headingText('Import &amp; export')).toBe('Import & export')
    expect(headingText('Unknown &foo; entity')).toBe('Unknown &foo; entity')
    expect(headingText('Escaped \\* star')).toBe('Escaped * star')
    expect(headingText('a < b')).toBe('a < b')
    expect(headingText('Unclosed `code')).toBe('Unclosed code')
    expect(headingText('[not a link] here')).toBe('[not a link] here')
  })
})

describe('collectAnchors', () => {
  it('suffixes repeated headings -1, -2 – dropping the counter makes #notes-1 look broken', () => {
    const anchors = collectAnchors('# Notes\n\n## Notes\n\n### Notes\n')
    expect([...anchors]).toEqual(['notes', 'notes-1', 'notes-2'])
  })

  it('reads setext headings – ignoring `===`/`---` underlines makes their anchors look broken', () => {
    const anchors = collectAnchors('Big title\n=========\n\nSmaller\n---\n\n- list item\n---\n')
    expect(anchors.has('big-title')).toBe(true)
    expect(anchors.has('smaller')).toBe(true)
    expect(anchors.has('list-item')).toBe(false)
  })

  it('ignores headings in fenced code, frontmatter and comments – they are not anchors on GitHub', () => {
    const md = '---\ntitle: x\n# not a heading\n---\n\n```sh\n# comment in code\n```\n\n<!--\n# hidden\n-->\n# Real ##\n'
    expect([...collectAnchors(md)]).toEqual(['real'])
  })

  it('accepts explicit id and name attributes – a checker that reads only headings rejects <a id> anchors', () => {
    const anchors = collectAnchors('<a id="custom-spot"></a>\n<h2 name="other">x</h2>\nnot-an-id="z"\n<a id="unterminated\n')
    expect(anchors.has('custom-spot')).toBe(true)
    expect(anchors.has('other')).toBe(true)
    expect(anchors.has('z')).toBe(false)
  })

  it('handles empty and non-heading hash lines', () => {
    const anchors = collectAnchors('#\n#hashtag\n####### seven\n## Trailing#hash\n')
    expect([...anchors]).toEqual(['', 'trailinghash'])
  })

  it('keeps a fence open until a matching closer – closing on a shorter fence exposes code as headings', () => {
    const md = '````md\n```\n# inside\n````\n# Outside\n~~~\n# tilde code\n~~~\n'
    expect([...collectAnchors(md)]).toEqual(['outside'])
  })
})

// ---------------------------------------------------------------------------
// Link scanner
// ---------------------------------------------------------------------------

describe('scanLinks', () => {
  it('finds a link whose text wraps across lines – a per-line scanner misses it', () => {
    const { links } = scanLinks('Read the [research\nnotes](research.md) first.\n')
    expect(links).toEqual([{ line: 2, target: 'research.md', image: false }])
  })

  it('marks images, including an image inside a link – losing the `!` check hides broken images', () => {
    const { links } = scanLinks('![alt](a.png)\n\n[![badge](b.svg)](c.md)\n')
    expect(links).toEqual([
      { line: 1, target: 'a.png', image: true },
      { line: 3, target: 'b.svg', image: true },
      { line: 3, target: 'c.md', image: false }
    ])
  })

  it('skips code spans, fenced code, comments and escapes – scanning them reports links that GitHub does not render', () => {
    const md = [
      'Inline `[x](gone.md)` and ``[y](gone.md)`` spans.',
      '',
      '```md',
      '[z](gone.md)',
      '```',
      '',
      '<!-- [c](gone.md) -->',
      '\\[not](gone.md)',
      '[real](here.md)'
    ].join('\n')
    expect(scanLinks(md).links.map((l) => l.target)).toEqual(['here.md'])
  })

  it('treats an unmatched backtick as literal – swallowing the rest of the paragraph hides its links', () => {
    const { links } = scanLinks('A lone ` backtick, then [a](a.md) and ``` [b](b.md)\n')
    expect(links.map((l) => l.target)).toEqual(['a.md', 'b.md'])
  })

  it('parses angle-bracket destinations, titles and balanced parentheses – a naive `)` search cuts them short', () => {
    const md = "[a](<with space.md>) [b](b.md \"Title\") [c](c_(1).md) [d](d.md 'T') [e](e.md (T)) [f]( f.md )"
    expect(scanLinks(md).links.map((l) => l.target)).toEqual(['with space.md', 'b.md', 'c_(1).md', 'd.md', 'e.md', 'f.md'])
  })

  it('rejects malformed destinations instead of guessing', () => {
    const md = '[a](<unclosed.md) [b](b.md "unclosed title) [c](c.md trailing) [d](d\\)x.md)'
    expect(scanLinks(md).links.map((l) => l.target)).toEqual(['d\\)x.md'])
  })

  it('reads reference definitions but not footnotes or mid-line brackets', () => {
    const md = '[ref]: docs/ref.md "Title"\n   [ang]: <docs/a b.md>\n[^1]: A footnote\ntext [x]: not-a-def.md\n[empty]:\n'
    expect(scanLinks(md).links.map((l) => l.target)).toEqual(['docs/ref.md', 'docs/a b.md'])
  })

  it(`reports and skips lines over ${MAX_LINE_CHARS} characters – scanning them is the ReDoS/size bound`, () => {
    const long = '[x](gone.md)' + 'a'.repeat(MAX_LINE_CHARS)
    const { links, longLines } = scanLinks(`# T\n${long}\n[ok](ok.md)\n`)
    expect(longLines).toEqual([2])
    expect(links.map((l) => l.target)).toEqual(['ok.md'])
  })

  it('stays linear on hostile input – a backtracking scanner stalls here', () => {
    const hostile = ('[' + '`'.repeat(3) + '(').repeat(3000) + '\n'
    const started = Date.now()
    scanLinks(hostile.repeat(3))
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('handles CRLF line endings', () => {
    expect(scanLinks('[a](a.md)\r\n[b](b.md)\r\n').links.map((l) => l.target)).toEqual(['a.md', 'b.md'])
  })
})

// ---------------------------------------------------------------------------
// Target classification (lexical, no fs)
// ---------------------------------------------------------------------------

describe('classifyTarget', () => {
  it('leaves external URLs alone – the check makes no network calls', () => {
    for (const t of ['https://example.org/x', 'http://a', 'mailto:a@example.org', '//cdn.example.org/x']) {
      expect(classifyTarget('docs/a.md', t)).toEqual({ kind: 'external' })
    }
  })

  it('rejects every existence-probe shape – dropping one lets a link stat a path outside the repository', () => {
    const cases = {
      'file:///etc/hosts': 'file: URL',
      '/etc/hosts': 'absolute path',
      'C:/Windows/win.ini': 'absolute path',
      '~/secret.md': 'home-relative path (~)',
      '%2Fetc%2Fhosts': 'absolute path',
      '%7E/secret.md': 'home-relative path (~)',
      '..\\..\\etc\\hosts': 'backslash in link path',
      'a%00.md': 'NUL byte in link path',
      'a%zz.md': 'malformed percent-encoding',
      '%66ile:/etc/hosts': 'encoded URL scheme',
      '../../etc/hosts': 'outside repository',
      '%2e%2e/%2e%2e/etc/hosts': 'outside repository',
      '': 'empty link target'
    }
    for (const [target, reason] of Object.entries(cases)) {
      expect(classifyTarget('docs/a.md', target), target).toEqual({ kind: 'rejected', reason })
    }
  })

  it('resolves relative targets, drops the query and keeps the fragment', () => {
    expect(classifyTarget('docs/a.md', '../README.md?plain=1#top')).toEqual({ kind: 'relative', rel: 'README.md', fragment: 'top' })
    expect(classifyTarget('docs/a.md', 'sub/')).toEqual({ kind: 'relative', rel: 'docs/sub', fragment: null })
    expect(classifyTarget('docs/a.md', '..')).toEqual({ kind: 'relative', rel: '', fragment: null })
    expect(classifyTarget('docs/a.md', '#here')).toEqual({ kind: 'same-file', fragment: 'here' })
    expect(classifyTarget('docs/a.md', '?q#there')).toEqual({ kind: 'same-file', fragment: 'there' })
  })
})

// ---------------------------------------------------------------------------
// Trust boundary, against a real temp repository
// ---------------------------------------------------------------------------

describe('checkRepository – trust boundary', () => {
  it('never touches the file system for a rejected target – removing the lexical outside-root check lets ../../etc/hosts be stat\'ed', () => {
    write({
      'docs/a.md': [
        '[a](../../etc/hosts)',
        '[b](%2e%2e/%2e%2e/%2e%2e/etc/hosts)',
        '[c](/etc/hosts)',
        '[d](file:///etc/hosts)',
        '[e](~/.ssh/id_rsa)',
        `[f](../../outside/secret.md)`
      ].join('\n\n')
    })
    const { api, calls } = recordingFs()
    const result = check(['docs/a.md'], { all: true, fsApi: api })
    expect(result.findings).toHaveLength(6)
    expect(callsOutsideRoot(calls)).toEqual([])
    expect(calls.some((c) => c.args.some((a) => typeof a === 'string' && a.includes('etc')))).toBe(false)
  })

  it('refuses a symlink that leaves the root without looking behind it – following it (realpath/stat) is an existence probe', () => {
    write({ 'docs/a.md': '[in](escape/secret.md)\n\n[gone](escape/missing.md)\n\n[abs](abs-escape/secret.md)\n' })
    nodeFs.symlinkSync('../../outside', path.join(root, 'docs/escape'))
    nodeFs.symlinkSync(outside, path.join(root, 'docs/abs-escape'))
    const { api, calls } = recordingFs()
    const result = check(['docs/a.md'], { all: true, fsApi: api })
    // The same message whether or not the outside file exists: no oracle.
    expect(messages(result)).toEqual([
      'docs/a.md:1: broken link: resolves outside repository (symlink) – escape/secret.md',
      'docs/a.md:3: broken link: resolves outside repository (symlink) – escape/missing.md',
      'docs/a.md:5: broken link: resolves outside repository (symlink) – abs-escape/secret.md'
    ])
    // readlink of the link itself (inside the root) is the only call that names it.
    expect(callsOutsideRoot(calls)).toEqual([])
  })

  it('never reads a scanned file that is a symlink out of the root – reading it would leak outside content into findings', () => {
    nodeFs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'))
    const { api, calls } = recordingFs()
    const result = check(['leak.md'], { all: true, fsApi: api })
    expect(messages(result)).toEqual(['leak.md:0: resolves outside repository (symlink)'])
    expect(calls.filter((c) => c.fn === 'readFileSync')).toEqual([])
  })

  it('follows symlinks that stay inside the root, relative or absolute (by the real root path)', () => {
    write({ 'real/target.md': '# Target\n', 'docs/a.md': '[r](rel-link/target.md#target)\n\n[a](abs-link/target.md)\n\n[f](file-link.md#target)\n' })
    nodeFs.symlinkSync('../real', path.join(root, 'docs/rel-link'))
    nodeFs.symlinkSync(path.join(root, 'real'), path.join(root, 'docs/abs-link'))
    nodeFs.symlinkSync('../real/target.md', path.join(root, 'docs/file-link.md'))
    expect(check(['docs/a.md'], { all: true }).findings).toEqual([])
  })

  it('stops a symlink loop – an unbounded walk never returns', () => {
    write({ 'a.md': '[x](loop/x.md)\n' })
    nodeFs.symlinkSync('loop', path.join(root, 'loop'))
    expect(messages(check(['a.md'], { all: true }))).toEqual(['a.md:1: broken link: too many symlinks – loop/x.md'])
  })

  it('refuses a `..` inside a symlink target that climbs above the root', () => {
    write({ 'a.md': '[x](up/x.md)\n' })
    nodeFs.symlinkSync('..', path.join(root, 'up'))
    expect(messages(check(['a.md'], { all: true }))).toEqual([
      'a.md:1: broken link: resolves outside repository (symlink) – up/x.md'
    ])
  })

  it(`reports and skips a file over ${MAX_FILE_BYTES} bytes – reading it unbounded is the input-size threat`, () => {
    write({ 'docs/user-guide/big.md': '#'.repeat(MAX_FILE_BYTES + 1), 'docs/user-guide/a.md': '[x](big.md#anchor)\n' })
    const { api, calls } = recordingFs()
    const result = check(['docs/user-guide/a.md', 'docs/user-guide/big.md'], { fsApi: api })
    expect(messages(result)).toEqual([
      'docs/user-guide/a.md:1: anchor not checked: target larger than 2 MB – big.md#anchor',
      'docs/user-guide/big.md:0: file larger than 2 MB, skipped'
    ])
    expect(calls.filter((c) => c.fn === 'readFileSync' && String(c.args[0]).endsWith('big.md'))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Link and anchor findings
// ---------------------------------------------------------------------------

describe('checkRepository – links and anchors', () => {
  it('reports a missing target, a missing image and a case mismatch – macOS resolves `Readme.md` but GitHub does not', () => {
    write({ 'README.md': '# Readme\n', 'docs/a.md': '[m](missing.md)\n\n![i](img/none.png)\n\n[c](../Readme.md)\n\n[d](../nodir/x.md)\n' })
    expect(messages(check(['docs/a.md'], { all: true }))).toEqual([
      'docs/a.md:1: broken link: target does not exist – missing.md',
      'docs/a.md:3: broken image: target does not exist – img/none.png',
      'docs/a.md:5: broken link: case differs from the file on disk (README.md) – ../Readme.md',
      'docs/a.md:7: broken link: target does not exist – ../nodir/x.md'
    ])
  })

  it('checks anchors in the target and in the same file – skipping the fragment lets #wrong-heading through', () => {
    write({
      'docs/b.md': '# Big title\n\n## Café menu\n',
      'docs/a.md': [
        '# Local',
        '[ok](b.md#big-title) [ok2](b.md#caf%C3%A9-menu) [self](#local) [top](#)',
        '[bad](b.md#wrong-heading) [badself](#nope) [malformed](b.md#%zz)',
        '[dir](../docs#x) [code](../src/x.ts#L10) [bare](b.md)'
      ].join('\n\n')
    })
    write({ 'src/x.ts': '' })
    expect(messages(check(['docs/a.md'], { all: true }))).toEqual([
      'docs/a.md:5: broken anchor: no heading #wrong-heading in docs/b.md – b.md#wrong-heading',
      'docs/a.md:5: broken anchor: no heading #nope in this file – #nope',
      'docs/a.md:5: broken anchor: no heading #%zz in docs/b.md – b.md#%zz'
    ])
  })

  it('reports an empty target and a scanned path that is a directory', () => {
    write({ 'a.md': '[empty]()\n', 'dir.md/x': '' })
    expect(messages(check(['a.md', 'dir.md'], { all: true }))).toEqual([
      'a.md:1: broken link: empty link target – ',
      'dir.md:0: is a directory'
    ])
  })

  it('reports an over-long line in a scoped file', () => {
    write({ 'docs/user-guide/a.md': `x${'y'.repeat(MAX_LINE_CHARS)}\n` })
    expect(messages(check(['docs/user-guide/a.md']))).toEqual([
      `docs/user-guide/a.md:1: line longer than ${MAX_LINE_CHARS} characters, skipped`
    ])
  })
})

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe('scope', () => {
  it('fixes the default scope – dropping a folded page or the guide folder stops checking it', () => {
    expect(inFixedScope('docs/user-guide/how-to/x.md')).toBe(true)
    expect(inFixedScope('docs/keyboard-shortcuts.md')).toBe(true)
    expect(inFixedScope('CLAUDE.md')).toBe(true)
    expect(inFixedScope('docs/designs/138-user-guide/research.md')).toBe(true)
    expect(inFixedScope('docs/designs/138-user-guide/sub/x.md')).toBe(false)
    expect(inFixedScope('docs/ci.md')).toBe(false)
  })

  it('adds any file that links into docs/user-guide/ and ignores the rest unless --all – else a broken inbound link goes unseen', () => {
    write({
      'docs/user-guide/README.md': '# Guide\n',
      'docs/other.md': '[guide](user-guide/README.md) [bad](missing.md)\n',
      'docs/unrelated.md': '[bad](missing.md)\n',
      'docs/unreadable.md': 'x'
    })
    nodeFs.rmSync(path.join(root, 'docs/unreadable.md'))
    const files = ['docs/other.md', 'docs/unrelated.md', 'docs/unreadable.md', 'docs/user-guide/README.md']
    const scoped = check(files)
    expect(scoped.checked).toEqual(['docs/other.md', 'docs/user-guide/README.md'])
    expect(messages(scoped)).toEqual(['docs/other.md:1: broken link: target does not exist – missing.md'])
    const all = check(files, { all: true })
    expect(all.checked).toEqual(['docs/other.md', 'docs/unrelated.md', 'docs/user-guide/README.md'])
    expect(all.findings).toHaveLength(3)
  })

  it('applies the wording rule inside docs/user-guide/ only – a repo-wide rule would fail design notes that quote the banned phrase', () => {
    write({ 'docs/user-guide/a.md': 'An AI-powered editor.\n', 'docs/b.md': 'An AI-powered editor.\n' })
    expect(messages(check(['docs/user-guide/a.md', 'docs/b.md'], { all: true }))).toEqual([
      'docs/user-guide/a.md:1: wording: "AI-powered" claims built-in AI – Erfana hosts the agent (negate it or reword)'
    ])
  })
})

// ---------------------------------------------------------------------------
// Wording rule
// ---------------------------------------------------------------------------

describe('findWordingIssues', () => {
  const phrases = (text) => findWordingIssues(text).map((i) => i.phrase)

  it.each([
    ['It is an AI-powered editor.', 'AI-powered'],
    ["Ask Erfana's AI to help.", "Erfana's AI"],
    ['Use the AI prompts menu.', 'AI prompts'],
    ['Open the AI assistant.', 'AI assistant'],
    ['Erfana has built-in AI.', 'built-in AI']
  ])('fails the claim %j – deleting its WORDING_RULES entry lets it through', (text, phrase) => {
    expect(phrases(text)).toEqual([phrase])
  })

  it('covers exactly the five phrases of the spec', () => {
    expect(WORDING_RULES.map((r) => r.phrase)).toEqual(['AI-powered', "Erfana's AI", 'AI prompts', 'AI assistant', 'built-in AI'])
  })

  it.each([
    'Erfana has no built-in AI.',
    'Erfana does not have built-in AI.',
    "Erfana doesn't include an AI assistant.",
    'It is not an AI-powered editor.',
    'It is a Markdown workspace without built-in AI.',
    'Erfana never ships built-in AI.',
    'Neither a plugin nor built-in AI is involved.',
    "It isn't an AI-powered editor.",
    "We don't call these AI prompts.",
    'Erfana doesn’t include an AI assistant.',
    'Erfana does not have,\nin any version, built-in AI.'
  ])('passes the negated %j – a rule without the negation window rejects correct wording', (text) => {
    expect(phrases(text)).toEqual([])
  })

  it.each([
    ['It never crashes. It has built-in AI.', 'sentence end .'],
    ['It never crashes! It has built-in AI.', 'sentence end !'],
    ['Does it crash? No; it has built-in AI.', 'sentence end ;'],
    ['Not a toy: it has built-in AI.', 'sentence end :'],
    ['Is it slow? It has built-in AI.', 'sentence end ?'],
    ['It is not slow.\n\nIt has built-in AI', 'paragraph break'],
    ['| Not slow | Has built-in AI |', 'table cell border'],
    ['- Not slow\n- Has built-in AI', 'list item start'],
    ['It is not just an AI-powered editor.', 'not just'],
    ['It is not only an AI-powered editor.', 'not only'],
    ['It is no longer an AI-powered editor.', 'no longer'],
    ['It is not one two three four five six seven eight built-in AI.', 'more than eight words'],
    ['ERFANA HAS BUILT-IN AI.', 'case-insensitive'],
    ['Erfana’s AI writes for you.', 'typographic apostrophe']
  ])('fails %j – the window must stop at a %s', (text) => {
    expect(phrases(text)).toHaveLength(1)
  })

  it('reports the line of the phrase and ignores comments', () => {
    const issues = findWordingIssues('<!-- built-in AI -->\nFine.\n\nSee the\nAI assistant.\n')
    expect(issues).toEqual([{ line: 5, phrase: 'AI assistant' }])
  })

  it('trims quotes and hyphens around words – "\'AI assistant\'" is still the phrase', () => {
    expect(phrases("Call it an 'AI assistant' -- no.")).toEqual(['AI assistant'])
  })
})

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe('run', () => {
  function capture(argv, files) {
    const out = []
    const err = []
    const code = run(argv, { root, listFiles: () => files, log: (l) => out.push(l), error: (l) => err.push(l) })
    return { code, out, err }
  }

  it('exits 1 on a finding in the default scope – exiting 0 would let the gate pass a broken link', () => {
    write({ 'CLAUDE.md': '[x](missing.md)\n' })
    const r = capture([], ['CLAUDE.md'])
    expect(r.code).toBe(1)
    expect(r.err).toEqual([
      'CLAUDE.md:1: broken link: target does not exist – missing.md',
      'check-links: 1 finding(s) in 1 of 1 files in the default scope.'
    ])
  })

  it('exits 0 when clean', () => {
    write({ 'CLAUDE.md': '# Title\n' })
    expect(capture([], ['CLAUDE.md'])).toEqual({
      code: 0,
      out: ['check-links: 1 files in the default scope, no findings.'],
      err: []
    })
  })

  it('warns and exits 0 with --all – failing would break the gate on existing debt elsewhere', () => {
    write({ 'docs/old.md': '[x](missing.md)\n' })
    const r = capture(['--all'], ['docs/old.md'])
    expect(r.code).toBe(0)
    expect(r.out).toEqual([
      'warning: docs/old.md:1: broken link: target does not exist – missing.md',
      'check-links: 1 finding(s) in 1 of 1 files in every tracked Markdown file. Reported as warnings (--all never fails).'
    ])
  })

  it('prints control characters in a link as `?` – echoing them lets a crafted link inject terminal escapes into gate output', () => {
    write({ 'CLAUDE.md': '[x](evil\u001b[2Jname.md)\n' })
    const r = capture([], ['CLAUDE.md'])
    expect(r.err[0]).toBe('CLAUDE.md:1: broken link: target does not exist – evil?[2Jname.md')
  })

  it('refuses an unknown option', () => {
    const r = capture(['--fix'], [])
    expect(r.code).toBe(1)
    expect(r.err[0]).toContain('unknown option --fix')
  })

  it('lists tracked .md files from git only – a directory walk would follow untracked files and symlinked trees', () => {
    write({ 'a.md': '', 'docs/b.md': '', 'c.txt': '', 'untracked.md': '' })
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    git('init', '-q')
    git('add', 'a.md', 'docs/b.md', 'c.txt')
    expect(listTrackedMarkdown(root).sort()).toEqual(['a.md', 'docs/b.md'])
  })
})
