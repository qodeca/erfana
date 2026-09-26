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
//   4. That commit is fetched by the task worktree and extracted with
//      `git archive` (no .git inside) into /private/tmp/xezar-review-app-<run>-
//      <sha>/app, a 0700 folder this user owns. Not under the task worktree:
//      that lies inside the primary checkout, which the sandbox denies whole,
//      and build tools (browserslist, babel) stat every parent folder. The
//      session's own checkout is never moved, so this file keeps resolving to
//      the copy the kit snapshot took from the primary checkout, not to the
//      PR's version.
//   5. `npm ci` and `npm run dev` run under a sandbox profile that lets them
//      write only that private folder, denies every read of the primary
//      checkout and of the owner's credential and Erfana app-data paths, and
//      gives them an allowlisted environment: no tokens, no agent variables,
//      HOME and Electron's user-data folder inside the private folder.
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

// The sandbox profile. Later rules win in SBPL: the credential denies come last
// so nothing above can re-open them.
export function buildProfile({ appDir, tmpDir, ownerHome, primaryRoot, nodePrefix }) {
  const inside = path.relative(tmpDir, appDir)
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Refusal('the app folder must be inside the private folder.')
  const intoPrimary = path.relative(primaryRoot, tmpDir)
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
    ';; Writes: only the private folder (app, HOME, temp, Electron user data) and tty/null devices.',
    '(deny file-write*)',
    `(allow file-write* (subpath ${sbString(tmpDir)})`,
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

function confinedCommand(argv, { appDir, tmpDir, ownerHome, primaryRoot, nodePrefix, parentEnv = process.env }) {
  const home = path.join(tmpDir, 'home')
  fs.mkdirSync(home, { recursive: true })
  const profile = path.join(tmpDir, 'review-run-app.sb')
  fs.writeFileSync(profile, buildProfile({ appDir, tmpDir, ownerHome, primaryRoot, nodePrefix }), { mode: 0o600 })
  return { file: SANDBOX_EXEC, args: ['-f', profile, ...argv], env: buildEnv(parentEnv, { home, tmpDir, nodePrefix }) }
}

// Runs argv under the profile with the scrubbed environment and returns its
// output. Exported so the tests can prove what the confinement stops.
export function runConfined(argv, opts) {
  const { file, args, env } = confinedCommand(argv, opts)
  return spawnSync(file, args, { cwd: opts.cwd ?? opts.appDir, env, input: opts.input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

// The confined process group running now. Stopping the wrapper stops all of it:
// Electron and its helpers otherwise outlive their parent, keep the dev port
// and hold the app's single-instance lock, so the next start talks to a stale app.
let running = null
function stopRunning(signal = 'SIGTERM') {
  if (!running) return
  try {
    process.kill(-running.pid, signal)
  } catch {
    // Already gone.
  }
}
let stopping = false
function installStopHandlers() {
  for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(name, () => {
      if (stopping) return
      stopping = true
      stopRunning('SIGTERM')
      setTimeout(() => {
        stopRunning('SIGKILL')
        process.exit(code)
      }, 3000).unref()
    })
  }
  process.on('exit', () => stopRunning('SIGKILL'))
}

// The same, streaming, in its own process group. Output always goes through
// pipes: a confined process that inherits a descriptor to a file it may not
// read (the wrapper's own log inside the primary checkout) aborts at start-up.
function streamConfined(argv, opts, input) {
  const { file, args, env } = confinedCommand(argv, opts)
  return new Promise((resolveExit) => {
    const child = spawn(file, args, { cwd: opts.appDir, env, detached: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    running = child
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    if (input) child.stdin.end(input)
    child.on('error', (error) => resolveExit({ error }))
    child.on('close', (status, signal) => {
      stopRunning('SIGKILL')
      running = null
      resolveExit({ status, signal })
    })
  })
}

// The install folder of the node running this wrapper (bin/node's grandparent),
// the one part of the owner home the confined npm must read.
export function nodeInstallPrefix(execPath = process.execPath) {
  return path.dirname(path.dirname(realpath(execPath)))
}

function must(result, what) {
  if (result.error) throw new Refusal(`${what} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Refusal(`${what} failed with exit ${result.status ?? result.signal}.`)
}

// The private folder: created 0700, or reused only when it is a real folder
// (not a symlink) this user owns that nobody else can reach. /tmp is shared,
// so a folder someone else planted there is refused.
export function privateFolder(dir) {
  try {
    fs.mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Refusal(`cannot create ${dir}.`)
  }
  const stat = fs.lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    throw new Refusal(`${dir} is not a private folder of this user; remove it and retry.`)
  }
  return dir
}

export async function main(argv, { platform = process.platform, cwd = process.cwd(), env = process.env, ghHead = ghPrHead } = {}) {
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

  installStopHandlers()
  const tmpDir = privateFolder(path.join(realpath('/tmp'), `xezar-review-app-${path.basename(top)}-${sha}`))
  const appDir = path.join(tmpDir, 'app')
  const confined = (args, input) =>
    streamConfined(args, { appDir, tmpDir, ownerHome: realpath(os.homedir()), primaryRoot, nodePrefix: nodeInstallPrefix(), parentEnv: env }, input)

  const done = path.join(appDir, '.review-app-installed')
  if (!fs.existsSync(done)) {
    fs.rmSync(appDir, { recursive: true, force: true })
    fs.mkdirSync(appDir, { mode: 0o700 })
    const archive = spawnSync('git', ['archive', '--format=tar', sha], { cwd: top, maxBuffer: 1024 * 1024 * 1024 })
    must(archive, 'git archive')
    // Extract confined too: a symlink in the PR tree cannot steer a write outside the folder.
    must(await confined(['/usr/bin/tar', '-x', '-f', '-', '-C', appDir], archive.stdout), 'extracting the PR tree')
    must(await confined(['/usr/bin/env', 'npm', 'ci']), 'npm ci')
    fs.writeFileSync(done, `${sha}\n`)
  }
  process.stdout.write(`review-run-app: PR #${pr} at ${sha} in ${appDir}; starting the dev server (confined, network open)\n`)
  // macOS refuses a sandbox inside a sandbox, so Chromium's own (GPU, network,
  // renderer) cannot start here; the outer profile is the confinement instead.
  // Electron's own user data goes to the private folder, never the owner's.
  const userData = `--user-data-dir=${path.join(tmpDir, 'electron-user-data')}`
  const dev = await confined(['/usr/bin/env', 'npm', 'run', 'dev', '--', '--noSandbox', '--', userData])
  return dev.status ?? 1
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
