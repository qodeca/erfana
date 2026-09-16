// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – frames show pages from the same project (#124, part 2, WI-24).
 *
 * P2-AC1 same-project `src` and `srcdoc` frames run script, CSS and images,
 * sealed from their parent, and saving what a frame uses reloads the preview;
 * P2-AC2 a host blocked inside a frame reaches the permission band and loads
 * after approval; P2-AC3 refused frames are listed – each with the layer that
 * wrote the entry – and never reach the band; P2-AC4 the depth and count caps
 * (user answer 9 for `srcdoc`), and a link inside a frame changes only the
 * frame. P2-AC5 (pages without frames unchanged) is the corpus spec. DoD-2 and
 * DoD-3: this spec runs on the `frames/` corpus.
 *
 * Every test seeds `e2e/fixtures/html-preview-corpus/frames/` into its own temp
 * project, then makes what must never be committed: the symlink
 * `frames/escape.html` pointing outside the project, `frames/node_modules/`,
 * `frames/.hidden/` and `frames/.gitignore` naming `private.html`.
 *
 * Which layer wrote each refused-frame entry is read from Electron's own
 * signals (`html-preview.frames.ts`, `writerOf`) and attached to the test as a
 * `refused-frame` annotation; the layers the design fixes are asserted.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see docs/design/design-issue-124-part2.md
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import type { ElectronApplication, Page } from '@playwright/test'
import { test as base, expect } from './fixtures/localServer'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import {
  armFrameTrail,
  dismissToasts,
  evalInFrame,
  frameTree,
  readBadgeGroups,
  readFrameTrail,
  resetHostZoom,
  waitForBadgeCount,
  writerOf
} from './pages/html-preview.frames'
import { FAILURE_TYPE_LABELS as LABEL } from '../src/renderer/src/components/Panels/HtmlPreviewPanel/htmlPreview.logic'
import { PREVIEW } from '../src/shared/constants'
import { PREVIEW_LIMITS } from '../src/shared/preview-limits'
import { SRCDOC_TOO_DEEP_ENTRY, describeFramesOverLimit } from '../src/shared/previewFrameBadgeText'

const FRAMES_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus', 'frames')
const { MAX_FRAME_DEPTH, MAX_FRAMES_PER_PAGE } = PREVIEW_LIMITS

/** Fixture facts the assertions depend on. */
const CHAIN_LEVELS = 4
const MANY_FRAMES = 60
const REMOTE_URL = 'https://example.com/frame.html'
const FOREIGN_URL = 'erfana-preview://0123456789abcdef0123456789abcdef/frames/child.html'
const CDN_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js'
const CHILD_TITLE = 'Frames child -CHILD-'
const NAV_TARGET_TITLE = 'Frame links target -FRAMENAV-B-'

const INDEX = 'frames/index.html'
const REFUSED = 'frames/refused.html'

interface Frames {
  preview: HtmlPreviewPage
  page: Page
  app: ElectronApplication
  projectPath: string
  outsideFile: string
}

/** The committed `frames/` corpus, as `testProjectFiles`. */
function framesCorpus(): Record<string, string> {
  const files: Record<string, string> = { 'notes.md': '# Notes\n' }
  for (const name of fs.readdirSync(FRAMES_DIR)) {
    files[`frames/${name}`] = fs.readFileSync(path.join(FRAMES_DIR, name), 'utf-8')
  }
  return files
}

/** The files the design keeps out of git, made in the temp project only. */
async function seedSetupOnly(projectPath: string, outsideFile: string): Promise<void> {
  const frames = path.join(projectPath, 'frames')
  await fsp.writeFile(outsideFile, '<!DOCTYPE html><title>-OUTSIDE-</title><p>outside</p>\n', 'utf-8')
  await fsp.symlink(outsideFile, path.join(frames, 'escape.html'))
  for (const folder of ['node_modules', '.hidden']) {
    await fsp.mkdir(path.join(frames, folder), { recursive: true })
    await fsp.writeFile(path.join(frames, folder, 'x.html'), '<!DOCTYPE html><title>-EXCLUDED-</title>\n', 'utf-8')
  }
  await fsp.writeFile(path.join(frames, '.gitignore'), 'private.html\n', 'utf-8')
}

