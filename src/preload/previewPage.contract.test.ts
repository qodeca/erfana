// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Source-level contract for the preview-page preload (sd-074b §5.1; HTML
 * Preview comments, docs/designs/comments/html-preview-comments.md §9.2, SEC-01, SEC-02;
 * docs/adrs/0005-sub-frame-preload-one-receive-channel.md).
 *
 * This preload runs inside the sealed page's process, so what it does NOT do is
 * the security property worth pinning. Asserted against the source rather than
 * the bundle so it fails in unit tests, before a build.
 *
 * REVISITED ON PURPOSE for HTML Preview comments. The preload used to be
 * send-only; it now has exactly ONE receive path – `ipcRenderer.on` for the
 * literal `preview-page:commentState`, in `previewPageComments/index.ts` – and
 * runs in sub-frames too. The rules below therefore read BOTH preload sources
 * (`previewPage.ts` and every module of `previewPageComments/`), and "never
 * listens" became "listens on that one literal and nothing else". Widening any
 * rule here changes the sealed box's security posture and needs the same
 * deliberate review.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

import {
  PREVIEW_PAGE_LINK_CHANNEL,
  PREVIEW_PAGE_LINK_NOTE_CHANNEL
} from '../main/services/preview/previewLinkBridge'
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from '../main/services/preview/previewCspViolationBridge'
import { PreviewCommentPageChannels } from '../shared/ipc/preview-comment-channels'

/**
 * The source with comments removed.
 *
 * The contract is about what the CODE does; the file's own documentation
 * explains why it avoids `contextBridge` and `preventDefault`, and matching
 * those words in prose would fail the very test that documents them.
 *
 * Comments are found by the TypeScript parser, never by a regex: a `//`
 * inside a string (`'http://…'`) or a regex literal is code, and a regex
 * stripper would cut the rest of that line – and with it whatever banned call
 * followed it. Each comment becomes one space (a line comment keeps its line
 * break, so `^import` rules still see line starts).
 */
function code(raw: string): string {
  const file = ts.createSourceFile('preload.ts', raw, ts.ScriptTarget.Latest, true)
  const comments = new Map<number, number>()
  const collect = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) comments.set(range.pos, range.end)
  }
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(raw, node.getFullStart()))
    collect(ts.getTrailingCommentRanges(raw, node.getEnd()))
    for (const child of node.getChildren(file)) visit(child)
  }
  visit(file)
  let out = ''
  let at = 0
  for (const [pos, end] of [...comments].sort(([a], [b]) => a - b)) {
    if (pos < at) continue
    out += raw.slice(at, pos) + ' '
    at = end
  }
  return out + raw.slice(at)
}

const RAW = readFileSync(join(__dirname, 'previewPage.ts'), 'utf8')

/** `previewPage.ts` alone: the link and CSP reporter. */
const SOURCE = code(RAW)

const COMMENTS_DIR = join(__dirname, 'previewPageComments')

/** Every non-test module of the comment overlay, by file name. */
const COMMENT_SOURCES: ReadonlyMap<string, string> = new Map(
  readdirSync(COMMENTS_DIR)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => [name, code(readFileSync(join(COMMENTS_DIR, name), 'utf8'))])
)

/** Both preload sources as one text. */
const ALL = [SOURCE, ...COMMENT_SOURCES.values()].join('\n')

