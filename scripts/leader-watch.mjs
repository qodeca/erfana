// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Leader-silence alert (#179, spike docs/spikes/179-leader-liveness.md).
 *
 * Raises one local macOS notification when a xezar run has stopped and is
 * waiting, and the project leader has recorded nothing for more than
 * LEADER_WATCH_MINUTES (default 30). It only alerts: it never dispatches,
 * continues, answers, approves, merges, kills or edits anything. Its only
 * effects are the notification and one log line on stdout per alert
 * (launchd appends stdout to the log file named in the plist).
 *
 * The rule, as replayed in the spike: a run is waiting when its log in
 * `.local/xezar/runs/<runId>.ndjson` was last written more than the limit ago,
 * and after the leader's last sign of life. The leader's last sign of life is
 * the later of its last commit to `.xezar/campaigns` on `develop` (never
 * `--all`: author branches sometimes carry campaign files) and the newest
 * file in the live campaign folder (a tick written but not yet committed).
 *
 * Alerts repeat at most once per limit while the silence lasts. The previous
 * alert time is read back from the log file (LEADER_WATCH_LOG, read-only), so
 * the script keeps no state file of its own; without a log it alerts on every
 * poll that matches.
 *
 * What it reads, and the bound on each (the inputs are local files, but they
 * are written by agents, so they are read defensively):
 * - run logs: only their names and modification times, never their content;
 *   names must be `<uuid>.ndjson`, symlinks and non-files are skipped, and at
 *   most MAX_ENTRIES directory entries are considered.
 * - the campaign folder: one level of sub-folders, names and modification
 *   times only, symlinks skipped, at most MAX_ENTRIES entries per folder.
 * - git: one `git log -1 --format=%ct` with an argument array and a timeout;
 *   only the commit time is read – no author, e-mail or remote.
 * - the log file: at most LOG_TAIL_BYTES from its end, one anchored regex per
 *   line with no nested quantifier.
 *
 * Usage:
 *   LEADER_WATCH_REPO=/path/to/erfana node scripts/leader-watch.mjs [--dry-run]
 *
 * --dry-run prints the notification text instead of showing it. Install steps:
 * docs/runbooks/leader-watch.md.
 */
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LIMIT_MIN = 30
export const MAX_ENTRIES = 5000
export const LOG_TAIL_BYTES = 64 * 1024
export const BRANCH = 'develop'
export const CAMPAIGNS = '.xezar/campaigns'
export const RUNS = '.local/xezar/runs'
export const TITLE = 'Erfana leader silent'

const RUN_LOG = /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.ndjson$/
const ALERT_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z) alert /

/**
 * The run waiting longest: last written after `leaderAtMs` and at least
 * `limitMs` before `nowMs`. Returns `{ id, mtimeMs }` or null.
 */
export function findWaitingRun({ nowMs, leaderAtMs, runs, limitMs }) {
  let best = null
  for (const run of runs) {
    if (run.mtimeMs <= leaderAtMs || run.mtimeMs > nowMs - limitMs) continue
    if (!best || run.mtimeMs < best.mtimeMs) best = run
  }
  return best
}

/** One alert per limit while the silence lasts. */
export function shouldAlert({ nowMs, lastAlertMs, limitMs }) {
  return lastAlertMs === null || nowMs - lastAlertMs >= limitMs
}

/** The whole decision for one poll. Returns null (quiet) or the alert. */
export function evaluate({ nowMs, leaderAtMs, runs, limitMs, lastAlertMs = null }) {
  const run = findWaitingRun({ nowMs, leaderAtMs, runs, limitMs })
  if (!run || !shouldAlert({ nowMs, lastAlertMs, limitMs })) return null
  const silentMin = Math.floor((nowMs - leaderAtMs) / 60_000)
  const waitingMin = Math.floor((nowMs - run.mtimeMs) / 60_000)
  return {
    run: run.id,
    silentMin,
    message: `Run ${run.id} has waited ${waitingMin} min and the leader has recorded nothing for ${silentMin} min.`,
  }
}

export function formatLogLine(nowMs, alert) {
  return `${new Date(nowMs).toISOString()} alert run=${alert.run} leader-silent=${alert.silentMin}m`
}

/** The time of the last alert line in a log text, or null. */
export function lastAlertFrom(text) {
  let last = null
  for (const line of text.split('\n')) {
    const m = ALERT_LINE.exec(line)
    if (m) last = Date.parse(m[1])
  }
  return last
}

/** Run logs as `{ id, mtimeMs }`, id being the first eight hex digits. */
export function listRuns(runsDir, fs = { readdirSync, lstatSync }, paths = path) {
  let names
  try {
    names = fs.readdirSync(runsDir)
  } catch {
    return []
  }
  const runs = []
  for (const name of names.slice(0, MAX_ENTRIES)) {
    const m = RUN_LOG.exec(name)
    if (!m) continue
    const st = fs.lstatSync(paths.join(runsDir, name), { throwIfNoEntry: false })
    if (st?.isFile()) runs.push({ id: m[1], mtimeMs: st.mtimeMs })
  }
  return runs
}

