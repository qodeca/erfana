// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the capture's ffmpeg argument lists and the demo edit (#138,
 * design § Encoding and § Loop for #139; R138-9). Each test names the break
 * it catches in encode.mjs.
 */

import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  contactSheetArgs,
  demoSourceArgs,
  editFilter,
  findSyncTime,
  frameAtArgs,
  loopArgs,
  planDemoEdit,
  stillArgs,
  webpPageAt,
  webpSamplePages
} from './encode.mjs'

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

describe('loopArgs (R138-9)', () => {
  it('WebP is libwebp_anim and loops forever', () => {
    const a = loopArgs('webp', 'src.mkv', 'demo.webp')
    expect(arg(a, '-c:v')).toBe('libwebp_anim')
    expect(arg(a, '-loop')).toBe('0')
  })

  it('GIF uses palettegen/paletteuse and loops (break: default 256 colours put it over the 5 MiB cap)', () => {
    const a = loopArgs('gif', 'src.mkv', 'demo.gif')
    expect(arg(a, '-filter_complex')).toMatch(/palettegen=max_colors=32.*paletteuse=dither=none/)
    expect(arg(a, '-loop')).toBe('0')
  })

  it('MP4 is H.264, yuv420p, faststart', () => {
    const a = loopArgs('mp4', 'src.mkv', 'demo.mp4')
    expect(arg(a, '-c:v')).toBe('libx264')
    expect(arg(a, '-pix_fmt')).toBe('yuv420p')
    expect(arg(a, '-movflags')).toBe('+faststart')
  })

  it('all read the same source; an unknown format throws', () => {
    for (const f of ['webp', 'gif', 'mp4']) expect(arg(loopArgs(f, 'src.mkv', 'x'), '-i')).toBe('src.mkv')
    expect(() => loopArgs('avi', 'a', 'b')).toThrow()
  })
})

const marks = { startScreen: 1, projectOpen: 2.5, claudeIdle: 12, selected: 12.4, menuOpen: 12.8, dialogOpen: 13.3, handedOff: 14, editLanded: 34, end: 35 }

describe('planDemoEdit', () => {
  it('cuts from projectOpen to claudeIdle: no frame of the start-up is in any segment (R138-4; break: one segment from startScreen to the end)', () => {
    const { segments } = planDemoEdit(marks)
    for (const s of segments) expect(s.from >= marks.claudeIdle || s.to <= marks.projectOpen).toBe(true)
  })

  it('speeds up only the agent segment, to about 5 s', () => {
    const { segments } = planDemoEdit(marks)
    const fast = segments.filter((s) => s.speed > 1)
    expect(fast.map((s) => s.name)).toEqual(['S4 agent'])
    expect((fast[0].to - fast[0].from) / fast[0].speed).toBeCloseTo(5)
  })

  it('lands in the 10–20 s range with the storyboard timing', () => {
    const { duration, times } = planDemoEdit(marks)
    expect(duration).toBeGreaterThan(10)
    expect(duration).toBeLessThan(20)
    expect(times.handOff).toBeLessThan(times.agentEnd)
  })

  it('refuses missing or out-of-order marks (break: a NaN edit)', () => {
    expect(() => planDemoEdit({ ...marks, end: undefined })).toThrow(/missing: end/)
    expect(() => planDemoEdit({ ...marks, selected: 11 })).toThrow(/out of order/)
  })
})

describe('editFilter and demoSourceArgs', () => {
  it('trims, speeds, pads and concatenates every segment', () => {
    const g = editFilter([
      { name: 'a', from: 1, to: 2, holdStart: 1 },
      { name: 'b', from: 3, to: 13, speed: 2, holdEnd: 0.5 }
    ])
    expect(g).toMatch(/^\[0:v\]split=2\[s0\]\[s1\]/)
    expect(g).toMatch(/trim=start=3\.000:end=13\.000,setpts=\(PTS-STARTPTS\)\/2\.0000/)
    expect(g).toMatch(/tpad=start_mode=clone:start_duration=1\.000/)
    expect(g).toMatch(/concat=n=2:v=1:a=0,fps=12/)
    expect(() => editFilter([{ from: 2, to: 2 }])).toThrow(/empty/)
    expect(() => editFilter([])).toThrow()
  })

  it('the edited source is lossless FFV1 at 1280×800', () => {
    const a = demoSourceArgs({ input: 'r.webm', segments: [{ from: 0, to: 1 }], output: 's.mkv' })
    expect(arg(a, '-c:v')).toBe('ffv1')
    expect(arg(a, '-filter_complex')).toMatch(/scale=1280:800/)
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
    expect(webpSamplePages(delays)).toEqual([0, 1, 3])
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
