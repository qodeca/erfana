// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a send writes, read back from disk (spec 025, 025-FR-033 to
 * 025-FR-039): the context file's fields, the screenshot and the crop, the
 * recent errors and the expiry sweep. Every capture here is a real send –
 * pick, **Explain**, the stub agent in the terminal – and the files are the
 * ones its prompt names. The context file is read with the shared parser
 * (`fixtures/browser/contextFile.parse.ts`); images are decoded with sharp.
 * Condition-based waits only.
 *
 * Titles carry an AC id only where the whole criterion is proven here.
 * 025-AC-033: the golden file is an example of another page, so the match is
 * its structure (its headings, in its order) with every field checked by
 * value. 025-AC-034: the live pick outline gets a unique test colour from
 * main's pick hook (`setHighlightColour`, test builds only) and the pick label
 * one from a style on Erfana's window; each is first seen drawn (the positive
 * control), then searched for in the PNG. At a forced 2× scale the engine's
 * overlay does not show in `capturePage` at all, so that control runs at
 * scale 1. The 125 % and 150 % runs the criterion names are Windows scaling:
 * they are covered by unit tests of the bitmap read at those scales
 * (`pickCaptureReads.test.ts`), not here. 025-AC-038 covers every case of the
 * criterion, plus no entry of Erfana's own making (the DevTools agent's
 * `net::ERR_CACHE_MISS` reads at pick start, Electron's development security
 * warnings) and a multi-line message that cannot forge an entry. 025-AC-039
 * runs on macOS, where `chflags uchg` locks a file.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { test, expect } from './fixtures/browserHarness'
import { BROWSER_CHROMIUM_ARGS } from './fixtures/browser/serve'
import { listItems, parseContextFile, parseNumbers, type ParsedContextFile } from './fixtures/browser/contextFile.parse'
import { BrowserSendUi, CAPTURES_REL, SEND_WAIT_MS, type StubAgent } from './pages/browser-send.page'
import { appMainLogPath, LogTail } from './fixtures/logTail'

const IS_POSIX = process.platform !== 'win32'
const GOLDEN = path.join(__dirname, 'fixtures', 'browser', 'context-file.golden.md')
const TOKENS = path.join(__dirname, '..', 'src', 'renderer', 'src', 'styles', 'design-tokens.css')

/** The computed styles 025-FR-033 lists. */
const STYLE_NAMES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'padding', 'border', 'box-sizing', 'overflow', 'z-index', 'visibility', 'transform', 'flex', 'flex-direction', 'flex-wrap',
  'align-self', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-area', 'font-family', 'font-size', 'font-weight',
  'line-height', 'letter-spacing', 'text-align', 'white-space', 'text-overflow', 'word-break', 'color', 'background-color', 'opacity'
]

interface Rgb {
  r: number
  g: number
  b: number
}

/** `--color-accent-primary`, resolved through the tokens it names. */
async function accentColour(): Promise<Rgb> {
  const css = await fs.readFile(TOKENS, 'utf8')
  let value = '--color-accent-primary'
  for (let depth = 0; depth < 5 && value.startsWith('--'); depth += 1) {
    const match = new RegExp(`${value}:\\s*([^;]+);`).exec(css)
    if (match === null) throw new Error(`token ${value} not found`)
    value = match[1].trim().replace(/^var\((--[\w-]+)\)$/, '$1')
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex === null) throw new Error(`accent is not a hex colour: ${value}`)
  const n = parseInt(hex[1], 16)
  return { r: n >> 16, g: (n >> 8) & 0xff, b: n & 0xff }
}

/** CIE76 ΔE between two sRGB colours. */
function deltaE(a: Rgb, b: Rgb): number {
  const lab = ({ r, g, b: bl }: Rgb): [number, number, number] => {
    const lin = (c: number): number => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const [R, G, B] = [lin(r), lin(g), lin(bl)]
    const xyz = [(R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, R * 0.2126 + G * 0.7152 + B * 0.0722, (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883]
    const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
    const [fx, fy, fz] = xyz.map(f)
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
  }
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

interface Image {
  width: number
  height: number
  at(x: number, y: number): Rgb
}

async function readPng(file: string): Promise<Image> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    at: (x, y) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3
      return { r: data[i], g: data[i + 1], b: data[i + 2] }
    }
  }
}

/** Pixels of `img` that `matches` says are of a test colour. */
function countWhere(img: Image, matches: (p: Rgb) => boolean): number {
  let count = 0
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) if (matches(img.at(x, y))) count += 1
  }
  return count
}

