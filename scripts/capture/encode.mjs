// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Encoding for the capture, all through the bundled ffmpeg (`ffmpeg-static`):
 * stills (overlay, crop, scale, palette quantisation) and the README demo loop
 * (edit list, then animated WebP, GIF and MP4 from one trimmed source).
 *
 * The argument builders are pure so the unit tests pin them; `runFfmpeg`
 * passes them as an argument array, never through a shell.
 *
 * Design: docs/designs/138-user-guide/README.md § Encoding, § Loop for #139.
 */

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/** Frame rate of the README loop (design encode table). */
export const LOOP_FPS = 12

/** Full-window stills are scaled to this width; crops keep 2×. */
export const WINDOW_WIDTH = 1600

export function ffmpegPath() {
  const p = require('ffmpeg-static')
  if (!p) throw new Error('ffmpeg-static has no binary for this platform')
  return p
}

/** One palette per image, no dithering (design § Encoding). */
const QUANTISE = 'split[qa][qb];[qa]palettegen=max_colors=256:stats_mode=full[qp];[qb][qp]paletteuse=dither=none'

const int = (n) => {
  if (!Number.isFinite(n)) throw new Error(`not a number: ${n}`)
  return Math.round(n)
}
/** An even number, as the H.264 and crop filters want. */
const even = (n) => Math.max(2, 2 * Math.round(n / 2))

/**
 * Arguments for one still: optional native-view overlay, optional crop,
 * optional scale to a width, then palette quantisation to a PNG.
 *
 * @param {object} o
 * @param {string} o.input - raw page screenshot (PNG)
 * @param {{ file: string, x: number, y: number } | null} [o.overlay] - native view capture, in device pixels
 * @param {{ x: number, y: number, width: number, height: number } | null} [o.crop] - device pixels
 * @param {number | null} [o.scaleWidth]
 * @param {string} o.output
 */
export function stillArgs({ input, overlay = null, crop = null, scaleWidth = null, output }) {
  const inputs = ['-i', input]
  const chain = []
  let label = '[0:v]'
  if (overlay) {
    inputs.push('-i', overlay.file)
    chain.push(`[0:v][1:v]overlay=x=${int(overlay.x)}:y=${int(overlay.y)}[ov]`)
    label = '[ov]'
  }
  const steps = []
  if (crop) steps.push(`crop=${even(crop.width)}:${even(crop.height)}:${int(crop.x)}:${int(crop.y)}`)
  if (scaleWidth) steps.push(`scale=${even(scaleWidth)}:-2:flags=lanczos`)
  steps.push(QUANTISE)
  chain.push(`${label}${steps.join(',')}`)
  return ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', chain.join(';'), '-frames:v', '1', output]
}

/**
 * The edit of the README demo: cut, speed-up and holds (design § Loop for
 * #139, Edit). Each segment is a range of the raw recording in seconds.
 *
 * @typedef {{ from: number, to: number, speed?: number, holdStart?: number, holdEnd?: number, name?: string }} Segment
 */

/**
 * Plan the demo's edit from the scene's marks (seconds on the recording's
 * timeline). The only cut is between `projectOpen` and `claudeIdle`, so
 * Claude Code's start-up screen never reaches a frame; the only speed-up is
 * the agent's working time (S4).
 *
 * @param {Record<string, number>} m - marks: startScreen, projectOpen, claudeIdle, selected, menuOpen, dialogOpen, handedOff, editLanded, end
 * @param {object} [t] - target seconds per storyboard shot
 * @returns {{ segments: Segment[], duration: number, times: { handOff: number, agentEnd: number, still: number } }}
 */
