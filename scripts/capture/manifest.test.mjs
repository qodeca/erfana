// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the capture manifest (#138, spec § 3.2 and step 5): validation,
 * `--only` resolution, the budget and the `--check` drift report.
 *
 * Each test names the break it catches: the change to manifest.mjs that would
 * make it fail.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CaptureError,
  GUIDE_TOTAL_BYTES,
  checkBudget,
  checkDrift,
  designScreenshotFiles,
  fileProblem,
  loadManifest,
  resolveOnly,
  validateManifest
} from './manifest.mjs'

const still = (over = {}) => ({
  id: 'open-a-project/welcome',
  file: 'docs/user-guide/images/open-a-project/welcome.png',
  pages: [],
  scene: 'open-a-project',
  state: 'Start screen',
  crop: 'window',
  agent: false,
  native: false,
  maxKB: 400,
  ...over
})

const demoRows = () => [
  { id: 'readme/demo-webp', file: 'docs/assets/readme/demo.webp', pages: [], scene: 'readme-demo', kind: 'loop', agent: true, native: false, maxKB: 5120 },
  { id: 'readme/demo-gif', file: 'docs/assets/readme/demo.gif', pages: [], scene: 'readme-demo', kind: 'loop', agent: true, native: false, maxKB: 5120 },
  { id: 'readme/demo-mp4', file: 'docs/assets/readme/demo.mp4', pages: [], scene: 'readme-demo', kind: 'loop', agent: true, native: false, maxKB: 3072 },
  still({ id: 'readme/demo-still', file: 'docs/assets/readme/demo-still.png', scene: 'readme-demo', agent: true })
]

describe('fileProblem – where a capture may write', () => {
  it('accepts .webp in both allow-listed folders (R138-10; break: dropping .webp from EXTENSIONS)', () => {
    expect(fileProblem('docs/assets/readme/demo.webp')).toBeNull()
    expect(fileProblem('docs/user-guide/images/x/loop.webp')).toBeNull()
  })

  it('refuses a third folder (break: widening OUTPUT_ALLOW_LIST or dropping the prefix check)', () => {
    expect(fileProblem('docs/other/demo.png')).toMatch(/allow-list/)
    expect(fileProblem('src/renderer/evil.png')).toMatch(/allow-list/)
  })

  it('refuses .. even inside an allowed prefix (break: checking the prefix only)', () => {
    expect(fileProblem('docs/user-guide/images/../../../src/x.png')).toMatch(/\.\./)
    expect(fileProblem('docs/assets/readme/a..png')).toMatch(/\.\./)
  })

  it('refuses absolute paths, backslashes and other extensions', () => {
    expect(fileProblem('/docs/user-guide/images/a.png')).toMatch(/absolute/)
    expect(fileProblem('docs\\user-guide\\images\\a.png')).toMatch(/backslash/)
    expect(fileProblem('docs/user-guide/images/a.svg')).toMatch(/must end/)
    expect(fileProblem('docs/user-guide/images//a.png')).toMatch(/empty/)
  })
})

describe('validateManifest', () => {
  it('accepts the committed shots.json (break: a row that no longer validates)', () => {
    const rows = loadManifest(path.join(import.meta.dirname, 'shots.json'))
    expect(rows.filter((r) => r.file.startsWith('docs/user-guide/images/')).length).toBe(52)
    const demo = rows.filter((r) => r.scene === 'readme-demo')
    expect([0, 4]).toContain(demo.length)
  })

  it('defaults kind to still and lists every problem at once', () => {
    expect(validateManifest([still()])[0].kind).toBe('still')
    let err
    try {
      validateManifest([still({ file: 'x.png' }), still({ id: 'Bad Id', maxKB: 0 })])
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CaptureError)
    expect(err.message).toMatch(/row 1.*allow-list/s)
    expect(err.message).toMatch(/row 2.*id must be/s)
    expect(err.message).toMatch(/maxKB/)
  })

  it('refuses duplicate ids and files (break: a missing Set check lets two rows overwrite one image)', () => {
    expect(() => validateManifest([still(), still()])).toThrow(/duplicate id/)
    expect(() => validateManifest([still(), still({ id: 'x/y' })])).toThrow(/duplicate file/)
  })

  it('a still must be PNG and a loop must not be', () => {
    expect(() => validateManifest([still({ file: 'docs/assets/readme/a.gif' })])).toThrow(/still must be a \.png/)
    expect(() => validateManifest([{ ...demoRows()[0], file: 'docs/assets/readme/a.png' }])).toThrow(/loop must be/)
  })

  it('refuses a scene id that is also a row id (break: --only could not tell them apart)', () => {
    expect(() => validateManifest([still({ id: 'a/b', scene: 'a' }), still({ id: 'a', file: 'docs/user-guide/images/a.png' })])).toThrow()
  })
})

