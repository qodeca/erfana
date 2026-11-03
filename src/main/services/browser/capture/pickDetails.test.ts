// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PICK_TEXT_MAX_CHARS, elementText, sourceLine } from './pickDetails'

const hints = (resolvedSource?: { path: string; line?: number }) => ({
  sourceAttributes: [],
  react: null,
  sourceNotFound: resolvedSource === undefined,
  ...(resolvedSource === undefined ? {} : { resolvedSource })
})

describe('elementText', () => {
  it('reads the visible text of the element, white space collapsed', () => {
    expect(elementText('<button class="cta">\n  Save   <b>draft</b>\n</button>')).toBe('Save draft')
  })

  it('drops script, style, template, noscript, svg and comments', () => {
    const html =
      '<div>A<script>alert(1)</script><style>p{}</style><template>T</template><noscript>N</noscript>' +
      '<svg><text>S</text></svg><!-- hidden -->B</div>'
    expect(elementText(html)).toBe('A B')
  })

  it('decodes entities, named and numeric', () => {
    expect(elementText('<p>Fish &amp; chips &lt;3 &#8211; &#x2014; &nbsp;ok &bogus;</p>')).toBe('Fish & chips <3 – — ok &bogus;')
  })

  it('keeps text after the last tag, and text with no tag at all', () => {
    expect(elementText('<b>Total</b> 42 items')).toBe('Total 42 items')
    expect(elementText('plain words')).toBe('plain words')
  })

  it('returns null for an element with no text', () => {
    expect(elementText('<img src="a.png">')).toBeNull()
    expect(elementText('')).toBeNull()
  })

  it('cuts long text at a whole character with an ellipsis', () => {
    const text = elementText(`<p>${'🙂'.repeat(PICK_TEXT_MAX_CHARS + 10)}</p>`)
    expect(text?.endsWith('…')).toBe(true)
    expect(Array.from(text ?? '')).toHaveLength(PICK_TEXT_MAX_CHARS + 1)
  })

  it('survives broken HTML: an unclosed tag, an unclosed comment, an unclosed script', () => {
    expect(elementText('<p>before<span')).toBe('before')
    expect(elementText('<p>x<!-- never closed')).toBe('x')
    expect(elementText('<div>y<script>never closed')).toBe('y')
  })

  it('keeps self-closing skipped tags from swallowing the rest', () => {
    expect(elementText('<div><svg/>after</div>')).toBe('after')
  })
})

describe('sourceLine', () => {
  it('gives path:line for a confirmed source, the path alone without a line', () => {
    expect(sourceLine(hints({ path: 'src/App.tsx', line: 12 }))).toBe('src/App.tsx:12')
    expect(sourceLine(hints({ path: 'src/App.tsx' }))).toBe('src/App.tsx')
  })

  it('gives null when the source was not confirmed in the project', () => {
    expect(sourceLine(hints())).toBeNull()
  })
})