/**
 * The live pick outline's unique test colour (main's pick hook): magenta; and
 * the pick label's (a style on Erfana's window): cyan. A pixel counts as one
 * of them by the hue that dominates it, not by closeness: what the engine
 * paints reaches `capturePage` colour-managed (macOS converts to the display
 * profile) and, at a 2× scale, blended with the page along a thin line, so
 * its channels move by tens. Neither the fixture page nor the drawn accent
 * outline (#A0A8FF) has a pixel with either hue this strong.
 */
const LIVE_OUTLINE_TEST: Rgb = { r: 255, g: 0, b: 255 }
const LABEL_TEST: Rgb = { r: 0, g: 255, b: 255 }
const HUE_MARGIN = 100
const isOutlineTest = (p: Rgb): boolean => Math.min(p.r, p.b) - p.g > HUE_MARGIN
const isLabelTest = (p: Rgb): boolean => Math.min(p.g, p.b) - p.r > HUE_MARGIN

/** Decode a PNG (a buffer) into an {@link Image}. */
async function decodePng(png: Buffer): Promise<Image> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    at: (x, y) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3
      return { r: data[i], g: data[i + 1], b: data[i + 2] }
    }
  }
}

/** One send of the element at `selector` and its parsed context file. */
async function capture(
  send: BrowserSendUi,
  agent: StubAgent,
  selector: string,
  at?: { x: number; y: number }
): Promise<{ parsed: ParsedContextFile; text: string; point: { x: number; y: number }; screenshot: string; crop: string }> {
  const point = await send.pickAt(selector, at)
  const files = await send.explainAndRead(agent)
  return {
    parsed: parseContextFile(files.context),
    text: files.context,
    point,
    screenshot: path.join(send.projectRoot, files.screenshotPath),
    crop: path.join(send.projectRoot, files.cropPath)
  }
}

/** For each part of a selector chain: how many elements it matches in its document or open shadow root. */
async function chainMatches(send: BrowserSendUi, chain: string[]): Promise<number[]> {
  return (await send.panel.page()).eval<number[]>(`(() => {
    const chain = ${JSON.stringify(chain)}
    const counts = []
    let scope = document
    for (const part of chain) {
      const found = scope.querySelectorAll(part)
      counts.push(found.length)
      scope = found[0] && found[0].shadowRoot ? found[0].shadowRoot : scope
    }
    return counts
  })()`)
}

