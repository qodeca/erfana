// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the capture's ffmpeg argument lists (#138, design § Encoding) and
 * the README video's edit (spec 023). Each test names the break it catches in
 * encode.mjs.
 */

import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { contactSheetArgs, findSyncTime, frameAtArgs, stillArgs, storyArgs, storyWebpArgs, WEBP_QUALITIES, webpPageAt } from './encode.mjs'

const arg = (args, flag) => args[args.indexOf(flag) + 1]

describe('stillArgs', () => {
  it('window shot: scale to 1600 then one palette, no dithering (break: dither on or no quantise)', () => {
    const a = stillArgs({ input: 'in.png', scaleWidth: 1600, output: 'out.png' })
    const graph = arg(a, '-filter_complex')
    expect(graph).toMatch(/^\[0:v\]scale=1600:-2:flags=lanczos,split/)
    expect(graph).toMatch(/palettegen=max_colors=256/)
    expect(graph).toMatch(/paletteuse=dither=none/)
    expect(a.slice(-3)).toEqual(['-frames:v', '1', 'out.png'])
  })

  it('native row: overlay first, then crop (break: cropping before the overlay shifts the view)', () => {
    const a = stillArgs({ input: 'p.png', overlay: { file: 'v.png', x: 884, y: 164 }, crop: { x: 10, y: 20, width: 301, height: 400 }, output: 'o.png' })
    expect(a).toContain('v.png')
    const graph = arg(a, '-filter_complex')
    expect(graph.indexOf('overlay=x=884:y=164')).toBeLessThan(graph.indexOf('crop='))
    expect(graph).toMatch(/crop=302:400:10:20/)
    expect(graph).not.toMatch(/scale=/)
  })
})

describe('storyArgs (spec 023)', () => {
  const video = { fps: 12, labelSize: 24, titleBar: 32 }
  const base = {
    input: 'rec.mkv',
    segments: [
      { from: 2, to: 10, speed: 1 },
      { from: 10, to: 50, speed: 8 },
      { from: 50, to: 60, speed: 1 }
    ],
    captions: [{ file: '/c/0.txt', from: 0, to: 8 }, { file: '/c/1.txt', from: 8, to: 26 }],
    hold: 2,
    fade: 1,
    content: 23,
    video,
    fontFile: '/f.ttf',
    output: 'src.mkv'
  }
  const graph = (o = base) => arg(storyArgs(o), '-filter_complex')

  it('plays every segment at its own speed and joins them with no gap (break: a cut, or a wrong factor)', () => {
    const g = graph()
    expect(g).toContain('trim=start=2.000:end=10.000,setpts=(PTS-STARTPTS)/1')
    expect(g).toContain('trim=start=10.000:end=50.000,setpts=(PTS-STARTPTS)/8')
    expect(g).toContain('concat=n=3:v=1:a=0')
  })

  it('draws each caption from its text file, centred in the title bar, only in its time span (break: a label shown all the time)', () => {
    const g = graph()
    expect(g).toContain("textfile=/c/1.txt:fontsize=24")
    expect(g).toContain('x=(w-text_w)/2:y=4')
    expect(g).toContain("enable='between(t,8.000,26.000)'")
    expect(g).toContain('fontfile=/f.ttf')
  })

  it('holds the last frame, then fades to the first over the fade (break: a jump at the loop point)', () => {
    const g = graph()
    expect(g).toContain('tpad=stop_mode=clone:stop_duration=3.000')
    expect(g).toContain('trim=end_frame=1')
    expect(g).toContain('xfade=transition=fade:duration=1.000:offset=25.000')
    const a = storyArgs(base)
    expect(arg(a, '-c:v')).toBe('ffv1')
    expect(a).toContain('-an')
  })

  it('refuses an empty edit or an empty segment', () => {
    expect(() => storyArgs({ ...base, segments: [] })).toThrow(/empty edit/)
    expect(() => storyArgs({ ...base, segments: [{ from: 3, to: 3, speed: 1 }] })).toThrow(/empty/)
  })

  it('without captions the graph still runs', () => {
    expect(graph({ ...base, captions: [] })).toContain('[cut]null,split')
  })
})

describe('storyWebpArgs (023-FR-010)', () => {
  it('an endless, silent, animated WebP at the asked quality (break: a finite loop or audio)', () => {
    const a = storyWebpArgs('src.mkv', 'demo.webp', 85)
    expect(arg(a, '-c:v')).toBe('libwebp_anim')
    expect(arg(a, '-q:v')).toBe('85')
    expect(arg(a, '-loop')).toBe('0')
    expect(a).toContain('-an')
  })

  it('tries the qualities best first (023-NFR-002: sharpness wins up to the limit)', () => {
    expect([...WEBP_QUALITIES].sort((x, y) => y - x)).toEqual(WEBP_QUALITIES)
  })
})

describe('frames', () => {
  it('frameAtArgs seeks before the input and scales on request', () => {
    const a = frameAtArgs('d.mp4', 2.5, 'f.png', 800)
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))
    expect(arg(a, '-vf')).toBe('scale=800:-2:flags=lanczos')
  })

  it('a WebP page is found by its time, not by t × fps (break: merged pages)', () => {
    const delays = [1000, 83, 83, 3000]
    expect(webpPageAt(delays, 0.5)).toBe(0)
    expect(webpPageAt(delays, 1.1)).toBe(2)
    expect(webpPageAt(delays, 99)).toBe(3)
  })

  it('the contact sheet is one frame per second', () => {
    expect(arg(contactSheetArgs('d.mp4', 's.png'), '-vf')).toMatch(/^fps=1,/)
  })
})

describe('findSyncTime', () => {
  it('returns the time of the first magenta frame', () => {
    const frame = (rgb) => Buffer.alloc(8 * 5 * 3, 0).fill(Buffer.from(rgb))
    const raw = Buffer.concat([frame([10, 10, 10]), frame([10, 10, 10]), frame([250, 5, 250]), frame([255, 0, 255])])
    expect(findSyncTime(raw, 50)).toBeCloseTo(0.04)
    expect(findSyncTime(frame([0, 0, 0]), 50)).toBeNull()
  })
})
