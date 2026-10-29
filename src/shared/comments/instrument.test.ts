// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Element tokens for the served copy (docs/designs/comments/html-preview-comments.md
 * §6, §19 R3-12, R3-13; U-090–U-093).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { BOM, fixedId, seededRandom } from './__fixtures__/commentTestData'
import { attributeOf, indexHtml } from '../htmlComments/htmlIndex'
import {
  ELEMENT_TOKEN_ATTRIBUTE,
  ELEMENT_TOKEN_PATTERN,
  instrumentHtml,
  mintElementToken,
  type InstrumentedHtml
} from '../htmlComments/instrument'

const CONTEXTS = join(__dirname, '__fixtures__', 'contexts')
const fixture = (name: string): string => readFileSync(join(CONTEXTS, name), 'utf8')

const TOKEN_ATTRIBUTE = / data-erfana-el="[a-z2-7]{12}"/g

/** A token source that never repeats: the base32 spelling of a counter. */
function counterTokens(): () => string {
  let n = 0
  return () => {
    n += 1
    return fixedId('c-', n).slice(-12)
  }
}

function instrumented(text: string): InstrumentedHtml {
  const result = instrumentHtml(text, counterTokens())
  if (result.kind !== 'ok') throw new Error(`instrumentHtml: ${result.kind}`)
  return result
}

describe('instrumentHtml', () => {
  it('U-090 every eligible start tag gets one token right after its name, and only those', () => {
    for (const name of ['flow.html', 'tags.html', 'raw-text.html']) {
      const text = fixture(name)
      const index = indexHtml(text)
      const result = instrumented(text)
      expect(result.tokens).toHaveLength(index.elements.length)
      expect(new Set(result.tokens).size).toBe(result.tokens.length)
      expect(result.offsets).toEqual([...index.elements].map(el => el.start).sort((a, b) => a - b))
      for (let i = 0; i < result.offsets.length; i += 1) {
        expect(text[result.offsets[i]], name).toBe('<')
        expect(index.elementAt(result.offsets[i])?.tag).toBe(result.tags[i])
      }
      // The served copy parses to the same tree, each eligible element carrying its own token.
      const served = indexHtml(result.html)
      expect(served.tagSequence).toEqual(index.tagSequence)
      const tagOfToken = new Map(result.tokens.map((token, i) => [token, result.tags[i]]))
      const servedTokens = served.elements.map(el => {
        const token = attributeOf(el.node, ELEMENT_TOKEN_ATTRIBUTE)
        expect(tagOfToken.get(token ?? ''), name).toBe(el.tag)
        return token
      })
      expect(new Set(servedTokens)).toEqual(new Set(result.tokens))
    }
  })

  it('U-090 raw text, attribute values, head and template content get no token', () => {
    const text =
      '<!doctype html><html><head><title>t</title><meta charset="utf-8"></head><body>' +
      '<script>let s = "<b>not a tag</b>"</script><style>a::before{content:"<i>"}</style>' +
      '<textarea><u>text</u></textarea><a title="<em>x</em>" href="#">link</a>' +
      '<template><p>later</p></template><svg><rect/><foreignObject><p>in svg</p></foreignObject></svg><br/>' +
      '</body></html>'
    const result = instrumented(text)
    expect(result.tags).toEqual([
      'body',
      'script',
      'style',
      'textarea',
      'a',
      'template',
      'svg',
      'rect',
      'foreignObject',
      'p',
      'br'
    ])
    expect(result.html).toContain('<rect data-erfana-el="')
    expect(result.html).toMatch(/<br data-erfana-el="[a-z2-7]{12}"\/>/)
    expect(result.html).toContain('<script data-erfana-el=')
    expect(result.html).toContain('let s = "<b>not a tag</b>"')
    expect(result.html).toContain('<template data-erfana-el=')
    expect(result.html).toContain('<p>later</p>')
  })

  it('U-091 a source that already contains the attribute name (any case, anywhere) is not instrumented', () => {
    for (const text of [
      '<p data-erfana-el="aaaaaaaaaaaa">x</p>',
      '<P DATA-ERFANA-EL=x>y</P>',
      '<p>docs mention data-erfana-el</p>',
      '<!-- data-Erfana-El --><p>x</p>'
    ]) {
      expect(instrumentHtml(text, counterTokens())).toEqual({ kind: 'collision' })
    }
  })

  it('U-092 removing the attributes gives the original text back exactly', () => {
    const texts = [
      fixture('flow.html'),
      fixture('tags.html'),
      fixture('raw-text.html'),
      `${BOM}<!doctype html>\r\n<p class=a\r\n   id=b>x</p>\r\n`,
      '<p>unclosed<li>item<table><tr><td>cell',
      '',
      'plain text only'
    ]
    for (const text of texts) {
      const result = instrumented(text)
      expect(result.html.replace(TOKEN_ATTRIBUTE, '')).toBe(text)
      expect(result.html.match(TOKEN_ATTRIBUTE) ?? []).toHaveLength(result.tokens.length)
    }
    expect(instrumented(`${BOM}<p>x</p>`).offsets).toEqual([1])
  })

  it('reuses a parse the caller already has', () => {
    const text = '<main><p>a</p></main>'
    const index = indexHtml(text)
    expect(instrumentHtml(text, counterTokens(), { index })).toEqual(
      instrumentHtml(text, counterTokens())
    )
    expect(instrumentHtml(text, counterTokens(), { index })).toMatchObject({
      kind: 'ok',
      tags: ['main', 'p']
    })
  })

  it('R3-13 more eligible elements than the cap → too-large', () => {
    expect(instrumentHtml('<p>a</p><p>b</p><p>c</p>', counterTokens(), { maxTokens: 2 })).toEqual({
      kind: 'too-large',
      count: 3
    })
    expect(instrumentHtml('<p>a</p><p>b</p>', counterTokens(), { maxTokens: 2 }).kind).toBe('ok')
  })

  it('R3-13 a real document one element over the default cap is too large', () => {
    const cap = PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT
    // The implied body has no start tag, so cap + 1 written elements is one over.
    const text = '<i></i>'.repeat(cap + 1)
    let minted = 0
    const result = instrumentHtml(text, () => {
      minted += 1
      return 'aaaaaaaaaaaa'
    })
    expect(result).toEqual({ kind: 'too-large', count: cap + 1 })
    expect(minted).toBe(0)
  }, 60_000)

  it('a malformed token from the caller is a programming error', () => {
    for (const bad of ['', 'AAAAAAAAAAAA', 'aaaaaaaaaaa1', 'aaaaaaaaaaaaa', 'aaaaaa"aaaaa']) {
      expect(() => instrumentHtml('<p>x</p>', () => bad)).toThrow(TypeError)
    }
  })
})

describe('mintElementToken', () => {
  it('U-093 tokens are 12 base32 characters and do not repeat', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2_000; i += 1) {
      const token = mintElementToken()
      expect(token).toMatch(ELEMENT_TOKEN_PATTERN)
      seen.add(token)
    }
    expect(seen.size).toBe(2_000)
  })

  it('U-093 a given random source gives the same token', () => {
    expect(mintElementToken(seededRandom(7))).toBe(mintElementToken(seededRandom(7)))
    expect(mintElementToken(seededRandom(7))).not.toBe(mintElementToken(seededRandom(8)))
  })
})
