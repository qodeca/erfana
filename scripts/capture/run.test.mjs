// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the capture orchestrator's pure parts, the sandbox guard and the
 * legibility judge (#138, spec § 3.1, § 3.3, § 7). Each test names the break
 * it catches.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CaptureError } from './manifest.mjs'
import { approveReadmeVideo, EXIT, parseArgs, readLogin, reportLines, runCheck, safeTarget, storyReportLines } from './run.mjs'
import { MARKER, VOLUME_ROOT, attachedImages, claudeJson, findClaude, layout, projectClaudeSettings, sandboxProblem, shellQuote, userClaudeSettings, volumeProblem } from './sandbox.mjs'
import { capitalHeight, judgeFrame, normalise } from './legibility.mjs'

let tmp
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-run-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('parseArgs', () => {
  it('reads --only in both forms, --check and --skip-build', () => {
    expect(parseArgs(['--only', 'a,b'])).toMatchObject({ only: 'a,b' })
    expect(parseArgs(['--only=readme-demo', '--skip-build'])).toMatchObject({ only: 'readme-demo', skipBuild: true })
    expect(parseArgs(['--check']).check).toBe(true)
  })

  it('refuses unknown flags, a bare --only and --check with --only (break: silently ignoring a typo)', () => {
    expect(() => parseArgs(['--onyl', 'x'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--only'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--check', '--only', 'x'])).toThrow(/cannot be combined/)
  })
})

describe('readLogin (exit 3)', () => {
  it('no login at all is exit 3 with the message naming both inputs', () => {
    let err
    try {
      readLogin({})
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CaptureError)
    expect(err.exitCode).toBe(EXIT.NO_LOGIN)
    expect(err.message).toMatch(/ANTHROPIC_API_KEY or ERFANA_CAPTURE_CLAUDE_TOKEN_FILE/)
  })

  it('reads the token file into memory only, trimmed; an empty or missing file is exit 3', () => {
    const f = path.join(tmp, 'token')
    fs.writeFileSync(f, 'invented-token-value\n', { mode: 0o600 })
    expect(readLogin({ ERFANA_CAPTURE_CLAUDE_TOKEN_FILE: f })).toEqual(['invented-token-value'])
    fs.writeFileSync(f, '   \n')
    expect(() => readLogin({ ERFANA_CAPTURE_CLAUDE_TOKEN_FILE: f })).toThrow(/empty/)
    expect(() => readLogin({ ERFANA_CAPTURE_CLAUDE_TOKEN_FILE: path.join(tmp, 'nope') })).toThrow(/cannot be read/)
  })

  it('a broken token file with a working API key still stops the run (break: returning only the secrets read so far)', () => {
    const env = { ANTHROPIC_API_KEY: 'invented-key-value', ERFANA_CAPTURE_CLAUDE_TOKEN_FILE: path.join(tmp, 'rotated-away') }
    for (const required of [true, false]) {
      let err
      try {
        readLogin(env, fs, { required })
      } catch (e) {
        err = e
      }
      expect(err, `required: ${required}`).toBeInstanceOf(CaptureError)
      expect(err.exitCode).toBe(EXIT.NO_LOGIN)
    }
  })

  it('a run with no agent row may have no login at all, but keeps every secret that is set (break: an empty deny-list)', () => {
    expect(readLogin({}, fs, { required: false })).toEqual([])
    expect(readLogin({ ANTHROPIC_API_KEY: 'invented-key-value' }, fs, { required: false })).toEqual(['invented-key-value'])
  })

  it('the error never contains the token (break: echoing the file content in a message)', () => {
    const f = path.join(tmp, 'token')
    fs.writeFileSync(f, 'x'.repeat(20000))
    let msg = ''
    try {
      readLogin({ ERFANA_CAPTURE_CLAUDE_TOKEN_FILE: f })
    } catch (e) {
      msg = e.message
    }
    expect(msg).not.toMatch(/xxxx/)
  })
})

