// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * R-012 – the comments UI uses only design tokens that exist, and the page
 * overlay's theme matches them (docs/designs/html-preview-comments.md §10.2,
 * §12.2; the same approach as `../HtmlPreviewPanel.tokens.test.ts`).
 *
 * Three halves, because the comments UI is drawn in three places:
 *
 * 1. Erfana's own chrome (`CommentWindow.css`, `CommentDrawer.css`, the
 *    Settings section, the toolbar rules in `PreviewNavControls.css`): every
 *    `var(--…)` must be defined, and every pixel literal must carry a
 *    `deviates:` note on the line above (the design system's rule).
 * 2. The overlay theme main hands to the page (`commentOverlayTheme.ts`): the
 *    page cannot read Erfana's CSS, so the values are copied – each beside the
 *    token it copies. The copy must still equal the token.
 * 3. The overlay stylesheet the preload builds (`overlayStyles.ts`): every
 *    length comes from a theme field, and any literal left is a recorded
 *    exception, so a new literal fails here until someone decides what it is.
 *
 * Main and preload sources are read as TEXT: the renderer may not import them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDGE_PX, WINDOW_MAX_HEIGHT_PX, WINDOW_MAX_WIDTH_PX } from './commentPlacement'

const REPO = resolve(__dirname, '../../../../../../..')
const read = (path: string): string => readFileSync(resolve(REPO, path), 'utf8')

const TOKENS_CSS = read('src/renderer/src/styles/design-tokens.css')
const CHROME_CSS: Record<string, string> = {
  'CommentWindow.css': read(
    'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentWindow.css'
  ),
  'CommentDrawer.css': read(
    'src/renderer/src/components/Panels/HtmlPreviewPanel/comments/CommentDrawer.css'
  ),
  'CommentsSection.css': read('src/renderer/src/components/Settings/sections/CommentsSection.css'),
  'PreviewNavControls.css': read(
    'src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewNavControls.css'
  )
}
const THEME_TS = read('src/main/services/preview/comments/commentOverlayTheme.ts')
const OVERLAY_TS = read('src/preload/previewPageComments/overlayStyles.ts')

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every custom property the token sheet defines, with its raw value. */
function definitions(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of withoutComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1], match[2].replace(/\s+/g, ' ').trim())
  }
  return out
}
const DEFINED = definitions(TOKENS_CSS)

/** A token's value with every `var(--…)` in it resolved. */
function resolveToken(name: string, depth = 0): string {
  const raw = DEFINED.get(name)
  if (raw === undefined) throw new Error(`${name} is not defined in design-tokens.css`)
  if (depth > 10) throw new Error(`${name} resolves in a loop`)
  return raw.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_m, inner: string) =>
    resolveToken(inner, depth + 1)
  )
}

