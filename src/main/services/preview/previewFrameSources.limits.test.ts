// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A scan bound reached during the frame-source walk (issue #124 audit): the
 * links found are kept, the frames are still followed, and the bounds reached
 * are logged once for the walk, by name – never a path.
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

import { logger } from '../LoggingService'
import { MAX_ATTRIBUTES_PER_TAG } from './htmlElementScan'
import type { ConfineFn } from './PreviewWatchCoordinator'
import { collectPreviewFrameSources } from './previewFrameSources'

const SITE = resolve('/proj/site')
const PAGE = resolve(SITE, 'index.html')

function at(rel: string): string {
  return resolve(SITE, rel)
}

/** Every path is inside the project, at its own spelling. */
const insideSite: ConfineFn = (_root, candidate) =>
  Promise.resolve({ ok: true, realTarget: candidate, rel: path.relative(SITE, candidate) })

/** An element with more attributes than the scan keeps, and a link before them. */
function overfullTag(link: string): string {
  let tag = `<img src="${link}"`
  for (let index = 0; index <= MAX_ATTRIBUTES_PER_TAG; index += 1) tag += ` a${index}`
  return `${tag}>`
}

async function collect(entryHtml: string, files: Readonly<Record<string, string>>) {
  return collectPreviewFrameSources({
    entryPath: PAGE,
    entryHtml,
    readHtml: (filePath) => {
      const html = files[filePath]
      return html === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(html)
    },
    realRoot: SITE,
    confine: insideSite
  })
}

describe('collectPreviewFrameSources – a scan that reaches a bound', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear()
  })

  it('keeps the links, follows the frames and logs the bound once, by name', async () => {
    const result = await collect(`${overfullTag('page.png')}<iframe src="child.html"></iframe>`, {
      [at('child.html')]: `${overfullTag('child.png')}<link rel="stylesheet" href="child.css">`
    })

    expect(result.candidates).toEqual([
      at('page.png'),
      at('child.html'),
      at('child.png'),
      at('child.css')
    ])
    const warn = vi.mocked(logger.warn)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toEqual({ limits: ['attributes-per-tag'] })
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('proj')
    expect(logged).not.toContain('.png')
  })

  it('logs nothing for pages within every bound', async () => {
    await collect('<img src="a.png"><iframe src="child.html"></iframe>', {
      [at('child.html')]: '<img src="b.png">'
    })
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })
})