describe('safeTarget', () => {
  it('resolves inside an allow-listed folder', () => {
    fs.mkdirSync(path.join(tmp, 'docs', 'user-guide', 'images'), { recursive: true })
    expect(safeTarget(tmp, 'docs/user-guide/images/a/b.png')).toBe(path.join(fs.realpathSync(tmp), 'docs', 'user-guide', 'images', 'a', 'b.png'))
  })

  it('refuses a folder that is a symlink out of the repository (break: trusting the lexical path)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-outside-'))
    try {
      fs.mkdirSync(path.join(tmp, 'docs', 'user-guide'), { recursive: true })
      fs.symlinkSync(outside, path.join(tmp, 'docs', 'user-guide', 'images'))
      expect(() => safeTarget(tmp, 'docs/user-guide/images/x.png')).toThrow(/outside the output allow-list/)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('refuses a target file that is a symlink', () => {
    fs.mkdirSync(path.join(tmp, 'docs', 'assets', 'readme'), { recursive: true })
    fs.symlinkSync('/etc/hosts', path.join(tmp, 'docs', 'assets', 'readme', 'demo.gif'))
    expect(() => safeTarget(tmp, 'docs/assets/readme/demo.gif')).toThrow(/symlink/)
  })
})

describe('runCheck', () => {
  it('drift is exit 7, over budget exit 6, agreement exit 0', () => {
    const row = {
      id: 'a/b',
      file: 'docs/user-guide/images/a/b.png',
      pages: [],
      scene: 's',
      kind: 'still',
      state: 'x',
      crop: 'window',
      agent: false,
      native: false,
      maxKB: 1
    }
    const log = () => undefined
    const listFiles = () => []
    expect(runCheck({ root: tmp, rows: [row], log, listFiles })).toBe(EXIT.DRIFT)
    fs.mkdirSync(path.join(tmp, 'docs', 'user-guide', 'images', 'a'), { recursive: true })
    fs.writeFileSync(path.join(tmp, row.file), 'z'.repeat(4096))
    expect(runCheck({ root: tmp, rows: [row], log, listFiles })).toBe(EXIT.BUDGET)
    fs.writeFileSync(path.join(tmp, row.file), 'z')
    expect(runCheck({ root: tmp, rows: [row], log, listFiles })).toBe(EXIT.OK)
  })
})

const STORY_DEMO = {
  duration: 61.2,
  pages: 412,
  quality: 85,
  window: { width: 1920, height: 1080 },
  columns: 86,
  results: { open: 'the tree lists the project', edit: 'the preview shows the table the agent wrote' },
  steps: [
    { id: 'open', from: 0, to: 4.1 },
    { id: 'edit', from: 4.1, to: 20 }
  ],
  segments: [
    { from: 0, to: 30, speed: 1 },
    { from: 30, to: 90, speed: 12 }
  ],
  layout: [{ step: 'edit', window: 1920, tree: 288, preview: 998, terminal: 634, editorVisible: false }],
  editLatencyMs: 640,
  screenshot: { width: 1920, height: 1080, expected: { width: 1920, height: 1080 } },
  legibility: [{ what: 'label "Open a project" at 880 px', capPx: 7.6, samples: 2, readBack: true }]
}

describe('reportLines', () => {
  it('lists each file and the totals, and the README video checks when it ran', () => {
    const rows = [{ id: 'a/b', file: 'docs/user-guide/images/a/b.png', agent: true }]
    const lines = reportLines({ rows, sizes: new Map([['a/b', 2048]]), partial: true, version: '2.1.282 (Claude Code)', guideTotal: 2048, demo: STORY_DEMO }).join('\n')
    expect(lines).toMatch(/partial run/)
    expect(lines).toMatch(/2 KB {2}docs\/user-guide\/images\/a\/b\.png {2}\(agent\)/)
    expect(lines).toMatch(/README video: every check passed/)
  })
})

describe('storyReportLines (spec 023)', () => {
  it('names the evidence for each check (break: a check that passes without a line in the report)', () => {
    const t = storyReportLines(STORY_DEMO).join('\n')
    expect(t).toMatch(/length: 61\.2 s \(50–70 s\), 412 WebP pages, quality 85, loop 0/)
    expect(t).toMatch(/window: 1920×1080; terminal 86 columns/)
    expect(t).toMatch(/step 2 edit at 4\.1–20\.0 s: the preview shows the table/)
    expect(t).toMatch(/sped up ×12: 60\.0 s of recording/)
    expect(t).not.toMatch(/×1:/)
    expect(t).toMatch(/layout at edit: tree 15\.0 %, preview 52\.0 %, terminal 33\.0 %, editor hidden/)
    expect(t).toMatch(/edit to preview: 640 ms/)
    expect(t).toMatch(/window screenshot: 1920×1080 \(window 1920×1080\)/)
    expect(t).toMatch(/capital height 7\.6 px/)
    expect(t).toMatch(/privacy: 412 pages read, 0 hits/)
  })
})

