// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame-source walk never rejects (issue #124, QG-11a Q12): a document the
 * link extractor throws on ends the walk with what was found so far, and the
 * log names the error, never a path. A page nested thousands of levels deep,
 * which once overflowed the extractor's stack, now simply resolves.
 *
 * Its own file because the extractor and the logger are mocked at module scope
 * (docs/windows/contributing.md, "Test-file split policy"); the walk itself is
 * covered in `previewFrameSources.test.ts`.
 */
import path, { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('./linkExtract', () => ({
  extractStaticLinks: vi.fn(),
  extractFrameSources: vi.fn()
}))

import { logger } from '../LoggingService'
import { extractFrameSources, extractStaticLinks } from './linkExtract'
import type { ConfineFn } from './PreviewWatchCoordinator'
import { collectPreviewFrameSources } from './previewFrameSources'

const actual = await vi.importActual<typeof import('./linkExtract')>('./linkExtract')

const SITE = resolve('/proj/site')
const PAGE = resolve(SITE, 'index.html')

/** Nesting that overflowed the old recursive walk; see `linkExtract.test.ts`. */
const DEEP_NESTING = 10_000
/** parse5 is quadratic in depth: slow on a loaded CI runner with coverage on. */
const DEEP_NESTING_TIMEOUT_MS = 30_000

/** A stack overflow whose message names a path, which must not reach the log. */
const OVERFLOW = new RangeError(`Maximum call stack size exceeded in ${PAGE}`)

function at(rel: string): string {
  return resolve(SITE, rel)
}

/** Every path is inside the project, at its own spelling. */
const insideSite: ConfineFn = (_root, candidate) =>
  Promise.resolve({ ok: true, realTarget: candidate, rel: path.relative(SITE, candidate) })

/** `extractStaticLinks` throws `error` on exactly `html`, and works on anything else. */
function staticLinksThrowOn(html: string, error: unknown): void {
  vi.mocked(extractStaticLinks).mockImplementation((markup) => {
    if (markup === html) throw error
    return actual.extractStaticLinks(markup)
  })
}

/** `extractFrameSources` throws `error` on exactly `html`, and works on anything else. */
function frameSourcesThrowOn(html: string, error: unknown): void {
  vi.mocked(extractFrameSources).mockImplementation((markup) => {
    if (markup === html) throw error
    return actual.extractFrameSources(markup)
  })
}

async function collect(entryHtml: string, files: Readonly<Record<string, string>> = {}) {
  const readHtml = vi.fn((filePath: string): Promise<string> => {
    const html = files[filePath]
    return html === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(html)
  })
  const sources = await collectPreviewFrameSources({
    entryPath: PAGE,
    entryHtml,
    readHtml,
    realRoot: SITE,
    confine: insideSite
  })
  return { ...sources, reads: readHtml.mock.calls.map(([filePath]) => filePath) }
}

/** The context of the one warning logged, once no path of the site is found in the log. */
function onlyWarningContext(): unknown {
  const warn = vi.mocked(logger.warn)
  expect(warn).toHaveBeenCalledTimes(1)
  const logged = JSON.stringify(warn.mock.calls)
  expect(logged).not.toContain('proj')
  expect(logged).not.toContain('.html')
  expect(logged).not.toContain('.png')
  return warn.mock.calls[0][1]
}

describe('collectPreviewFrameSources – a document the extractor throws on', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
    vi.mocked(extractStaticLinks).mockReset().mockImplementation(actual.extractStaticLinks)
    vi.mocked(extractFrameSources).mockReset().mockImplementation(actual.extractFrameSources)
  })

  it(`resolves with the links of a ${DEEP_NESTING}-deep page, logging nothing`, async () => {
    const result = await collect(`${'<div>'.repeat(DEEP_NESTING)}<img src="a.png">`)

    expect(result.candidates).toEqual([at('a.png')])
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  }, DEEP_NESTING_TIMEOUT_MS)

  it('resolves with no candidates when the page itself cannot be scanned', async () => {
    const entry = '<img src="a.png"><iframe src="child.html"></iframe>'
    staticLinksThrowOn(entry, OVERFLOW)

    const result = await collect(entry, { [at('child.html')]: '<img src="child.png">' })

    expect(result).toEqual({ candidates: [], frameAssets: new Set(), reads: [] })
    expect(onlyWarningContext()).toEqual({ error: 'RangeError' })
  })

  it("keeps the page's links when its frames cannot be listed, and reads no frame", async () => {
    const entry = '<img src="a.png"><iframe src="child.html"></iframe>'
    frameSourcesThrowOn(entry, OVERFLOW)

    const result = await collect(entry, { [at('child.html')]: '<img src="child.png">' })

    expect(result.candidates).toEqual([at('a.png'), at('child.html')])
    expect(result.frameAssets.size).toBe(0)
    expect(result.reads).toEqual([])
    expect(onlyWarningContext()).toEqual({ error: 'RangeError' })
  })

  it('ends the walk at a frame document it cannot scan, keeping what came before', async () => {
    const one = '<img src="one.png">'
    staticLinksThrowOn(one, OVERFLOW)

    const result = await collect(
      '<link rel="stylesheet" href="a.css"><iframe src="one.html"></iframe><iframe src="two.html"></iframe>',
      { [at('one.html')]: one, [at('two.html')]: '<img src="two.png">' }
    )

    expect(result.candidates).toEqual([at('a.css'), at('one.html'), at('two.html')])
    expect(result.frameAssets).toEqual(new Set([at('one.html'), at('two.html')]))
    expect(result.reads).toEqual([at('one.html')])
    expect(onlyWarningContext()).toEqual({ error: 'RangeError' })
  })

  it('names the type of a thrown value that is not an Error', async () => {
    const entry = '<img src="a.png">'
    staticLinksThrowOn(entry, `cannot scan ${PAGE}`)

    await expect(collect(entry)).resolves.toMatchObject({ candidates: [] })
    expect(onlyWarningContext()).toEqual({ error: 'string' })
  })
})
