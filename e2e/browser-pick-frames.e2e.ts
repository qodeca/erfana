// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Picks inside frames and of elements that are not wholly on screen, end to
 * end (spec 025): 025-AC-029 (every frame kind, embedded content, a
 * transformed cross-site frame) and 025-AC-035 (partly off-screen,
 * off-screen, zero-size and covered elements).
 *
 * Expected boxes are read from each frame's own document through main
 * (`PickFlow.frameEval`, which reaches cross-site and sandboxed frames) and
 * added up through the `<iframe>` elements' boxes and borders; the outline
 * is the pick hook's box (S-1). Sends go to the app's terminal running
 * `cat`; context files and screenshots are read from disk. Condition-based
 * waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import {
  AgentTerminal,
  captureBox,
  contextFiles,
  near,
  newCapture,
  PickFlow,
  PICK_WAIT_MS as WAIT_MS,
  readPng
} from './pages/browser-pick-flow.page'
import type { Box } from './pages/browser-pick.page'

const ACCENT: [number, number, number] = [160, 168, 255] // --color-accent-primary (#A0A8FF), the screenshot's outline

const RECT = (selector: string): string =>
  `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
/** An `<iframe>`'s box and border, in its document. */
const FRAME_RECT = (selector: string): string =>
  `(() => { const f = document.querySelector(${JSON.stringify(selector)}); const r = f.getBoundingClientRect(); return { x: r.x + f.clientLeft, y: r.y + f.clientTop, width: r.width, height: r.height } })()`

const shift = (inner: Box, by: Box): Box => ({ x: inner.x + by.x, y: inner.y + by.y, width: inner.width, height: inner.height })

/** The lines of a context-file section (`### name`), up to the next blank line. */
function section(text: string, name: string): string[] {
  const lines = text.split('\n')
  const start = lines.indexOf(`### ${name}`)
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 2)) {
    if (line.trim() === '') break
    out.push(line.replace(/^- /, ''))
  }
  return out
}

/** Every pixel of the screenshot near the outline colour. */
async function accentPixels(png: Awaited<ReturnType<typeof readPng>>): Promise<number> {
  let count = 0
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) if (near(png.at(x, y), ACCENT, 6)) count++
  return count
}

/**
 * Hover `point` until the highlight label matches `label` and its box is
 * within 1 px of `expected`. Both are polled: the label alone can still be
 * the previous pick's highlight (the same button in another frame).
 */
async function hoverUntil(flow: PickFlow, point: { x: number; y: number }, label: RegExp, expected: Box, what: string): Promise<void> {
  let step = 0
  await expect(async () => {
    await flow.move(point.x + (step++ % 2), point.y)
    expect((await flow.highlightLabel()) ?? '').toMatch(label)
    const box = (await (await flow.driver()).highlight())?.box
    expect(box, `${what}: no highlight box`).toBeTruthy()
    expectNear(box!, expected, what)
  }).toPass({ timeout: WAIT_MS })
}

/**
 * The sandboxed frame's button box in that frame: no script runs there, so the same page is loaded in a test-owned,
 * not sandboxed, same-origin twin with the same content size, read from the top document, then removed.
 */