describe('sandbox guard (exit 4)', () => {
  // POSIX-only: the capture refuses to run anywhere but macOS (exit 2) before
  // the sandbox is touched, and Windows has no process.getuid.
  it.skipIf(process.platform === 'win32')('absent is fine; a symlink, a file, or a folder without the marker is refused (break: deleting any folder of that name)', () => {
    const root = path.join(tmp, 'sb')
    expect(sandboxProblem(root)).toBeNull()
    fs.mkdirSync(root)
    expect(sandboxProblem(root)).toMatch(/not made by the capture script/)
    fs.writeFileSync(path.join(root, MARKER), 'x')
    expect(sandboxProblem(root)).toBeNull()
    const link = path.join(tmp, 'link')
    fs.symlinkSync(root, link)
    expect(sandboxProblem(link)).toMatch(/symlink/)
    const file = path.join(tmp, 'file')
    fs.writeFileSync(file, 'x')
    expect(sandboxProblem(file)).toMatch(/not a directory/)
    expect(sandboxProblem(root, { uid: process.getuid() + 1 })).toMatch(/not yours/)
  })
})

describe('sandbox settings', () => {
  it('user settings hold only the Stop hook; the project gets acceptEdits (R138-8)', () => {
    const u = userClaudeSettings("/Users/Shared/erfana-capture/marks/stop-hook.log")
    expect(Object.keys(u)).toEqual(['hooks'])
    expect(u.hooks.Stop[0].hooks[0].command).toBe("date +%s >> '/Users/Shared/erfana-capture/marks/stop-hook.log'")
    expect(projectClaudeSettings()).toEqual({ permissions: { defaultMode: 'acceptEdits' } })
  })

  it('~/.claude.json skips onboarding and trusts both spellings of the project (spike Q4)', () => {
    const j = claudeJson(['/a/p', '/private/a/p', '/a/p'])
    expect(j.hasCompletedOnboarding).toBe(true)
    expect(Object.keys(j.projects)).toEqual(['/a/p', '/private/a/p'])
    expect(j.projects['/a/p'].hasTrustDialogAccepted).toBe(true)
  })

  it('shellQuote survives a quote in the path', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })

  it('findClaude skips wrappers in temporary folders (break: picking a terminal shim)', () => {
    const shim = path.join(tmp, 'shim')
    const real = path.join(tmp, 'real')
    fs.mkdirSync(shim)
    fs.mkdirSync(real)
    for (const d of [shim, real]) fs.writeFileSync(path.join(d, 'claude'), '', { mode: 0o755 })
    const home = path.join(tmp, 'home')
    // The temporary-folder list is passed in: the test's own folders live in
    // the OS temp folder (/tmp on Linux), which the default list skips.
    const PATH = [shim, real].join(path.delimiter)
    expect(findClaude({ PATH }, { home, tempDirs: [shim] })).toBe(fs.realpathSync(path.join(real, 'claude')))
    expect(findClaude({ PATH: shim }, { home, tempDirs: [shim] })).toBeNull()
    expect(findClaude({ ERFANA_CAPTURE_CLAUDE_BIN: path.join(real, 'claude'), PATH: '' }, { home })).toBe(fs.realpathSync(path.join(real, 'claude')))
    expect(findClaude({ PATH: '' }, { home })).toBeNull()
  })
})

describe('demo drive (B-7)', () => {
  const l = layout('/Users/Shared/erfana-capture')

  it('the project lives on the demo drive, not under /Users/ or the sandbox (break: a project path the app would show)', () => {
    expect(l.project.startsWith(`${VOLUME_ROOT}/`)).toBe(true)
    expect(l.project.startsWith('/Users/')).toBe(false)
  })

  it('reads mount points from hdiutil info', () => {
    const info = { images: [{ 'image-path': l.image, 'system-entities': [{ 'content-hint': 'GUID' }, { 'mount-point': VOLUME_ROOT }] }] }
    expect(attachedImages(info)).toEqual([{ image: l.image, mounts: [VOLUME_ROOT] }])
    expect(attachedImages({})).toEqual([])
  })

  it('refuses a mount point it did not make (break: writing into someone else\'s drive)', () => {
    expect(volumeProblem(l, [{ image: l.image, mounts: [VOLUME_ROOT] }], () => true)).toBeNull()
    expect(volumeProblem(l, [], () => false)).toBeNull()
    expect(volumeProblem(l, [{ image: '/elsewhere.dmg', mounts: [VOLUME_ROOT] }], () => true)).toMatch(/did not mount/)
  })
})