describe('previewPage preload contract', () => {
  /**
   * The channel name exists TWICE on purpose: the preload must stay
   * self-contained, because `electron.vite.config.ts` fails the build if two
   * preload entries share a module by value (#73). Nothing else pins the two
   * copies together, and a drift between them makes every preview link go inert
   * with no error anywhere — silence being the exact failure this feature was
   * built to remove (lens review F31).
   *
   * A value import is fine HERE: the build constraint applies to the preload
   * bundle, not to its test.
   */
  it('inlines the same channel name the main process listens on', () => {
    expect(SOURCE).toContain(`'${PREVIEW_PAGE_LINK_CHANNEL}'`)
  })

  it('inlines the same link-note channel name main listens on', () => {
    // Drift here leaves links working but racing again: main would never hear
    // a click is coming, so a page busy for a moment after the click loses its
    // `will-navigate` race, and an external link shows "Blocked link" instead
    // of asking.
    expect(SOURCE).toContain(`'${PREVIEW_PAGE_LINK_NOTE_CHANNEL}'`)
  })

  it('inlines the same CSP-violation channel name main listens on', () => {
    // Same drift risk as the link channel above, and the same build reason for
    // duplicating the string. Drift here is worse than inert links: a host the
    // page's CSP refused would never be reported, so it could never be
    // approved — and on a project with an empty allowlist that is EVERY remote
    // host, silently.
    expect(SOURCE).toContain(`'${PREVIEW_PAGE_CSP_VIOLATION_CHANNEL}'`)
  })

  it('reports CSP violations, and only genuine ones', () => {
    // `isTrusted` is the whole guard against a page calling `dispatchEvent` to
    // make Erfana prompt for a host it never referenced.
    expect(SOURCE).toContain('securitypolicyviolation')
    expect(SOURCE).toMatch(/if \(!event\.isTrusted\) return/)
  })

  it('listens for violations in the capture phase', () => {
    // Bubble phase would let a page listener call `stopPropagation()` and hide
    // its own remote hosts from Erfana. The link listeners are deliberately
    // bubble-phase (the page's own handlers must win); this one is not, and the
    // difference is easy to "tidy" away.
    expect(SOURCE).toMatch(
      /addEventListener\(\s*'securitypolicyviolation'\s*,\s*\w+\s*,\s*true\s*\)/
    )
  })

  it('SEC-01 exposes nothing to the page — no contextBridge, in either source', () => {
    expect(COMMENT_SOURCES.size).toBeGreaterThan(5)
    expect(ALL).not.toContain('contextBridge')
  })

  it('SEC-01 does not reach into the frame API or message other frames', () => {
    expect(ALL).not.toContain('webFrame')
    expect(ALL).not.toContain('postMessage')
  })

  it('SEC-01 never invokes main and never sends synchronously', () => {
    // An `invoke` would let the page wait on main's answer: a two-way bridge.
    expect(ALL).not.toContain('.invoke(')
    expect(ALL).not.toContain('sendSync')
    expect(SOURCE).toContain('ipcRenderer.send')
  })

  it('SEC-01 the link and CSP reporter itself stays send-only', () => {
    // The one receive path lives in the comment overlay, not here.
    expect(SOURCE).not.toContain('ipcRenderer.on')
    expect(SOURCE).not.toContain('.on(')
  })

  it('SEC-01 listens to main on exactly one channel, named by its literal', () => {
    // Any `.on(` / `.once(` / `.addListener(` in either source: exactly one,
    // and it is this one. A listener on a constant, a template or a second
    // channel fails here and needs a deliberate review (ADR 0005).
    const listeners = ALL.match(/\.(on|once|addListener|prependListener|prependOnceListener)\(/g) ?? []
    expect(listeners).toEqual(['.on('])
    expect(COMMENT_SOURCES.get('index.ts')).toContain(
      `ipcRenderer.on('${PreviewCommentPageChannels.STATE}', `
    )
  })

  it('SEC-01 never writes markup or styles into the page', () => {
    // The overlay draws in its own closed shadow root through constructable
    // sheets and `element.style` only: no parser, no <style> a page CSP or
    // selector could reach (§19 R3-7).
    for (const banned of ['innerHTML =', 'outerHTML =', 'insertAdjacentHTML', "setAttribute('style'", "createElement('style')", 'document.write']) {
      expect(ALL, banned).not.toContain(banned)
    }
  })

  it('reports the href attribute as written, beside the resolved href', () => {
    // Main needs the attribute to label a link that climbed out of the project
    // as an escape; Chromium has collapsed the climb out of `href` by then.
    expect(SOURCE).toContain('rawHref')
    expect(SOURCE).toMatch(/getAttribute\('href'\)/)
  })

  it('reports the click button, so main can open a middle click in a new tab', () => {
    // The link table (issue #124) keeps only a primary click in its tab;
    // without the button a middle click would look like one.
    expect(SOURCE).toMatch(/button:\s*event\.button/)
  })

  it('requires a genuine user gesture', () => {
    expect(SOURCE).toContain('event.isTrusted')
  })

  it('SEC-02 the link reporter never cancels the page’s own click handling', () => {
    // The page must keep winning; the browser navigation is already refused.
    expect(SOURCE).not.toContain('preventDefault')
  })

  it('SEC-02 the overlay cancels events in one place: the comment-mode guard', () => {
    // `swallow` (input.ts) is the one function that calls `preventDefault`;
    // it runs for comment-mode events and pin clicks only.
    const callers = [...COMMENT_SOURCES].filter(([, text]) => text.includes('preventDefault'))
    expect(callers.map(([name]) => name)).toEqual(['input.ts'])
    const input = COMMENT_SOURCES.get('input.ts') ?? ''
    expect(input.match(/preventDefault/g)).toHaveLength(1)
    const swallow = /function swallow\(event: Event\): void \{[\s\S]*?\n\}/.exec(input)?.[0] ?? ''
    expect(swallow).toContain('preventDefault')
  })

  it('SEC-22 registers the link and CSP listeners in the main frame only', () => {
    // The preload now runs in frames too; a frame must not report links or
    // CSP violations for the page (main refuses them as well – SEC-27).
    const gate = SOURCE.indexOf('if (window === window.top) {')
    expect(gate).toBeGreaterThan(-1)
    for (const listener of [
      "addEventListener('click'",
      "addEventListener('auxclick'",
      "addEventListener('securitypolicyviolation'"
    ]) {
      expect(SOURCE.indexOf(listener), listener).toBeGreaterThan(gate)
    }
    // …and the overlay is installed outside that gate, in every frame – but
    // only when main passed the comments argument (the flag is a kill switch).
    const install = SOURCE.indexOf('if (commentsRequested()) installPreviewPageComments()')
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(gate)
    expect(SOURCE.match(/installPreviewPageComments\(/g)).toHaveLength(1)
  })

  it('inlines its channel names rather than importing shared code', () => {
    // A value import from a shared module makes Rollup hoist a chunk a
    // sandboxed preload cannot require (#73 build guard). The one relative
    // import is this entry's own overlay folder, bundled into the same file.
    const imports = SOURCE.match(/^import .*/gm) ?? []
    expect(imports).toEqual([
      "import { ipcRenderer } from 'electron'",
      "import { commentsRequested, installPreviewPageComments } from './previewPageComments'"
    ])
  })

  it('strips comments without cutting strings or regexes that hold `//`', () => {
    const lines = [
      String.raw`const a = 'http://x' // gone`,
      String.raw`/* gone too */ const b = /\/\//g`,
      'const c = `//${a}` /** and this */'
    ]
    expect(code(lines.join('\n')).split('\n').map(line => line.trim())).toEqual([
      "const a = 'http://x'",
      String.raw`const b = /\/\//g`,
      'const c = `//${a}`'
    ])
  })

  it('the overlay imports ipcRenderer from electron in index.ts only, and otherwise only its own modules', () => {
    for (const [name, text] of COMMENT_SOURCES) {
      for (const statement of text.match(/^import [\s\S]*?from '[^']+'/gm) ?? []) {
        const from = /from '([^']+)'$/.exec(statement)?.[1] ?? ''
        if (from === 'electron') {
          expect(name).toBe('index.ts')
          expect(statement).toBe("import { ipcRenderer } from 'electron'")
        } else {
          expect(from, `${name}: ${from}`).toMatch(/^\.\/[A-Za-z]+$/)
        }
      }
    }
  })
})
