// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the frame-source walk and for frame assets in the watcher's
 * spelling (issue #124, WI-15; design part 2 §2.9): order, depth, budget,
 * unreadable frames, `srcdoc`, Windows paths, and frames outside the project,
 * which are never read (fail closed). How the post-load pipeline uses both is
 * in `previewFrameSources.pipeline.test.ts`.
 */
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import type { ConfineVerdict } from './previewPathResolve'
import type { IPreviewWatchPool } from './PreviewWatchPool'
import {
  createPreviewWatchCoordinator,
  type ConfineFn,
  type WatchSetResult
} from './PreviewWatchCoordinator'
import {
  collectPreviewFrameSources,
  watchedFrameAssets,
  type PreviewFrameSourcesInput
} from './previewFrameSources'

const SITE = resolve('/proj/site')
const PAGE = resolve(SITE, 'index.html')

/** An absolute path in the site folder, with the host's separators. */
function at(rel: string): string {
  return resolve(SITE, rel)
}

/** Escape markup for a double-quoted attribute, as a `srcdoc` needs. */
function attr(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** `count` image links named `<prefix><n>.png`. */
function images(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, n) => `<img src="${prefix}${n}.png">`).join('')
}

/** A reader over an in-memory project; any other path rejects as missing. */
function readerFor(files: Readonly<Record<string, string>>) {
  const byPath = new Map(Object.entries(files))
  return vi.fn((filePath: string): Promise<string> => {
    const html = byPath.get(filePath)
    return html === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(html)
  })
}

/** The gate for an in-memory project: lexically inside the root is inside. */
function insideBy(rules: path.PlatformPath): ConfineFn {
  return (root, candidate) => {
    const rel = rules.relative(root, candidate)
    const verdict: ConfineVerdict =
      rel === '' || rel.startsWith('..') || rules.isAbsolute(rel)
        ? { ok: false, reason: 'escape' }
        : { ok: true, realTarget: candidate, rel }
    return Promise.resolve(verdict)
  }
}

async function collect(
  entryHtml: string,
  files: Readonly<Record<string, string>> = {},
  options: Partial<PreviewFrameSourcesInput> = {}
) {
  const readHtml = readerFor(files)
  const sources = await collectPreviewFrameSources({
    entryPath: PAGE,
    entryHtml,
    readHtml,
    realRoot: SITE,
    confine: insideBy(path),
    ...options
  })
  return { ...sources, reads: readHtml.mock.calls.map(([filePath]) => filePath) }
}