describe('--approve-readme-video (023-FR-015)', () => {
  const rows = [
    { id: 'readme/demo-webp', file: 'docs/assets/readme/demo.webp', scene: 'readme-demo' },
    { id: 'readme/demo-still', file: 'docs/assets/readme/demo-still.png', scene: 'readme-demo' },
    { id: 'x/y', file: 'docs/user-guide/images/x/y.png', scene: 'x' }
  ]
  const setup = (report = 'README video: every check passed\n') => {
    const root = path.join(tmp, 'repo')
    const draftDir = path.join(tmp, 'draft')
    fs.mkdirSync(path.join(root, 'docs', 'assets', 'readme'), { recursive: true })
    fs.mkdirSync(draftDir, { recursive: true })
    for (const f of ['demo.gif', 'demo.mp4', 'demo.webp']) fs.writeFileSync(path.join(root, 'docs', 'assets', 'readme', f), 'old')
    fs.writeFileSync(path.join(draftDir, 'demo.webp'), 'new video')
    fs.writeFileSync(path.join(draftDir, 'demo-still.png'), 'new still')
    if (report !== null) fs.writeFileSync(path.join(draftDir, 'report.txt'), report)
    return { root, draftDir }
  }

  it('puts the passed draft in place and removes the GIF and MP4 (break: the old files stay)', () => {
    const { root, draftDir } = setup()
    expect(approveReadmeVideo({ root, draftDir, rows, log: () => {} })).toBe(EXIT.OK)
    const dir = path.join(root, 'docs', 'assets', 'readme')
    expect(fs.readFileSync(path.join(dir, 'demo.webp'), 'utf8')).toBe('new video')
    expect(fs.readFileSync(path.join(dir, 'demo-still.png'), 'utf8')).toBe('new still')
    expect(fs.existsSync(path.join(dir, 'demo.gif'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'demo.mp4'))).toBe(false)
  })

  it('refuses a draft whose report did not pass, or a draft without its files (break: an unchecked video lands)', () => {
    let { root, draftDir } = setup('README video: 2 checks failed\n')
    expect(() => approveReadmeVideo({ root, draftDir, rows, log: () => {} })).toThrow(/no passed README video draft/)
    fs.rmSync(path.join(tmp, 'draft'), { recursive: true })
    ;({ root, draftDir } = setup(null))
    expect(() => approveReadmeVideo({ root, draftDir, rows, log: () => {} })).toThrow(/no passed README video draft/)
    fs.writeFileSync(path.join(draftDir, 'report.txt'), 'README video: every check passed\n')
    fs.rmSync(path.join(draftDir, 'demo-still.png'))
    expect(() => approveReadmeVideo({ root, draftDir, rows, log: () => {} })).toThrow(/has no demo-still\.png/)
    expect(fs.readFileSync(path.join(root, 'docs', 'assets', 'readme', 'demo.webp'), 'utf8')).toBe('old')
  })

  it('takes no other option', () => {
    expect(parseArgs(['--approve-readme-video']).approve).toBe(true)
    expect(() => parseArgs(['--approve-readme-video', '--only', 'x'])).toThrow(CaptureError)
  })
})

describe('legibility judge (R138-3)', () => {
  const word = (text, h) => ({ text, bbox: { y0: 0, y1: h * 3 } })

  it('measures capitals from words without descenders (break: counting "Update" with its p)', () => {
    expect(capitalHeight([word('Read', 7.5), word('Update', 11), word('file', 5), word('Done.', 7.1)])).toEqual({ px: 7.3, samples: 2 })
    expect(capitalHeight([word('x', 3)])).toEqual({ px: null, samples: 0 })
  })

  it('fails under 7 px or when the known line is not read back', () => {
    const ocr = (h, text) => ({ text, words: [word('Pasted', h), word('Read', h)] })
    expect(judgeFrame(ocr(7.3, '[Pasted  text #1 +37 lines]'), 'Pasted text').ok).toBe(true)
    expect(judgeFrame(ocr(6.7, 'Pasted text'), 'Pasted text').reasons.join()).toMatch(/6\.7 px < 7 px/)
    expect(judgeFrame(ocr(7.3, 'Pastcd tcxt'), 'Pasted text').reasons.join()).toMatch(/not read back/)
    expect(normalise(' A\n b ')).toBe('a b')
  })
})