const test = base.extend<{ frames: Frames }>({
  frames: async ({ windowWithTestProject: page, appWithTestProject: app, testProject }, use) => {
    const outsideDir = await fsp.mkdtemp(path.join(path.dirname(testProject.path), 'frames-outside-'))
    const outsideFile = path.join(outsideDir, 'outside.html')
    await seedSetupOnly(testProject.path, outsideFile)
    await armFrameTrail(app)
    await resetHostZoom(app, page)
    await dismissToasts(page)
    await use({ preview: new HtmlPreviewPage(page, app), page, app, projectPath: testProject.path, outsideFile })
    await resetHostZoom(app, page)
    await fsp.rm(outsideDir, { recursive: true, force: true })
  }
})

test.use({ testProjectFiles: framesCorpus() })

const target = HtmlPreviewPage.target

async function openAndSettle(h: Frames, relPath: string, sentinel: string): Promise<void> {
  await h.preview.open(relPath)
  await h.preview.waitForTitled(sentinel)
}

/** Replace `from` with `to` in a project file; the fixture must hold `from`. */
async function edit(h: Frames, relPath: string, from: string | RegExp, to: string): Promise<void> {
  const file = path.join(h.projectPath, relPath)
  const text = await fsp.readFile(file, 'utf-8')
  expect(text, `${relPath} no longer holds ${String(from)}`).toMatch(from)
  await fsp.writeFile(file, text.replace(from, to), 'utf-8')
}

/** The frames of one preview, by title – polled until `ready` holds. */
async function framesWhen(
  h: Frames,
  relPath: string,
  ready: (titles: string[]) => boolean,
  message: string
): Promise<Awaited<ReturnType<typeof frameTree>>> {
  let tree = await frameTree(h.app, target(relPath))
  await expect
    .poll(
      async () => {
        tree = await frameTree(h.app, target(relPath))
        return ready(tree.map((f) => f.title))
      },
      { timeout: PREVIEW_BUDGET_MS, message }
    )
    .toBe(true)
  return tree
}

/**
 * The badge as `{ label: entries (sorted) }`, after attaching one `refused-frame`
 * annotation per entry naming the layer that wrote it. Returns the writers too.
 */
async function badgeWithWriters(h: Frames): Promise<{ groups: Record<string, string[]>; writer: (e: string) => string }> {
  const groups = await readBadgeGroups(h.page)
  const trail = await readFrameTrail(h.app)
  await test.info().attach('frame-trail', { body: JSON.stringify(trail, null, 2), contentType: 'application/json' })
  const writers = new Map<string, string>()
  const byLabel: Record<string, string[]> = {}
  for (const group of groups) {
    byLabel[group.label] = [...group.entries].sort()
    for (const entry of group.entries) {
      writers.set(entry, writerOf(entry, trail))
      test.info().annotations.push({ type: 'refused-frame', description: `${group.label}: ${entry} ← ${writers.get(entry)}` })
    }
  }
  return { groups: byLabel, writer: (entry) => writers.get(entry) ?? 'not listed' }
}

// --- the page's own JavaScript state, the reload probe ---------------------

const PAGE_MARK = "getComputedStyle(document.documentElement).getPropertyValue('--page-mark').trim()"

async function markPage(h: Frames, relPath: string): Promise<void> {
  expect(await h.preview.eval("(window.__e2eMarker = 'kept')", target(relPath))).toBe('kept')
}

async function pageMarker(h: Frames, relPath: string): Promise<string | null> {
  return h.preview.eval('String(window.__e2eMarker)', target(relPath))
}

/**
 * Save `page.css` (top page only) until the change shows in place. Proves the
 * page's watchers are live, and is itself the in-place swap. Retried: a save
 * that lands before the watch set is armed is simply not seen.
 */
async function swapPageCss(h: Frames, relPath: string, value: string): Promise<void> {
  let round = 0
  await expect(async () => {
    round += 1
    await edit(h, 'frames/page.css', /--page-mark: [^;]+;/, `--page-mark: ${value}-${round};`)
    await expect.poll(() => h.preview.eval(PAGE_MARK, target(relPath)), { timeout: 3_000 }).toBe(`${value}-${round}`)
  }).toPass({ timeout: PREVIEW_BUDGET_MS })
}