async function openSend(
  app: Parameters<typeof BrowserSendUi.open>[0],
  window: Parameters<typeof BrowserSendUi.open>[1],
  projectRoot: string
): Promise<{ send: BrowserSendUi; agent: StubAgent }> {
  const send = await BrowserSendUi.open(app, window, projectRoot)
  const agent = await send.startStubAgent(test.info().outputPath('agent-input.bin'))
  return { send, agent }
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('025-AC-033 the context file', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('holds every field of 025-FR-033 in the golden file’s structure; the pick point of an Enter pick is the last mouse position', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    const url = browserServers.sites.static.url('/elements.html')
    await send.load(url)
    // Pointer to a point inside the label that is not its centre, then Enter.
    const box = await (await send.driver()).rect('#save-label')
    const at = { x: Math.round(box.x + 3), y: Math.round(box.y + box.height / 2) }
    const { parsed, text } = await capture(send, agent, '#save-label', at)
    const { facts, sections } = parsed

    expect(facts['Schema version']).toBe('1')
    expect(facts['Captured at']).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/)
    expect(facts['Viewport']).toMatch(/^\d+ × \d+ CSS px$/)
    expect(facts['Width preset']).toBe('Full width')
    expect(Number(facts['Device pixel ratio'])).toBeGreaterThan(0)
    const elementBox = parseNumbers(facts['Element box (top-level viewport, CSS px)'])
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(elementBox[key] - box[key])).toBeLessThanOrEqual(1)
    expect(facts['Element box (own frame, CSS px)']).toBe(facts['Element box (top-level viewport, CSS px)'])
    expect(parseNumbers(facts['Pick point (top-level viewport, CSS px)'])).toEqual(at)
    expect(facts['Screenshot']).toMatch(/^\.erfana\/browser\/captures\/\d{8}-\d{6}Z-[0-9a-f]{8}\.png$/)
    expect(facts['Element crop']).toBe(facts['Screenshot'].replace(/\.png$/, '-crop.png'))

    expect(listItems(sections['Page'])).toEqual([`URL: ${url}`, 'Title: Elements fixture'])
    expect(listItems(sections['Frame chain'])).toEqual([new URL(url).origin])
    expect(sections['Outer HTML'].join('\n')).toBe('<span id="save-label">Save changes</span>')
    const styles = listItems(sections['Computed styles']).map((line) => line.slice(0, line.indexOf(': ')))
    expect(styles).toEqual(STYLE_NAMES)
    const layout = listItems(sections['Layout chain'])
    expect(layout).toHaveLength(3)
    expect(layout[0]).toMatch(/^button – display \S+, position \S+, overflow \S+, [\d.]+px × [\d.]+px$/)
    // Matched rules are listed, or the note says they are not available.
    expect(listItems(sections['Matched CSS rules']).length > 0 || parsed.notes.includes('matched rules not available')).toBe(true)
    expect(sections['React']).toBeDefined()
    expect(parsed.notes).toContain('source not found')

    // The golden file's structure: its headings, in its order, nothing else.
    const golden = parseContextFile(await fs.readFile(GOLDEN, 'utf8'))
    expect(parsed.headings.filter((h) => !golden.headings.includes(h))).toEqual([])
    const order = parsed.headings.map((h) => golden.headings.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text).toContain(`<<<END-ERFANA-UNTRUSTED-${parsed.token}>>>`)
  })

  test('each part of the selector chain matches exactly one element in its document or open shadow root, ids :r1: and 1abc included', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    await send.load(browserServers.sites.static.url('/elements.html'))
    for (const selector of ['#save-label', '[id=":r1:"]', '[id="1abc"]', '[data-testid="long-classes"]', '[data-testid="emoji-class"]']) {
      const chain = listItems((await capture(send, agent, selector)).parsed.sections['Selector chain'])
      expect(chain, selector).toHaveLength(1)
      expect(await chainMatches(send, chain), `${selector}: ${chain.join(' | ')}`).toEqual([1])
    }
    await send.load(browserServers.sites.static.url('/shadow.html'))
    const nested = await (await send.panel.page()).eval<{ x: number; y: number }>(`(() => {
      const r = document.getElementById('open-host').shadowRoot.getElementById('nested-host').shadowRoot.getElementById('nested-button').getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    const chain = listItems((await capture(send, agent, '#open-host', nested)).parsed.sections['Selector chain'])
    expect(chain).toHaveLength(3)
    expect(await chainMatches(send, chain)).toEqual([1, 1, 1])
  })

  test('a pick inside a closed shadow root names the host, with the note "inside closed shadow root"', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    await send.load(browserServers.sites.static.url('/shadow.html'))
    const { parsed } = await capture(send, agent, '#closed-host')
    expect(parsed.notes).toContain('inside closed shadow root')
    const chain = listItems(parsed.sections['Selector chain'])
    expect(chain).toEqual(['div#closed-host'])
    expect(await chainMatches(send, chain)).toEqual([1])
  })

  test('outer HTML is cut at 20,000 characters with the truncation note; exactly 20,000 is not cut; a cut next to an emoji keeps it whole', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    await send.load(browserServers.sites.static.url('/long-text.html'))
    const lengths = await (await send.panel.page()).eval<Record<string, number>>('window.__fixture.lengths()')
    expect(lengths).toEqual({ 'exact-20000': 20000, 'over-20000': 20001, 'over-50000': 50000, 'emoji-at-cut': 20010 })
    const outer = async (id: string): Promise<{ html: string; notes: readonly string[] }> => {
      // The text is one unbroken line: bring it into view and pick near its start, not its centre (off the page).
      await (await send.panel.page()).eval(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'center' }); 0`)
      const box = await (await send.driver()).rect(`#${id}`)
      const { parsed } = await capture(send, agent, `#${id}`, { x: Math.round(box.x + 4), y: Math.round(box.y + box.height / 2) })
      return { html: parsed.sections['Outer HTML'].join('\n'), notes: parsed.notes }
    }
    const big = await outer('over-50000')
    expect(big.html).toHaveLength(20000)
    expect(big.html.startsWith('<div id="over-50000" class="long">')).toBe(true)
    expect(big.notes).toContain('HTML truncated at 20,000 characters')

    const exact = await outer('exact-20000')
    expect(exact.html).toHaveLength(20000)
    expect(exact.html.endsWith('</div>')).toBe(true)
    expect(exact.notes).not.toContain('HTML truncated at 20,000 characters')

    const emoji = await outer('emoji-at-cut')
    expect(emoji.notes).toContain('HTML truncated at 20,000 characters')
    // No lone surrogate: the emoji is either whole at the end or left out.
    expect(emoji.html.isWellFormed()).toBe(true)
    expect([19999, 20001]).toContain(emoji.html.length)
  })
})

