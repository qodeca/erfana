// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `npm run docs:screenshots` – regenerate the user guide's screenshots and the
 * README demo from the real app (#138, #139).
 *
 * Stages, each failing closed with a named reason and exit code:
 * preflight → build → sandbox → scenes → post-process (encode, privacy,
 * budget) → copy → report. Nothing reaches `docs/` unless every check passed
 * for every selected row; the copy is one temp-file-and-rename per file, at
 * the end, so a failed run leaves the committed tree as it was.
 *
 * Exit codes (spec § 3.1): 0 ok · 1 scene failed · 2 not macOS · 3 no agent
 * login · 4 unsafe sandbox path · 5 privacy hit · 6 over budget · 7 drift.
 *
 * The runbook is scripts/capture/README.md.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { CaptureError, checkBudget, checkDrift, formatKB, GUIDE_IMAGES_DIR, loadManifest, OUTPUT_ALLOW_LIST, resolveOnly } from './manifest.mjs'
import { buildDenyList, createOcr, resolveTesseract, sampleTimes, scanText, stripAnsi } from './privacy.mjs'
import {
  contactSheetArgs,
  demoSourceArgs,
  findSyncTime,
  frameAtArgs,
  loopArgs,
  planDemoEdit,
  runFfmpeg,
  stillArgs,
  syncScanArgs,
  webpPageAt,
  webpSamplePages
} from './encode.mjs'
import { DISPLAY_WIDTH, judgeFrame, resolveSharp, terminalCrop } from './legibility.mjs'
import { findClaude, prepareSandbox, removeSandbox, SANDBOX_ROOT, sandboxProblem } from './sandbox.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..')
const MANIFEST = path.join(HERE, 'shots.json')
const SCENES_DIR = path.join(HERE, 'scenes')
const require = createRequire(import.meta.url)

export const EXIT = { OK: 0, SCENE: 1, NOT_MACOS: 2, NO_LOGIN: 3, UNSAFE_SANDBOX: 4, PRIVACY: 5, BUDGET: 6, DRIFT: 7 }

/** A token file larger than this is not a token. */
const MAX_TOKEN_BYTES = 16 * 1024

const HELP = `Usage: npm run docs:screenshots [-- --only <id,...>] [-- --check] [-- --skip-build]

  --only <ids>   Capture only these rows; each id is a row id or a scene id
                 (e.g. --only readme-demo). The report says "partial run".
  --check        No capture: manifest rows, files, the design's list and the
                 guide's image links agree, and the size budget holds.
  --skip-build   Use the existing out/ build (only when it is from this checkout).

Agent login: ERFANA_CAPTURE_CLAUDE_TOKEN_FILE (a file holding a token from
\`claude setup-token\`) or ANTHROPIC_API_KEY. Runbook: scripts/capture/README.md`

export function parseArgs(argv) {
  const opts = { only: undefined, check: false, skipBuild: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') opts.check = true
    else if (a === '--skip-build') opts.skipBuild = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--only') {
      if (i + 1 >= argv.length) throw new CaptureError('--only needs a value')
      opts.only = argv[++i]
    } else if (a.startsWith('--only=')) opts.only = a.slice('--only='.length)
    else throw new CaptureError(`unknown argument: ${a}`)
  }
  if (opts.check && opts.only !== undefined) throw new CaptureError('--check and --only cannot be combined')
  return opts
}

/** `--check`: the drift and budget report, and its exit code. */
export function runCheck({ root = REPO_ROOT, rows, log = console.log, listFiles } = {}) {
  const { drift, budget, notes } = checkDrift({ root, rows, ...(listFiles ? { listFiles } : {}) })
  for (const n of notes) log(`note: ${n}`)
  for (const d of drift) log(`drift: ${d}`)
  for (const b of budget.problems) log(`over budget: ${b}`)
  log(`guide images: ${formatKB(budget.guideTotal)} of ${GUIDE_IMAGES_DIR} (limit 12288 KB); all rows: ${formatKB(budget.total)}`)
  if (drift.length) return EXIT.DRIFT
  if (budget.problems.length) return EXIT.BUDGET
  log(`check ok: ${rows.length} rows agree`)
  return EXIT.OK
}