interface FrameReport {
  js: boolean
  version: string
  css: string
  shared: string
  img: boolean
  canReadParent: boolean
  parentCanRead: boolean
}
type FrameReports = Partial<Record<'src' | 'srcdoc', FrameReport>>

async function frameReports(h: Frames): Promise<FrameReports> {
  return JSON.parse((await h.preview.eval('JSON.stringify(window.__frameReports || {})', target(INDEX))) ?? '{}')
}

test.describe('HTML preview frames – same-project frames (P2-AC1)', () => {
  test('should run script, CSS and an image in a src and a srcdoc frame, each sealed from its parent', async ({ frames: h }) => {
    await openAndSettle(h, INDEX, '-FRAMES-1-')

    const reports = await frameReports(h)
    const sealed = { js: true, img: true, css: 'child-v1', canReadParent: false, parentCanRead: false }
    expect(reports.src).toMatchObject({ ...sealed, version: '1', shared: 'shared-v1' })
    expect(reports.srcdoc).toMatchObject(sealed)
    expect((await frameTree(h.app, target(INDEX))).map((f) => f.title).sort()).toEqual([CHILD_TITLE, 'srcdoc child'])
    expect(await h.preview.failureBadgeCount()).toBe(0)
  })

  const FRAME_SAVES: Array<{ file: string; from: string; to: string; fresh: (r: FrameReports) => boolean }> = [
    { file: 'child.html', from: 'data-version="1"', to: 'data-version="2"', fresh: (r) => r.src?.version === '2' },
    { file: 'child.css', from: 'child-v1', to: 'child-v2', fresh: (r) => r.src?.css === 'child-v2' && r.srcdoc?.css === 'child-v2' },
    { file: 'child.svg', from: 'fill="#2b6cb0"', to: 'fill="#b02b6c"', fresh: (r) => r.src?.img === true && r.srcdoc?.img === true },
    { file: 'shared.css', from: 'shared-v1', to: 'shared-v2', fresh: (r) => r.src?.shared === 'shared-v2' }
  ]
  for (const save of FRAME_SAVES) {
    test(`should reload the preview when ${save.file}, which a frame uses, is saved`, async ({ frames: h }) => {
      await openAndSettle(h, INDEX, '-FRAMES-1-')
      await swapPageCss(h, INDEX, 'warm')
      await markPage(h, INDEX)

      await edit(h, `frames/${save.file}`, save.from, save.to)

      await expect
        .poll(() => pageMarker(h, INDEX), { timeout: PREVIEW_BUDGET_MS, message: `saving ${save.file} did not reload the preview` })
        .toBe('undefined')
      await h.preview.waitForTitled('-FRAMES-1-')
      await expect
        .poll(async () => save.fresh(await frameReports(h)), { timeout: PREVIEW_BUDGET_MS, message: `a frame kept the old ${save.file}` })
        .toBe(true)
    })
  }

  test('should swap page.css in place, without a reload, when only the top page uses it', async ({ frames: h }) => {
    await openAndSettle(h, INDEX, '-FRAMES-1-')
    await markPage(h, INDEX)

    await swapPageCss(h, INDEX, 'swapped')

    expect(await pageMarker(h, INDEX)).toBe('kept')
  })
})

