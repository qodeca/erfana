// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Blocked hosts inside frames, parsed from the console (issue #124, WI-14;
 * part 2 §2.8). The fixtures are lines captured from Electron 39.8.10 (spike
 * S17), with the scheme name the app serves; the refusal line quotes
 * `frame-src erfana-preview://<token>` (WI-13).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  createPreviewFrameCspConsole,
  parseFrameCspConsoleMessage,
  type PreviewFrameCspViolation
} from './previewFrameCspConsole'
import type { PreviewFrameLike } from './previewFrameGuard'

afterEach(() => {
  vi.restoreAllMocks()
})

const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
const OTHER_TOKEN = 'cafebabecafebabecafebabecafebabe'

/** A real panel id's shape: the page's lower-cased path. */
const PANEL_ID = 'preview-/proj/page.html'
/** What the log lines carry instead (QG-7 S3). */
const LOGGED_PANEL_ID = stablePathDigest(PANEL_ID)

const CAPTURED = {
  stylesheet: `Loading the stylesheet 'https://css.example.com/child.css' violates the following Content Security Policy directive: "style-src 'unsafe-inline' erfana-preview:". Note that 'style-src-elem' was not explicitly set, so 'style-src' is used as a fallback. The action has been blocked.`,
  script: `Loading the script 'https://js.example.com/child.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline' 'unsafe-eval' erfana-preview:". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.`,
  image: `Loading the image 'https://img.example.com/child.png' violates the following Content Security Policy directive: "img-src data: blob: erfana-preview:". The action has been blocked.`,
  font: `Loading the font 'https://fonts.example.com/child.woff2' violates the following Content Security Policy directive: "font-src data: erfana-preview:". The action has been blocked.`,
  media: `Loading media from  'https://media.example.com/child.mp4' violates the following Content Security Policy directive: "media-src blob: erfana-preview:". The action has been blocked.`,
  connect: `Connecting to 'https://api.example.com/child' violates the following Content Security Policy directive: "connect-src erfana-preview:". The action has been blocked.`,
  fetchFollowUp: `Fetch API cannot load https://api.example.com/child. Refused to connect because it violates the document's Content Security Policy.`,
  framing: `Framing 'https://remote.example.com/' violates the following Content Security Policy directive: "frame-src erfana-preview://${TOKEN}". The request has been blocked.\n`,
  framingOtherToken: `Framing 'erfana-preview://${OTHER_TOKEN}/' violates the following Content Security Policy directive: "frame-src erfana-preview://${TOKEN}". The request has been blocked.\n`
} as const

/** An image refusal line for `url`, in the captured wording. */
const imageLine = (url: string): string =>
  `Loading the image '${url}' violates the following Content Security Policy directive: "img-src data: blob: erfana-preview:". The action has been blocked.`