test.describe('025-AC-034 the screenshot and the crop', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  for (const scale of [1, 2]) {
    test.describe(`at device scale ${scale}`, () => {
      test.use({ extraLaunchArgs: [...BROWSER_CHROMIUM_ARGS, ...(scale === 2 ? ['--force-device-scale-factor=2'] : [])] })

      test('one PNG of the viewport × the pixel ratio, a 2-device-pixel accent outline just outside the element, and a crop of its box plus 24 px', async ({
        appWithTestProject,
        windowWithTestProject,
        browserServers,
        testProject
      }) => {
        const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
        await send.load(browserServers.sites.static.url('/elements.html'))
        // The live outline and the label in colours of their own, so the image can be searched for them.
        await send.fault('setHighlightColour', { ...LIVE_OUTLINE_TEST, a: 1 })
        await windowWithTestProject.addStyleTag({
          content: `.erf-brw-banner-line__more--1 { background-color: rgb(${LABEL_TEST.r}, ${LABEL_TEST.g}, ${LABEL_TEST.b}) !important; color: rgb(${LABEL_TEST.r}, ${LABEL_TEST.g}, ${LABEL_TEST.b}) !important; }`
        })
        let files: { context: string; screenshotPath: string; cropPath: string }
        try {
          await send.pick.pickButton.click()
          const driver = await send.driver()
          await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
          // In a small window (the Linux run's 1920 × 1080 virtual screen is 960 × 540 at 2×) the element starts
          // below the page's viewport: bring it in, so the pointer reaches it.
          await driver.page.eval(`document.getElementById('1abc').scrollIntoView({ block: 'center', inline: 'center' }); 0`)
          const target = await driver.rect('[id="1abc"]')
          await driver.move(Math.round(target.x + target.width / 2), Math.round(target.y + target.height / 2))
          await expect.poll(async () => (await driver.highlight())?.label ?? '', { timeout: SEND_WAIT_MS }).toMatch(/^div/)
          // Positive controls: the engine paints the live outline in its test colour on the page, and the label shows in its own.
          // At a forced 2× scale the engine's overlay never shows in `capturePage` (seen on macOS, 2026-11-03), so
          // there the control cannot run and the scale-1 run is the one that proves the outline is hidden first.
          if (scale === 1) {
            const tabId = await send.panel.tabId()
            await expect
              .poll(async () => countWhere(await decodePng(Buffer.from((await send.fault('pagePng', tabId)) as string, 'base64')), isOutlineTest), {
                timeout: SEND_WAIT_MS,
                message: 'live outline painted in its test colour'
              })
              .toBeGreaterThan(0)
          }
          const label = send.pick.status.locator('.erf-brw-banner-line__more--1')
          await expect(label).toHaveText(/^div/)
          expect(countWhere(await decodePng(await label.screenshot()), isLabelTest), 'label drawn in its test colour').toBeGreaterThan(0)
          await driver.key('Return')
          await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
          files = await send.explainAndRead(agent)
        } finally {
          await send.fault('resetFaults')
        }
        const parsed = parseContextFile(files.context)
        const screenshot = path.join(send.projectRoot, files.screenshotPath)
        const crop = path.join(send.projectRoot, files.cropPath)
        const dpr = Number(parsed.facts['Device pixel ratio'])
        expect(dpr).toBe(scale)
        const [vw, vh] = parsed.facts['Viewport'].split(' ')[0] === '' ? [0, 0] : parsed.facts['Viewport'].replace(' CSS px', '').split(' × ').map(Number)
        const shot = await readPng(screenshot)
        expect(Math.abs(shot.width - vw * dpr)).toBeLessThanOrEqual(1)
        expect(Math.abs(shot.height - vh * dpr)).toBeLessThanOrEqual(1)
        // Neither Erfana's live outline nor its label is in the image: only the drawn outline is.
        expect(countWhere(shot, isOutlineTest), 'live outline pixels').toBe(0)
        expect(countWhere(shot, isLabelTest), 'label pixels').toBe(0)

        // The outline: the two device pixels just outside the box, in the accent colour; inside it is the element's own.
        const accent = await accentColour()
        const b = parseNumbers(parsed.facts['Element box (top-level viewport, CSS px)'])
        const midY = Math.round((b.y + b.height / 2) * dpr)
        const midX = Math.round((b.x + b.width / 2) * dpr)
        /** Accent pixels in the 4 device px just outside one edge, walking outwards from it. */
        const ring = (edge: number, step: 1 | -1, vertical: boolean): boolean[] =>
          [0, 1, 2, 3].map((i) => {
            const p = Math.floor(edge) + step * i + (step < 0 ? -1 : 0)
            return deltaE(vertical ? shot.at(midX, p) : shot.at(p, midY), accent) <= 3
          })
        for (const [name, edge, step, vertical] of [
          ['left', b.x * dpr, -1, false],
          ['right', (b.x + b.width) * dpr, 1, false],
          ['top', b.y * dpr, -1, true],
          ['bottom', (b.y + b.height) * dpr, 1, true]
        ] as Array<[string, number, 1 | -1, boolean]>) {
          const hits = ring(edge, step, vertical)
          // Two device pixels of accent, right at the edge (one pixel of rounding allowed), and no wider.
          expect(hits.filter(Boolean).length, `${name} outline ${JSON.stringify(hits)}`).toBe(2)
          expect(hits[3], `${name} outline is 2 device px`).toBe(false)
        }

        // The crop: the box plus 24 CSS px each side, clipped to the viewport, without the outline.
        const cropped = await readPng(crop)
        const left = Math.max(0, b.x - 24)
        const top = Math.max(0, b.y - 24)
        const right = Math.min(vw, b.x + b.width + 24)
        const bottom = Math.min(vh, b.y + b.height + 24)
        expect(Math.abs(cropped.width - (right - left) * dpr)).toBeLessThanOrEqual(2)
        expect(Math.abs(cropped.height - (bottom - top) * dpr)).toBeLessThanOrEqual(2)
        expect(deltaE(cropped.at((b.x - left) * dpr - 1, (b.y - top + b.height / 2) * dpr), accent)).toBeGreaterThan(3)
      })
    })
  }

  test('a canvas pick and a closed-shadow-root pick carry a crosshair at the pick point; an empty first image is retried and the send completes', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    const accent = await accentColour()
    const crosshairAt = async (screenshot: string, point: { x: number; y: number }, dpr: number): Promise<void> => {
      const shot = await readPng(screenshot)
      // The crosshair's arms run through the point: accent pixels left, right, above and below it.
      for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6]]) {
        const pixel = shot.at((point.x + dx) * dpr, (point.y + dy) * dpr)
        expect(deltaE(pixel, accent), `${dx},${dy} ${JSON.stringify(pixel)}`).toBeLessThanOrEqual(3)
      }
    }
    await send.load(browserServers.sites.static.url('/elements.html'))
    const canvasBox = await (await send.driver()).rect('#canvas')
    // An empty canvas area, away from what the page drew.
    const canvasPoint = { x: Math.round(canvasBox.x + canvasBox.width - 20), y: Math.round(canvasBox.y + 20) }
    const canvas = await capture(send, agent, '#canvas', canvasPoint)
    await crosshairAt(canvas.screenshot, canvasPoint, Number(canvas.parsed.facts['Device pixel ratio']))

    // A canvas pick by the second Ctrl/Cmd+E with the mouse still: the crosshair is at the mouse.
    const driver = await send.driver()
    await (await send.panel.page()).waitForInputReady()
    await driver.key('e', [process.platform === 'darwin' ? 'meta' : 'control'])
    await expect.poll(async () => (await driver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
    const stillPoint = { x: canvasPoint.x - 30, y: canvasPoint.y + 10 }
    await driver.move(stillPoint.x, stillPoint.y)
    await expect.poll(async () => (await driver.highlight())?.label ?? '', { timeout: SEND_WAIT_MS }).toMatch(/^canvas#canvas /)
    await driver.key('e', [process.platform === 'darwin' ? 'meta' : 'control'])
    await expect(send.pick.actions).toBeVisible({ timeout: SEND_WAIT_MS })
    const byKey = await send.explainAndRead(agent)
    const byKeyFacts = parseContextFile(byKey.context).facts
    expect(parseNumbers(byKeyFacts['Pick point (top-level viewport, CSS px)'])).toEqual(stillPoint)
    await crosshairAt(path.join(send.projectRoot, byKey.screenshotPath), stillPoint, Number(byKeyFacts['Device pixel ratio']))

    await send.load(browserServers.sites.static.url('/shadow.html'))
    const shadow = await capture(send, agent, '#closed-host')
    await crosshairAt(shadow.screenshot, shadow.point, Number(shadow.parsed.facts['Device pixel ratio']))

    await send.load(browserServers.sites.static.url('/elements.html'))
    try {
      await send.fault('armEmptyCaptures', 1)
      const retried = await capture(send, agent, '#save-label')
      expect(retried.parsed.facts['Schema version']).toBe('1')
      expect((await fs.stat(retried.screenshot)).size).toBeGreaterThan(0)

      // The retry comes back empty too: the 025-FR-046 path – a toast naming why, no menu, pick mode still on, nothing written.
      const files = await send.captureFiles()
      await send.fault('armEmptyCaptures', 2)
      if ((await send.pick.pickButton.getAttribute('aria-pressed')) !== 'true') await send.pick.pickButton.click()
      const emptyDriver = await send.driver()
      await expect.poll(async () => (await emptyDriver.state()).active, { timeout: SEND_WAIT_MS }).toBe(true)
      await emptyDriver.hover(await emptyDriver.rect('#save-label'), 'span#save-label ')
      await emptyDriver.key('Return')
      const toast = send.errorToasts().filter({ hasText: "Couldn't capture this element" })
      await expect(toast).toHaveCount(1, { timeout: SEND_WAIT_MS })
      await expect(toast).toContainText('The screenshot came back empty')
      await expect(send.pick.actions).toHaveCount(0)
      await expect(send.pick.pickButton).toHaveAttribute('aria-pressed', 'true')
      expect(await emptyDriver.state()).toMatchObject({ active: true, capture: null })
      expect(await send.captureFiles()).toEqual(files)
    } finally {
      await send.fault('resetFaults')
    }
  })
})

