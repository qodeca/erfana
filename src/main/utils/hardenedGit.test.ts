// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import {
  GIT_ENV_ALLOWLIST,
  GIT_NULL_DEVICE,
  buildGitEnv,
  buildHardeningArgs,
  hardenedSpawnOptions,
  isSafeFilterName,
  parseFilterNames,
  resolveFinderBinary
} from './hardenedGit'

const ROOT = '/work/project'

describe('buildGitEnv', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('keeps only allowlisted variables plus the fixed GIT_* trio', () => {
    process.env['GIT_TRACE'] = '/tmp/trace.log'
    process.env['GIT_DIR'] = '/elsewhere'
    process.env['GIT_EXTERNAL_DIFF'] = '/tmp/x'
    process.env['SECRET_TOKEN'] = 'nope'
    process.env['PATH'] = '/usr/bin:/bin'

    const env = buildGitEnv()

    const expected = [
      ...GIT_ENV_ALLOWLIST.filter((k) => process.env[k] !== undefined),
      'GIT_CONFIG_NOSYSTEM',
      'GIT_TERMINAL_PROMPT',
      'GIT_OPTIONAL_LOCKS'
    ].sort()
    expect(Object.keys(env).sort()).toEqual(expected)
    expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1')
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(env['GIT_OPTIONAL_LOCKS']).toBe('0')
    expect(env['GIT_TRACE']).toBeUndefined()
    expect(env['GIT_DIR']).toBeUndefined()
    expect(env['SECRET_TOKEN']).toBeUndefined()
  })
})

describe('hardenedSpawnOptions', () => {
  it('runs outside the repo without a shell and hides the window', () => {
    const opts = hardenedSpawnOptions()
    expect(opts.cwd).toBe(tmpdir())
    expect(opts.shell).toBe(false)
    expect(opts.windowsHide).toBe(true)
  })
})

describe('buildHardeningArgs', () => {
  it('emits the base isolation prefix in order', () => {
    expect(buildHardeningArgs(ROOT)).toEqual([
      '--no-pager',
      '--no-optional-locks',
      '-C',
      ROOT,
      '-c',
      'core.fsmonitor=false',
      '-c',
      `core.hooksPath=${GIT_NULL_DEVICE}`,
      '-c',
      `include.path=${GIT_NULL_DEVICE}`
    ])
  })

  it('neutralises every clean/smudge/process driver of each named filter', () => {
    const args = buildHardeningArgs(ROOT, ['lfs', 'my.driver'])
    for (const name of ['lfs', 'my.driver']) {
      for (const key of ['clean', 'smudge', 'process']) {
        const i = args.indexOf(`filter.${name}.${key}=`)
        expect(i).toBeGreaterThan(0)
        expect(args[i - 1]).toBe('-c')
      }
      expect(args).toContain(`filter.${name}.required=false`)
    }
  })
})

describe('isSafeFilterName', () => {
  it.each(['lfs', 'my-filter', 'a.b', 'Filter_1', 'c++'])('accepts %s', (name) => {
    expect(isSafeFilterName(name)).toBe(true)
  })

  it.each(['', ' ', 'a b', 'a=b', 'a\nb', 'a"b', "a'b", '.lead', '-lead', 'a;b', 'a$(x)'])(
    'rejects %j',
    (name) => {
      expect(isSafeFilterName(name)).toBe(false)
    }
  )
})

describe('parseFilterNames', () => {
  it('returns an empty list for empty output', () => {
    expect(parseFilterNames('')).toEqual([])
  })

  it('dedupes names across variables and handles dotted subsections', () => {
    const out = ['filter.lfs.clean', 'filter.lfs.smudge', 'filter.a.b.process', ''].join('\0')
    expect(parseFilterNames(out)).toEqual(['lfs', 'a.b'])
  })

  it('fails closed on an unsafe name or malformed key', () => {
    expect(parseFilterNames('filter.a b.clean\0')).toBeNull()
    expect(parseFilterNames('filter.x=y.clean\0')).toBeNull()
    expect(parseFilterNames('filter.clean\0')).toBeNull()
    expect(parseFilterNames('core.fsmonitor\0')).toBeNull()
  })
})

describe('resolveFinderBinary', () => {
  it('is an absolute path, never a bare name', () => {
    const finder = resolveFinderBinary()
    if (process.platform === 'win32') {
      expect(finder).toMatch(/System32[\\/]where\.exe$/)
    } else {
      expect(finder).toBe('/usr/bin/which')
    }
  })
})
