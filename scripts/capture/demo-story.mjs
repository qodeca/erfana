// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The README showcase video's story and its edit plan (spec 023,
 * specs/spec-t3-023-readme-video). Pure data and arithmetic, shared by the
 * scene (which records the steps and logs their times), `run.mjs` (which
 * plans the edit, checks it and encodes) and the unit tests.
 *
 * The edit never cuts: the whole recording from the first step's start to the
 * last step's end plays, at real speed except inside the waits the scene
 * marked (an agent turn, a conversion, a transcription), which are sped up by
 * a whole-number factor that is shown on screen while they play (023-FR-008).
 */

/** The nine steps in story order (023-FR-001), each with its label (023-FR-007). */
export const STORY = [
  { id: 'open', label: 'Open a project' },
  { id: 'agent', label: 'Start Claude Code in the terminal' },
  { id: 'import', label: 'Import a file: PDF to Markdown' },
  { id: 'edit', label: 'Claude edits, the preview updates' },
  { id: 'transcribe', label: 'Transcribe a voice memo' },
  { id: 'html', label: 'Preview an HTML page' },
  { id: 'comment', label: 'Comment mode: pin a note' },
  { id: 'export', label: 'Export to PDF' },
  { id: 'screenshot', label: 'Capture window for the agent' }
]

/**
 * The app's own names a label shows (023-FR-007, 023-FR-016). Each has a
 * claim-ledger entry whose source is the code line that defines it, so a
 * rename fails `npm run check:claims`.
 */
export const LABEL_UI_NAMES = ['Import a file', 'Comment mode', 'Export to PDF', 'Capture window']

/** The demo project's input files the story uses (023-AC-011). */
export const STORY_INPUTS = ['inbox/seed-order.pdf', 'recordings/committee-voice-note.m4a', 'site/index.html']

/**
 * The speech-model prerequisite (023-FR-018): the app's model list after the
 * scene asked for the local "tiny" model. Null when it is there, otherwise
 * the message that stops the run before anything is recorded.
 */
export function speechModelProblem(listing) {
  return /tiny/.test(String(listing)) ? null : `the speech model is not downloaded (${String(listing).slice(0, 200)}); nothing was recorded`
}

/** Video geometry and limits (023-NFR-001…004). */
export const VIDEO = {
  /** The window's outer size: content plus the 32 px title bar. */
  width: 1920,
  height: 1080,
  titleBar: 32,
  /** Frame rate of the WebP. */
  fps: 12,
  /** One loop, in seconds, hold and fade included. */
  minSeconds: 50,
  maxSeconds: 70,
  targetSeconds: 60,
  holdSeconds: 2,
  fadeSeconds: 1,
  maxBytes: 30 * 1024 * 1024,
  /** The README's display width, where the labels are measured. */
  displayWidth: 880,
  /** The label's text size in px at 1920: its capital height stays ≥ 7 px at 880 px. */
  labelSize: 28,
  maxLabelWords: 6
}

/** A label's text with its speed-up mark, when it has one. */
export function caption(label, speed) {
  return speed > 1 ? `${label}  ×${speed}` : label
}

/** Words in a label, for the six-word limit. */
export function wordCount(label) {
  return label.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length
}

/**
 * Plan the edit from the scene's log.
 *
 * @param {object} log
 * @param {Array<{ id: string, start: number, end: number }>} log.steps - seconds on the recording's timeline
 * @param {Array<{ from: number, to: number }>} [log.waits] - spans that may be sped up
 * @param {object} [o]
 * @returns {{
 *   segments: Array<{ from: number, to: number, speed: number }>,
 *   captions: Array<{ text: string, from: number, to: number }>,
 *   steps: Array<{ id: string, from: number, to: number }>,
 *   content: number,
 *   duration: number
 * }} times in `captions` and `steps` are seconds of the output, before the hold
 */