describe('collectPreviewFrameSources', () => {
  it("returns the page's own links alone, reading nothing, for a page without frames", async () => {
    const result = await collect('<link rel="stylesheet" href="a.css"><img src="b.png">')

    expect(result.candidates).toEqual([at('a.css'), at('b.png')])
    expect(result.frameAssets.size).toBe(0)
    expect(result.reads).toEqual([])
  })

  it("puts the page's links first, then each frame document's, breadth-first by depth", async () => {
    const result = await collect(
      '<link rel="stylesheet" href="top.css"><iframe src="a.html"></iframe>' +
        '<iframe src="b.html"></iframe><img src="top.png">',
      {
        [at('a.html')]: '<link rel="stylesheet" href="a.css"><iframe src="a1.html"></iframe>',
        [at('b.html')]: '<img src="b.png">',
        [at('a1.html')]: '<img src="a1.png">'
      }
    )

    expect(result.candidates).toEqual([
      ...[at('top.css'), at('a.html'), at('b.html'), at('top.png')], // the page
      ...[at('a.css'), at('a1.html'), at('b.png')], // depth 1
      at('a1.png') // depth 2
    ])
    expect(result.reads).toEqual([at('a.html'), at('b.html'), at('a1.html')])
    expect(result.frameAssets).toEqual(
      new Set([at('a.html'), at('b.html'), at('a.css'), at('a1.html'), at('b.png'), at('a1.png')])
    )
  })

  it(`reads frame documents down to depth ${PREVIEW_LIMITS.MAX_FRAME_DEPTH} and no deeper`, async () => {
    const deepest = PREVIEW_LIMITS.MAX_FRAME_DEPTH
    const files: Record<string, string> = {}
    for (let level = 1; level <= deepest + 1; level += 1) {
      files[at(`l${level}.html`)] =
        `<link rel="stylesheet" href="l${level}.css"><iframe src="l${level + 1}.html"></iframe>`
    }
    const result = await collect('<iframe src="l1.html"></iframe>', files)

    expect(result.reads).toEqual(Array.from({ length: deepest }, (_, n) => at(`l${n + 1}.html`)))
    expect(result.candidates).toContain(at(`l${deepest}.css`))
    // The level past the cap is a link of the deepest frame: watched, never read.
    expect(result.candidates).toContain(at(`l${deepest + 1}.html`))
    expect(result.candidates).not.toContain(at(`l${deepest + 1}.css`))
  })

  it("resolves srcdoc links against the parent's folder and counts srcdoc levels toward the depth", async () => {
    // page → sub/frame.html (1) → srcdoc (2) → srcdoc (3) → sub/deep.html (4, refused)
    const level3 = '<img src="inner.png"><iframe src="deep.html"></iframe>'
    const level2 = `<link rel="stylesheet" href="mid.css"><iframe srcdoc="${attr(level3)}"></iframe>`
    const result = await collect(
      `<iframe src="sub/frame.html"></iframe><iframe srcdoc="${attr('<img src="top.png">')}"></iframe>`,
      {
        [at('sub/frame.html')]: `<iframe srcdoc="${attr(level2)}"></iframe>`,
        [at('sub/deep.html')]: '<img src="deep.png">'
      }
    )

    expect(result.reads).toEqual([at('sub/frame.html')])
    expect(result.candidates).toEqual([
      at('sub/frame.html'),
      at('top.png'),
      at('sub/mid.css'),
      at('sub/inner.png'),
      at('sub/deep.html')
    ])
    expect(result.frameAssets).toEqual(new Set(result.candidates))
  })

  it(`stops reading frame documents once ${PREVIEW.MAX_WATCHED_FILES} candidates are known`, async () => {
    const result = await collect('<iframe src="f1.html"></iframe><iframe src="f2.html"></iframe>', {
      [at('f1.html')]: images('f1-', PREVIEW.MAX_WATCHED_FILES - 1),
      [at('f2.html')]: images('f2-', 1)
    })

    expect(result.reads).toEqual([at('f1.html')])
    // Every link of a document that was read is kept; the coordinator drops the rest.
    expect(result.candidates).toHaveLength(PREVIEW.MAX_WATCHED_FILES + 1)
    expect(result.candidates).not.toContain(at('f2-0.png'))
  })

  it('keeps every link of the page itself past the budget, and then reads no frame', async () => {
    const pageLinks = images('p', PREVIEW.MAX_WATCHED_FILES + 2)
    const result = await collect(`${pageLinks}<iframe src="f.html"></iframe>`, {
      [at('f.html')]: '<img src="f.png">'
    })

    expect(result.candidates).toHaveLength(PREVIEW.MAX_WATCHED_FILES + 3)
    expect(result.candidates.at(-1)).toBe(at('f.html'))
    expect(result.reads).toEqual([])
    expect(result.frameAssets).toEqual(new Set([at('f.html')]))
  })

  it(`scans at most ${PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE} frame documents, however few links they hold`, async () => {
    const srcdoc = (inner: string): string => `<iframe srcdoc="${attr(inner)}"></iframe>`
    const empties = Array.from({ length: PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE - 1 }, () =>
      srcdoc('<p>empty</p>')
    )
    const result = await collect(
      [srcdoc('<img src="first.png">'), ...empties, srcdoc('<img src="late.png">')].join('')
    )

    expect(result.candidates).toEqual([at('first.png')])
  })

  it('skips a frame document it cannot read and goes on with the rest', async () => {
    const result = await collect(
      '<iframe src="gone.html"></iframe><iframe src="ok.html"></iframe>',
      { [at('ok.html')]: '<img src="ok.png">' }
    )

    expect(result.reads).toEqual([at('gone.html'), at('ok.html')])
    expect(result.candidates).toEqual([at('gone.html'), at('ok.html'), at('ok.png')])
    expect(result.frameAssets.has(at('gone.html'))).toBe(true)
  })

  it('reads a file framed from two documents once', async () => {
    const result = await collect('<iframe src="nav.html"></iframe><iframe src="b.html"></iframe>', {
      [at('nav.html')]: '<img src="nav.png">',
      [at('b.html')]: '<iframe src="nav.html"></iframe>'
    })

    expect(result.reads).toEqual([at('nav.html'), at('b.html')])
  })

  it('watches a frame that shows something other than a page, but reads only HTML pages', async () => {
    const result = await collect(
      '<iframe src="chart.png"></iframe><iframe src="notes.HTM"></iframe>',
      { [at('notes.HTM')]: '<img src="notes.png">' }
    )

    expect(result.reads).toEqual([at('notes.HTM')])
    expect(result.candidates).toEqual([at('chart.png'), at('notes.HTM'), at('notes.png')])
    expect(result.frameAssets.has(at('chart.png'))).toBe(true)
  })

  it("reads the page once more when a frame shows it, so their stylesheet counts as a frame's", async () => {
    const html = '<link rel="stylesheet" href="self.css"><iframe src="index.html"></iframe>'
    const result = await collect(html, { [PAGE]: html })

    expect(result.reads).toEqual([PAGE])
    expect(result.frameAssets).toEqual(new Set([PAGE, at('self.css')]))
  })

  it('honours a smaller depth and budget when given', async () => {
    const files = { [at('a.html')]: '<iframe src="b.html"></iframe>' }
    const shallow = await collect('<iframe src="a.html"></iframe>', files, { maxDepth: 1 })
    const spent = await collect('<img src="x.png"><iframe src="a.html"></iframe>', files, {
      budget: 2
    })

    expect(shallow.reads).toEqual([at('a.html')])
    expect(shallow.candidates).toEqual([at('a.html'), at('b.html')])
    expect(spent.reads).toEqual([])
  })

  it('builds Windows paths with native separators, reading a backslash src as a slash', async () => {
    const frame = 'C:\\proj\\site\\sub\\page.html'
    const result = await collect(
      '<iframe src="sub\\page.html"></iframe>',
      { [frame]: '<link rel="stylesheet" href="p.css">' },
      {
        entryPath: 'C:\\proj\\site\\index.html',
        realRoot: 'C:\\proj\\site',
        confine: insideBy(path.win32),
        pathApi: path.win32
      }
    )

    expect(result.candidates).toEqual([frame, 'C:\\proj\\site\\sub\\p.css'])
  })

  it('reads a frame at the real path its check returned, resolving links from its own folder', async () => {
    const result = await collect(
      '<iframe src="child.html"></iframe>',
      { [at('real/child.html')]: '<img src="c.png">' },
      {
        confine: (_root, candidate) =>
          Promise.resolve({ ok: true, realTarget: at('real/child.html'), rel: candidate })
      }
    )

    expect(result.reads).toEqual([at('real/child.html')])
    expect(result.candidates).toEqual([at('child.html'), at('c.png')])
  })

  it('reads no frame file without a project root, but still follows srcdoc markup', async () => {
    const result = await collect(
      `<iframe src="child.html"></iframe><iframe srcdoc="${attr('<img src="inline.png">')}"></iframe>`,
      { [at('child.html')]: '<img src="child.png">' },
      { realRoot: undefined }
    )

    expect(result.reads).toEqual([])
    expect(result.candidates).toEqual([at('child.html'), at('inline.png')])
  })

  it('reads nothing when the confinement check itself fails', async () => {
    const result = await collect(
      '<iframe src="child.html"></iframe>',
      { [at('child.html')]: '<img src="child.png">' },
      { confine: () => Promise.reject(new Error('EACCES')) }
    )

    expect(result.reads).toEqual([])
  })
})