/** The console entries of a context file: `time origin level: message`, one per entry. */
function consoleEntries(parsed: ParsedContextFile): string[] {
  return listItems(parsed.sections['Console']).filter((item) => /^\d\d:\d\d:\d\d\.\d{3} /.test(item))
}

/** The failed requests of a context file: `time origin status url`, one per entry. */
function failedRequests(parsed: ParsedContextFile): string[] {
  return listItems(parsed.sections['Failed requests']).filter((item) => /^\d\d:\d\d:\d\d\.\d{3} /.test(item))
}

/** Entries Erfana itself must never add: the DevTools agent's cache reads and Electron's development warnings. */
function expectNoEngineNoise(parsed: ParsedContextFile): void {
  expect(failedRequests(parsed).filter((f) => f.includes('ERR_CACHE_MISS'))).toEqual([])
  expect(consoleEntries(parsed).filter((e) => e.includes('Electron Security Warning'))).toEqual([])
}

test.describe('025-AC-038 recent errors in the context file', () => {
  test.skip(!IS_POSIX, 'The stub agent is a node program in front of a POSIX shell (macOS and Linux)')

  test('the last 20 console entries in time order and the failed requests; earlier entries are gone after a navigation; 21 failed requests list the last 20', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    const url = browserServers.sites.static.url('/console.html')
    await send.load(url)
    const page = await send.panel.page()
    await page.eval('window.__fixture.runSequence().then(() => 0)')
    await page.waitFor(`window.__fixture.count('request-failed') + window.__fixture.count('response') >= 2`, 'both requests settled')
    const { parsed } = await capture(send, agent, 'h1')
    const entries = consoleEntries(parsed)
    const messages = entries.map((e) => e.replace(/^\S+ \S+ /, ''))
    const expected = [...Array.from({ length: 19 }, (_, i) => `error: error ${i + 7}`), 'warning: final warning']
    expect(messages).toEqual(expected)
    const times = entries.map((e) => e.slice(0, 12))
    expect(times).toEqual([...times].sort())
    const origin = new URL(url).origin
    expect(entries.every((e) => e.split(' ')[1] === origin)).toBe(true)
    const failed = failedRequests(parsed)
    expect(failed.some((f) => / 500 .*\/__status\/500$/.test(f))).toBe(true)
    expect(failed.some((f) => f.includes('errors.invalid'))).toBe(true)
    // Both failed requests and nothing else: no entry of the load or of pick mode's own reads.
    expect(failed).toHaveLength(2)
    expectNoEngineNoise(parsed)

    // A new document: the earlier entries are gone.
    await send.load(browserServers.sites.static.url('/elements.html'))
    const after = await capture(send, agent, 'h1')
    expect(consoleEntries(after.parsed).filter((e) => /error \d+|final warning/.test(e))).toEqual([])
    expect(listItems(after.parsed.sections['Failed requests']).filter((f) => f.includes('__status/500') || f.includes('errors.invalid'))).toEqual([])

    // Exactly 21 failed requests: the last 20.
    await send.load(url)
    await (await send.panel.page()).clickSelector('#fetch-21')
    await (await send.panel.page()).waitFor(`window.__fixture.count('response') >= 21`, '21 requests settled')
    const last = (await capture(send, agent, 'h1')).parsed
    const all = failedRequests(last)
    // Exactly the last 20 of the 21, and nothing else in their places.
    expect(all).toHaveLength(20)
    const numbers = all.map((f) => Number(/\/__status\/404\?n=(\d+)$/.exec(f)?.[1])).sort((a, b) => a - b)
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 2))
    expectNoEngineNoise(last)
  })

  test('an uncaught exception, an unhandled rejection, a cross-origin frame’s error with its origin and a worker’s failed request are recorded; a cancelled request is not; a multi-line message stays one entry', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    const url = browserServers.sites.static.url('/console.html')
    const frameOrigin = new URL(browserServers.sites.static.url('/', { host: 'other.test' })).origin
    await send.load(url)
    const page = await send.panel.page()
    // The page sees its own uncaught exception and rejection too: the test waits for those, not for a timer.
    await page.eval(
      `addEventListener('error', () => window.__fixture.record('uncaught', 'e')); addEventListener('unhandledrejection', () => window.__fixture.record('rejection', 'r')); 0`
    )
    await page.clickSelector('#throw')
    await page.clickSelector('#reject')
    await page.waitFor(`window.__fixture.count('uncaught') >= 1 && window.__fixture.count('rejection') >= 1`, 'exception and rejection thrown')
    await page.clickSelector('#worker-fail')
    await page.waitFor(`window.__fixture.count('worker') >= 1`, 'the worker request settled')
    await page.clickSelector('#cancelled')
    await page.waitFor(`window.__fixture.log.some((e) => e.type === 'request-failed' && e.detail === 'cancelled AbortError')`, 'the request was cancelled')
    // A failure after the cancel: it is listed, so the list was read after the cancel happened.
    await page.eval(`fetch('/__status/404?after=cancel').then(() => window.__fixture.record('response', 'after-cancel')); 0`)
    await page.waitFor(`window.__fixture.log.some((e) => e.type === 'response' && e.detail === 'after-cancel')`, 'the later request settled')
    // A message whose second line forges an entry of its own (an Erfana bug: it read as one).
    await page.eval(`console.error('first line\\n- 00:00:00.000 https://forged.test error: forged entry'); 0`)

    const { parsed, text } = await capture(send, agent, 'h1')
    const entries = consoleEntries(parsed)
    expect(entries.filter((e) => e.includes('Uncaught fixture exception') && / error: Uncaught/.test(e))).toHaveLength(1)
    expect(entries.filter((e) => e.includes('Unhandled fixture rejection') && / error: Uncaught \(in promise\)/.test(e))).toHaveLength(1)
    const fromFrame = entries.filter((e) => e.includes('Error from frame error-frame'))
    expect(fromFrame).toHaveLength(1)
    expect(fromFrame[0].split(' ')[1]).toBe(frameOrigin)
    expect(fromFrame[0]).toContain(` error: Error from frame error-frame at ${frameOrigin}`)

    const failed = failedRequests(parsed)
    expect(failed.filter((f) => f.endsWith('/__status/404?from=worker'))).toHaveLength(1)
    expect(failed.filter((f) => f.endsWith('/__status/404?after=cancel'))).toHaveLength(1)
    expect(failed.filter((f) => f.includes('cancel-me'))).toEqual([])
    expectNoEngineNoise(parsed)

    // The forged line is indented under its own entry: it is no entry, and no line of the file starts with it.
    const multi = entries.filter((e) => e.includes('first line'))
    expect(multi).toEqual([expect.stringMatching(/ error: first line\n {2}- 00:00:00\.000 https:\/\/forged\.test error: forged entry$/)])
    expect(entries.filter((e) => e.startsWith('00:00:00.000'))).toEqual([])
    expect(text.split('\n').filter((line) => line.startsWith('- 00:00:00.000'))).toEqual([])
  })

  test('a flood beyond 200 events, and separately beyond 1 MB, in a second stops reporting until the next navigation with "logs truncated"', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const { send, agent } = await openSend(appWithTestProject, windowWithTestProject, testProject.path)
    const url = browserServers.sites.static.url('/console.html')
    for (const [name, flood] of [
      ['200 events', `for (let i = 0; i < 400; i += 1) console.error('flood ' + i)`],
      ['1 MB', `for (let i = 0; i < 3; i += 1) console.error('big ' + i + ' ' + 'x'.repeat(400 * 1024))`]
    ] as const) {
      await send.load(url)
      const page = await send.panel.page()
      await page.eval(`console.error('before the flood'); ${flood}; 0`)
      await page.eval(`console.error('after the flood'); 0`)
      const flooded = (await capture(send, agent, 'h1')).parsed
      const entries = consoleEntries(flooded)
      expect(flooded.notes, name).toContain('logs truncated')
      // Reporting stopped part-way through the flood: the last entries are of the flood, never its end, nor anything after it.
      expect(entries.filter((e) => e.includes('after the flood')), name).toEqual([])
      if (name === '200 events') {
        const numbers = entries.map((e) => Number(/ error: flood (\d+)$/.exec(e)?.[1]))
        expect(numbers.every((n) => Number.isInteger(n)), name).toBe(true)
        expect(Math.max(...numbers), name).toBeLessThan(399)
      } else {
        expect(entries.some((e) => e.endsWith('error: before the flood')), name).toBe(true)
        expect(entries.some((e) => / error: big 0 x/.test(e)), name).toBe(true)
        expect(entries.filter((e) => / error: big 2 /.test(e)), name).toEqual([])
      }

      // A new document: reporting is back and the note is gone.
      await send.load(url)
      await (await send.panel.page()).eval(`console.error('after the navigation'); 0`)
      const after = (await capture(send, agent, 'h1')).parsed
      expect(after.notes, name).not.toContain('logs truncated')
      expect(consoleEntries(after).filter((e) => e.endsWith('error: after the navigation')), name).toHaveLength(1)
      expect(consoleEntries(after).filter((e) => /flood/.test(e)), name).toEqual([])
    }
  })
})

