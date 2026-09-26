#!/usr/bin/env node
// Safe app start for the qa and design-review workflows (#177, PR #202 S-2).
//
//   node .xezar/checks/review-run-app.mjs <pr-number> <head-sha>
//
// A reviewing session may start the app of the pull request it reviews, but
// only this way, and only in a private folder of its own:
//
//   1. macOS only: the confinement is sandbox-exec; any other host is refused.
//   2. Never in the primary checkout: the git dir must differ from the common
//      git dir, and the top level must be a task worktree under
//      <repo>/.local/xezar/worktrees/<run>.
//   3. `gh` must report the PR head as exactly <head-sha>.
//   4. Every start gets a fresh, unpredictable 0700 parent from mkdtemp under
//      /private/tmp (not under the task worktree: that lies inside the primary
//      checkout, which the sandbox denies whole, and build tools stat every
//      parent folder). It holds two siblings: control/, where the wrapper
//      writes the sandbox profile (O_EXCL | O_NOFOLLOW) before any child
//      exists and which no child can read or write, and work/, the only folder
//      a child may write. The exact commit is extracted with `git archive` (no
//      .git) into work/app on every start – no cache, no marker. The session's
//      own checkout is never moved, so this file keeps resolving to the copy
//      the kit snapshot took from the primary checkout, not the PR's version.
//   5. The extraction, `npm ci` and `npm run dev` run under that profile: no
//      write outside work/, no read of the owner home (except the Node.js
//      install), the credential paths, the Erfana app data or the primary
//      checkout; an allowlisted environment with HOME, TMPDIR and Electron's
//      user data inside work/.
//   6. Every descendant is tracked while it runs and swept by folder at the
//      end; on stop all are killed, checked gone, and the parent is removed.
//      After a child has run, the wrapper never writes or trusts anything in
//      work/.
//
// Network stays open – `npm ci` needs it – so the confined code can still send
// anything it can read to the internet. It cannot read the denied paths.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const USAGE = 'usage: node .xezar/checks/review-run-app.mjs <pr-number> <40-hex head sha>'
const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

// The only variables the confined processes inherit. Everything else – GH_TOKEN,
// GITHUB_TOKEN, CLAUDE*, ANTHROPIC*, OPENAI*, CODEX*, npm auth, SSH agents – is dropped.
const KEPT_ENV = ['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME', 'SHELL']
export const SCRUBBED_PATTERNS = [/^GH_/, /^GITHUB_/, /^CLAUDE/, /^ANTHROPIC/, /^OPENAI/, /^CODEX/, /TOKEN/, /SECRET/, /^SSH_/, /^NPM_CONFIG_/i]

// Owner paths no confined process may read, relative to the owner's home.
// `.claude` and `.codex` are prefixes, so `.claude.json` and every
// `.claude.<profile>` directory are covered too.
export const DENIED_HOME_PREFIXES = ['.claude', '.codex']
export const DENIED_HOME_PATHS = [
  '.ssh',
  '.config/gh',
  'Library/Keychains',
  '.npmrc',
  '.gitconfig',
  '.git-credentials',
  '.netrc',
  '.aws',
  '.docker/config.json',
  // The owner's own Erfana settings and caches; the confined app gets its own user-data folder.
  'Library/Application Support/erfana'
]

export class Refusal extends Error {}

function sbString(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /["\\\n\r\0]/.test(value)) {
    throw new Refusal(`unsafe path for the sandbox profile: ${JSON.stringify(value)}`)
  }
  return `"${value}"`
}

function sbPrefixRegex(prefix) {
  sbString(prefix)
  return `#"^${prefix.replace(/[.*+?^${}()|[\]]/g, (c) => `\\${c}`)}"`
}

// root and every folder below it on the way to target (target excluded).
function foldersBetween(root, target) {
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return []
  const parts = rel.split(path.sep)
  return parts.map((_, i) => path.join(root, ...parts.slice(0, i)))
}

