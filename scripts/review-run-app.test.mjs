// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
// Tests for .xezar/checks/review-run-app.mjs – the qa / design-review safe app
// start (#177, PR #202 S-2). The wrapper lives beside the kit checks so the
// kit snapshot copies it from the primary checkout; its tests live here so the
// required Unit tests job runs them. Sandbox cases need macOS and skip elsewhere.
// Every "secret" below is a fixture file written by the test.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  Refusal,
  SCRUBBED_PATTERNS,
  buildEnv,
  buildProfile,
  createSession,
  endSession,
  main,
  parseArgs,
  writeNewFile,
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
  const ok = { workDir: '/t/work', controlDir: '/t/control', ownerHome: '/h', primaryRoot: '/p' }

  it('refuses a path that could break out of a profile string', () => {
    expect(buildProfile(ok)).toContain('(deny file-write*)')
    expect(() => buildProfile({ ...ok, ownerHome: '/h") (allow file-read* (subpath "/' })).toThrow(Refusal)
    expect(() => buildProfile({ ...ok, primaryRoot: 'relative' })).toThrow(Refusal)
  })

  it('refuses a parent inside the primary checkout, or work and control that are not siblings', () => {
    expect(() => buildProfile({ ...ok, workDir: '/p/x/work', controlDir: '/p/x/control' })).toThrow(/must not be inside the primary checkout/)
    expect(() => buildProfile({ ...ok, controlDir: '/elsewhere/control' })).toThrow(/must be siblings/)
  })

  it('denies the control folder after allowing the work folder', () => {
    const profile = buildProfile(ok)
    expect(profile.indexOf('(deny file-read* file-write* (subpath "/t/control"))')).toBeGreaterThan(profile.indexOf('(allow file-write* (subpath "/t/work")'))
  })
})

describe.skipIf(process.platform === 'win32')('writeNewFile', () => {
  it('refuses a planted symlink or an existing file at the path, and never writes the target', () => {
    const dir = fs.mkdtempSync(path.join(base, 'wnf-'))
    const outside = path.join(base, `outside-${path.basename(dir)}.txt`)
    fs.writeFileSync(outside, 'ORIGINAL')
    fs.symlinkSync(outside, path.join(dir, 'link.sb'))
    expect(() => writeNewFile(path.join(dir, 'link.sb'), 'OVERWRITTEN')).toThrow(/EEXIST|ELOOP/)
    fs.writeFileSync(path.join(dir, 'existing.sb'), 'X')
    expect(() => writeNewFile(path.join(dir, 'existing.sb'), 'Y')).toThrow(/EEXIST/)
    expect(fs.readFileSync(outside, 'utf8')).toBe('ORIGINAL')
    writeNewFile(path.join(dir, 'new.sb'), 'Z')
    expect(fs.readFileSync(path.join(dir, 'new.sb'), 'utf8')).toBe('Z')
  })
})

