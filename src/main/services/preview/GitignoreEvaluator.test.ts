// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * GitignoreEvaluator tests (Issue #74, work item 26).
 *
 * Security-focused: the child argv, cwd and env are asserted with an exec spy.
 * The env is asserted POSITIVELY (an allowlist), so `GIT_TRACE`, `GIT_WORK_TREE`,
 * `GIT_INDEX_FILE`, `GIT_PROXY_COMMAND` and `GIT_CEILING_DIRECTORIES` are proven
 * absent (design NEW-13). Also covers exit-code mapping, fail-open when git is
 * missing, and the TTL cache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { devNull } from 'node:os'
import { GitignoreEvaluator, GIT_ENV_ALLOWLIST, type GitExecFn } from './GitignoreEvaluator'

const GIT_PATH = '/usr/bin/git'
const TEMP_DIR = '/tmp/erfana-safe-cwd'
const ROOT = '/home/user/project'

/** Base deps: an absolute git path, a safe temp dir, and a spy exec. */
function makeDeps(exec: GitExecFn) {
  return {
    exec,
    resolveGitPath: vi.fn(async () => GIT_PATH),
    tempDir: () => TEMP_DIR
  }
}

const savedEnv = { ...process.env }

afterEach(() => {
  // Restore any env vars a test injected.
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key]
  }
  Object.assign(process.env, savedEnv)
  vi.restoreAllMocks()
})

describe('GitignoreEvaluator', () => {
  describe('exit-code mapping', () => {
    it('treats exit 0 as ignored', async () => {
      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const ev = new GitignoreEvaluator(makeDeps(exec))
      expect(await ev.isIgnored(ROOT, 'dist/index.html')).toBe(true)
    })

    it('treats exit 1 as not ignored', async () => {
      const exec = vi.fn<GitExecFn>(async () => {
        throw Object.assign(new Error('not ignored'), { code: 1 })
      })
      const ev = new GitignoreEvaluator(makeDeps(exec))
      expect(await ev.isIgnored(ROOT, 'src/page.html')).toBe(false)
    })

    it('fails open (not ignored) on exit 128', async () => {
      const exec = vi.fn<GitExecFn>(async () => {
        throw Object.assign(new Error('fatal: not a git repository'), { code: 128 })
      })
      const ev = new GitignoreEvaluator(makeDeps(exec))
      expect(await ev.isIgnored(ROOT, 'src/page.html')).toBe(false)
    })

    it('fails open on a spawn error (ENOENT)', async () => {
      const exec = vi.fn<GitExecFn>(async () => {
        throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
      })
      const ev = new GitignoreEvaluator(makeDeps(exec))
      expect(await ev.isIgnored(ROOT, 'src/page.html')).toBe(false)
    })
  })

  describe('fail-open when git is unavailable', () => {
    it('returns false without calling exec when git cannot be resolved', async () => {
      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const ev = new GitignoreEvaluator({
        exec,
        resolveGitPath: async () => null,
        tempDir: () => TEMP_DIR
      })
      expect(await ev.isIgnored(ROOT, 'src/page.html')).toBe(false)
      expect(exec).not.toHaveBeenCalled()
    })
  })

  describe('hardened invocation', () => {
    it('uses an absolute git binary, safe cwd, and the hardened argv', async () => {
      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const ev = new GitignoreEvaluator(makeDeps(exec))
      await ev.isIgnored(ROOT, 'src/page.html')

      expect(exec).toHaveBeenCalledTimes(1)
      const [file, args, options] = exec.mock.calls[0]

      expect(file).toBe(GIT_PATH)
      expect(args).toEqual([
        '-C',
        ROOT,
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=',
        '-c',
        `core.hooksPath=${devNull}`,
        '-c',
        'include.path=',
        'check-ignore',
        '--quiet',
        '--',
        'src/page.html'
      ])

      // cwd is NOT inside the repo.
      expect(options.cwd).toBe(TEMP_DIR)
      expect(options.cwd).not.toContain(ROOT)
      expect(options.shell).toBe(false)
      expect(options.windowsHide).toBe(true)
      expect(typeof options.timeout).toBe('number')
    })

    it('passes ONLY the env allowlist plus GIT_CONFIG_NOSYSTEM (dangerous GIT_* absent)', async () => {
      // Inject dangerous vars that must NOT survive.
      process.env['GIT_TRACE'] = '/tmp/pwn.log'
      process.env['GIT_WORK_TREE'] = '/etc'
      process.env['GIT_INDEX_FILE'] = '/tmp/idx'
      process.env['GIT_PROXY_COMMAND'] = '/tmp/evil.sh'
      process.env['GIT_CEILING_DIRECTORIES'] = '/'
      process.env['PATH'] = '/usr/bin:/bin'

      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const ev = new GitignoreEvaluator(makeDeps(exec))
      await ev.isIgnored(ROOT, 'src/page.html')

      const env = exec.mock.calls[0][2].env as NodeJS.ProcessEnv
      const keys = Object.keys(env).sort()

      // Positive assertion: exactly the allowlist keys that are present + NOSYSTEM.
      const expectedKeys = [...GIT_ENV_ALLOWLIST.filter((k) => process.env[k] !== undefined), 'GIT_CONFIG_NOSYSTEM'].sort()
      expect(keys).toEqual(expectedKeys)

      expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1')
      // The dangerous variables cannot survive.
      expect(env['GIT_TRACE']).toBeUndefined()
      expect(env['GIT_WORK_TREE']).toBeUndefined()
      expect(env['GIT_INDEX_FILE']).toBeUndefined()
      expect(env['GIT_PROXY_COMMAND']).toBeUndefined()
      expect(env['GIT_CEILING_DIRECTORIES']).toBeUndefined()
    })
  })

  describe('git-path resolution', () => {
    it('resolves git exactly once across multiple evaluations', async () => {
      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const resolveGitPath = vi.fn(async () => GIT_PATH)
      const ev = new GitignoreEvaluator({ exec, resolveGitPath, tempDir: () => TEMP_DIR })

      await ev.isIgnored(ROOT, 'a.html')
      await ev.isIgnored(ROOT, 'b.html')

      expect(resolveGitPath).toHaveBeenCalledTimes(1)
    })
  })

  describe('TTL cache', () => {
    it('caches a result within the TTL and re-evaluates after it expires', async () => {
      let clock = 1000
      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const ev = new GitignoreEvaluator({
        ...makeDeps(exec),
        now: () => clock,
        cacheTtlMs: 5000
      })

      await ev.isIgnored(ROOT, 'src/page.html')
      await ev.isIgnored(ROOT, 'src/page.html')
      expect(exec).toHaveBeenCalledTimes(1) // second read served from cache

      clock += 6000 // past the TTL
      await ev.isIgnored(ROOT, 'src/page.html')
      expect(exec).toHaveBeenCalledTimes(2)
    })

    it('clearCache forces re-evaluation', async () => {
      const exec = vi.fn<GitExecFn>(async () => ({ stdout: '', stderr: '' }))
      const ev = new GitignoreEvaluator(makeDeps(exec))

      await ev.isIgnored(ROOT, 'src/page.html')
      ev.clearCache()
      await ev.isIgnored(ROOT, 'src/page.html')

      expect(exec).toHaveBeenCalledTimes(2)
    })
  })
})