describe('collectPreviewFrameSources – frames outside the project (fail closed)', () => {
  let base = ''
  let root = ''
  const outsideFrame = (): string => join(base, 'outside', 'evil.html')

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-frame-confine-')))
    root = join(base, 'project')
    await mkdir(root)
    await mkdir(join(base, 'outside'))
    await writeFile(outsideFrame(), '<img src="secret.png">')
    await writeFile(join(root, 'child.html'), '<img src="child.png">')
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  /** Walk from `project/index.html` with the real gate and a real reader. */
  async function walk(entryHtml: string) {
    const readHtml = vi.fn((filePath: string) => readFile(filePath, 'utf8'))
    const entryPath = join(root, 'index.html')
    const sources = await collectPreviewFrameSources({
      entryPath,
      entryHtml,
      readHtml,
      realRoot: root
    })
    return { ...sources, reads: readHtml.mock.calls.map(([filePath]) => filePath) }
  }

  /** What a real watch coordinator, confining with the same gate, makes of `candidates`. */
  async function watch(candidates: readonly string[]) {
    const acquired: string[] = []
    const pool: IPreviewWatchPool = {
      acquire: filePath => acquired.push(filePath) > 0,
      release: () => Promise.resolve(),
      releaseAll: () => Promise.resolve(),
      close: () => Promise.resolve(),
      size: 0
    }
    const coordinator = createPreviewWatchCoordinator({ realRoot: root, pool, onChanged: vi.fn() })
    const result = await coordinator.setWatchSet(candidates)
    await coordinator.dispose()
    return { acquired, dropped: result.dropped.map(entry => entry.candidate) }
  }

  it('reads a frame inside the project', async () => {
    const result = await walk('<iframe src="child.html"></iframe>')

    expect(result.reads).toEqual([join(root, 'child.html')])
    expect(result.candidates).toContain(join(root, 'child.png'))
  })

  it('neither reads nor watches a frame that climbs out with ../', async () => {
    const result = await walk('<iframe src="../outside/evil.html"></iframe>')
    const watched = await watch(result.candidates)

    expect(result.reads).toEqual([])
    expect(result.candidates).not.toContain(join(base, 'outside', 'secret.png'))
    expect(watched.acquired).toEqual([])
    expect(watched.dropped).toEqual([outsideFrame()])
  })

  it('neither reads nor watches a frame named by an absolute path outside the project', async () => {
    // On Windows `C:/…` reads as a URL scheme, so it names no project file at all.
    const result = await walk(`<iframe src="${outsideFrame()}"></iframe>`)
    const watched = await watch(result.candidates)

    expect(result.reads).toEqual([])
    expect(watched.acquired).toEqual([])
  })

  it.skipIf(process.platform === 'win32')(
    'neither reads nor watches a symlink in the project that points outside it',
    async () => {
      await symlink(outsideFrame(), join(root, 'linked.html'))
      const result = await walk('<iframe src="linked.html"></iframe>')
      const watched = await watch(result.candidates)

      expect(result.reads).toEqual([])
      expect(watched.acquired).toEqual([])
      expect(watched.dropped).toEqual([join(root, 'linked.html')])
    }
  )
})