describe.skipIf(!onMac)('inside the sandbox (macOS)', () => {
  let fx
  let session
  const sessions = []
  const newSession = () => {
    const created = createSession({ base: fx.base, ownerHome: fx.ownerHome, primaryRoot: fx.primaryRoot, nodePrefix: fx.nodePrefix })
    sessions.push(created)
    return created
  }
  beforeAll(() => {
    const root = path.join(base, 'sandbox')
    fx = {
      base: path.join(root, 'tmp'),
      primaryRoot: path.join(root, 'primary'),
      ownerHome: path.join(root, 'ownerhome')
    }
    fx.nodePrefix = path.join(fx.ownerHome, '.nvm/versions/node/v0')
    fs.mkdirSync(path.join(fx.nodePrefix, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(fx.nodePrefix, 'bin', 'marker.txt'), 'node-install')
    const worktree = path.join(fx.primaryRoot, '.local/xezar/worktrees/run1')
    for (const d of [fx.base, worktree, path.join(fx.ownerHome, '.ssh'), path.join(fx.ownerHome, '.claude.profile')]) {
      fs.mkdirSync(d, { recursive: true })
    }
    fs.writeFileSync(path.join(fx.ownerHome, '.ssh', 'id_fixture'), 'FIXTURE-NOT-A-KEY')
    fs.writeFileSync(path.join(fx.ownerHome, '.claude.profile', 'settings.json'), 'FIXTURE')
    fs.writeFileSync(path.join(fx.primaryRoot, 'owner-file.txt'), 'FIXTURE')
    fs.writeFileSync(path.join(fx.ownerHome, 'notes.txt'), 'FIXTURE')
    session = newSession()
  })
  afterAll(() => {
    for (const created of sessions) endSession(created)
  })
  const sh = (command, parentEnv = process.env, on = session) => runConfined(['/bin/sh', '-c', command], on, { parentEnv })

  it('can write in the app folder and its temp folder', () => {
    const r = sh('echo ok > "$PWD/written.txt" && echo ok > "$TMPDIR/t.txt" && cat "$PWD/written.txt"')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('ok')
  })

  it('cannot write outside the work folder: not the control folder or its profile, not beside it, not the primary checkout, a task worktree or the home', () => {
    const before = fs.readFileSync(session.profile, 'utf8')
    for (const target of [
      session.profile,
      path.join(session.controlDir, 'new.sb'),
      path.join(session.parent, 'outside.txt'),
      path.join(base, 'outside.txt'),
      path.join(fx.primaryRoot, 'outside.txt'),
      path.join(fx.primaryRoot, '.local/xezar/worktrees/run1/outside.txt'),
      path.join(fx.ownerHome, 'outside.txt')
    ]) {
      const r = sh(`echo harmless > '${target}'`)
      expect(r.status, target).not.toBe(0)
      expect(r.stderr).toMatch(/Operation not permitted|Permission denied/)
    }
    expect(fs.readFileSync(session.profile, 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(session.controlDir, 'new.sb'))).toBe(false)
    expect(sh(`cat '${session.profile}'`).status).not.toBe(0)
    expect(sh(`mv '${session.controlDir}' '${session.workDir}/stolen'`).status).not.toBe(0)
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
    expect(r.stdout).toContain(`HOME=${session.home}`)
  })

  it('a link planted where the old install marker lived cannot make the wrapper write outside', () => {
    const outside = path.join(base, 'marker-target.txt')
    fs.writeFileSync(outside, 'ORIGINAL')
    const s1 = newSession()
    // The child cannot plant a link into the control folder; in work/ it can, and the wrapper never writes there.
    expect(sh(`ln -s '${outside}' '${path.join(s1.controlDir, 'review-run-app.sb.new')}'`, process.env, s1).status).not.toBe(0)
    expect(sh(`ln -s '${outside}' '${path.join(s1.appDir, '.review-app-installed')}'`, process.env, s1).status).toBe(0)
    expect(endSession(s1)).toEqual([])
    expect(fs.readFileSync(outside, 'utf8')).toBe('ORIGINAL')
  })

  it('two starts use different, fresh folders: nothing the first child left is in the second', () => {
    const s1 = newSession()
    const s2 = newSession()
    expect(s1.parent).not.toBe(s2.parent)
    expect(path.dirname(s1.parent)).toBe(fs.realpathSync(fx.base))
    expect(fs.statSync(s1.parent).mode & 0o777).toBe(0o700)
    const tar = runConfined(['/bin/sh', '-c', 'mkdir -p src && echo pr-content > src/a.txt && /usr/bin/tar -c -f - src'], s1).stdout
    expect(tar.length).toBeGreaterThan(0)
    expect(sh('echo tampered > src/a.txt && cat src/a.txt', process.env, s1).stdout.trim()).toBe('tampered')
    expect(fs.readdirSync(s2.appDir)).toEqual([])
    expect(fs.existsSync(path.join(s2.appDir, 'src'))).toBe(false)
    expect(endSession(s1)).toEqual([])
    expect(endSession(s2)).toEqual([])
  })

  it('a child that detaches with setsid is still stopped, and the parent folder is removed', async () => {
    const s1 = newSession()
    const pidFile = path.join(s1.appDir, 'pid')
    // Fork, start a new session (setsid), leave the process group, keep running after the parent exits.
    const r = runConfined(
      ['/usr/bin/perl', '-e', `use POSIX; my $p = fork; if ($p) { exit 0 } POSIX::setsid(); open(STDIN, '<', '/dev/null'); open(STDOUT, '>', '/dev/null'); open(STDERR, '>', '/dev/null'); open(my $f, '>', '${pidFile}'); print $f $$; close $f; sleep 300;`],
      s1
    )
    expect(r.status).toBe(0)
    let pid = 0
    for (let i = 0; i < 50 && !pid; i++) {
      if (fs.existsSync(pidFile)) pid = Number(fs.readFileSync(pidFile, 'utf8')) || 0
      if (!pid) await sleep(100)
    }
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).not.toThrow()
    expect(endSession(s1)).toEqual([])
    expect(() => process.kill(pid, 0)).toThrow()
    expect(fs.existsSync(s1.parent)).toBe(false)
  })
})

describe.skipIf(!onMac)('main, end to end on a fixture PR (macOS)', () => {
  it('re-extracts the exact commit on every start, in a new folder, and removes it after', async () => {
    const root = fs.mkdtempSync(path.join(base, 'e2e-'))
    const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()
    const origin = path.join(root, 'origin.git')
    const primary = path.join(root, 'primary')
    const pr = path.join(root, 'pr')
    git(root, 'init', '-q', '--bare', origin)
    fs.mkdirSync(primary)
    git(primary, 'init', '-q', '-b', 'develop')
    git(primary, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(primary, 'remote', 'add', 'origin', origin)
    const task = path.join(primary, '.local/xezar/worktrees/run1')
    git(primary, 'worktree', 'add', '-q', '-b', 'xez/run1', task)
    // The PR: its dev script prints a file, then tampers with it.
    fs.mkdirSync(path.join(pr, 'src'), { recursive: true })
    fs.writeFileSync(path.join(pr, 'src/a.txt'), 'pr-content\n')
    fs.writeFileSync(path.join(pr, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true, scripts: { dev: 'cat src/a.txt && echo tampered > src/a.txt' } }))
    fs.writeFileSync(path.join(pr, 'package-lock.json'), JSON.stringify({ name: 'fx', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fx', version: '1.0.0' } } }))
    git(pr, 'init', '-q', '-b', 'topic')
    git(pr, 'add', '.')
    git(pr, 'commit', '-q', '-m', 'pr')
    const sha = git(pr, 'rev-parse', 'HEAD')
    git(pr, 'push', '-q', origin, 'HEAD:refs/pull/1/head')

    const printed = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk))
      return true
    })
    const parents = []
    try {
      for (let start = 0; start < 2; start++) {
        const code = await main(['1', sha], { platform: 'darwin', cwd: task, ghHead: () => sha, onSession: (s) => parents.push(s.parent) })
        expect(code).toBe(0)
      }
    } finally {
      spy.mockRestore()
    }
    const out = printed.join('')
    expect(out.match(/pr-content/g)).toHaveLength(2)
    expect(out).not.toMatch(/^tampered/m)
    expect(parents).toHaveLength(2)
    expect(parents[0]).not.toBe(parents[1])
    for (const parent of parents) expect(fs.existsSync(parent)).toBe(false)
  }, 120000)
})
