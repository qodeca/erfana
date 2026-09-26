// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
// Tests for .xezar/checks/review-run-app.mjs – the qa / design-review safe app
// start (#177, PR #202 S-2). The wrapper lives beside the kit checks so the
// kit snapshot copies it from the primary checkout; its tests live here so the
// required Unit tests job runs them. Sandbox cases need macOS and skip elsewhere.
// Every "secret" below is a fixture file written by the test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Refusal,
  SCRUBBED_PATTERNS,
  buildEnv,
  buildProfile,
  main,
  parseArgs,
  privateFolder,
  resolveTaskWorktree,
  runConfined,
  verifyHead
} from '../.xezar/checks/review-run-app.mjs'

const SHA = 'a'.repeat(40)
const onMac = process.platform === 'darwin'
let base

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'review-run-app-test-')))
})
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

function gitRepoWithTaskWorktree() {
  const primary = path.join(base, `repo-${Math.random().toString(16).slice(2)}`)
  fs.mkdirSync(primary)
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  git(primary, 'init', '-q', '-b', 'develop')
  git(primary, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init')
  const task = path.join(primary, '.local', 'xezar', 'worktrees', 'run1')
  git(primary, 'worktree', 'add', '-q', '-b', 'xez/run1', task)
  const stray = path.join(base, `stray-${Math.random().toString(16).slice(2)}`)
  git(primary, 'worktree', 'add', '-q', '-b', 'stray', stray)
  return { primary, task, stray }
}

describe('where it may run', () => {
  it('refuses the primary checkout', async () => {
    const { primary } = gitRepoWithTaskWorktree()
    expect(() => resolveTaskWorktree(primary)).toThrow(/refusing to run in the primary checkout/)
    await expect(main(['202', SHA], { platform: 'darwin', cwd: primary, ghHead: () => SHA })).rejects.toThrow(/primary checkout/)
  })

  it('refuses a worktree that is not a task worktree, accepts a task worktree', () => {
    const { primary, task, stray } = gitRepoWithTaskWorktree()
    expect(() => resolveTaskWorktree(stray)).toThrow(/is not a task worktree/)
    expect(resolveTaskWorktree(task)).toEqual({ top: fs.realpathSync(task), primaryRoot: fs.realpathSync(primary) })
  })

  it('refuses a non-macOS host before anything else', async () => {
    for (const platform of ['linux', 'win32']) {
      await expect(main(['202', SHA], { platform, ghHead: () => SHA })).rejects.toThrow(/needs macOS sandbox-exec; this host is/)
    }
  })
})

describe('what it runs', () => {
  it('refuses a head SHA that does not match the PR', () => {
    expect(() => verifyHead('202', SHA, 'b'.repeat(40))).toThrow(Refusal)
    expect(() => verifyHead('202', SHA, '')).toThrow(/head is unknown/)
    expect(() => verifyHead('202', SHA, `${SHA}\n`)).not.toThrow()
  })

  it('refuses a SHA mismatch from a task worktree before fetching', async () => {
    const { task } = gitRepoWithTaskWorktree()
    await expect(main(['202', SHA], { platform: 'darwin', cwd: task, ghHead: () => 'b'.repeat(40) })).rejects.toThrow(/not a{40}/)
  })

  it('accepts only a PR number and a full SHA', () => {
    expect(parseArgs(['202', SHA])).toEqual({ pr: '202', sha: SHA })
    for (const argv of [[], ['202'], ['0', SHA], ['202', 'abc'], ['202', SHA.toUpperCase()], ['202', SHA, '--x'], ['-1', SHA]]) {
      expect(() => parseArgs(argv)).toThrow(/usage/)
    }
  })
})

describe('buildEnv', () => {
  it('drops tokens and agent variables and moves HOME to the temp folder', () => {
    const parent = {
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      HOME: '/Users/owner',
      GH_TOKEN: 'fixture',
      GITHUB_TOKEN: 'fixture',
      CLAUDE_CONFIG_DIR: 'fixture',
      CLAUDECODE: '1',
      ANTHROPIC_API_KEY: 'fixture',
      OPENAI_API_KEY: 'fixture',
      CODEX_HOME: 'fixture',
      NPM_TOKEN: 'fixture',
      SSH_AUTH_SOCK: 'fixture',
      XEZ_TASK_ID: 'fixture'
    }
    const env = buildEnv(parent, { home: '/tmp/x/home', tmpDir: '/tmp/x', nodePrefix: '/n' })
    expect(env.HOME).toBe('/tmp/x/home')
    expect(env.PATH.split(':')[0]).toBe('/n/bin')
    expect(env.PATH).not.toContain('/Users/owner')
    for (const key of Object.keys(env)) {
      expect(SCRUBBED_PATTERNS.some((re) => re.test(key)), key).toBe(false)
      expect(key).not.toMatch(/^(GH_|GITHUB_|CLAUDE|ANTHROPIC|OPENAI|CODEX|XEZ_)/)
    }
  })
})

describe('buildProfile', () => {
  const ok = { appDir: '/t/app', tmpDir: '/t', ownerHome: '/h', primaryRoot: '/p' }

  it('refuses a path that could break out of a profile string', () => {
    expect(buildProfile(ok)).toContain('(deny file-write*)')
    expect(() => buildProfile({ ...ok, ownerHome: '/h") (allow file-read* (subpath "/' })).toThrow(Refusal)
    expect(() => buildProfile({ ...ok, primaryRoot: 'relative' })).toThrow(Refusal)
  })

  it('refuses a private folder inside the primary checkout, or an app outside the private folder', () => {
    expect(() => buildProfile({ ...ok, tmpDir: '/p/x', appDir: '/p/x/app' })).toThrow(/must not be inside the primary checkout/)
    expect(() => buildProfile({ ...ok, appDir: '/elsewhere' })).toThrow(/must be inside the private folder/)
  })
})

describe.skipIf(process.platform === 'win32')('privateFolder', () => {
  it('creates a 0700 folder and refuses one others can reach or a symlink', () => {
    const dir = path.join(base, 'private-ok')
    expect(privateFolder(dir)).toBe(dir)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    const open = path.join(base, 'private-open')
    fs.mkdirSync(open, { mode: 0o755 })
    fs.chmodSync(open, 0o755)
    expect(() => privateFolder(open)).toThrow(/not a private folder/)
    const link = path.join(base, 'private-link')
    fs.symlinkSync(dir, link)
    expect(() => privateFolder(link)).toThrow(/not a private folder/)
  })
})

describe.skipIf(!onMac)('inside the sandbox (macOS)', () => {
  let fx
  beforeAll(() => {
    const root = path.join(base, 'sandbox')
    fx = {
      primaryRoot: path.join(root, 'primary'),
      ownerHome: path.join(root, 'ownerhome'),
      tmpDir: path.join(root, 'private')
    }
    fx.appDir = path.join(fx.tmpDir, 'app')
    fx.nodePrefix = path.join(fx.ownerHome, '.nvm/versions/node/v0')
    fs.mkdirSync(path.join(fx.nodePrefix, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(fx.nodePrefix, 'bin', 'marker.txt'), 'node-install')
    const worktree = path.join(fx.primaryRoot, '.local/xezar/worktrees/run1')
    for (const d of [fx.appDir, worktree, path.join(fx.ownerHome, '.ssh'), path.join(fx.ownerHome, '.claude.profile')]) {
      fs.mkdirSync(d, { recursive: true })
    }
    fs.writeFileSync(path.join(fx.ownerHome, '.ssh', 'id_fixture'), 'FIXTURE-NOT-A-KEY')
    fs.writeFileSync(path.join(fx.ownerHome, '.claude.profile', 'settings.json'), 'FIXTURE')
    fs.writeFileSync(path.join(fx.primaryRoot, 'owner-file.txt'), 'FIXTURE')
    fs.writeFileSync(path.join(fx.ownerHome, 'notes.txt'), 'FIXTURE')
  })
  const sh = (command, parentEnv = process.env) => runConfined(['/bin/sh', '-c', command], { ...fx, parentEnv })

  it('can write in the app folder and its temp folder', () => {
    const r = sh('echo ok > "$PWD/written.txt" && echo ok > "$TMPDIR/t.txt" && cat "$PWD/written.txt"')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('ok')
  })

  it('cannot write outside the private folder: not beside it, not in the primary checkout or a task worktree', () => {
    for (const target of [
      path.join(base, 'outside.txt'),
      path.join(fx.primaryRoot, 'outside.txt'),
      path.join(fx.primaryRoot, '.local/xezar/worktrees/run1/outside.txt'),
      path.join(fx.ownerHome, 'outside.txt')
    ]) {
      const r = sh(`echo harmless > '${target}'`)
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/Operation not permitted/)
      expect(fs.existsSync(target)).toBe(false)
    }
  })

  it('cannot read planted fake secrets beside the temp HOME stand-in, nor the primary checkout', () => {
    for (const file of [
      path.join(fx.ownerHome, '.ssh', 'id_fixture'),
      path.join(fx.ownerHome, '.claude.profile', 'settings.json'),
      path.join(fx.ownerHome, 'notes.txt'),
      path.join(fx.primaryRoot, 'owner-file.txt')
    ]) {
      const r = sh(`cat '${file}'`)
      expect(r.status).not.toBe(0)
      expect(r.stdout).not.toContain('FIXTURE')
    }
  })

  it('reads the Node.js install inside the home, but nothing beside it', () => {
    expect(sh(`cat '${path.join(fx.nodePrefix, 'bin', 'marker.txt')}'`).stdout).toBe('node-install')
    expect(sh(`ls '${fx.ownerHome}'`).status).not.toBe(0)
    expect(sh(`ls '${path.join(fx.ownerHome, '.nvm')}'`).status).not.toBe(0)
  })

  it('sees none of the scrubbed variables', () => {
    const r = sh('env', { ...process.env, GH_TOKEN: 'fixture', GITHUB_TOKEN: 'fixture', CLAUDE_X: 'fixture', ANTHROPIC_API_KEY: 'fixture', OPENAI_API_KEY: 'fixture', CODEX_HOME: 'fixture' })
    expect(r.status).toBe(0)
    const names = r.stdout.split('\n').map((line) => line.split('=')[0])
    for (const name of names) expect(name).not.toMatch(/^(GH_|GITHUB_|CLAUDE|ANTHROPIC|OPENAI|CODEX)/)
    expect(r.stdout).toContain(`HOME=${path.join(fx.tmpDir, 'home')}`)
  })
})
