// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { realClock } from '../../../../shared/clock'
import { REACT_LOOKUP } from '../cdp/cdpPickFunctions'
import { PickReader } from './pickCdp'
import { bitmapWidth, CaptureFailure, fallbackFacts, PickCaptureReads, toBitmap, type CapturedImage } from './pickCaptureReads'
import { readChain } from './pickElement'
import { PickFrames } from './pickFrames'
import { PickFaults } from './pickSupport'
import { samplePage } from './__test-helpers__/samplePage'

function image(width: number, height: number, scale = 1, alpha = 255): CapturedImage {
  const data = Buffer.alloc(width * scale * height * scale * 4, 0)
  for (let i = 3; i < data.length; i += 4) data[i] = alpha
  return { toBitmap: () => data, getSize: () => ({ width, height }) }
}

function setup(over: { capture?: () => Promise<CapturedImage>; frozen?: boolean; faults?: PickFaults } = {}) {
  const page = samplePage({ crossSite: false })
  const reader = new PickReader(page.cdp)
  const frames = new PickFrames(page.cdp, reader)
  const reads = new PickCaptureReads({
    reader,
    frames,
    capturePage: over.capture ?? (async () => image(800, 600, 2)),
    isFrozen: () => over.frozen ?? false,
    projectRoot: () => null,
    clock: realClock,
    faults: over.faults
  })
  return { page, reader, frames, reads }
}

const top = (id: number) => ({ sessionKey: '', backendNodeId: id, frameId: 'top' })

describe('toBitmap', () => {
  it('reads the bitmap at its largest scale factor', () => {
    expect(toBitmap(image(10, 5, 2))).toMatchObject({ width: 20, height: 10 })
    expect(toBitmap(image(10, 5, 1)).data.length).toBe(200)
    expect(toBitmap({ toBitmap: () => Buffer.alloc(0), getSize: () => ({ width: 0, height: 0 }) })).toMatchObject({ width: 0, height: 0 })
  })

  /** An image whose DIP size is `width` × `height` and whose bitmap is `pixelWidth` × `pixelHeight`, as at a fractional scale. */
  function scaled(width: number, height: number, pixelWidth: number, pixelHeight: number, factors?: number[]): CapturedImage {
    const data = Buffer.alloc(pixelWidth * pixelHeight * 4, 255)
    return { toBitmap: () => data, getSize: () => ({ width, height }), ...(factors === undefined ? {} : { getScaleFactors: () => factors }) }
  }

  it('025-AC-034 reads a 125 % and a 150 % Windows capture at its exact pixel size, within 1 px of the viewport × the scale', () => {
    // Sizes where a width taken from the mean scale alone is one pixel off, which shears every row.
    for (const [scale, width, height] of [
      [1.25, 249, 150],
      [1.25, 1001, 601],
      [1.25, 1280, 720],
      [1.5, 1001, 601],
      [1.5, 385, 50],
      [1.5, 1366, 705]
    ]) {
      for (const round of [Math.round, Math.ceil, Math.floor]) {
        const [pw, ph] = [round(width * scale), round(height * scale)]
        for (const factors of [[scale], undefined]) {
          const bitmap = toBitmap(scaled(width, height, pw, ph, factors))
          if (factors !== undefined) expect([bitmap.width, bitmap.height], `${scale} ${width}×${height}`).toEqual([pw, ph])
          expect(Math.abs(bitmap.width - width * scale)).toBeLessThanOrEqual(1)
          expect(Math.abs(bitmap.height - height * scale)).toBeLessThanOrEqual(1)
          expect(bitmap.data.length).toBe(bitmap.width * bitmap.height * 4)
        }
      }
    }
  })

  it('takes the pixel size as given when the image reports it at scale 1, and a stray scale factor does not override the bitmap', () => {
    expect(toBitmap(scaled(1252, 752, 1252, 752, [1]))).toMatchObject({ width: 1252, height: 752 })
    expect(toBitmap(scaled(100, 50, 200, 100, [1]))).toMatchObject({ width: 200, height: 100 })
  })

  it('picks the width that divides the pixel count, nearest the scaled size', () => {
    expect(bitmapWidth(311 * 188, 249, 150, 1.25)).toBe(311)
    expect(bitmapWidth(312 * 188, 249, 150, 1.25)).toBe(312)
    // No width near the scaled size divides the count (a short buffer): the scaled width stands.
    expect(bitmapWidth(7919, 100, 50, 1.5)).toBe(150)
  })
})