describe('resolveOnly (R138-2)', () => {
  const rows = validateManifest([still(), still({ id: 'open-a-project/project-open', file: 'docs/user-guide/images/p.png' }), ...demoRows()])

  it('a scenario id gives exactly its four rows (break: matching ids only)', () => {
    const { rows: got, partial } = resolveOnly(rows, 'readme-demo')
    expect(got.map((r) => r.id)).toEqual(['readme/demo-webp', 'readme/demo-gif', 'readme/demo-mp4', 'readme/demo-still'])
    expect(partial).toBe(true)
  })

  it('a row id gives that row; a list is de-duplicated in manifest order', () => {
    expect(resolveOnly(rows, 'open-a-project/welcome').rows.map((r) => r.id)).toEqual(['open-a-project/welcome'])
    expect(resolveOnly(rows, 'readme/demo-gif, open-a-project, readme-demo').rows).toHaveLength(6)
  })

  it('an unknown id is an error, not an empty run (break: filtering silently)', () => {
    expect(() => resolveOnly(rows, 'readme-demo,nope')).toThrow(/unknown row or scene id: nope/)
    expect(() => resolveOnly(rows, ' , ')).toThrow(/at least one/)
  })

  it('no --only is a full run', () => {
    expect(resolveOnly(rows, undefined)).toEqual({ rows, partial: false })
  })
})

describe('checkBudget (AC8)', () => {
  const rows = validateManifest([still(), still({ id: 'a/crop', file: 'docs/user-guide/images/a/crop.png', maxKB: 200 }), ...demoRows()])

  it('a file over its own cap is named with its size and limit (break: comparing KB to bytes)', () => {
    const sizes = new Map([['a/crop', 200 * 1024 + 1], ['open-a-project/welcome', 400 * 1024]])
    const { problems } = checkBudget(rows, sizes)
    expect(problems).toEqual(['a/crop is 200 KB (limit 200 KB)'])
  })

  it('the 12 MB total counts guide images only, plus the committed ones a partial run did not measure', () => {
    const sizes = new Map([['open-a-project/welcome', 100], ['readme/demo-gif', 5 * 1024 * 1024]])
    expect(checkBudget(rows, sizes).guideTotal).toBe(100)
    const over = checkBudget(rows, sizes, { extraGuideBytes: GUIDE_TOTAL_BYTES })
    expect(over.problems.join()).toMatch(/guide images total/)
  })
})

describe('designScreenshotFiles', () => {
  it('reads only the numbered rows of the Screenshot list section', () => {
    const md = ['### Screenshot list', '| # | File |', '|---|---|', '| 1 | `index/overview.png` |', '| x | `no.png` |', '### Other', '| 2 | `other.png` |'].join('\n')
    expect(designScreenshotFiles(md)).toEqual(['docs/user-guide/images/index/overview.png'])
  })
})

describe('checkDrift (--check)', () => {
  let root
  const write = (rel, body = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), body)
  }
  const list = (dir) => {
    const out = []
    const walk = (rel) => {
      const abs = path.join(root, rel)
      if (!fs.existsSync(abs)) return
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const r = path.posix.join(rel, e.name)
        if (e.isDirectory()) walk(r)
        else out.push(r)
      }
    }
    walk(dir.replace(/\/$/, ''))
    return out
  }
  const design = (files) => ['### Screenshot list', ...files.map((f, i) => `| ${i + 1} | \`${f}\` |`)].join('\n')

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-drift-'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('agrees when rows, files and the design match; pages not written yet are a note (part B state)', () => {
    const rows = validateManifest([still({ pages: ['docs/user-guide/how-to/open-a-project.md'] })])
    write('docs/user-guide/images/open-a-project/welcome.png')
    write('docs/designs/138-user-guide/README.md', design(['open-a-project/welcome.png']))
    const r = checkDrift({ root, rows, listFiles: list })
    expect(r.drift).toEqual([])
    expect(r.notes.join()).toMatch(/not written yet/)
  })

  it('reports a row without a file, a file without a row and a design mismatch (break: any one check removed)', () => {
    const rows = validateManifest([still()])
    write('docs/user-guide/images/stray.png')
    write('docs/designs/138-user-guide/README.md', design(['other.png']))
    const { drift } = checkDrift({ root, rows, listFiles: list })
    expect(drift).toContain('row without a file: open-a-project/welcome → docs/user-guide/images/open-a-project/welcome.png')
    expect(drift).toContain('file without a row: docs/user-guide/images/stray.png')
    expect(drift.join('\n')).toMatch(/not in the design's screenshot list/)
    expect(drift.join('\n')).toMatch(/design lists an image with no row/)
  })

  it('once a guide page exists, a listed page must exist and show the image (break: keeping the part-B note forever)', () => {
    const rows = validateManifest([
      still({ pages: ['docs/user-guide/how-to/open-a-project.md', 'docs/user-guide/missing.md'] })
    ])
    write('docs/user-guide/images/open-a-project/welcome.png')
    write('docs/designs/138-user-guide/README.md', design(['open-a-project/welcome.png']))
    write('docs/user-guide/how-to/open-a-project.md', '# Open\n\n![Screenshot](../images/nope.png)\n')
    const { drift } = checkDrift({ root, rows, listFiles: list })
    expect(drift.join('\n')).toMatch(/page does not exist: docs\/user-guide\/missing\.md/)
    expect(drift.join('\n')).toMatch(/does not show docs\/user-guide\/images\/open-a-project\/welcome\.png/)
    expect(drift.join('\n')).toMatch(/image link with no manifest row: docs\/user-guide\/images\/nope\.png/)
  })

  it('reports sizes for the budget', () => {
    const rows = validateManifest([still({ maxKB: 1 })])
    write('docs/user-guide/images/open-a-project/welcome.png', 'y'.repeat(2048))
    write('docs/designs/138-user-guide/README.md', design(['open-a-project/welcome.png']))
    expect(checkDrift({ root, rows, listFiles: list }).budget.problems).toEqual(['open-a-project/welcome is 2 KB (limit 1 KB)'])
  })
})
