// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Encoding for the capture, all through the bundled ffmpeg (`ffmpeg-static`):
 * stills (overlay, crop, scale, palette quantisation) and the README video
 * (spec 023: the speed-up edit with captions, hold and fade, then an animated
 * WebP).
 *
 * The argument builders are pure so the unit tests pin them; `runFfmpeg`
 * passes them as an argument array, never through a shell.
 *
 * Design: docs/designs/user-guide/README.md § Encoding; the README video:
 * specs/spec-t3-023-readme-video.
 */

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

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

/** The macOS system font, which the app's UI uses (`--font-sans` starts with -apple-system). */
export const SYSTEM_FONT = '/System/Library/Fonts/SFNS.ttf'

/**
 * The README video's edit (spec 023): the screen recording, already cropped to
 * the window, played segment by segment at each segment's speed with no cut,
 * the step captions drawn centred in the title bar, then a hold on the last
 * frame and a fade to the first (023-FR-009). One lossless source comes out;
 * `storyWebpArgs` encodes it.
 *
 * @param {object} o
 * @param {string} o.input - the recording
 * @param {Array<{ from: number, to: number, speed: number }>} o.segments - recording seconds
 * @param {Array<{ file: string, from: number, to: number }>} o.captions - a text file per caption, output seconds
 * @param {number} o.hold
 * @param {number} o.fade
 * @param {number} o.content - output seconds before the hold
 * @param {{ fps: number, labelSize: number, titleBar: number }} o.video
 * @param {string} [o.fontFile]
 * @param {string} o.output
 */
export function storyArgs({ input, segments, captions, hold, fade, content, video, fontFile = SYSTEM_FONT, output }) {
  if (!segments.length) throw new Error('empty edit')
  const fps = video.fps
  const n = segments.length
  const parts = [`[0:v]split=${n}${segments.map((_, i) => `[s${i}]`).join('')}`]
  segments.forEach((s, i) => {
    if (!(s.to > s.from)) throw new Error(`segment ${i} is empty`)
    parts.push(`[s${i}]trim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},setpts=(PTS-STARTPTS)/${s.speed},fps=${fps}[v${i}]`)
  })
  parts.push(`${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,fps=${fps},setsar=1[cut]`)
  // Captions: white on a dark box, centred in the title bar.
  const y = Math.round((video.titleBar - video.labelSize) / 2)
  const draws = captions.map(
    (c) =>
      `drawtext=fontfile=${fontFile}:textfile=${c.file}:fontsize=${video.labelSize}:fontcolor=white:box=1:boxcolor=black@0.78:boxborderw=4:x=(w-text_w)/2:y=${y}:enable='between(t,${c.from.toFixed(3)},${c.to.toFixed(3)})'`
  )
  parts.push(`[cut]${draws.length ? draws.join(',') : 'null'},split[a][b]`)
  // The hold, plus the fade's length of the same frame for the cross-fade to run over.
  parts.push(`[a]tpad=stop_mode=clone:stop_duration=${(hold + fade).toFixed(3)}[held]`)
  parts.push(`[b]trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${fade.toFixed(3)}[first]`)
  parts.push(`[held][first]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(content + hold).toFixed(3)},format=yuv444p[out]`)
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-filter_complex', parts.join(';'), '-map', '[out]', '-c:v', 'ffv1', '-an', output]
}

/** The README video as an endless, silent, animated WebP at one quality (023-FR-010). */
export function storyWebpArgs(input, output, quality) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(int(quality)), '-compression_level', '6', '-loop', '0', '-an', output]
}

/**
 * WebP qualities to try, best first (023-NFR-002: sharpness wins up to the
 * size limit, so the first one that fits is kept).
 */
export const WEBP_QUALITIES = [90, 85, 80, 75, 70, 65, 60]

/** One frame at a time `t` (seconds), optionally scaled to a width. */
export function frameAtArgs(input, t, output, scaleWidth = null) {
  const vf = scaleWidth ? ['-vf', `scale=${even(scaleWidth)}:-2:flags=lanczos`] : []
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', input, '-frames:v', '1', ...vf, output]
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