describe('R-012 comments tokens', () => {
  describe('placement constants mirror the stylesheet', () => {
    it('EDGE_PX is --space-4 and WINDOW_MAX_WIDTH_PX is --comments-window-max-width', () => {
      expect(resolveToken('--space-4')).toBe(`${EDGE_PX}px`)
      expect(resolveToken('--comments-window-max-width')).toBe(`${WINDOW_MAX_WIDTH_PX}px`)
    })

    it('WINDOW_MAX_HEIGHT_PX is the window rule\'s max-block-size literal', () => {
      expect(withoutComments(CHROME_CSS['CommentWindow.css'])).toContain(
        `max-block-size: min(${WINDOW_MAX_HEIGHT_PX}px,`
      )
    })
  })

  describe('Erfana chrome', () => {
    it.each(Object.keys(CHROME_CSS))('%s references only defined tokens', file => {
      const used = [...withoutComments(CHROME_CSS[file]).matchAll(/var\(\s*(--[\w-]+)/g)].map(
        m => m[1]
      )
      expect(used.length).toBeGreaterThan(0)
      expect(used.filter(name => !DEFINED.has(name))).toEqual([])
    })

    it.each(['CommentWindow.css', 'CommentDrawer.css', 'CommentsSection.css'])(
      '%s has no undocumented pixel literal',
      file => {
        const raw = CHROME_CSS[file].split('\n')
        // Comments blanked line for line, so a number in prose is not a
        // literal and the line above a declaration is still its note.
        const lines = CHROME_CSS[file]
          .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
          .split('\n')
        const offenders: string[] = []
        lines.forEach((code, index) => {
          const line = raw[index]
          // 1px is the visually-hidden pattern's size, not a design value.
          const literals = [...code.matchAll(/(-?\d*\.?\d+)px/g)]
            .map(m => m[1])
            .filter(v => !['0', '1', '-1'].includes(v))
          if (literals.length === 0) return
          if (!(raw[index - 1] ?? '').includes('deviates:'))
            offenders.push(`${index + 1}: ${line.trim()}`)
        })
        expect(offenders).toEqual([])
      }
    )

    it('the comment window and drawer widths come from tokens', () => {
      expect(resolveToken('--comments-window-width')).toBe('360px')
      expect(resolveToken('--comments-window-max-width')).toBe('480px')
      expect(resolveToken('--comments-drawer-width')).toBe('320px')
      expect(withoutComments(CHROME_CSS['CommentWindow.css'])).toContain(
        'var(--comments-window-width)'
      )
      expect(withoutComments(CHROME_CSS['CommentDrawer.css'])).toContain(
        'var(--comments-drawer-width)'
      )
    })
  })

  describe('overlay theme mapping matches design-tokens.css', () => {
    const entries = [
      ...THEME_TS.matchAll(/^\s*(\w+):\s*(['"])(.*?)\2,?\s*\/\/\s*(--[\w-]+)/gm)
    ].map(m => ({
      field: m[1],
      value: m[3],
      token: m[4]
    }))

    it('names a token for every theme field', () => {
      const fields = [
        ...(THEME_TS.match(/interface CommentOverlayTheme \{([\s\S]*?)\}/)?.[1] ?? '').matchAll(
          /readonly (\w+):/g
        )
      ].map(m => m[1])
      expect(fields.length).toBeGreaterThan(0)
      expect(entries.map(e => e.field).sort()).toEqual([...fields].sort())
    })

    it.each([
      'accent',
      'accentHover',
      'ink',
      'paper',
      'muted',
      'warning',
      'font',
      'size',
      'ring',
      'pinTarget',
      'hairline',
      'space1',
      'space2',
      'space4',
      'leading'
    ])('%s equals its token', field => {
      const entry = entries.find(e => e.field === field)
      expect(entry, `${field} has no "// --token" note`).toBeDefined()
      if (!entry) return
      const normalise = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase()
      expect(normalise(entry.value)).toBe(normalise(resolveToken(entry.token)))
    })
  })

  describe('overlay stylesheet literals are theme fields or recorded exceptions', () => {
    /**
     * Literals with no token, and why. Every length the overlay draws comes
     * from a theme field now (hairline, space1/2/4, leading), so a token
     * value typed in as a literal fails here.
     */
    const EXCEPTIONS: Record<string, string> = {
      '1px': 'the visually-hidden live-region box (1 x 1, not a stroke)',
      '12%': 'selected-element fill mix',
      '24%': 'flash fill mix',
      '50%': 'centring and the visually-hidden clip',
      '100%': 'pin SVG fills its button',
      '1.5': 'pin stroke width (SVG user units)',
      '2': 'selected pin stroke width (SVG user units)',
      '1ch': 'label size gap',
      '700': 'pin count weight'
    }

    it('has no literal outside the exceptions', () => {
      const css = OVERLAY_TS.replace(/\$\{[^}]*\}/g, 'X').replace(/\/\*[\s\S]*?\*\//g, '')
      const rules = css.match(/\.erf-hpc[^`]*/g)?.join('\n') ?? ''
      const literals = new Set(
        [...rules.matchAll(/(?<![\w-])(-?\d*\.?\d+)(px|%|ch)?(?![\w-])/g)]
          .map(m => `${m[1]}${m[2] ?? ''}`)
          .filter(v => !['0', '-50%'].includes(v))
      )
      const unknown = [...literals].filter(v => !(v in EXCEPTIONS))
      expect(unknown).toEqual([])
    })
  })
})