export function planStory(log, o = {}) {
  const v = { ...VIDEO, ...o }
  const steps = log.steps ?? []
  if (steps.length !== STORY.length) throw new Error(`the story has ${STORY.length} steps; the log has ${steps.length}`)
  steps.forEach((s, i) => {
    if (s.id !== STORY[i].id) throw new Error(`step ${i + 1} is "${s.id}", expected "${STORY[i].id}"`)
    if (!(Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)) throw new Error(`step "${s.id}" has no time span`)
    if (i > 0 && s.start < steps[i - 1].end) throw new Error(`step "${s.id}" starts before "${steps[i - 1].id}" ends`)
  })
  const start = steps[0].start
  const end = steps[steps.length - 1].end
  const waits = [...(log.waits ?? [])].sort((a, b) => a.from - b.from)
  waits.forEach((w, i) => {
    if (!(w.to > w.from)) throw new Error(`wait ${i + 1} is empty`)
    if (w.from < start || w.to > end) throw new Error(`wait ${i + 1} lies outside the story`)
    if (i > 0 && w.from < waits[i - 1].to) throw new Error(`waits ${i} and ${i + 1} overlap`)
  })

  // Real-time parts play as they are; the waits share what is left of the target.
  const waited = waits.reduce((a, w) => a + (w.to - w.from), 0)
  const realTime = end - start - waited
  const budget = v.targetSeconds - v.holdSeconds - v.fadeSeconds - realTime
  const speeds = waits.map((w) => {
    if (waited === 0) return 1
    if (budget <= 0) return Math.max(1, Math.ceil(w.to - w.from))
    return Math.max(1, Math.ceil((w.to - w.from) / ((budget * (w.to - w.from)) / waited)))
  })

  // Contiguous segments from the first step to the last: no cut anywhere.
  const segments = []
  let at = start
  waits.forEach((w, i) => {
    if (w.from > at) segments.push({ from: at, to: w.from, speed: 1 })
    segments.push({ from: w.from, to: w.to, speed: speeds[i] })
    at = w.to
  })
  if (end > at) segments.push({ from: at, to: end, speed: 1 })

  /** Recording time → output time. */
  const out = (t) => {
    let acc = 0
    for (const s of segments) {
      if (t <= s.to) return acc + (Math.max(t, s.from) - s.from) / s.speed
      acc += (s.to - s.from) / s.speed
    }
    return acc
  }
  const content = out(end)
  const planned = steps.map((s, i) => ({ id: s.id, from: out(s.start), to: out(i + 1 < steps.length ? steps[i + 1].start : end) }))

  // One caption per stretch of one step at one speed.
  const captions = []
  for (const [i, step] of planned.entries()) {
    const cuts = new Set([step.from, step.to])
    for (const s of segments) {
      for (const t of [out(s.from), out(s.to)]) if (t > step.from && t < step.to) cuts.add(t)
    }
    const points = [...cuts].sort((a, b) => a - b)
    for (let k = 0; k + 1 < points.length; k++) {
      const mid = (points[k] + points[k + 1]) / 2
      const seg = segments.find((s) => out(s.from) <= mid && mid <= out(s.to))
      const text = caption(STORY[i].label, seg ? seg.speed : 1)
      const last = captions[captions.length - 1]
      if (last && last.text === text && Math.abs(last.to - points[k]) < 1e-9) last.to = points[k + 1]
      else captions.push({ text, from: points[k], to: points[k + 1] })
    }
  }
  // The last caption stays through the hold (the fade then goes to the first frame).
  captions[captions.length - 1].to = content + v.holdSeconds + v.fadeSeconds

  return { segments, captions, steps: planned, content, duration: content + v.holdSeconds + v.fadeSeconds }
}

/**
 * What the length rule says about a plan (023-NFR-003): null when it fits,
 * otherwise the reason.
 */
export function lengthProblem(duration, v = VIDEO) {
  if (duration < v.minSeconds) return `the loop is ${duration.toFixed(1)} s, under ${v.minSeconds} s`
  if (duration > v.maxSeconds) return `the loop is ${duration.toFixed(1)} s, over ${v.maxSeconds} s`
  return null
}

/**
 * Panel widths as shares of the window (023-FR-002): tree about 15 %, preview
 * about 52 %, terminal about 33 %, each ±5 points. Returns the problems.
 *
 * @param {{ window: number, tree: number, preview: number, terminal: number, columns?: number, editorVisible?: boolean }} m
 */
export function layoutProblems(m) {
  const problems = []
  const want = { tree: 15, preview: 52, terminal: 33 }
  for (const [k, pct] of Object.entries(want)) {
    const got = (100 * m[k]) / m.window
    if (Math.abs(got - pct) > 5) problems.push(`${k} is ${got.toFixed(1)} % of the window, not ${pct} ± 5 %`)
  }
  if (m.editorVisible) problems.push('an editor pane is visible')
  if (m.columns !== undefined && m.columns < 80) problems.push(`the terminal has ${m.columns} columns, under 80`)
  return problems
}
