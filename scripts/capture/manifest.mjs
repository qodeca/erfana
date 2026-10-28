// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The capture manifest (`shots.json`): load, validate, `--only` resolution,
 * the size budget and the `--check` drift report.
 *
 * The manifest decides where the capture writes inside `docs/`, so it is
 * validated before anything else runs: a row's `file` must sit in one of the
 * two output folders below, carry an allowed extension and never contain
 * `..`. `run.mjs` checks the real path again before it writes.
 *
 * Spec: docs/features/138-user-guide.md § 3.1, § 3.2 and step 5.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { scanLinks, classifyTarget } from '../check-links.mjs'

/** The only folders a capture may write into (spec § 3.2, R138-10). */
export const OUTPUT_ALLOW_LIST = ['docs/user-guide/images/', 'docs/assets/readme/']

/** Guide images count towards the 12 MB total; the README demo does not. */
export const GUIDE_IMAGES_DIR = 'docs/user-guide/images/'

export const EXTENSIONS = ['.png', '.gif', '.mp4', '.webp']

/** AC8: at most 12 MB for all guide images together. */
export const GUIDE_TOTAL_BYTES = 12 * 1024 * 1024

/** The design's screenshot list, which the manifest must agree with. */
export const DESIGN_FILE = 'docs/designs/138-user-guide/README.md'

const MAX_KB_CEILING = 5120
const ID_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_PAGE_BYTES = 2 * 1024 * 1024

/** A finding that stops the run with the given exit code. */
export class CaptureError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

function isIdPath(value, minParts) {
  if (typeof value !== 'string') return false
  const parts = value.split('/')
  return parts.length >= minParts && parts.every((p) => ID_PART.test(p))
}

/**
 * Check one `file` value: repository-relative, POSIX, inside the allow-list,
 * an allowed extension, no `..`. Returns the reason it is refused, or null.
 */
export function fileProblem(file) {
  if (typeof file !== 'string' || file === '') return 'file is missing'
  if (file.includes('\\')) return 'file contains a backslash'
  if (file.includes('\0')) return 'file contains a NUL byte'
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file)) return 'file is an absolute path'
  if (file.split('/').some((p) => p === '..')) return 'file contains ..'
  if (file.includes('..')) return 'file contains ..'
  if (file.split('/').some((p) => p === '' || p === '.')) return 'file has an empty or . path part'
  if (!OUTPUT_ALLOW_LIST.some((dir) => file.startsWith(dir))) {
    return `file is outside the output allow-list (${OUTPUT_ALLOW_LIST.join(', ')})`
  }
  if (!EXTENSIONS.includes(path.posix.extname(file))) {
    return `file must end in ${EXTENSIONS.join(', ')}`
  }
  return null
}

/**
 * Validate the parsed manifest. Throws a CaptureError (exit 1) listing every
 * problem, so one run shows them all.
 *
 * @param {unknown} data - parsed `shots.json`
 * @returns {Array<object>} rows with `kind` defaulted to `still`
 */