describe('PickCaptureReads', () => {
  it('takes the screenshot', async () => {
    const { reads } = setup()
    expect(await reads.screenshot()).toMatchObject({ width: 1600, height: 1200 })
  })

  it('retries an empty first screenshot once, and fails on a second (the first macOS capture)', async () => {
    const capture = vi.fn().mockResolvedValueOnce(image(10, 10, 1, 0)).mockResolvedValueOnce(image(10, 10))
    expect((await setup({ capture }).reads.screenshot()).width).toBe(10)
    const empty = vi.fn(async () => image(10, 10, 1, 0))
    await expect(setup({ capture: empty }).reads.screenshot()).rejects.toEqual(new CaptureFailure('The screenshot came back empty'))
    expect(empty).toHaveBeenCalledTimes(2)
  })

  it('honours the forced faults: an empty image and a refusal', async () => {
    const faults = new PickFaults()
    faults.armEmptyCaptures(2)
    await expect(setup({ faults }).reads.screenshot()).rejects.toThrow('The screenshot came back empty')
    faults.armCaptureFailures(1)
    await expect(setup({ faults }).reads.screenshot()).rejects.toThrow('The screenshot could not be taken')
  })

  it('reads the top viewport, failing when it has no size', async () => {
    const { page, reads } = setup()
    expect(await reads.viewport()).toEqual({ width: 800, height: 600 })
    page.viewports.delete('')
    await expect(reads.viewport()).rejects.toThrow('The page size could not be read')
  })

  it('reads the facts of an entry from the page', async () => {
    const { reader, frames, reads } = setup()
    const chain = await readChain(reader, frames, top(5))
    const got = await reads.facts(chain, chain.entries[3], 3)
    expect(got.outerHtml).toBe('<button></button>')
    expect(got.boxInView).toEqual({ x: 20, y: 20, width: 100, height: 30 })
  })

  it('gives the snapshot-only facts while frozen, for an entry with no node, and when the read fails', async () => {
    const live = setup()
    const chain = await readChain(live.reader, live.frames, top(5))
    const frozen = setup({ frozen: true })
    expect(await frozen.reads.facts(chain, chain.entries[4], 4)).toEqual(fallbackFacts(chain, chain.entries[4]))
    expect(frozen.page.cdp.calls('Runtime.callFunctionOn')).toEqual([])
    expect(await live.reads.facts(chain, { ...chain.entries[2], node: null }, 2)).toEqual(fallbackFacts(chain, { ...chain.entries[2], node: null }))
    live.page.cdp.handle('DOM.getBoxModel', () => {
      throw new Error('gone')
    })
    live.page.broken.add(5)
    const failed = await live.reads.facts(chain, chain.entries[4], 4)
    expect(failed.boxInView).toBeNull()
  })

  it('takes hints from source attributes first, nearest element first', async () => {
    const { reader, frames, reads } = setup()
    const chain = await readChain(reader, frames, top(5))
    const got = await reads.hints(chain, 4)
    expect(got.sourceAttributes).toEqual([['data-source', 'src/Save.tsx:4']])
  })

  it("runs the React lookup in the page's main world when no attribute answers, but never while frozen", async () => {
    const { page, reader, frames, reads } = setup()
    page.react.set(3, { component: 'Outer', owners: ['App'], source: null })
    const chain = await readChain(reader, frames, top(3))
    expect((await reads.hints(chain, 2)).react).toEqual({ component: 'Outer', ownerChain: ['App'], source: null })
    const lookup = page.cdp.calls('Runtime.callFunctionOn').find((c) => (c.params as { functionDeclaration: string }).functionDeclaration === REACT_LOOKUP.source)
    expect(lookup).toBeDefined()
    expect(page.cdp.calls('DOM.resolveNode').some((c) => (c.params as Record<string, unknown>).executionContextId === undefined)).toBe(true)
    const frozen = setup({ frozen: true })
    frozen.page.react.set(3, { component: 'Outer' })
    expect(await frozen.reads.hints(chain, 2)).toEqual({ sourceAttributes: [], react: null, sourceNotFound: true })
  })

  it('runs the hint fault before the lookup', async () => {
    const faults = new PickFaults()
    faults.armHints({ throws: true })
    const { page, reader, frames, reads } = setup({ faults })
    page.react.set(3, { component: 'Outer' })
    const chain = await readChain(reader, frames, top(3))
    expect((await reads.hints(chain, 2)).sourceNotFound).toBe(true)
  })

  it('records style sheet headers for matched-rule lines, ignoring junk, and clears them', async () => {
    const { page, reader, frames, reads } = setup()
    reads.recordStyleSheet({ header: { styleSheetId: 's1', sourceURL: 'https://app.test/a.css', startLine: 10 } })
    reads.recordStyleSheet({ header: { styleSheetId: 's2' } })
    reads.recordStyleSheet('junk')
    page.matchedStyles = {
      matchedCSSRules: [{ rule: { origin: 'regular', styleSheetId: 's1', selectorList: { text: '.a' }, style: { cssText: 'color: red;', range: { startLine: 2 } } } }]
    }
    const chain = await readChain(reader, frames, top(5))
    expect((await reads.facts(chain, chain.entries[4], 4)).matchedRules).toEqual([{ stylesheetUrl: 'https://app.test/a.css', line: 13, text: '.a { color: red; }' }])
    reads.clearStyleSheets()
    expect((await reads.facts(chain, chain.entries[4], 4)).matchedRules).toEqual([{ stylesheetUrl: '', line: 3, text: '.a { color: red; }' }])
  })

  it('serialises node-id reads per session, even after a failure', async () => {
    const { reads } = setup()
    const order: string[] = []
    let release: () => void = () => undefined
    const first = reads.serialise('', () => new Promise<void>((r) => (release = () => (order.push('first'), r()))))
    const failing = reads.serialise('', async () => {
      order.push('second')
      throw new Error('x')
    })
    const third = reads.serialise('', async () => void order.push('third'))
    const other = reads.serialise('S1', async () => void order.push('other session'))
    await other
    release()
    await first
    await expect(failing).rejects.toThrow('x')
    await third
    expect(order).toEqual(['other session', 'first', 'second', 'third'])
  })
})
