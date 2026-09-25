// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The capture sandbox (spec § 3.3, as changed by the spike on PR #149).
 *
 * It lives in `/Users/Shared/erfana-capture/`: not in `/tmp` (Erfana refuses
 * `/tmp` and `/private` as project folders) and not inside a repository
 * (Claude Code would load that repository's `.claude/settings.local.json`).
 * The path holds no user name, so what the app shows of it is safe.
 *
 * The sandbox is recreated on every run. It is refused if it is a symlink,
 * not a directory, not owned by this user, or lacks the marker file this
 * script writes, so the recursive delete can only ever remove a sandbox this
 * script made.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const SANDBOX_ROOT = '/Users/Shared/erfana-capture'
export const MARKER = '.erfana-capture-sandbox'
export const PROJECT_NAME = 'harbour-garden'
export const FIXTURE_DIR = path.join(HERE, 'demo-project', PROJECT_NAME)
export const ZSHRC_TEMPLATE = path.join(HERE, '.zshrc.template')

/** The fixed parts of the sandbox. */
export function layout(root = SANDBOX_ROOT) {
  const home = path.join(root, 'home')
  return {
    root,
    home,
    project: path.join(home, 'Projects', PROJECT_NAME),
    userData: path.join(root, 'user-data'),
    raw: path.join(root, 'raw'),
    marks: path.join(root, 'marks'),
    stopLog: path.join(root, 'marks', 'stop-hook.log')
  }
}

/**
 * Why the sandbox path cannot be used, or null. Absent is fine; present must
 * be a real directory owned by this user and made by this script.
 */
export function sandboxProblem(root, { fsApi = fs, uid = process.getuid() } = {}) {
  let st
  try {
    st = fsApi.lstatSync(root)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    return `${root} cannot be read (${e.code})`
  }
  if (st.isSymbolicLink()) return `${root} is a symlink`
  if (!st.isDirectory()) return `${root} is not a directory`
  if (st.uid !== uid) return `${root} is not yours`
  try {
    const m = fsApi.lstatSync(path.join(root, MARKER))
    if (!m.isFile()) return `${root} was not made by the capture script`
  } catch {
    return `${root} was not made by the capture script`
  }
  return null
}

/** The sandbox user's Claude Code settings: only the Stop-hook marker. */
export function userClaudeSettings(stopLog) {
  return {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: `date +%s >> ${shellQuote(stopLog)}` }] }]
    }
  }
}

/** The sandbox project's Claude Code settings (R138-8, option a). */
export function projectClaudeSettings() {
  return { permissions: { defaultMode: 'acceptEdits' } }
}

/**
 * `~/.claude.json` pre-seeded so the theme picker and the folder-trust screen
 * (which prints the full path) never appear (spike Q4). Both spellings of the
 * project path are trusted.
 */
export function claudeJson(projectPaths) {
  const projects = {}
  for (const p of new Set(projectPaths)) projects[p] = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
  return { theme: 'dark', hasCompletedOnboarding: true, projects }
}

export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/**
 * The real `claude` binary: `ERFANA_CAPTURE_CLAUDE_BIN`, else the native
 * install in `~/.local/bin`, else the first `claude` on PATH that is not in a
 * temporary folder (wrappers some terminals put there).
 */
export function findClaude(env = process.env, { fsApi = fs, home = os.homedir(), tmp = os.tmpdir() } = {}) {
  const isExe = (p) => {
    try {
      fsApi.accessSync(p, fs.constants.X_OK)
      return fsApi.statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (env.ERFANA_CAPTURE_CLAUDE_BIN) return isExe(env.ERFANA_CAPTURE_CLAUDE_BIN) ? fsApi.realpathSync(env.ERFANA_CAPTURE_CLAUDE_BIN) : null
  const native = path.join(home, '.local', 'bin', 'claude')
  if (isExe(native)) return fsApi.realpathSync(native)
  const tmpReal = [tmp, '/var/folders', '/private/var/folders', '/tmp', '/private/tmp']
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir || tmpReal.some((t) => dir.startsWith(t))) continue
    const p = path.join(dir, 'claude')
    if (isExe(p)) return fsApi.realpathSync(p)
  }
  return null
}