/**
 * The agent login inputs. Returns the secret values for the deny-list; they
 * are held in memory only and never printed or written.
 */
/**
 * A login input that is set but unusable always stops the run (exit 3), even
 * when another input works and even when no selected row needs the agent: a
 * broken input must never quietly leave a secret off the deny-list.
 * `required: false` (no agent row selected) only allows "nothing set at all".
 */
export function readLogin(env = process.env, fsApi = fs, { required = true } = {}) {
  const secrets = []
  if (env.ANTHROPIC_API_KEY) secrets.push(env.ANTHROPIC_API_KEY)
  const file = env.ERFANA_CAPTURE_CLAUDE_TOKEN_FILE
  if (file) {
    let st
    try {
      st = fsApi.statSync(file)
    } catch {
      throw new CaptureError('ERFANA_CAPTURE_CLAUDE_TOKEN_FILE names a file that cannot be read. Screenshots were not changed.', EXIT.NO_LOGIN)
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_TOKEN_BYTES) {
      throw new CaptureError('ERFANA_CAPTURE_CLAUDE_TOKEN_FILE must name a non-empty token file. Screenshots were not changed.', EXIT.NO_LOGIN)
    }
    const token = fsApi.readFileSync(file, 'utf8').trim()
    if (!token) throw new CaptureError('ERFANA_CAPTURE_CLAUDE_TOKEN_FILE is empty. Screenshots were not changed.', EXIT.NO_LOGIN)
    secrets.push(token)
  }
  if (secrets.length === 0 && required) {
    throw new CaptureError(
      'No Claude Code login for the capture sandbox: set ANTHROPIC_API_KEY or ERFANA_CAPTURE_CLAUDE_TOKEN_FILE. Screenshots were not changed.',
      EXIT.NO_LOGIN
    )
  }
  return secrets
}

function spawnInherit(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve(signal ? 1 : code))
  })
}

/**
 * The real path a row's file is written to, checked again at write time:
 * inside the repository and inside an allow-listed folder, and not a symlink.
 */
export function safeTarget(root, file) {
  const rootReal = fs.realpathSync(root)
  const abs = path.join(rootReal, ...file.split('/'))
  const dir = path.dirname(abs)
  fs.mkdirSync(dir, { recursive: true })
  const dirReal = fs.realpathSync(dir)
  const allowed = OUTPUT_ALLOW_LIST.map((d) => path.join(rootReal, ...d.split('/').filter(Boolean)))
  if (!allowed.some((a) => dirReal === a || dirReal.startsWith(a + path.sep))) {
    throw new CaptureError(`refusing to write ${file}: its folder resolves outside the output allow-list`)
  }
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) throw new CaptureError(`refusing to write ${file}: it is a symlink`)
  } catch (e) {
    if (e instanceof CaptureError) throw e
  }
  return path.join(dirReal, path.basename(abs))
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

