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
 * value. 025-AC-034 is not titled: no hook gives the pick label a unique test
 * colour to look for, and the 125 % / 150 % runs are Windows. 025-AC-038 is
 * not titled: the uncaught exception, rejection, cross-origin frame, worker,
 * cancelled-request and flood cases are not covered, and the load itself adds
 * two `net::ERR_CACHE_MISS` "failed requests" (one with no origin or URL) that
 * take places in the last 20. 025-AC-039 runs on macOS, where `chflags uchg`
 * locks a file.
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

test.describe('the screenshot and the crop (025-AC-034)', () => {
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
        const { parsed, screenshot, crop } = await capture(send, agent, '[id="1abc"]')
        const dpr = Number(parsed.facts['Device pixel ratio'])
        expect(dpr).toBe(scale)
        const [vw, vh] = parsed.facts['Viewport'].split(' ')[0] === '' ? [0, 0] : parsed.facts['Viewport'].replace(' CSS px', '').split(' × ').map(Number)
        const shot = await readPng(screenshot)
        expect(Math.abs(shot.width - vw * dpr)).toBeLessThanOrEqual(1)
        expect(Math.abs(shot.height - vh * dpr)).toBeLessThanOrEqual(1)

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
    } finally {
      await send.fault('resetFaults')
    }
  })
})

/** The console entries of a context file: `time origin level: message`, one per entry. */
function consoleEntries(parsed: ParsedContextFile): string[] {
  return listItems(parsed.sections['Console']).filter((item) => /^\d\d:\d\d:\d\d\.\d{3} /.test(item))
}

test.describe('recent errors in the context file (025-AC-038)', () => {
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
    const failed = listItems(parsed.sections['Failed requests'])
    expect(failed.some((f) => / 500 .*\/__status\/500$/.test(f))).toBe(true)
    expect(failed.some((f) => f.includes('errors.invalid'))).toBe(true)

    // A new document: the earlier entries are gone.
    await send.load(browserServers.sites.static.url('/elements.html'))
    const after = await capture(send, agent, 'h1')
    expect(consoleEntries(after.parsed).filter((e) => /error \d+|final warning/.test(e))).toEqual([])
    expect(listItems(after.parsed.sections['Failed requests']).filter((f) => f.includes('__status/500') || f.includes('errors.invalid'))).toEqual([])

    // Exactly 21 failed requests: the last 20.
    await send.load(url)
    await (await send.panel.page()).clickSelector('#fetch-21')
    await (await send.panel.page()).waitFor(`window.__fixture.count('response') >= 21`, '21 requests settled')
    const all = listItems((await capture(send, agent, 'h1')).parsed.sections['Failed requests'])
    // At most 20, the newest: the requests of the 21 that are listed run on to the last one.
    // (Erfana also lists two net::ERR_CACHE_MISS entries of the load itself, which take two of the
    // 20 places – reported as a product finding; the window is still the newest 20.)
    expect(all).toHaveLength(20)
    const numbers = all.filter((f) => f.includes('/__status/404?n=')).map((f) => Number(/n=(\d+)/.exec(f)![1])).sort((a, b) => a - b)
    expect(numbers.at(-1)).toBe(21)
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => 22 - numbers.length + i))
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