/** A capture file name dated `ageMs` before `now`. */
function captureName(now: number, ageMs: number, id: string, ext: string): string {
  const d = new Date(now - ageMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  return `${stamp}-${id}${ext}`
}

const DAY = 24 * 60 * 60 * 1000
const SEEDED_AT = Date.now()
const OLD = [captureName(SEEDED_AT, 8 * DAY, '0000aaaa', '.md'), captureName(SEEDED_AT, 8 * DAY, '0000aaaa', '.png')]
const RECENT = [captureName(SEEDED_AT, 6 * DAY + 12 * 60 * 60 * 1000, '0000bbbb', '.md')]
const YOUNG = [captureName(SEEDED_AT, 2 * DAY, '0000cccc', '.md')]
const LOCKED = captureName(SEEDED_AT, 9 * DAY, '0000dddd', '.png')
const OTHER = 'notes-20200101.txt'
const LINK = captureName(SEEDED_AT, 10 * DAY, '0000eeee', '.png')

test.describe('025-AC-039 old captures are deleted on project open and every 24 hours', () => {
  test.skip(process.platform !== 'darwin', 'A locked file is made with chflags uchg (macOS)')
  test.use({
    testProjectFiles: {
      'notes.md': '# Notes',
      ...Object.fromEntries([...OLD, ...RECENT, ...YOUNG, OTHER].map((name) => [path.join(CAPTURES_REL, name), 'capture']))
    }
  })

  test('on open the 8-day captures go, the 6-day ones stay, a locked one is logged and the rest still processed, links and other names stay; 24 h later the 6-day ones go', async ({
    appWithTestProject,
    windowWithTestProject,
    testProject,
    homeDir
  }) => {
    const dir = path.join(testProject.path, CAPTURES_REL)
    const run = promisify(execFile)
    const names = async (): Promise<string[]> => (await fs.readdir(dir)).sort()
    // The seeded 8-day captures went when the fixture opened the project.
    await expect.poll(names, { timeout: SEND_WAIT_MS }).toEqual([OTHER, ...RECENT, ...YOUNG].sort())

    // Old captures again, a locked one and a link; then the project opens again (switch away and back).
    const target = path.join(testProject.path, 'notes.md')
    for (const name of OLD) await fs.writeFile(path.join(dir, name), 'capture')
    await fs.writeFile(path.join(dir, LOCKED), 'locked')
    await run('chflags', ['uchg', path.join(dir, LOCKED)])
    await fs.symlink(target, path.join(dir, LINK))
    const other = test.info().outputPath('other-project')
    await fs.mkdir(other, { recursive: true })
    await fs.writeFile(path.join(other, 'other.md'), '# Other')
    const log = new LogTail(appMainLogPath(homeDir))
    await log.mark()
    const open = (projectPath: string): Promise<void> =>
      windowWithTestProject.evaluate(async (p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, untyped in e2e
        await (window as any).api.file.openProjectByPath({ projectPath: p })
      }, projectPath)
    try {
      await open(other)
      await open(testProject.path)
      await expect.poll(names, { timeout: SEND_WAIT_MS }).toEqual([LOCKED, LINK, OTHER, ...RECENT, ...YOUNG].sort())
      await log.waitFor(/Browser capture expiry could not delete a file.*EPERM/, { timeout: SEND_WAIT_MS })
      expect(await fs.readFile(target, 'utf8')).toBe('# Notes')

      // 24 hours on the test clock: the 6½-day capture is now past 7 days; the 2-day one stays.
      await appWithTestProject.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- main's hooks, untyped there
        await (globalThis as any).__erfanaTestHooks.clock.advance(24 * 60 * 60 * 1000)
      })
      await expect.poll(names, { timeout: SEND_WAIT_MS }).toEqual([LOCKED, LINK, OTHER, ...YOUNG].sort())
    } finally {
      await run('chflags', ['nouchg', path.join(dir, LOCKED)]).catch(() => undefined)
    }
  })
})