export function planDemoEdit(m, t = {}) {
  const need = ['startScreen', 'projectOpen', 'claudeIdle', 'selected', 'menuOpen', 'dialogOpen', 'handedOff', 'editLanded', 'end']
  for (const k of need) if (!Number.isFinite(m[k])) throw new Error(`demo mark missing: ${k}`)
  for (let i = 1; i < need.length; i++) {
    if (!(m[need[i]] >= m[need[i - 1]])) throw new Error(`demo marks out of order: ${need[i - 1]} → ${need[i]}`)
  }
  const target = { open: 2.5, establish: 1.5, select: 1.0, menu: 0.9, dialog: 0.9, handOff: 1.5, agent: 5, land: 3, hold: 2, ...t }
  const seg = (name, from, to, holdTotal, speed = 1) => {
    const len = (to - from) / speed
    return { name, from, to, speed, holdStart: 0, holdEnd: Math.max(0, holdTotal - len) }
  }
  const segments = [
    { ...seg('S0 open', m.startScreen, m.projectOpen, 0), holdStart: 1.0 },
    seg('S1 establish', m.claudeIdle, m.selected, target.establish),
    seg('S2 select', m.selected, m.menuOpen, target.select),
    seg('S2 menu', m.menuOpen, m.dialogOpen, target.menu),
    seg('S3 hand-off', m.dialogOpen, m.handedOff, target.dialog + target.handOff),
    seg('S4 agent', m.handedOff, m.editLanded, target.agent, Math.max(1, (m.editLanded - m.handedOff) / target.agent)),
    seg('S5-S6 land and hold', m.editLanded, m.end, target.land + target.hold)
  ]
  // The open shot is real time plus a short hold on the opened project.
  const open = segments[0]
  const openLen = open.holdStart + (open.to - open.from)
  open.holdEnd = Math.max(0.3, target.open - openLen)
  const len = (s) => s.holdStart + (s.to - s.from) / s.speed + s.holdEnd
  const at = (n) => segments.slice(0, n).reduce((a, s) => a + len(s), 0)
  const duration = at(segments.length)
  return {
    segments,
    duration,
    times: {
      // The prompt has arrived in the terminal: the end of the hand-off shot.
      handOff: at(5) - 0.2,
      // The end of the agent's (sped-up) work, just before the edit lands.
      agentEnd: at(6) - 0.2,
      still: at(6) + 0.5
    }
  }
}

/**
 * The filter graph that applies an edit and resamples to the loop's frame
 * rate. Output label `[out]`.
 *
 * @param {Segment[]} segments
 * @param {number} [fps]
 */
export function editFilter(segments, fps = LOOP_FPS) {
  if (!segments.length) throw new Error('empty edit')
  const n = segments.length
  const parts = [`[0:v]split=${n}${segments.map((_, i) => `[s${i}]`).join('')}`]
  segments.forEach((s, i) => {
    if (!(s.to > s.from)) throw new Error(`segment ${s.name ?? i} is empty`)
    const speed = s.speed ?? 1
    const f = [`trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)}`, `setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`, `fps=${fps}`]
    const hs = s.holdStart ?? 0
    const he = s.holdEnd ?? 0
    if (hs > 0 || he > 0) {
      f.push(`tpad=start_mode=clone:start_duration=${hs.toFixed(3)}:stop_mode=clone:stop_duration=${he.toFixed(3)}`)
    }
    parts.push(`[s${i}]${f.join(',')}[v${i}]`)
  })
  parts.push(`${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,fps=${fps},setsar=1[out]`)
  return parts.join(';')
}

/** Raw recording → one lossless, edited source at the loop's size and rate. */
export function demoSourceArgs({ input, segments, width = 1280, height = 800, output }) {
  const graph = `${editFilter(segments)};[out]scale=${even(width)}:${even(height)}:flags=lanczos,format=yuv444p[src]`
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-filter_complex', graph, '-map', '[src]', '-c:v', 'ffv1', '-an', output]
}

/**
 * Encoder arguments per loop format (design encode table, R138-9). All three
 * read the same edited source.
 *
 * @param {'webp'|'gif'|'mp4'} format
 */