describe('watchedFrameAssets', () => {
  function watchSet(watched: string[], dropped: WatchSetResult['dropped'] = []): WatchSetResult {
    return { watched, dropped }
  }

  it('keeps a frame asset watched under its own spelling, with no realpath', async () => {
    const realPath = vi.fn((filePath: string) => Promise.resolve(filePath))
    const found = await watchedFrameAssets(
      new Set([at('shared.css'), at('frame.html')]),
      watchSet([at('shared.css'), at('frame.html'), at('top.css')]),
      realPath
    )

    expect(found).toEqual(new Set([at('shared.css'), at('frame.html')]))
    expect(realPath).not.toHaveBeenCalled()
  })

  it('finds a frame asset the coordinator watches under its real path', async () => {
    const realPath = (filePath: string): Promise<string> =>
      Promise.resolve(filePath.replace('linked', 'real'))
    const found = await watchedFrameAssets(
      new Set([resolve('/linked/shared.css')]),
      watchSet([resolve('/real/shared.css')]),
      realPath
    )

    expect(found).toEqual(new Set([resolve('/real/shared.css')]))
  })

  it('asks nothing about what the coordinator dropped, and skips what no longer resolves', async () => {
    const realPath = vi.fn((_filePath: string) => Promise.reject(new Error('ENOENT')))
    const found = await watchedFrameAssets(
      new Set([at('over.css'), at('gone.css')]),
      watchSet([at('top.css')], [{ candidate: at('over.css'), reason: 'over-cap' }]),
      realPath
    )

    expect(found.size).toBe(0)
    expect(realPath.mock.calls).toEqual([[at('gone.css')]])
  })

  it('answers at once when no frame uses anything, or nothing is watched', async () => {
    const realPath = vi.fn((filePath: string) => Promise.resolve(filePath))

    expect((await watchedFrameAssets(new Set(), watchSet([at('a.css')]), realPath)).size).toBe(0)
    expect((await watchedFrameAssets(new Set([at('a.css')]), watchSet([]), realPath)).size).toBe(0)
    expect(realPath).not.toHaveBeenCalled()
  })

  it('resolves a frame asset reached through a linked folder by default', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'erfana-frame-assets-')))
    try {
      await mkdir(join(dir, 'real'))
      await writeFile(join(dir, 'real', 'shared.css'), 'p { color: red }')
      // A junction needs no privilege on Windows; elsewhere the type is ignored.
      await symlink(join(dir, 'real'), join(dir, 'linked'), 'junction')
      const watched = join(dir, 'real', 'shared.css')

      const found = await watchedFrameAssets(
        new Set([join(dir, 'linked', 'shared.css')]),
        watchSet([watched])
      )
      expect(found).toEqual(new Set([watched]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