// The sandbox profile. Later rules win in SBPL: the control-folder and
// credential denies come last so nothing above can re-open them.
export function buildProfile({ workDir, controlDir, ownerHome, primaryRoot, nodePrefix }) {
  if (path.dirname(workDir) !== path.dirname(controlDir) || workDir === controlDir) {
    throw new Refusal('the work and control folders must be siblings under one parent.')
  }
  const intoPrimary = path.relative(primaryRoot, path.dirname(workDir))
  if (!intoPrimary.startsWith('..') && !path.isAbsolute(intoPrimary)) {
    throw new Refusal('the private folder must not be inside the primary checkout.')
  }
  const denyHome = [
    ...DENIED_HOME_PREFIXES.map((p) => `(regex ${sbPrefixRegex(path.join(ownerHome, p))})`),
    ...DENIED_HOME_PATHS.map((p) => `(subpath ${sbString(path.join(ownerHome, p))})`)
  ]
  return [
    '(version 1)',
    '(allow default)',
    ';; Writes: only the work folder (app, HOME, temp, Electron user data) and tty/null devices.',
    '(deny file-write*)',
    `(allow file-write* (subpath ${sbString(workDir)})`,
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty") (regex #"^/dev/fd/"))',
    ';; Reads: nothing of the owner home except the Node.js install that runs npm (and the',
    ';; metadata of the folders above it, which realpath stats), so no dotfile, browser profile',
    ';; or document there is readable. Then nothing of the primary checkout, wherever it is.',
    `(deny file-read* (subpath ${sbString(ownerHome)}))`,
    ...(nodePrefix && foldersBetween(ownerHome, nodePrefix).length
      ? [
          `(allow file-read* (subpath ${sbString(nodePrefix)}))`,
          ...foldersBetween(ownerHome, nodePrefix).map((dir) => `(allow file-read-metadata (literal ${sbString(dir)}))`)
        ]
      : []),
    `(deny file-read* (subpath ${sbString(primaryRoot)}))`,
    ';; The control folder (this profile) is neither writable nor readable from inside.',
    `(deny file-read* file-write* (subpath ${sbString(controlDir)}))`,
    ';; Reads: never the owner credential paths.',
    `(deny file-read* file-write*\n  ${denyHome.join('\n  ')})`,
    ''
  ].join('\n')
}

// PATH is not inherited: its home entries are unreadable in the sandbox and
// would fail the lookup. Node's own bin folder first, then system folders.
export const SYSTEM_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

export function buildEnv(parentEnv, { home, tmpDir, nodePrefix }) {
  const env = {}
  for (const key of KEPT_ENV) {
    if (typeof parentEnv[key] === 'string' && !SCRUBBED_PATTERNS.some((re) => re.test(key))) env[key] = parentEnv[key]
  }
  env.PATH = [...(nodePrefix ? [path.join(nodePrefix, 'bin')] : []), ...SYSTEM_PATH].join(':')
  env.HOME = home
  env.TMPDIR = `${tmpDir}/`
  return env
}