test.describe('HTML preview frames – refused frames (P2-AC3)', () => {
  test('should list every refused frame with the layer that wrote it, and load the gitignored frame', async ({ frames: h }) => {
    await openAndSettle(h, REFUSED, '-REFUSED-')
    const tree = await framesWhen(h, REFUSED, (t) => t.includes('Private frame -PRIVATE-'), 'the gitignored frame never loaded')

    expect(tree.length).toBe(9)

    await waitForBadgeCount(h.preview, 8)
    const { groups, writer } = await badgeWithWriters(h)
    // The browser's own-token frame-src refuses these before any other layer (S10).
    for (const entry of [REMOTE_URL, FOREIGN_URL, 'data:', 'blob:']) {
      expect(writer(entry), entry).toBe('failed-load writer (-30)')
    }
    // Same token: the guard lets them through and the protocol handler refuses them.
    for (const entry of ['/frames/escape.html', '/frames/node_modules/x.html', '/frames/.hidden/x.html', '/frames/missing.html']) {
      expect(writer(entry), entry).toMatch(/^protocol handler \(HTTP 4\d\d\)$/)
    }
    // No refused frame shows a document.
    const titles = (await frameTree(h.app, target(REFUSED))).map((f) => f.title).join(' | ')
    for (const leaked of ['-OUTSIDE-', '-EXCLUDED-', '-BLOB-', CHILD_TITLE]) expect(titles).not.toContain(leaked)
    // Each entry under its label (part 2 §2.12). Soft, so every misfiled entry shows in one run.
    // escape.html is a leaf symlink: macOS/Linux refuse it at the O_NOFOLLOW open (404, step 8e), Windows at the escape check (step 8g).
    const escapeLabel = process.platform === 'win32' ? LABEL['frame-escape'] : LABEL['missing-local-file']
    const expected: Record<string, string[]> = {
      [LABEL['frame-remote']]: ['blob:', 'data:', REMOTE_URL].sort(),
      [LABEL['frame-escape']]: [FOREIGN_URL],
      [LABEL['frame-excluded']]: ['/frames/.hidden/x.html', '/frames/node_modules/x.html'],
      [LABEL['missing-local-file']]: ['/frames/missing.html']
    }
    expected[escapeLabel] = [...expected[escapeLabel], '/frames/escape.html'].sort()
    expect.soft(groups).toEqual(expected)
  })

  test('should leave the permission band empty when only frames are refused', async ({ frames: h }) => {
    await openAndSettle(h, REFUSED, '-REFUSED-')
    await waitForBadgeCount(h.preview, 8)

    await expect(h.preview.chip()).toContainText('0 blocked · 0 allowed')
  })

  test('should never reload for a change to a frame file outside the project', async ({ frames: h }) => {
    await openAndSettle(h, REFUSED, '-REFUSED-')
    await swapPageCss(h, REFUSED, 'warm')
    await markPage(h, REFUSED)

    await fsp.writeFile(h.outsideFile, '<!DOCTYPE html><title>-OUTSIDE-CHANGED-</title>\n', 'utf-8')
    // Barrier: a later change the watchers DO see lands in place, so the outside
    // write has had its full chance to reload the page.
    await swapPageCss(h, REFUSED, 'after-outside')

    expect(await pageMarker(h, REFUSED)).toBe('kept')
    expect((await frameTree(h.app, target(REFUSED))).map((f) => f.title).join(' | ')).not.toContain('-OUTSIDE')
  })
})