/** Newest modification time of a file one level inside the campaign folder, or 0. */
export function newestCampaignFileMs(campaignsDir, fs = { readdirSync, lstatSync }, paths = path) {
  let newest = 0
  let folders
  try {
    folders = fs.readdirSync(campaignsDir)
  } catch {
    return 0
  }
  for (const folder of folders.slice(0, MAX_ENTRIES)) {
    const dir = paths.join(campaignsDir, folder)
    if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue
    let names
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names.slice(0, MAX_ENTRIES)) {
      const st = fs.lstatSync(paths.join(dir, name), { throwIfNoEntry: false })
      if (st?.isFile() && st.mtimeMs > newest) newest = st.mtimeMs
    }
  }
  return newest
}

/** The leader's last campaign commit on develop, in ms, or null when git cannot say. */
export function lastCampaignCommitMs(repo, exec = execFileSync) {
  try {
    const out = exec('git', ['-C', repo, 'log', '-1', '--format=%ct', BRANCH, '--', CAMPAIGNS], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 4096,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const s = Number.parseInt(String(out).trim(), 10)
    return Number.isFinite(s) && s > 0 ? s * 1000 : null
  } catch {
    return null
  }
}

/** The last LOG_TAIL_BYTES of a file as text, or '' when it cannot be read. */
export function readTail(file) {
  let fd
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, LOG_TAIL_BYTES)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Show the notification. Text travels as osascript arguments, never inside the script. */
export function notify(message, exec = execFileSync) {
  exec(
    'osascript',
    [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 1 of argv) with title (item 2 of argv) sound name "Submarine"',
      '-e',
      'end run',
      message,
      TITLE,
    ],
    { timeout: 10_000, stdio: 'ignore' },
  )
}

export function parseLimit(value) {
  if (value === undefined || value === '') return DEFAULT_LIMIT_MIN
  if (!/^\d{1,4}$/.test(value) || Number(value) < 1) return null
  return Number(value)
}

/**
 * One poll. Returns the exit code. `deps` exists for tests; the defaults are
 * the real clock, file system, path module, platform, git and osascript.
 * `paths` lets a test pin the separator (`path.posix` or `path.win32`), so the
 * same fake file system matches on every host.
 */
export function main(argv, env, deps = {}) {
  const {
    now = () => Date.now(),
    out = (s) => process.stdout.write(`${s}\n`),
    err = (s) => process.stderr.write(`${s}\n`),
    exec = execFileSync,
    fs = { readdirSync, lstatSync },
    paths = path,
    tail = readTail,
    platform = process.platform,
  } = deps
  const dryRun = argv.includes('--dry-run')
  const repo = env.LEADER_WATCH_REPO
  if (!repo || !paths.isAbsolute(repo)) {
    err('leader-watch: set LEADER_WATCH_REPO to the absolute path of the main checkout')
    return 2
  }
  const limitMin = parseLimit(env.LEADER_WATCH_MINUTES)
  if (limitMin === null) {
    err('leader-watch: LEADER_WATCH_MINUTES must be a whole number of minutes')
    return 2
  }
  if (!dryRun && platform !== 'darwin') {
    err('leader-watch: notifications need macOS; use --dry-run elsewhere')
    return 2
  }

  const commitMs = lastCampaignCommitMs(repo, exec)
  if (commitMs === null) {
    err(`leader-watch: no ${CAMPAIGNS} commit readable on ${BRANCH}; nothing checked`)
    return 1
  }
  const nowMs = now()
  let alert
  try {
    const leaderAtMs = Math.max(commitMs, newestCampaignFileMs(paths.join(repo, CAMPAIGNS), fs, paths))
    const lastAlertMs = env.LEADER_WATCH_LOG ? lastAlertFrom(tail(env.LEADER_WATCH_LOG)) : null
    alert = evaluate({
      nowMs,
      leaderAtMs,
      runs: listRuns(paths.join(repo, RUNS), fs, paths),
      limitMs: limitMin * 60_000,
      lastAlertMs,
    })
  } catch {
    // A file that is listed but cannot be read (EACCES) leaves the leader's
    // last sign of life unknown: never alert on a guess, and never print the
    // error, whose message and stack name local paths and so the login name.
    err('leader-watch: metadata unavailable; nothing checked')
    return 1
  }
  if (!alert) return 0

  if (dryRun) {
    out(`${formatLogLine(nowMs, alert)} (dry run) ${alert.message}`)
    return 0
  }
  try {
    notify(alert.message, exec)
  } catch {
    err('leader-watch: osascript failed; no notification shown')
    return 1
  }
  out(formatLogLine(nowMs, alert))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2), process.env)
  } catch {
    // Last resort, for the same reason: fixed text only, never the error.
    process.stderr.write('leader-watch: unexpected failure; nothing checked\n')
    process.exitCode = 1
  }
}