const gitEnv = (home) => ({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Garden committee',
  GIT_AUTHOR_EMAIL: 'committee@example.org',
  GIT_COMMITTER_NAME: 'Garden committee',
  GIT_COMMITTER_EMAIL: 'committee@example.org',
  GIT_AUTHOR_DATE: '2026-03-14T10:00:00Z',
  GIT_COMMITTER_DATE: '2026-03-14T10:00:00Z'
})

/**
 * Copy the fixture into the sandbox project, make it a git repository with one
 * commit, then one modified and one untracked file so the tree shows real git
 * badges (design § Demo project). Runs before every scene, so a scene that
 * edits, imports or deletes never leaks into the next one.
 */
export function resetProject(l = layout(), fixture = FIXTURE_DIR) {
  const problem = sandboxProblem(l.root)
  if (problem) throw new Error(`refusing to reset the project: ${problem}`)
  fs.rmSync(l.project, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(l.project), { recursive: true })
  fs.cpSync(fixture, l.project, { recursive: true, dereference: false, verbatimSymlinks: true })
  fs.mkdirSync(path.join(l.project, '.claude'), { recursive: true })
  writeJson(path.join(l.project, '.claude', 'settings.json'), projectClaudeSettings())
  const git = (...args) => execFileSync('git', args, { cwd: l.project, env: gitEnv(l.home), stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'Garden handbook')
  fs.appendFileSync(path.join(l.project, 'handbook', 'getting-involved.md'), '\nNew volunteers: come to the Saturday work morning first.\n')
  fs.writeFileSync(path.join(l.project, 'drafts', 'ideas.md'), '# Ideas\n\n- A bee hotel by the shed.\n')
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Recreate the sandbox. Returns its layout. Throws an Error with
 * `code = 'UNSAFE_SANDBOX'` when the path is refused.
 */
export function prepareSandbox({ root = SANDBOX_ROOT, claudeBin }) {
  const problem = sandboxProblem(root)
  if (problem) {
    const e = new Error(`${problem}; remove it and retry.`)
    e.code = 'UNSAFE_SANDBOX'
    throw e
  }
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { mode: 0o700 })
  fs.writeFileSync(path.join(root, MARKER), 'Made by scripts/capture/sandbox.mjs; deleted after a successful run.\n')
  const l = layout(root)
  for (const dir of [l.home, l.userData, l.raw, l.marks, path.join(l.home, '.claude'), path.join(l.home, '.local', 'bin')]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  fs.copyFileSync(ZSHRC_TEMPLATE, path.join(l.home, '.zshrc'))
  writeJson(path.join(l.home, '.claude', 'settings.json'), userClaudeSettings(l.stopLog))
  if (claudeBin) fs.symlinkSync(claudeBin, path.join(l.home, '.local', 'bin', 'claude'))
  resetProject(l)
  writeJson(path.join(l.home, '.claude.json'), claudeJson([l.project, fs.realpathSync(l.project)]))
  return l
}

/** Remove the sandbox after a successful run (only one this script made). */
export function removeSandbox(root = SANDBOX_ROOT) {
  if (sandboxProblem(root) === null) fs.rmSync(root, { recursive: true, force: true })
}

// `node sandbox.mjs reset`: the scenes (TypeScript, loaded by Playwright as
// CommonJS) cannot import this ES module, so they reset the project through
// this entry point. It acts only on the sandbox named by
// ERFANA_CAPTURE_SANDBOX, and only if that sandbox passes the same checks.
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  const [command] = process.argv.slice(2)
  const root = process.env.ERFANA_CAPTURE_SANDBOX
  if (command !== 'reset' || !root) {
    console.error('usage: ERFANA_CAPTURE_SANDBOX=<root> node scripts/capture/sandbox.mjs reset')
    process.exitCode = 2
  } else {
    resetProject(layout(root))
  }
}