export function validateManifest(data) {
  if (!Array.isArray(data)) throw new CaptureError('shots.json must be a JSON array')
  const problems = []
  const ids = new Set()
  const files = new Set()
  const rows = data.map((raw, i) => {
    const where = `row ${i + 1}${raw && typeof raw.id === 'string' ? ` (${raw.id})` : ''}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`${where}: not an object`)
      return null
    }
    const row = { kind: 'still', ...raw }
    if (!isIdPath(row.id, 2)) problems.push(`${where}: id must be lower-case words joined by - and /, with at least one /`)
    else if (ids.has(row.id)) problems.push(`${where}: duplicate id`)
    else ids.add(row.id)
    const fp = fileProblem(row.file)
    if (fp) problems.push(`${where}: ${fp}`)
    else if (files.has(row.file)) problems.push(`${where}: duplicate file`)
    else files.add(row.file)
    if (!isIdPath(row.scene, 1) || row.scene.includes('/')) problems.push(`${where}: scene must be one lower-case word group (a-z, 0-9, -)`)
    if (row.kind !== 'still' && row.kind !== 'loop') problems.push(`${where}: kind must be "still" or "loop"`)
    if (row.kind === 'still' && !fp && path.posix.extname(row.file) !== '.png') problems.push(`${where}: a still must be a .png`)
    if (row.kind === 'loop' && !fp && path.posix.extname(row.file) === '.png') problems.push(`${where}: a loop must be .webp, .gif or .mp4`)
    if (row.kind === 'still') {
      if (typeof row.state !== 'string' || row.state === '') problems.push(`${where}: state is missing`)
      if (typeof row.crop !== 'string' || row.crop === '') problems.push(`${where}: crop is missing`)
    }
    if (!Array.isArray(row.pages) || row.pages.some((p) => typeof p !== 'string' || !p.endsWith('.md') || p.startsWith('/') || p.split('/').includes('..'))) {
      problems.push(`${where}: pages must be a list of repository-relative .md paths`)
    }
    if (typeof row.agent !== 'boolean') problems.push(`${where}: agent must be true or false`)
    if (typeof row.native !== 'boolean') problems.push(`${where}: native must be true or false`)
    if (!Number.isFinite(row.maxKB) || row.maxKB <= 0 || row.maxKB > MAX_KB_CEILING) {
      problems.push(`${where}: maxKB must be a number from 1 to ${MAX_KB_CEILING}`)
    }
    return row
  })
  const scenes = new Set(rows.filter(Boolean).map((r) => r.scene))
  for (const s of scenes) if (ids.has(s)) problems.push(`scene "${s}" is also a row id`)
  if (problems.length) {
    throw new CaptureError(`shots.json is invalid:\n  ${problems.join('\n  ')}`)
  }
  return rows
}

/** Read and validate `shots.json`. */
export function loadManifest(manifestPath) {
  const st = fs.lstatSync(manifestPath)
  if (!st.isFile()) throw new CaptureError(`${manifestPath} is not a regular file`)
  if (st.size > MAX_MANIFEST_BYTES) throw new CaptureError(`${manifestPath} is larger than ${MAX_MANIFEST_BYTES} bytes`)
  let data
  try {
    data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    throw new CaptureError(`shots.json is not valid JSON: ${e.message}`)
  }
  return validateManifest(data)
}

/**
 * `--only a,b,c`: each id is a row id or a scene id. An id that matches
 * neither is an error. Returns rows in manifest order, without duplicates.
 */
export function resolveOnly(rows, only) {
  if (only === undefined || only === null) return { rows: [...rows], partial: false }
  const wanted = String(only)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (wanted.length === 0) throw new CaptureError('--only needs at least one row or scene id')
  const unknown = wanted.filter((w) => !rows.some((r) => r.id === w || r.scene === w))
  if (unknown.length) throw new CaptureError(`--only: unknown row or scene id: ${unknown.join(', ')}`)
  const selected = rows.filter((r) => wanted.includes(r.id) || wanted.includes(r.scene))
  return { rows: selected, partial: selected.length !== rows.length }
}

/**
 * The budget: each file within its row's `maxKB`, and all guide images within
 * 12 MB. `sizes` maps a row id to a byte count (a row absent from it is not
 * checked); `extraGuideBytes` counts guide images this run did not measure.
 *
 * @returns {{ problems: string[], guideTotal: number, total: number }}
 */
export function checkBudget(rows, sizes, { extraGuideBytes = 0 } = {}) {
  const problems = []
  let guideTotal = extraGuideBytes
  let total = 0
  for (const row of rows) {
    if (!sizes.has(row.id)) continue
    const bytes = sizes.get(row.id)
    total += bytes
    if (row.file.startsWith(GUIDE_IMAGES_DIR)) guideTotal += bytes
    if (bytes > row.maxKB * 1024) {
      problems.push(`${row.id} is ${formatKB(bytes)} (limit ${row.maxKB} KB)`)
    }
  }
  if (guideTotal > GUIDE_TOTAL_BYTES) {
    problems.push(`guide images total ${formatKB(guideTotal)} (limit ${GUIDE_TOTAL_BYTES / 1024} KB)`)
  }
  return { problems, guideTotal, total }
}

export function formatKB(bytes) {
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * The file names the design's screenshot list names (its `| n | \`file\` |`
 * rows), as `docs/user-guide/images/…` paths.
 */
export function designScreenshotFiles(designMarkdown) {
  const out = []
  let inList = false
  for (const line of designMarkdown.split('\n')) {
    if (line.startsWith('### ')) inList = line.trim() === '### Screenshot list'
    if (!inList || !line.startsWith('| ')) continue
    const cells = line.split('|')
    if (cells.length < 3 || !/^\s*\d+\s*$/.test(cells[1])) continue
    const name = cells[2].trim()
    if (name.startsWith('`') && name.endsWith('`') && name.length > 2) {
      out.push(GUIDE_IMAGES_DIR + name.slice(1, -1))
    }
  }
  return out
}

/** Tracked and untracked (not ignored) files under a folder, never a directory walk. */
export function listRepoFiles(root, dir) {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', dir], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  return out.split('\0').filter(Boolean)
}

/**
 * `--check`: manifest rows, files on disk, the design's list and the guide's
 * image links agree. No app launch, no network.
 *
 * @param {object} o
 * @param {string} o.root - repository root
 * @param {object[]} o.rows - validated manifest rows
 * @param {(dir: string) => string[]} [o.listFiles] - repository listing
 * @param {typeof fs} [o.fsApi]
 * @returns {{ drift: string[], budget: ReturnType<typeof checkBudget>, notes: string[] }}
 */
export function checkDrift({ root, rows, listFiles = (dir) => listRepoFiles(root, dir), fsApi = fs }) {
  const drift = []
  const notes = []
  const sizes = new Map()
  const byFile = new Map(rows.map((r) => [r.file, r]))

  const statFile = (rel) => {
    try {
      const st = fsApi.lstatSync(path.join(root, ...rel.split('/')))
      return st.isFile() ? st : null
    } catch {
      return null
    }
  }

  for (const row of rows) {
    const st = statFile(row.file)
    if (!st) drift.push(`row without a file: ${row.id} → ${row.file}`)
    else sizes.set(row.id, st.size)
  }

  for (const file of listFiles(GUIDE_IMAGES_DIR)) {
    if (!byFile.has(file)) drift.push(`file without a row: ${file}`)
  }

  // The design's screenshot list and the manifest's guide rows name the same files.
  let design = null
  try {
    design = fsApi.readFileSync(path.join(root, ...DESIGN_FILE.split('/')), 'utf8')
  } catch {
    notes.push(`${DESIGN_FILE} not found; design list not compared`)
  }
  if (design !== null) {
    const listed = new Set(designScreenshotFiles(design))
    const guideRows = rows.filter((r) => r.file.startsWith(GUIDE_IMAGES_DIR))
    for (const r of guideRows) if (!listed.has(r.file)) drift.push(`row not in the design's screenshot list: ${r.id}`)
    for (const f of listed) if (!byFile.has(f)) drift.push(`design lists an image with no row: ${f}`)
  }

  // Guide pages: every image link resolves to a manifest row, and every page a
  // row names links to that row's image. Before the guide is written (step 7)
  // there are no pages, and page checks are reported as a note instead.
  const guidePages = listFiles('docs/user-guide/').filter((f) => f.endsWith('.md'))
  const pageLinks = new Map()
  for (const page of guidePages) {
    const st = statFile(page)
    if (!st) continue
    if (st.size > MAX_PAGE_BYTES) {
      drift.push(`${page}: larger than 2 MB, not read`)
      continue
    }
    const { links } = scanLinks(fsApi.readFileSync(path.join(root, ...page.split('/')), 'utf8'))
    const images = new Set()
    for (const link of links) {
      if (!link.image) continue
      const t = classifyTarget(page, link.target)
      if (t.kind !== 'relative') continue
      images.add(t.rel)
      if (t.rel.startsWith(GUIDE_IMAGES_DIR) && !byFile.has(t.rel)) {
        drift.push(`${page}:${link.line}: image link with no manifest row: ${t.rel}`)
      }
    }
    pageLinks.set(page, images)
  }
  const guideWritten = guidePages.length > 0
  let pending = 0
  for (const row of rows) {
    for (const page of row.pages) {
      if (!page.startsWith('docs/user-guide/')) {
        const st = statFile(page)
        if (!st) drift.push(`${row.id}: page does not exist: ${page}`)
        continue
      }
      if (!pageLinks.has(page)) {
        if (guideWritten) drift.push(`${row.id}: page does not exist: ${page}`)
        else pending++
        continue
      }
      if (!pageLinks.get(page).has(row.file)) drift.push(`${page}: does not show ${row.file} (row ${row.id})`)
    }
  }
  if (pending) notes.push(`the guide pages are not written yet: ${pending} page links not checked (plan step 7)`)

  return { drift, budget: checkBudget(rows, sizes), notes }
}