test.describe('HTML preview frames – frame caps and frame links (P2-AC4)', () => {
  test('should load src frames to the depth limit and leave the next level empty and listed', async ({ frames: h }) => {
    expect(MAX_FRAME_DEPTH, `chain.html is ${CHAIN_LEVELS} levels deep`).toBeLessThan(CHAIN_LEVELS)
    await openAndSettle(h, 'frames/chain.html', '-CHAIN-0-')
    const loaded = Array.from({ length: MAX_FRAME_DEPTH }, (_, i) => `-CHAIN-${i + 1}-`)
    const tree = await framesWhen(h, 'frames/chain.html', (t) => loaded.every((s) => t.some((x) => x.includes(s))), 'a level within the limit did not load')

    await waitForBadgeCount(h.preview, 1)
    const { groups, writer } = await badgeWithWriters(h)
    expect(groups).toEqual({ [LABEL['frame-too-deep']]: [`/frames/chain-${MAX_FRAME_DEPTH + 1}.html`] })
    expect(writer(`/frames/chain-${MAX_FRAME_DEPTH + 1}.html`)).toBe('frame guard')
    for (const f of tree) expect(f.title, `depth ${f.depth}`).toEqual(f.depth <= MAX_FRAME_DEPTH ? expect.stringContaining(`-CHAIN-${f.depth}-`) : '')
    expect(tree.map((f) => f.depth).sort()).toEqual(Array.from({ length: MAX_FRAME_DEPTH + 1 }, (_, i) => i + 1))
  })

  test('should show a srcdoc 4th level and list it once, while a src 4th level stays empty and listed', async ({ frames: h }) => {
    await openAndSettle(h, 'frames/srcdoc-chain.html', '-SRCDOC-0-')
    const tree = await framesWhen(h, 'frames/srcdoc-chain.html', (t) => t.some((x) => x.includes('-SRCDOC-4-')), 'the srcdoc 4th level was not shown')

    await waitForBadgeCount(h.preview, 2)
    const { groups, writer } = await badgeWithWriters(h)
    expect(groups).toEqual({ [LABEL['frame-too-deep']]: ['/frames/chain-4.html', SRCDOC_TOO_DEEP_ENTRY].sort() })
    expect(writer(SRCDOC_TOO_DEEP_ENTRY)).toBe('srcdoc detector')
    expect(writer('/frames/chain-4.html')).toBe('frame guard')
    const fourth = tree.filter((f) => f.depth === 4).map((f) => f.title).sort()
    expect(fourth).toEqual(['', 'srcdoc level 4 -SRCDOC-4-'])
  })

  test('should load src frames up to the count limit and list the rest in one entry, page responsive', async ({ frames: h }) => {
    expect(MANY_FRAMES).toBeGreaterThan(MAX_FRAMES_PER_PAGE)
    await openAndSettle(h, 'frames/many.html', '-MANY-')
    await framesWhen(h, 'frames/many.html', (t) => t.filter((x) => x === '-TINY-').length >= MAX_FRAMES_PER_PAGE, 'the frames within the limit did not load')

    await waitForBadgeCount(h.preview, 1)
    const { groups, writer } = await badgeWithWriters(h)
    const entry = describeFramesOverLimit(MANY_FRAMES - MAX_FRAMES_PER_PAGE, 'src')
    expect(groups).toEqual({ [LABEL['frame-over-limit']]: [entry] })
    expect(writer(entry)).toBe('frame guard')
    const titles = (await frameTree(h.app, target('frames/many.html'))).map((f) => f.title)
    expect({ loaded: titles.filter((t) => t === '-TINY-').length, empty: titles.filter((t) => t === '').length }).toEqual({
      loaded: MAX_FRAMES_PER_PAGE,
      empty: MANY_FRAMES - MAX_FRAMES_PER_PAGE
    })

    // Responsive: the page and the host each answer a round trip promptly.
    let started = Date.now()
    expect(await h.preview.eval('document.title', target('frames/many.html'))).toContain('-MANY-')
    expect(Date.now() - started).toBeLessThan(2_000)
    started = Date.now()
    expect(await h.page.evaluate(() => window.api.utils.getPlatform())).toBeTruthy()
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('should show all srcdoc frames past the count limit and list them once', async ({ frames: h }) => {
    await openAndSettle(h, 'frames/many-srcdoc.html', '-MANY-SRCDOC-')
    await framesWhen(h, 'frames/many-srcdoc.html', (t) => t.filter((x) => x === '-TINY-SRCDOC-').length === MANY_FRAMES, 'not every srcdoc frame was shown')

    await waitForBadgeCount(h.preview, 1)
    const { groups, writer } = await badgeWithWriters(h)
    const entry = describeFramesOverLimit(MANY_FRAMES - MAX_FRAMES_PER_PAGE, 'srcdoc')
    expect(groups).toEqual({ [LABEL['frame-over-limit']]: [entry] })
    expect(writer(entry)).toBe('srcdoc detector')
  })

  test('should change only the frame when a link inside it is followed, leaving the title and Back as they were', async ({ frames: h }) => {
    const top = 'frames/frame-nav-a.html'
    await openAndSettle(h, top, '-FRAMENAV-')
    await framesWhen(h, top, (t) => t.includes(NAV_TARGET_TITLE), 'the link frame never loaded')
    const back = h.page.getByTestId('preview-band-back')
    await expect(back).toHaveAttribute('aria-disabled', 'true')

    // A synthetic click in the frame: the guard judges the frame's navigation,
    // whoever started it.
    expect(await evalInFrame(h.app, 'frame-nav-b.html', "document.getElementById('to-child').click(), true", target(top))).toBe(true)

    await framesWhen(h, top, (t) => t.length === 1 && t[0] === CHILD_TITLE, 'the frame did not follow its link')
    expect((await h.preview.snapshot(target(top)))?.docTitle).toBe('Frame links -FRAMENAV-')
    expect((await h.preview.livePreviews()).map((p) => p.url)).toEqual([expect.stringMatching(/\/frames\/frame-nav-a\.html$/)])
    await expect(back).toHaveAttribute('aria-disabled', 'true')
    expect(await h.preview.failureBadgeCount()).toBe(0)
  })

  test('should list a remote link refused inside a frame by scheme and host only', async ({ frames: h }) => {
    const top = 'frames/frame-nav-a.html'
    await openAndSettle(h, top, '-FRAMENAV-')
    await framesWhen(h, top, (t) => t.includes(NAV_TARGET_TITLE), 'the link frame never loaded')

    expect(await evalInFrame(h.app, 'frame-nav-b.html', "document.getElementById('to-remote').click(), true", target(top))).toBe(true)

    await waitForBadgeCount(h.preview, 1)
    const { groups, writer } = await badgeWithWriters(h)
    expect(groups).toEqual({ [LABEL['frame-link-blocked']]: ['https://example.com'] })
    expect(writer('https://example.com')).toMatch(/^(failed-load writer \(-30\)|frame guard)$/)
    // The top page and the tab stay as they were. (The frame itself may show
    // Chromium's own error page for the refused navigation.)
    expect((await h.preview.snapshot(target(top)))?.docTitle).toBe('Frame links -FRAMENAV-')
    expect((await h.preview.livePreviews()).map((p) => p.url)).toEqual([expect.stringMatching(/\/frames\/frame-nav-a\.html$/)])
  })
})

test.describe('HTML preview frames – blocked hosts inside frames (P2-AC2)', () => {
  const CDN = 'frames/cdn.html'

  test('should list a host blocked inside a frame in the band, and load it there after Allow and Confirm', async ({ frames: h, localServer }) => {
    await edit(h, 'frames/cdn-child.html', CDN_SCRIPT_URL, localServer.probeUrl)
    await openAndSettle(h, CDN, '-FRAMES-CDN-')
    await expect.poll(() => h.preview.eval('document.body.dataset.remote', target(CDN)), { timeout: PREVIEW_BUDGET_MS }).toBe('blocked')

    const chip = h.preview.chip()
    // The loopback script origin and the frame's fetch host.
    await expect(chip).toContainText('2 blocked · 0 allowed', { timeout: PREVIEW_BUDGET_MS })
    expect(localServer.requests).toHaveLength(0)

    await h.preview.openBand()
    await h.preview.allowButton(localServer.origin).click()
    await expect(h.preview.confirmDialog()).toBeVisible()
    const approvedAt = Date.now()
    await h.preview.confirmButton().click()
    await expect(chip).toContainText('1 allowed', { timeout: PREVIEW.APPROVE_UI_DEADLINE_MS + 5_000 })

    await h.preview.waitForTitled('-FRAMES-CDN-LOADED-')
    const hits = localServer.requests.filter((r) => r.path === '/probe.js')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].at).toBeGreaterThanOrEqual(approvedAt)
  })

  test("should list a fetch inside a frame as a network request, and ignore the frame's own console.log look-alike", async ({ frames: h }) => {
    await openAndSettle(h, CDN, '-FRAMES-CDN-')
    await expect.poll(() => h.preview.eval('document.body.dataset.remote', target(CDN)), { timeout: PREVIEW_BUDGET_MS }).toBe('blocked')

    // The look-alike is printed first; the two real refusals come after it.
    await expect(h.preview.chip()).toContainText('2 blocked · 0 allowed', { timeout: PREVIEW_BUDGET_MS })
    await h.preview.openBand()
    await expect(h.preview.hostRow('cdn.jsdelivr.net')).toBeVisible()
    await expect(h.preview.hostRow('fetch.example.com')).toBeVisible()
    await expect(h.preview.band().getByText('console-lookalike.example')).toHaveCount(0)

    await h.preview.allowButton('https://fetch.example.com').click()
    await expect(h.preview.confirmDialog()).toContainText('a network request')
    await h.preview.cancelButton().click()
    await expect(h.preview.confirmDialog()).toHaveCount(0)
  })
})