function realpath(p) {
  return fs.realpathSync(p)
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

// Refuses the primary checkout and anything that is not a task worktree.
export function resolveTaskWorktree(cwd) {
  let top, gitDir, common
  try {
    top = realpath(git(cwd, ['rev-parse', '--show-toplevel']))
    gitDir = realpath(git(cwd, ['rev-parse', '--absolute-git-dir']))
    common = realpath(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  } catch {
    throw new Refusal('not inside a git checkout.')
  }
  const primaryRoot = path.dirname(common)
  if (gitDir === common || top === primaryRoot) {
    throw new Refusal(`refusing to run in the primary checkout (${primaryRoot}); start the app only from a task worktree.`)
  }
  if (path.dirname(top) !== path.join(primaryRoot, '.local', 'xezar', 'worktrees')) {
    throw new Refusal(`${top} is not a task worktree under ${path.join(primaryRoot, '.local/xezar/worktrees')}.`)
  }
  return { top, primaryRoot }
}

export function parseArgs(argv) {
  const [pr, sha, ...rest] = argv
  if (rest.length || !/^[1-9][0-9]{0,6}$/.test(pr ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Refusal(USAGE)
  return { pr, sha }
}

export function verifyHead(pr, sha, ghHead) {
  const actual = String(ghHead ?? '').trim()
  if (actual !== sha) {
    throw new Refusal(`PR #${pr} head is ${actual || 'unknown'}, not ${sha}; review the head you were given, re-read it first.`)
  }
}

function ghPrHead(pr, cwd) {
  try {
    return execFileSync('gh', ['pr', 'view', pr, '--json', 'headRefOid', '-q', '.headRefOid'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    throw new Refusal(`could not read PR #${pr} with gh.`)
  }
}

// The install folder of the node running this wrapper (bin/node's grandparent),
// the one part of the owner home the confined npm must read.
export function nodeInstallPrefix(execPath = process.execPath) {
  return path.dirname(path.dirname(realpath(execPath)))
}

// Writes a new file and refuses to follow or reuse anything already at the
// path: O_EXCL fails on an existing entry, O_NOFOLLOW on a symlink.
export function writeNewFile(file, text) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400)
  try {
    fs.writeSync(fd, text)
  } finally {
    fs.closeSync(fd)
  }
}

// One start: a fresh, unpredictable 0700 parent from mkdtemp, holding two
// siblings. control/ is written by the wrapper only, and only here, before any
// child exists: the profile. work/ is the only folder a child may write; after
// a child has run the wrapper never writes, trusts or follows anything in it –
// it only removes the whole parent when every process is gone.
export function createSession({ base = realpath('/tmp'), ownerHome, primaryRoot, nodePrefix }) {
  const parent = realpath(fs.mkdtempSync(path.join(base, 'xezar-review-app-')))
  const controlDir = path.join(parent, 'control')
  const workDir = path.join(parent, 'work')
  fs.mkdirSync(controlDir, { mode: 0o700 })
  fs.mkdirSync(workDir, { mode: 0o700 })
  const session = {
    parent,
    controlDir,
    workDir,
    appDir: path.join(workDir, 'app'),
    home: path.join(workDir, 'home'),
    tmpDir: path.join(workDir, 'tmp'),
    userDataDir: path.join(workDir, 'electron-user-data'),
    profile: path.join(controlDir, 'review-run-app.sb'),
    nodePrefix,
    known: new Set()
  }
  for (const dir of [session.appDir, session.home, session.tmpDir]) fs.mkdirSync(dir, { mode: 0o700 })
  writeNewFile(session.profile, buildProfile({ workDir, controlDir, ownerHome, primaryRoot, nodePrefix }))
  return session
}

function confinedCommand(argv, session, parentEnv) {
  return {
    file: SANDBOX_EXEC,
    args: ['-f', session.profile, ...argv],
    env: buildEnv(parentEnv, { home: session.home, tmpDir: session.tmpDir, nodePrefix: session.nodePrefix })
  }
}

// Runs argv confined and returns its output. Exported so the tests can prove
// what the confinement stops.
export function runConfined(argv, session, { parentEnv = process.env, input } = {}) {
  const { file, args, env } = confinedCommand(argv, session, parentEnv)
  return spawnSync(file, args, { cwd: session.appDir, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

// --- Containing every descendant -------------------------------------------------------
// A child may leave its process group (setsid) or be re-parented to launchd
// when its parent exits. Two nets catch it: every process seen descending from
// a confined child while it runs is remembered (polled every 250 ms), and a
// final sweep finds any process of this user whose working directory or
// executable is inside this start's parent folder. What escapes both – a
// process that forks away, changes directory out of the folder and runs a
// system binary, all within one poll interval – is still inside the sandbox:
// it cannot write outside work/ (removed on stop) or read the denied paths,
// but it can keep the network.

function processTable() {
  const out = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout ?? ''
  return out
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid))
}

export function trackDescendants(session, rootPid) {
  session.known.add(rootPid)
  const table = processTable()
  let grew = true
  while (grew) {
    grew = false
    for (const [pid, ppid] of table) {
      if (session.known.has(ppid) && !session.known.has(pid)) {
        session.known.add(pid)
        grew = true
      }
    }
  }
}

// Processes of this user whose cwd or executable lies inside the parent folder.
export function sweepFolder(session) {
  const out = spawnSync('/usr/sbin/lsof', ['-w', '-n', '-u', String(process.getuid()), '-a', '-d', 'cwd,txt', '-F', 'pn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? ''
  const found = new Set()
  let pid = null
  const prefix = `${session.parent}${path.sep}`
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid && pid !== process.pid && (line.slice(1) + path.sep).startsWith(prefix)) found.add(pid)
  }
  return found
}

// Zombies – exited, not yet reaped (the wrapper's own direct child is one until
// the event loop runs again) – are dead: they run nothing and hold no files.
function zombies() {
  const out = spawnSync('/bin/ps', ['-axo', 'pid=,stat='], { encoding: 'utf8' }).stdout ?? ''
  const found = new Set()
  for (const line of out.trim().split('\n')) {
    const [pid, stat] = line.trim().split(/\s+/)
    if (stat?.startsWith('Z')) found.add(Number(pid))
  }
  return found
}

function alive(pid, dead = new Set()) {
  if (dead.has(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function signalAll(pids, signal) {
  for (const pid of pids) {
    if (pid === process.pid) continue
    try {
      process.kill(pid, signal)
    } catch {
      // Already gone.
    }
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Stops every process this start produced and returns the ones still alive
// (an empty array means contained). Synchronous, so it also runs on exit.
export function stopAll(session, { graceMs = 2000 } = {}) {
  for (const pid of [...session.known]) if (alive(pid)) trackDescendants(session, pid)
  const targets = () => {
    const dead = zombies()
    return new Set([...session.known, ...sweepFolder(session)].filter((pid) => pid !== process.pid && alive(pid, dead)))
  }
  signalAll(targets(), 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (targets().size && Date.now() < deadline) pause(100)
  for (let round = 0; round < 5 && targets().size; round++) {
    signalAll(targets(), 'SIGKILL')
    pause(200)
  }
  return [...targets()]
}

// Stops everything, then removes the whole parent. The parent is left in place
// (and reported) only when a process survived, since removing a folder under a
// live process is a race the process could win.
export function endSession(session) {
  const survivors = stopAll(session)
  if (survivors.length === 0) fs.rmSync(session.parent, { recursive: true, force: true })
  return survivors
}

// Streams one confined step, tracking its descendants while it runs and
// stopping any left behind when it ends. Output always goes through pipes: a
// confined process that inherits a descriptor to a file it may not read (the
// wrapper's own log inside the primary checkout) aborts at start-up.
function streamConfined(argv, session, parentEnv, input) {
  const { file, args, env } = confinedCommand(argv, session, parentEnv)
  return new Promise((resolveExit) => {
    const child = spawn(file, args, { cwd: session.appDir, env, detached: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    session.known.add(child.pid)
    const poll = setInterval(() => trackDescendants(session, child.pid), 250)
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    if (input) child.stdin.end(input)
    child.on('error', (error) => {
      clearInterval(poll)
      resolveExit({ error })
    })
    child.on('close', (status, signal) => {
      clearInterval(poll)
      const survivors = stopAll(session)
      resolveExit({ status, signal, survivors })
    })
  })
}

function must(result, what) {
  if (result.error) throw new Refusal(`${what} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Refusal(`${what} failed with exit ${result.status ?? result.signal}.`)
}

// Signals stop everything and remove the parent; returns the uninstaller.
function installStopHandlers(session) {
  const handlers = []
  for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    const handler = () => {
      finishSession(session)
      process.exit(code)
    }
    process.on(name, handler)
    handlers.push([name, handler])
  }
  const onExit = () => finishSession(session)
  process.on('exit', onExit)
  handlers.push(['exit', onExit])
  return () => {
    for (const [name, handler] of handlers) process.off(name, handler)
  }
}

function finishSession(session) {
  if (session.ended) return
  session.ended = true
  const survivors = endSession(session)
  if (survivors.length) {
    process.stderr.write(`review-run-app: ${survivors.length} process(es) survived the stop: ${survivors.join(', ')}; ${session.parent} kept.\n`)
  }
}

export async function main(argv, { platform = process.platform, cwd = process.cwd(), env = process.env, ghHead = ghPrHead, onSession } = {}) {
  if (platform !== 'darwin') {
    throw new Refusal(`the safe app start needs macOS sandbox-exec; this host is ${platform}, so the PR's app is not started here.`)
  }
  const { pr, sha } = parseArgs(argv)
  const { top, primaryRoot } = resolveTaskWorktree(cwd)
  verifyHead(pr, sha, ghHead(pr, top))
  if (!fs.existsSync(SANDBOX_EXEC)) throw new Refusal(`${SANDBOX_EXEC} is missing, so the app cannot be confined.`)

  try {
    git(top, ['fetch', '--quiet', '--no-tags', 'origin', `refs/pull/${pr}/head`])
    git(top, ['cat-file', '-e', `${sha}^{commit}`])
  } catch {
    throw new Refusal(`could not fetch commit ${sha} of PR #${pr}.`)
  }

  const session = createSession({ ownerHome: realpath(os.homedir()), primaryRoot, nodePrefix: nodeInstallPrefix() })
  const uninstall = installStopHandlers(session)
  onSession?.(session)
  const confined = (args, input) => streamConfined(args, session, env, input)
  try {
    // Every start extracts the exact commit and installs afresh: nothing from an
    // earlier start is reused, so a PR cannot seed what the next start trusts.
    const archive = spawnSync('git', ['archive', '--format=tar', sha], { cwd: top, maxBuffer: 1024 * 1024 * 1024 })
    must(archive, 'git archive')
    // Extract confined too: a symlink in the PR tree cannot steer a write outside the work folder.
    must(await confined(['/usr/bin/tar', '-x', '-f', '-', '-C', session.appDir], archive.stdout), 'extracting the PR tree')
    must(await confined(['/usr/bin/env', 'npm', 'ci']), 'npm ci')
    process.stdout.write(`review-run-app: PR #${pr} at ${sha} in ${session.appDir}; starting the dev server (confined, network open)\n`)
    // macOS refuses a sandbox inside a sandbox, so Chromium's own (GPU, network,
    // renderer) cannot start here; the outer profile is the confinement instead.
    // Electron's own user data goes to the work folder, never the owner's.
    const dev = await confined(['/usr/bin/env', 'npm', 'run', 'dev', '--', '--noSandbox', '--', `--user-data-dir=${session.userDataDir}`])
    return dev.status ?? 1
  } finally {
    finishSession(session)
    uninstall()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`review-run-app refused: ${error instanceof Refusal ? error.message : 'unexpected error'}\n`)
      process.exitCode = 2
    }
  )
}