export function loopArgs(format, input, output) {
  const head = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input]
  switch (format) {
    case 'webp':
      return [...head, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '80', '-compression_level', '6', '-loop', '0', '-an', output]
    case 'gif':
      return [
        ...head,
        '-filter_complex',
        // 32 colours: the UI is mostly greys, and the agent's scrolling output
        // changes most of every frame, so a full palette put an 18 s loop at
        // about 7.7 MB, over #139's 5 MiB cap (measured 2026-09-25: 256 →
        // 7.7 MB, 64 → 5.2 MB, 32 → 3.8 MB). WebP is the preferred format.
        '[0:v]split[a][b];[a]palettegen=max_colors=32:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
        '-loop',
        '0',
        '-an',
        output
      ]
    case 'mp4':
      return [
        ...head,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '23',
        '-preset',
        'slow',
        '-movflags',
        '+faststart',
        '-an',
        output
      ]
    default:
      throw new Error(`unknown loop format: ${format}`)
  }
}

/** One frame at a time `t` (seconds), optionally scaled to a width. */
export function frameAtArgs(input, t, output, scaleWidth = null) {
  const vf = scaleWidth ? ['-vf', `scale=${even(scaleWidth)}:-2:flags=lanczos`] : []
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', input, '-frames:v', '1', ...vf, output]
}

/** Frames by index into numbered PNGs (`pattern` holds `%04d`). */
export function framesByIndexArgs(input, indexes, pattern) {
  const expr = indexes.map((i) => `eq(n\\,${int(i)})`).join('+')
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `select=${expr}`, '-fps_mode', 'passthrough', pattern]
}

/** A 1-fps contact sheet for the human review of the loop (never committed). */
export function contactSheetArgs(input, output, columns = 5, rows = 4) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `fps=1,scale=384:-2,tile=${columns}x${rows}:padding=4`, '-frames:v', '1', output]
}

/** Tiny frames at 50 fps as raw RGB, to find the sync flash. */
export function syncScanArgs(input) {
  return ['-hide_banner', '-loglevel', 'error', '-i', input, '-vf', 'fps=50,scale=8:5', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']
}

/** The sync flash's colour (pure magenta), and how close a pixel must be. */
export const SYNC_RGB = [255, 0, 255]

/**
 * The time (s) of the first frame whose centre pixel is the sync colour.
 *
 * @param {Buffer} raw - rgb24 frames of 8×5 pixels at `fps`
 */
export function findSyncTime(raw, fps = 50, width = 8, height = 5) {
  const frame = width * height * 3
  const centre = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3
  for (let i = 0; i * frame + frame <= raw.length; i++) {
    const o = i * frame + centre
    const d = Math.abs(raw[o] - SYNC_RGB[0]) + Math.abs(raw[o + 1] - SYNC_RGB[1]) + Math.abs(raw[o + 2] - SYNC_RGB[2])
    if (d < 60) return i / fps
  }
  return null
}

/**
 * The page of an animated WebP shown at time `t` (s). The WebP encoder merges
 * identical frames into one longer page, so a page index is not `t × fps`;
 * `delays` is sharp's per-page duration list in milliseconds.
 */
export function webpPageAt(delays, t) {
  let end = 0
  for (let i = 0; i < delays.length; i++) {
    end += delays[i] / 1000
    if (t < end) return i
  }
  return delays.length - 1
}

/**
 * The WebP pages the privacy pass reads: the page on screen at every second
 * of the loop, plus the first and last page (R138-11).
 */
export function webpSamplePages(delays) {
  const total = delays.reduce((a, d) => a + d, 0) / 1000
  const set = new Set([0, delays.length - 1])
  for (let t = 0; t < total; t += 1) set.add(webpPageAt(delays, t))
  return [...set].sort((a, b) => a - b)
}

/** Run ffmpeg with an argument array; rejects with its stderr on failure. */
export function runFfmpeg(args, { binary = ffmpegPath(), stdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    let err = ''
    child.stdout.on('data', (d) => stdout && out.push(d))
    child.stderr.on('data', (d) => {
      if (err.length < 20000) err += d
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`${path.basename(binary)} exited ${code}: ${err.trim().slice(-2000)}`))
    })
  })
}