async function twinButton(flow: PickFlow): Promise<Box> {
  await flow.eval(`(() => {
    const frame = document.getElementById('sandboxed')
    const twin = document.createElement('iframe'); twin.id = 'twin'; twin.src = '/frame-sandboxed.html'
    twin.style.cssText = 'border:0;width:' + frame.clientWidth + 'px;height:' + frame.clientHeight + 'px'
    document.body.append(twin); return 0 })()`)
  await expect
    .poll(() => flow.eval<boolean>(`document.getElementById('twin').contentDocument?.readyState === 'complete' && !!document.getElementById('twin').contentDocument.getElementById('frame-button')`), {
      timeout: WAIT_MS
    })
    .toBe(true)
  const box = await flow.eval<Box>(
    `(() => { const r = document.getElementById('twin').contentDocument.getElementById('frame-button').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
  )
  await flow.eval(`document.getElementById('twin').remove(); 0`)
  return box
}

function expectNear(actual: Box, expected: Box, what: string): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${what} ${key}: ${actual[key]} vs ${expected[key]}`).toBeLessThanOrEqual(1)
  }
}

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('025-AC-029 picks inside frames', () => {
  test('a button in each frame kind: the outline matches it in top-level CSS px, Up and Down work, the send completes and the context file lists the frame chain with each origin (null for the sandboxed frame)', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    const page = browserServers.sites.static.url('/frames.html')
    await flow.load(page)
    const top = new URL(page).origin
    const other = new URL(browserServers.sites.static.url('/', { host: 'other.test' })).origin

    for (const kind of [
      { id: 'same-origin', frames: ['name=same-origin'], origins: [top, top] },
      { id: 'cross-site', frames: ['name=cross-site'], origins: [top, other] },
      { id: 'nested', frames: ['frame-nest-1.html', 'frame-nest-2.html', 'name=level-3'], origins: [top, top, top, top] },
      { id: 'srcdoc', frames: ['about:srcdoc'], origins: [top, top] },
      { id: 'blank-written', frames: ['about:blank'], origins: [top, top] },
      { id: 'sandboxed', frames: ['frame-sandboxed.html'], origins: [top, 'null'] }
    ]) {
      // The lower frames start below the viewport: bring each one in (the hit test then has a scroll offset to add).
      await flow.eval(`document.getElementById('${kind.id}').scrollIntoView({ block: 'center' }); 0`)
      // The button's box in top-level CSS px: each frame's box and border, then the button in the last frame.
      let offset = await flow.eval<Box>(FRAME_RECT(`#${kind.id}`))
      for (let i = 0; i < kind.frames.length - 1; i++) {
        offset = shift(await flow.frameEval<Box>(kind.frames[i], FRAME_RECT('iframe')), offset)
      }
      const inner = kind.id === 'sandboxed' ? await twinButton(flow) : await flow.frameEval<Box>(kind.frames[kind.frames.length - 1], RECT('#frame-button'))
      const button = shift(inner, offset)

      await flow.pickButton.click()
      await flow.waitForActive(true)
      // The button's left padding: the button itself, not its label.
      await hoverUntil(flow, { x: button.x + 3, y: button.y + 3 }, /^button#frame-button /, button, `${kind.id} outline`)
      await flow.key('Up')
      await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^div\.wrap /)
      await flow.key('Down')
      await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(/^button#frame-button /)
      await flow.key('Return')
      await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
      const before = await contextFiles(testProject.path)
      await flow.action('Explain').click()
      await expect(flow.status).toContainText('Sent Explain to Terminal', { timeout: WAIT_MS })
      const capture = await newCapture(testProject.path, before)
      expect(section(capture.text, 'Frame chain'), `${kind.id} frame chain`).toEqual(kind.origins)
      await flow.waitForActive(false)
    }
  })

  /** Highlight the same-origin frame's button, then remove the frame; the button's box. */
  async function removeHighlightedFrame(flow: PickFlow): Promise<Box> {
    await flow.pickButton.click()
    await flow.waitForActive(true)
    const frame = await flow.eval<Box>(FRAME_RECT('#same-origin'))
    const button = shift(await flow.frameEval<Box>('name=same-origin', RECT('#frame-button')), frame)
    await hoverUntil(flow, { x: button.x + 3, y: button.y + 3 }, /^button#frame-button /, button, 'same-origin outline')
    expect(await flow.eval<boolean>(`window.__fixture.removeFrame('same-origin')`)).toBe(true)
    return button
  }

  test('a frame removed while it holds the highlight: the next pointer move ends the highlight; pick mode stays on', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/frames.html'))
    const removed = await removeHighlightedFrame(flow)
    // The frames below move up: the cross-site frame's button now lies under the same point, and the highlight
    // follows it (its own box), not the removed button.
    const frame = await flow.eval<Box>(FRAME_RECT('#cross-site'))
    const next = shift(await flow.frameEval<Box>('name=cross-site', RECT('#frame-button')), frame)
    expect(next.width, 'a different button').not.toBeCloseTo(removed.width, 0)
    await hoverUntil(flow, { x: removed.x + 3, y: removed.y + 3 }, /^button#frame-button /, next, 'the button now under the pointer')
    await expect(flow.pickButton).toHaveAttribute('aria-pressed', 'true')
    expect((await flow.state()).active).toBe(true)
  })

  test('a frame removed while it holds the highlight ends the highlight with no pointer move', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/frames.html'))
    await removeHighlightedFrame(flow)
    // No pointer move after the removal: main's highlight record (the outline and its label) ends on its own.
    await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toBeNull()
    expect((await flow.state()).active).toBe(true)
  })

  /** Put a test-owned host element at the top of elements.html (no fixture page carries one), then hover its centre. */
  async function hoverHost(flow: PickFlow, create: string, selector: string, label: RegExp): Promise<void> {
    await flow.eval(`(() => { const host = ${create}; host.style.cssText += ';display:block;width:240px;height:120px'; document.body.prepend(host); return 0 })()`)
    await flow.pickButton.click()
    await flow.waitForActive(true)
    const box = await flow.rect(selector)
    await hoverUntil(flow, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, label, box, selector)
  }

  test('an <embed> PDF is picked as its host element, not the content inside', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    // The <embed> loads the PDF as a child document that the hit test goes into; the host is picked instead (S-2).
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await hoverHost(flow, `Object.assign(document.createElement('embed'), { id: 'pdf', type: 'application/pdf', src: '/sample.pdf' })`, '#pdf', /^embed#pdf /)
  })

  test('a <fencedframe> is picked as its host element', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/elements.html'))
    await hoverHost(flow, `Object.assign(document.createElement('fencedframe'), { id: 'fenced' })`, '#fenced', /^fencedframe#fenced /)
  })

  test('a rotated and scaled cross-site frame: the outline still matches the element\'s box', async ({ appWithTestProject, windowWithTestProject, browserServers }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await flow.load(browserServers.sites.static.url('/probes/frames.html'))
    await expect.poll(async () => flow.frameEval<string>('name=transformed', 'document.readyState').catch(() => ''), { timeout: WAIT_MS }).toBe('complete')
    const inner = await flow.frameEval<Box>('name=transformed', RECT('#target'))
    // The fixture's transform: page = (80, 300) + rotate(12deg) · 0.8 · frame point (transform-origin 0 0).
    const rad = (12 * Math.PI) / 180
    const map = (x: number, y: number): { x: number; y: number } => ({
      x: 80 + 0.8 * (x * Math.cos(rad) - y * Math.sin(rad)),
      y: 300 + 0.8 * (x * Math.sin(rad) + y * Math.cos(rad))
    })
    const corners = [map(inner.x, inner.y), map(inner.x + inner.width, inner.y), map(inner.x, inner.y + inner.height), map(inner.x + inner.width, inner.y + inner.height)]
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    const expected = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    await flow.pickButton.click()
    await flow.waitForActive(true)
    await hoverUntil(flow, map(inner.x + inner.width / 2, inner.y + inner.height / 2), /^div#target /, expected, 'transformed frame')
  })
})

test.describe('elements not wholly on screen (025-AC-035)', () => {
  test('an element taller than the viewport: the scroll position is unchanged, the outline runs to the image edge and the context file says partly off-screen with the full size', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/offscreen.html'))
    await flow.eval(`document.getElementById('tall').scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); 0`)
    const scrollBefore = await flow.eval<number>('window.scrollY')
    const viewport = await flow.eval<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })')
    await flow.pickButton.click()
    const tall = await flow.rect('#tall')
    expect(tall.height).toBeGreaterThan(viewport.height)
    await flow.pickByClick('#tall', 'div#tall ')
    const before = await contextFiles(testProject.path)
    await flow.action('Explain').click()
    const capture = await newCapture(testProject.path, before)
    expect(await flow.eval<number>('window.scrollY')).toBe(scrollBefore)
    expect(capture.text).toMatch(/^- partly off-screen$/m)
    const { box, dpr } = captureBox(capture.text)
    expect(Math.abs(box.height - tall.height)).toBeLessThanOrEqual(1)
    const png = await readPng(appWithTestProject, capture.screenshot)
    // The left edge of the outline runs down to the image's last row: clipped there, not closed.
    const edgeAtBottom = [1, 2].map((d) => png.at(box.x * dpr - d, png.height - 1))
    expect(edgeAtBottom.some((c) => near(c, ACCENT, 30)), `outline at the image edge: ${JSON.stringify(edgeAtBottom)}`).toBe(true)
  })

  for (const kind of [
    { name: 'a parent wholly above the viewport', child: '#above-child', childLabel: 'div#above-child ', parentLabel: /^div#above-parent /, note: 'off-screen', setup: 'window.__fixture.scrollToAboveChild()' },
    { name: 'a zero-size element', child: '#zero-child', childLabel: 'div#zero-child ', parentLabel: /^div#zero-size /, note: 'zero size', setup: '0' }
  ]) {
    test(`${kind.name}, reached by Up, is sent with "${kind.note}" and no outline`, async ({ appWithTestProject, windowWithTestProject, browserServers, testProject }) => {
      const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
      await new AgentTerminal(windowWithTestProject, flow).start()
      await flow.load(browserServers.sites.static.url('/offscreen.html'))
      await flow.eval(`${kind.setup}; 0`)
      await flow.pickButton.click()
      await flow.waitForActive(true)
      // On a scrolled page (the first kind) this hover needs the hit test to add the scroll offset.
      await flow.hover(kind.child, kind.childLabel)
      await flow.key('Up')
      await expect.poll(() => flow.highlightLabel(), { timeout: WAIT_MS }).toMatch(kind.parentLabel)
      await flow.key('Return')
      await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
      const before = await contextFiles(testProject.path)
      await flow.action('Explain').click()
      const capture = await newCapture(testProject.path, before)
      expect(capture.text).toMatch(new RegExp(`^- ${kind.note}$`, 'm'))
      expect(await accentPixels(await readPng(appWithTestProject, capture.screenshot)), 'no outline in the screenshot').toBe(0)
    })
  }

  test('025-AC-035 an element under the fixture\'s overlay <div> (which lets clicks through) is sent with "covered by" and the tag div inside the untrusted block', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    // The click goes through the overlay (`pointer-events: none`) to #covered; the covered-by check uses the hit
    // test's topmost rule, which finds the overlay drawn on top (ADR 0007 decision 4, amended 2026-11-05).
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/offscreen.html'))
    await flow.pickButton.click()
    await flow.pickByClick('#covered', 'div#covered ')
    await expectCoveredByDiv(flow, testProject.path)
  })

  test('an element under an overlay <div> that catches clicks is sent with "covered by" and the tag div inside the untrusted block', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers,
    testProject
  }) => {
    const flow = await PickFlow.open(appWithTestProject, windowWithTestProject)
    await new AgentTerminal(windowWithTestProject, flow).start()
    await flow.load(browserServers.sites.static.url('/offscreen.html'))
    await flow.pickButton.click()
    await flow.waitForActive(true)
    // Outline the covered element first (the overlay lets the pointer through), then make the overlay catch clicks
    // and confirm by key with no pointer move: the element picked is the covered one, and the overlay is on top.
    await flow.hover('#covered', 'div#covered ')
    await flow.eval(`document.getElementById('overlay').style.pointerEvents = 'auto'; 0`)
    await flow.key('Return')
    await expect(flow.actions).toBeVisible({ timeout: WAIT_MS })
    await expect(flow.chip).toHaveText(/^div#covered · /)
    await expectCoveredByDiv(flow, testProject.path)
  })
})

/** Send Explain; the context file carries "covered by" and, inside the untrusted block, the covering tag div. */
async function expectCoveredByDiv(flow: PickFlow, projectRoot: string): Promise<void> {
  const before = await contextFiles(projectRoot)
  await flow.action('Explain').click()
  const capture = await newCapture(projectRoot, before)
  expect(capture.text).toMatch(/^- covered by \(the covering element is named in the untrusted block\)$/m)
  const lines = capture.text.split('\n')
  const open = lines.findIndex((l) => /^<<<ERFANA-UNTRUSTED-[0-9a-f]{32}>>>$/.test(l))
  const close = lines.findIndex((l) => /^<<<END-ERFANA-UNTRUSTED-[0-9a-f]{32}>>>$/.test(l))
  const covered = lines.indexOf('### Covered by')
  expect(covered).toBeGreaterThan(open)
  expect(covered).toBeLessThan(close)
  expect(section(capture.text, 'Covered by')).toEqual([expect.stringMatching(/^div\b/)])
}