describe('parseFrameCspConsoleMessage', () => {
  it.each([
    ['stylesheet', 'https://css.example.com/child.css', 'style-src'],
    ['script', 'https://js.example.com/child.js', 'script-src'],
    ['image', 'https://img.example.com/child.png', 'img-src'],
    ['font', 'https://fonts.example.com/child.woff2', 'font-src'],
    ['media', 'https://media.example.com/child.mp4', 'media-src'],
    ['connect', 'https://api.example.com/child', 'connect-src']
  ] as const)('reads the captured %s line', (name, blockedURI, effectiveDirective) => {
    expect(parseFrameCspConsoleMessage(CAPTURED[name])).toEqual({ blockedURI, effectiveDirective })
  })

  it('reads the older "Refused to load the …" wording', () => {
    expect(
      parseFrameCspConsoleMessage(
        `Refused to load the image 'https://img.example.com/a.png' because it violates the following Content Security Policy directive: "img-src data: blob: erfana-preview:".`
      )
    ).toEqual({ blockedURI: 'https://img.example.com/a.png', effectiveDirective: 'img-src' })
  })

  it('ignores framing lines: a refused frame is a badge entry, never a band row', () => {
    expect(parseFrameCspConsoleMessage(CAPTURED.framing)).toBeNull()
    expect(parseFrameCspConsoleMessage(CAPTURED.framingOtherToken)).toBeNull()
  })

  it.each([
    ['the directive-less fetch follow-up', CAPTURED.fetchFollowUp],
    ['an uncaught exception', 'Uncaught TypeError: x is not a function'],
    ['an empty line', ''],
    ['a match that is not at the start', `note: ${CAPTURED.image}`],
    ['an unquoted URL', CAPTURED.image.replace(/'/g, '')]
  ])('ignores %s', (_name, message) => {
    expect(parseFrameCspConsoleMessage(message)).toBeNull()
  })

  it('refuses a URL past 2048 characters rather than report a cut one', () => {
    expect(parseFrameCspConsoleMessage(imageLine(`https://x.example/${'a'.repeat(2048)}`))).toBeNull()
  })

  it('cuts a flood-sized line before matching and still reads its head', () => {
    const huge = CAPTURED.image + 'x'.repeat(PREVIEW_LIMITS.FRAME_CSP_CONSOLE_MAX_CHARS * 100)

    expect(parseFrameCspConsoleMessage(huge)).toEqual({
      blockedURI: 'https://img.example.com/child.png',
      effectiveDirective: 'img-src'
    })
  })
})

describe('createPreviewFrameCspConsole', () => {
  const main: PreviewFrameLike = { frameTreeNodeId: 1, parent: null }
  const child: PreviewFrameLike = { frameTreeNodeId: 2, parent: main }

  function makeBridge(clock?: { now: number }) {
    const reports: PreviewFrameCspViolation[] = []
    let current: PreviewFrameLike | undefined = main
    const bridge = createPreviewFrameCspConsole({
      panelId: PANEL_ID,
      mainFrame: () => current,
      report: (violation) => {
        reports.push(violation)
      },
      now: clock ? () => clock.now : undefined
    })
    return {
      bridge,
      reports,
      setMainFrame: (frame: PreviewFrameLike | undefined) => {
        current = frame
      }
    }
  }

  it("reports a subframe's refusal to the page's CSP bridge", () => {
    const { bridge, reports } = makeBridge()

    bridge.handle({ level: 'error', message: CAPTURED.script, frame: child })

    expect(reports).toEqual([
      { blockedURI: 'https://js.example.com/child.js', effectiveDirective: 'script-src' }
    ])
  })

  it("ignores the main frame's lines – and a look-alike a frame prints, credited to it (S9) – without spending the cap", () => {
    const clock = { now: 1_000 }
    const { bridge, reports } = makeBridge(clock)

    for (let i = 0; i < PREVIEW_LIMITS.FRAME_CONSOLE_MAX_PER_SECOND * 2; i += 1) {
      bridge.handle({ level: 'error', message: imageLine(`https://m${i}.example.com/a.png`), frame: main })
    }
    bridge.handle({ level: 'error', message: CAPTURED.image, frame: child })

    expect(reports).toHaveLength(1)
  })

  it.each(['warning', 'info', 'debug', 3])('ignores level %j', (level) => {
    const { bridge, reports } = makeBridge()

    bridge.handle({ level, message: CAPTURED.image, frame: child })

    expect(reports).toEqual([])
  })

  it('ignores a line with no frame, a non-string message, or a view with no main frame', () => {
    const { bridge, reports, setMainFrame } = makeBridge()

    bridge.handle({ level: 'error', message: CAPTURED.image, frame: null })
    bridge.handle({ level: 'error', message: 42, frame: child })
    setMainFrame(undefined)
    bridge.handle({ level: 'error', message: CAPTURED.image, frame: child })

    expect(reports).toEqual([])
  })

  it('ignores frames of another page, and frames deeper than the walk', () => {
    const { bridge, reports } = makeBridge()
    const stranger: PreviewFrameLike = { frameTreeNodeId: 99, parent: { frameTreeNodeId: 98, parent: null } }
    let deep: PreviewFrameLike = child
    for (let level = 2; level <= PREVIEW_LIMITS.MAX_FRAME_DEPTH + 2; level += 1) {
      deep = { frameTreeNodeId: 10 + level, parent: deep }
    }

    bridge.handle({ level: 'error', message: CAPTURED.image, frame: stranger })
    bridge.handle({ level: 'error', message: CAPTURED.image, frame: deep })

    expect(reports).toEqual([])
  })

  it('drops framing lines before the arrival cap, so a frame flood cannot starve a real host', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { bridge, reports } = makeBridge({ now: 1_000 })

    for (let i = 0; i < PREVIEW_LIMITS.FRAME_CONSOLE_MAX_PER_SECOND * 3; i += 1) {
      bridge.handle({ level: 'error', message: CAPTURED.framing, frame: child })
    }
    bridge.handle({ level: 'error', message: CAPTURED.font, frame: child })

    expect(reports).toEqual([
      { blockedURI: 'https://fonts.example.com/child.woff2', effectiveDirective: 'font-src' }
    ])
    bridge.dispose()
    expect(info).not.toHaveBeenCalled()
  })

  it('admits FRAME_CONSOLE_MAX_PER_SECOND lines a second, counts the rest, logs the count once per window', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const clock = { now: 1_000 }
    const { bridge, reports } = makeBridge(clock)
    const cap = PREVIEW_LIMITS.FRAME_CONSOLE_MAX_PER_SECOND
    const flood = (count: number, tag: string): void => {
      for (let i = 0; i < count; i += 1) {
        bridge.handle({ level: 'error', message: imageLine(`https://${tag}${i}.example.com/a.png`), frame: child })
      }
    }

    flood(cap + 50, 'a')
    expect(reports).toHaveLength(cap)
    expect(info).not.toHaveBeenCalled()

    clock.now += 1_000
    flood(1, 'b')
    expect(reports).toHaveLength(cap + 1)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(expect.any(String), { panelId: LOGGED_PANEL_ID, count: 50, cap })

    clock.now += 1_000
    flood(1, 'c')
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('logs a pending drop count on dispose, then ignores every line', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { bridge, reports } = makeBridge({ now: 1_000 })
    const cap = PREVIEW_LIMITS.FRAME_CONSOLE_MAX_PER_SECOND
    for (let i = 0; i < cap + 20; i += 1) {
      bridge.handle({ level: 'error', message: imageLine(`https://d${i}.example.com/a.png`), frame: child })
    }

    bridge.dispose()
    bridge.dispose()
    bridge.handle({ level: 'error', message: CAPTURED.image, frame: child })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(expect.any(String), { panelId: LOGGED_PANEL_ID, count: 20, cap })
    expect(reports).toHaveLength(cap)
  })

  it('drops a line whose frame is torn down while it is read, logging that once', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { bridge, reports } = makeBridge()
    const disposed = {
      get frameTreeNodeId(): number {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
      parent: main
    }

    bridge.handle({ level: 'error', message: CAPTURED.image, frame: disposed })
    bridge.handle({ level: 'error', message: CAPTURED.image, frame: disposed })

    expect(reports).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.any(String), { panelId: LOGGED_PANEL_ID, error: 'Error' })
  })

  it('logs a read failure by error name only – never its message, nor the readable panel id', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const leak = `erfana-preview://${TOKEN}/proj/page.html is gone`
    const throwing = (thrown: unknown): PreviewFrameLike => ({
      get frameTreeNodeId(): number {
        throw thrown
      },
      parent: main
    })

    makeBridge().bridge.handle({ level: 'error', message: CAPTURED.image, frame: throwing(new TypeError(leak)) })
    makeBridge().bridge.handle({ level: 'error', message: CAPTURED.image, frame: throwing(leak) })

    expect(warn.mock.calls).toEqual([
      [expect.any(String), { panelId: LOGGED_PANEL_ID, error: 'TypeError' }],
      [expect.any(String), { panelId: LOGGED_PANEL_ID, error: 'string' }]
    ])
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/\/proj|is gone/)
  })
})
