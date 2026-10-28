// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame walk scans every document through the link scan worker (issue
 * #124 audit, follow-up). A document the worker cannot answer for yields no
 * links and ends the walk with what came before, logged once by failure name –
 * never a path, and never a scan on the main thread instead. One walk scans at
 * most `MAX_WALK_SCAN_BYTES` of markup: a document past it is skipped,
 * counted, and logged once with the walk's other bounds.
 *
 * Its own file because the logger is mocked at module scope
 * (docs/windows/contributing.md, "Test-file split policy"); the walk itself is
 * covered in `previewFrameSources.test.ts`.
 */
import path, { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'
import { inProcessLinkScanner } from './__test-helpers__/inProcessLinkScanner'
import type { ConfineFn } from './PreviewWatchCoordinator'
import type { LinkScanFailure, LinkScanResult, PreviewLinkScanner } from './PreviewLinkScanWorkerAdapter'
import {
  collectPreviewFrameSources,
  MAX_WALK_SCAN_BYTES,
  type PreviewFrameSourcesInput
} from './previewFrameSources'
import { MAX_LINKS_PER_DOCUMENT, type HtmlSource } from './previewLinkScanProtocol'

const SITE = resolve('/proj/site')
const PAGE = resolve(SITE, 'index.html')

function at(rel: string): string {
  return resolve(SITE, rel)
}

/** Every path is inside the project, at its own spelling. */
const insideSite: ConfineFn = (_root, candidate) =>
  Promise.resolve({ ok: true, realTarget: candidate, rel: path.relative(SITE, candidate) })

/** The in-process scanner, recording what it was asked; `answer` may replace its answer per call. */
function recordingScanner(answer?: (html: HtmlSource, call: number) => LinkScanResult | undefined) {
  const calls: Array<{ html: HtmlSource; frames: boolean }> = []
  const scanner: PreviewLinkScanner = {
    scan: async (html, options) => {
      calls.push({ html, frames: options.frames })
      return answer?.(html, calls.length) ?? inProcessLinkScanner.scan(html, options)
    }
  }
  return { scanner, calls }
}

async function collect(
  entryHtml: HtmlSource,
  files: Readonly<Record<string, HtmlSource>>,
  options: Partial<PreviewFrameSourcesInput> = {}
) {
  const reads: string[] = []
  const sources = await collectPreviewFrameSources({
    entryPath: PAGE,
    entryHtml,
    readHtml: filePath => {
      reads.push(filePath)
      const html = files[filePath]
      return html === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(html)
    },
    realRoot: SITE,
    confine: insideSite,
    ...options
  })
  return { ...sources, reads }
}

/** The one warning logged, once no path of the site is found in the log. */
function onlyWarning(): unknown[] {
  const warn = vi.mocked(logger.warn)
  expect(warn).toHaveBeenCalledTimes(1)
  const logged = JSON.stringify(warn.mock.calls)
  expect(logged).not.toContain('proj')
  expect(logged).not.toContain('.html')
  expect(logged).not.toContain('.png')
  return warn.mock.calls[0]
}

const failed = (failure: LinkScanFailure): LinkScanResult => ({ kind: 'failed', failure })

beforeEach(() => {
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
})

describe('collectPreviewFrameSources – the scan runs in the worker', () => {
  it('hands the page and each frame document to the scanner, asking for frames above the deepest level', async () => {
    const { scanner, calls } = recordingScanner()
    const entry = new TextEncoder().encode('<img src="a.png"><iframe src="f.html"></iframe>')

    const result = await collect(
      entry,
      { [at('f.html')]: '<iframe src="g.html"></iframe>', [at('g.html')]: '<img src="g.png">' },
      { scanner, maxDepth: 2 }
    )

    // The page's own bytes, as read: nothing decoded them on the way.
    expect(calls[0].html).toBe(entry)
    expect(calls.map(call => call.frames)).toEqual([true, true, false])
    expect(result.candidates).toEqual([at('a.png'), at('f.html'), at('g.html'), at('g.png')])
  })

  it("hands a srcdoc frame's markup back to the scanner as the bytes it returned", async () => {
    const { scanner, calls } = recordingScanner()

    const result = await collect('<iframe srcdoc="&lt;img src=&quot;in.png&quot;&gt;"></iframe>', {}, { scanner })

    expect(calls).toHaveLength(2)
    expect(new TextDecoder().decode(calls[1].html as Uint8Array)).toBe('<img src="in.png">')
    expect(result.candidates).toEqual([at('in.png')])
  })

  it('follows no frame a scanner lists at the deepest level', async () => {
    // Each document names a frame of its own, asked for or not.
    const framesAlways = recordingScanner((_html, call) => ({
      kind: 'ok',
      links: [],
      frames: { src: [`d${call}.html`], srcdoc: [] },
      limits: []
    }))

    const result = await collect(
      '<p>',
      { [at('d1.html')]: '<p>', [at('d2.html')]: '<p>' },
      { scanner: framesAlways.scanner, maxDepth: 1 }
    )

    expect(result.reads).toEqual([at('d1.html')])
    expect(framesAlways.calls.map(call => call.frames)).toEqual([true, false])
  })

  it.each(['busy', 'timeout', 'crashed', 'malformed', 'unavailable'] as const)(
    'keeps no links of a document the worker answers %s for, ends the walk there, and logs it once',
    async failure => {
      const { scanner } = recordingScanner((_html, call) => (call === 2 ? failed(failure) : undefined))

      const result = await collect(
        '<link rel="stylesheet" href="a.css"><iframe src="one.html"></iframe><iframe src="two.html"></iframe>',
        { [at('one.html')]: '<img src="one.png">', [at('two.html')]: '<img src="two.png">' },
        { scanner }
      )

      expect(result.candidates).toEqual([at('a.css'), at('one.html'), at('two.html')])
      expect(result.reads).toEqual([at('one.html')])
      expect(onlyWarning()).toEqual(['Preview auto-refresh: could not scan a page for its files', { failure }])
    }
  )

  it('resolves with no candidates when the page itself cannot be scanned', async () => {
    const { scanner } = recordingScanner(() => failed('timeout'))
    const result = await collect('<img src="a.png"><iframe src="f.html"></iframe>', {}, { scanner })
    expect(result).toEqual({ candidates: [], frameAssets: new Set(), reads: [] })
    expect(onlyWarning()[1]).toEqual({ failure: 'timeout' })
  })

  it.each([
    ['an error', new RangeError(`cannot scan ${PAGE}`), 'RangeError'],
    ['a value that is not an error', `cannot scan ${PAGE}`, 'string']
  ])('never rejects when a scanner rejects with %s: no links, logged by name', async (_label, reason, error) => {
    const scanner: PreviewLinkScanner = { scan: () => Promise.reject(reason) }
    await expect(collect('<img src="a.png">', {}, { scanner })).resolves.toMatchObject({ candidates: [] })
    expect(onlyWarning()[1]).toEqual({ error })
  })

  it('uses the shared worker client by default: with no bundle in a test run, no links and one line', async () => {
    const result = await collect('<img src="a.png">', {})

    expect(result.candidates).toEqual([])
    expect(onlyWarning()[1]).toEqual({ failure: 'unavailable' })
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('Preview auto-refresh: the link scan worker could not be started')
  })
})

describe('collectPreviewFrameSources – the walk byte budget', () => {
  it(`scans at most ${MAX_WALK_SCAN_BYTES} bytes by default: four documents at the read bound`, () => {
    expect(MAX_WALK_SCAN_BYTES).toBe(4 * PREVIEW.MAX_ENTRY_HTML_BYTES)
  })

  it('skips a document past the budget, goes on with one that fits, and logs the count once', async () => {
    const { scanner, calls } = recordingScanner()
    const entry = '<iframe src="big.html"></iframe><iframe src="small.html"></iframe>'
    const big = `<img src="big.png">${'x'.repeat(40)}`
    const small = '<img src="small.png">'

    const result = await collect(entry, { [at('big.html')]: big, [at('small.html')]: small }, { scanner, maxScanBytes: 100 })

    expect(entry.length + small.length).toBeLessThanOrEqual(100)
    expect(entry.length + big.length).toBeGreaterThan(100)
    expect(result.reads).toEqual([at('big.html'), at('small.html')])
    expect(calls.map(call => call.html)).toEqual([entry, small])
    expect(result.candidates).toEqual([at('big.html'), at('small.html'), at('small.png')])
    expect(onlyWarning()).toEqual([
      'Preview auto-refresh: a page was scanned only up to a limit',
      { limits: ['walk-bytes'], skippedDocuments: 1 }
    ])
  })

  it('reads no further frame file once the budget is spent, and counts each one it passes', async () => {
    const { scanner } = recordingScanner()
    const entry = new TextEncoder().encode('<iframe src="a.html"></iframe><iframe src="b.html"></iframe>')

    const result = await collect(
      entry,
      { [at('a.html')]: '<img src="a.png">', [at('b.html')]: '<img src="b.png">' },
      { scanner, maxScanBytes: entry.byteLength }
    )

    expect(result.reads).toEqual([])
    expect(result.candidates).toEqual([at('a.html'), at('b.html')])
    expect(onlyWarning()[1]).toEqual({ limits: ['walk-bytes'], skippedDocuments: 2 })
  })

  it('skips even the page when it alone is past the budget', async () => {
    const { scanner, calls } = recordingScanner()
    const result = await collect('<img src="a.png">', {}, { scanner, maxScanBytes: 4 })
    expect(calls).toEqual([])
    expect(result.candidates).toEqual([])
    expect(onlyWarning()[1]).toEqual({ limits: ['walk-bytes'], skippedDocuments: 1 })
  })
})

describe('collectPreviewFrameSources – the links one document hands back', () => {
  it(`keeps the first ${MAX_LINKS_PER_DOCUMENT} links of a document, follows its frames and logs the bound`, async () => {
    const images = Array.from({ length: MAX_LINKS_PER_DOCUMENT + 10 }, (_, n) => `<img src="${n}.png">`).join('')

    const result = await collect(
      `<iframe src="f.html"></iframe>${images}`,
      { [at('f.html')]: '<img src="frame.png">' },
      // A watch budget the page's links do not spend, so the frame is still read.
      { scanner: inProcessLinkScanner, budget: MAX_LINKS_PER_DOCUMENT + 2 }
    )

    expect(result.candidates).toHaveLength(MAX_LINKS_PER_DOCUMENT + 1)
    expect(result.candidates[0]).toBe(at('f.html'))
    expect(result.candidates.at(-1)).toBe(at('frame.png'))
    expect(result.reads).toEqual([at('f.html')])
    expect(onlyWarning()[1]).toEqual({ limits: ['links-per-document'] })
  })
})