const stemOf = (id) => id.replace(/\//g, '__')

async function claudeVersion(claudeBin, sb) {
  if (!claudeBin) return 'not used'
  try {
    return execFileSync(claudeBin, ['--version'], { encoding: 'utf8', env: { HOME: sb.home, PATH: '/usr/bin:/bin' }, timeout: 30_000 }).trim()
  } catch {
    return 'unknown'
  }
}

async function main(argv) {
  const opts = parseArgs(argv)
  if (opts.help) {
    console.log(HELP)
    return EXIT.OK
  }
  const rows = loadManifest(MANIFEST)
  if (opts.check) return runCheck({ rows })

  // 1. Preflight
  if (process.platform !== 'darwin') throw new CaptureError('docs:screenshots runs on macOS only.', EXIT.NOT_MACOS)
  const { rows: selected, partial } = resolveOnly(rows, opts.only)
  const needsAgent = selected.some((r) => r.agent)
  const secrets = readLogin(process.env, fs, { required: needsAgent })
  const claudeBin = findClaude()
  if (needsAgent && !claudeBin) throw new CaptureError('`claude` (Claude Code) was not found; install it or set ERFANA_CAPTURE_CLAUDE_BIN.', EXIT.NO_LOGIN)
  resolveTesseract(REPO_ROOT)
  resolveSharp(REPO_ROOT)
  require('ffmpeg-static')
  const scenes = [...new Set(selected.map((r) => r.scene))]
  for (const s of scenes) {
    if (!fs.existsSync(path.join(SCENES_DIR, `${s}.capture.ts`))) throw new CaptureError(`scene file missing: scenes/${s}.capture.ts`)
  }
  const unsafe = sandboxProblem(SANDBOX_ROOT)
  if (unsafe) throw new CaptureError(`${unsafe}; remove it and retry.`, EXIT.UNSAFE_SANDBOX)
  const denyList = buildDenyList({ secrets, paths: [SANDBOX_ROOT] })

  // 2. Build
  if (!opts.skipBuild) {
    console.log('capture: building the app (electron-vite build)')
    const code = await spawnInherit(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'], process.env)
    if (code !== 0) throw new CaptureError('the build failed', EXIT.SCENE)
  }

  // 3. Sandbox
  let sb
  try {
    sb = prepareSandbox({ claudeBin })
  } catch (e) {
    if (e.code === 'UNSAFE_SANDBOX') throw new CaptureError(e.message, EXIT.UNSAFE_SANDBOX)
    throw e
  }
  console.log(`capture: sandbox ready at ${sb.root}; ${selected.length} row(s) in ${scenes.length} scene(s)${partial ? ' (partial run)' : ''}`)

  // 4. Scenes
  const env = { ...process.env, ERFANA_CAPTURE_SANDBOX: sb.root, ERFANA_CAPTURE_LAYOUT: JSON.stringify(sb), ERFANA_CAPTURE_ROWS: selected.map((r) => r.id).join(',') }
  delete env.CLAUDE_CONFIG_DIR
  const sceneFiles = scenes.map((s) => path.relative(REPO_ROOT, path.join(SCENES_DIR, `${s}.capture.ts`)))
  const code = await spawnInherit(
    process.execPath,
    [path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', path.relative(REPO_ROOT, path.join(HERE, 'playwright.capture.config.ts')), ...sceneFiles],
    env
  )
  if (code !== 0) throw new CaptureError(`a scene failed (Playwright exit ${code}); raw shots stay in ${sb.root}`, EXIT.SCENE)

  // 5. Post-process
  const encodedDir = path.join(sb.root, 'encoded')
  fs.mkdirSync(encodedDir, { recursive: true })
  const ocr = await createOcr(REPO_ROOT)
  const out = new Map() // row id → encoded file
  const masked = new Map() // row id → number of masks (design § Privacy, layer 4)
  const privacy = [] // { id, layer, kinds }
  const report = { demo: null }
  try {
    for (const row of selected.filter((r) => r.kind === 'still')) {
      const meta = JSON.parse(readText(path.join(sb.raw, `${stemOf(row.id)}.json`)) ?? 'null')
      if (!meta) throw new CaptureError(`${row.id}: the scene wrote no shot`, EXIT.SCENE)
      checkTexts(row.id, sb, denyList, privacy)
      if (meta.masks) masked.set(row.id, meta.masks)
      const target = path.join(encodedDir, `${stemOf(row.id)}.png`)
      await runFfmpeg(stillArgs({ input: meta.png, overlay: meta.overlay, crop: meta.crop, scaleWidth: meta.scaleWidth, output: target }))
      // OCR the final image, and the full-resolution window it came from:
      // small text (a file name in the tree) that the scaled, quantised image
      // loses is still read at 2× (observed with a planted address).
      for (const [layer, file] of [
        ['image OCR', target],
        ['full-resolution OCR', meta.png]
      ]) {
        const kinds = scanText((await ocr.read(file)).text, denyList)
        if (kinds.length) privacy.push({ id: row.id, layer, kinds })
      }
      out.set(row.id, target)
    }
    const loops = selected.filter((r) => r.kind === 'loop')
    if (loops.length) report.demo = await processDemo(loops, sb, encodedDir, ocr, denyList, privacy, out)
  } finally {
    await ocr.close()
  }

  if (privacy.length) {
    for (const p of privacy) console.error(`${p.id} refused: deny-list match in ${p.layer} (kind: ${p.kinds.join(', ')}). Nothing copied.`)
    throw new CaptureError(`privacy pass failed for ${new Set(privacy.map((p) => p.id)).size} row(s); nothing copied, the sandbox stays at ${sb.root}`, EXIT.PRIVACY)
  }
  const sizes = new Map([...out].map(([id, f]) => [id, fs.statSync(f).size]))
  // The 12 MB total covers every guide image, so a partial run adds the
  // committed sizes of the guide rows it did not capture.
  let committedGuideBytes = 0
  for (const r of rows) {
    if (sizes.has(r.id) || !r.file.startsWith(GUIDE_IMAGES_DIR)) continue
    try {
      committedGuideBytes += fs.statSync(path.join(REPO_ROOT, r.file)).size
    } catch {
      /* not captured yet */
    }
  }
  const budget = checkBudget(selected, sizes, { extraGuideBytes: committedGuideBytes })
  if (budget.problems.length) {
    for (const p of budget.problems) console.error(`over budget: ${p}`)
    throw new CaptureError('over budget; nothing copied', EXIT.BUDGET)
  }

  // 6. Copy: every file to a temp name next to its target, then rename.
  const staged = []
  for (const row of selected) {
    const target = safeTarget(REPO_ROOT, row.file)
    const tmp = `${target}.tmp-${process.pid}`
    fs.copyFileSync(out.get(row.id), tmp)
    staged.push([tmp, target])
  }
  for (const [tmp, target] of staged) fs.renameSync(tmp, target)

  // 7. Report
  const version = await claudeVersion(claudeBin, sb)
  const lines = reportLines({ rows: selected, sizes, partial, version, demo: report.demo, guideTotal: budget.guideTotal, masked })
  console.log(lines.join('\n'))
  keepEvidence(sb, lines)
  removeSandbox(sb.root)
  return EXIT.OK
}

/** Deny-list over the scene's DOM text and PTY stream for one row. */
function checkTexts(id, sb, denyList, privacy, stem = stemOf(id)) {
  const dom = readText(path.join(sb.raw, `${stem}.dom.txt`))
  const pty = readText(path.join(sb.raw, `${stem}.pty.txt`))
  if (dom === null) throw new CaptureError(`${id}: the scene wrote no DOM text`, EXIT.SCENE)
  const domKinds = scanText(dom, denyList)
  if (domKinds.length) privacy.push({ id, layer: 'DOM text', kinds: domKinds })
  const ptyKinds = scanText(stripAnsi(pty ?? ''), denyList)
  if (ptyKinds.length) privacy.push({ id, layer: 'PTY stream', kinds: ptyKinds })
}

/**
 * The README demo: sync, edit, encode, legibility, privacy over frames,
 * contact sheet (design § Loop for #139).
 */
async function processDemo(loops, sb, encodedDir, ocr, denyList, privacy, out) {
  const sharp = resolveSharp(REPO_ROOT)
  const demo = JSON.parse(readText(path.join(sb.raw, 'readme-demo.json')) ?? 'null')
  if (!demo) throw new CaptureError('readme-demo: the scene wrote no recording', EXIT.SCENE)
  const syncVideo = findSyncTime(await runFfmpeg(syncScanArgs(demo.video), { stdout: true }))
  if (syncVideo === null) throw new CaptureError('readme-demo: the sync flash was not found in the recording', EXIT.SCENE)
  const marks = Object.fromEntries(Object.entries(demo.marks).map(([k, wall]) => [k, (wall - demo.syncWall) / 1000 + syncVideo]))
  const plan = planDemoEdit(marks)
  if (plan.duration < 10 || plan.duration > 20) {
    throw new CaptureError(`readme-demo: the edit is ${plan.duration.toFixed(1)} s, outside 10–20 s`, EXIT.SCENE)
  }
  const source = path.join(encodedDir, 'demo-source.mkv')
  await runFfmpeg(demoSourceArgs({ input: demo.video, segments: plan.segments, output: source }))

  const legDir = path.join(sb.raw, 'legibility')
  fs.mkdirSync(legDir, { recursive: true })
  const legibility = []
  const files = []
  for (const row of loops) {
    const ext = path.extname(row.file).slice(1)
    const file = path.join(encodedDir, `demo.${ext}`)
    await runFfmpeg(loopArgs(ext, source, file))
    out.set(row.id, file)
    files.push({ row, ext, file })
  }
  // Legibility: the hand-off frame and the end of the agent's work, from each file.
  for (const { ext, file } of files) {
    for (const [name, t, known] of [
      ['hand-off', plan.times.handOff, demo.knownLine],
      ['agent-end', plan.times.agentEnd, null]
    ]) {
      const frame = await frameAt(sharp, ext, file, t)
      const { display, upscaled } = await terminalCrop(sharp, frame, demo.terminalRect, 1280)
      fs.writeFileSync(path.join(legDir, `${ext}-${name}-800.png`), display)
      fs.writeFileSync(path.join(legDir, `${ext}-${name}-terminal-ocr.png`), upscaled)
      const verdict = judgeFrame(await ocr.read(upscaled), known)
      legibility.push({ file: `demo.${ext}`, frame: name, ...verdict })
    }
  }
  fs.writeFileSync(path.join(legDir, 'result.json'), `${JSON.stringify({ zoom: demo.zoom, displayWidth: DISPLAY_WIDTH, legibility }, null, 2)}\n`)
  const illegible = legibility.filter((l) => !l.ok)
  if (illegible.length) {
    for (const l of illegible) console.error(`legibility: ${l.file} ${l.frame}: ${l.reasons.join('; ')}`)
    throw new CaptureError(`demo not legible at ${DISPLAY_WIDTH} px; frames kept in ${legDir}`, EXIT.SCENE)
  }

  // Privacy over the frames: at least one per second, plus the first and last.
  const framesDir = path.join(sb.raw, 'demo-frames')
  fs.mkdirSync(framesDir, { recursive: true })
  let framesRead = 0
  for (const { row, ext, file } of files) {
    const frames = await extractSampledFrames(sharp, ext, file, framesDir, plan.duration)
    for (const f of frames) {
      const kinds = scanText((await ocr.read(f)).text, denyList)
      framesRead++
      if (kinds.length) privacy.push({ id: row.id, layer: `frame ${path.basename(f)}`, kinds })
    }
  }
  // The DOM text at the end and the whole PTY stream of the recording.
  for (const { row } of files) checkTexts(row.id, sb, denyList, privacy, 'readme-demo')
  const sheet = path.join(sb.raw, 'demo-contact-sheet.png')
  await runFfmpeg(contactSheetArgs(files.find((f) => f.ext === 'mp4')?.file ?? source, sheet))
  return { duration: plan.duration, zoom: demo.zoom, legibility, framesRead, contactSheet: sheet, syncVideo }
}

async function frameAt(sharp, ext, file, t) {
  if (ext === 'webp') {
    const { delay } = await sharp(file, { animated: true }).metadata()
    return sharp(file, { page: webpPageAt(delay, t) }).png().toBuffer()
  }
  const tmp = path.join(path.dirname(file), `frame-${ext}-${Math.round(t * 1000)}.png`)
  await runFfmpeg(frameAtArgs(file, t, tmp))
  return fs.readFileSync(tmp)
}

async function extractSampledFrames(sharp, ext, file, dir, duration) {
  const files = []
  if (ext === 'webp') {
    const { delay } = await sharp(file, { animated: true }).metadata()
    for (const i of webpSamplePages(delay)) {
      const f = path.join(dir, `webp-${String(i).padStart(4, '0')}.png`)
      await sharp(file, { page: i }).png().toFile(f)
      files.push(f)
    }
    return files
  }
  // GIF and MP4: the frame on screen at every whole second, plus the last.
  // All three files are encoded from the one edited source, so they share
  // its duration. (The bundled ffprobe-static is not an arm64 binary.)
  for (const t of sampleTimes(duration)) {
    const f = path.join(dir, `${ext}-${String(Math.round(t * 1000)).padStart(6, '0')}.png`)
    await runFfmpeg(frameAtArgs(file, t, f))
    if (!fs.existsSync(f)) throw new CaptureError(`readme-demo: could not read the frame at ${t} s of demo.${ext}`, EXIT.SCENE)
    files.push(f)
  }
  return files
}

/**
 * ERFANA_CAPTURE_EVIDENCE_DIR: keep the report, the demo's legibility frames
 * and its contact sheet there, for the PR and #139's frame-by-frame review.
 * The sandbox itself is removed after a successful run.
 */
function keepEvidence(sb, lines) {
  const dir = process.env.ERFANA_CAPTURE_EVIDENCE_DIR
  if (!dir) return
  const out = path.join(path.resolve(dir), `capture-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'report.txt'), `${lines.join('\n')}\n`)
  const sheet = path.join(sb.raw, 'demo-contact-sheet.png')
  if (fs.existsSync(sheet)) fs.copyFileSync(sheet, path.join(out, 'demo-contact-sheet.png'))
  const leg = path.join(sb.raw, 'legibility')
  if (fs.existsSync(leg)) fs.cpSync(leg, path.join(out, 'legibility'), { recursive: true })
  console.log(`evidence kept in ${out}`)
}

export function reportLines({ rows, sizes, partial, version, demo, guideTotal, masked = new Map() }) {
  const out = [`capture report${partial ? ' (partial run)' : ''}`]
  out.push(`Claude Code: ${version}`)
  out.push('Chromium switches: --force-device-scale-factor=2 --force-color-profile=srgb --force-prefers-reduced-motion')
  let total = 0
  for (const r of rows) {
    const b = sizes.get(r.id)
    total += b
    const m = masked.get(r.id)
    out.push(`  ${formatKB(b).padStart(8)}  ${r.file}${r.agent ? '  (agent)' : ''}${m ? `  (${m} mask${m > 1 ? 's' : ''})` : ''}`)
  }
  const guide = rows.filter((r) => r.file.startsWith(GUIDE_IMAGES_DIR)).length
  out.push(`${guide} guide image(s), ${rows.length - guide} README demo file(s); this run ${formatKB(total)}; all guide images ${formatKB(guideTotal)} of 12288 KB`)
  if (demo) {
    out.push(`demo: ${demo.duration.toFixed(1)} s, zoom ${demo.zoom}, ${demo.framesRead} frames read by the privacy pass`)
    for (const l of demo.legibility) {
      out.push(`  legibility ${l.file} ${l.frame} at ${DISPLAY_WIDTH} px: capital height ${l.capPx} px (${l.samples} words)${l.readBack === null ? '' : `, known line read back: ${l.readBack}`}`)
    }
  }
  return out
}

const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (e) => {
      if (e instanceof CaptureError) {
        console.error(`docs:screenshots: ${e.message}`)
        process.exitCode = e.exitCode
      } else {
        console.error(e)
        process.exitCode = 1
      }
    }
  )
}

