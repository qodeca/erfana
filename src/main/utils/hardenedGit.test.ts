// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import {
  GIT_ENV_ALLOWLIST,
  GIT_FIXED_ENV,
  GIT_NULL_DEVICE,
  buildGitEnv,
  buildHardeningArgs,
  hardenedSpawnOptions,
  isSafeFilterName,
  parseIsolationListing,
  parseSystemEolConfig,
  resolveFinderBinary
} from './hardenedGit'

const ROOT = '/work/project'

describe('buildGitEnv', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('keeps only allowlisted variables plus the fixed GIT_* set', () => {
    process.env['GIT_TRACE'] = '/tmp/trace.log'
    process.env['GIT_DIR'] = '/elsewhere'
    process.env['GIT_EXTERNAL_DIFF'] = '/tmp/x'
    process.env['SECRET_TOKEN'] = 'nope'
    process.env['PATH'] = '/usr/bin:/bin'

    const env = buildGitEnv()

    const expected = [
      ...GIT_ENV_ALLOWLIST.filter((k) => process.env[k] !== undefined),
      ...Object.keys(GIT_FIXED_ENV)
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
      'include.path=/dev/null'
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

describe('parseIsolationListing', () => {
  it('returns empty results for empty output', () => {
    expect(parseIsolationListing('')).toEqual({ filterNames: [], eolKeysSet: new Set() })
  })

  it('dedupes names across variables and handles dotted subsections', () => {
    const out = ['filter.lfs.clean', 'filter.lfs.smudge', 'filter.a.b.process', ''].join('\0')
    expect(parseIsolationListing(out)?.filterNames).toEqual(['lfs', 'a.b'])
  })

  it('records line-ending keys that are already set', () => {
    const out = ['core.autocrlf', 'core.eol'].join('\0')
    expect(parseIsolationListing(out)?.eolKeysSet).toEqual(new Set(['core.autocrlf', 'core.eol']))
  })

  it('fails closed on an unsafe name or malformed key', () => {
    expect(parseIsolationListing('filter.a b.clean\0')).toBeNull()
    expect(parseIsolationListing('filter.x=y.clean\0')).toBeNull()
    expect(parseIsolationListing('filter.clean\0')).toBeNull()
    expect(parseIsolationListing('core.fsmonitor\0')).toBeNull()
  })

  it('fails closed on a promisor remote or partial clone', () => {
    expect(parseIsolationListing('remote.origin.promisor\0')).toBeNull()
    expect(parseIsolationListing('remote.a.b.promisor\0')).toBeNull()
    expect(parseIsolationListing('extensions.partialclone\0')).toBeNull()
  })
})

describe('parseSystemEolConfig', () => {
  it('keeps recognised line-ending keys with recognised values', () => {
    const out = ['core.autocrlf\ntrue', 'core.eol\nCRLF', 'core.safecrlf\nwarn'].join('\0') + '\0'
    expect(parseSystemEolConfig(out)).toEqual(['core.autocrlf=true', 'core.eol=crlf', 'core.safecrlf=warn'])
  })

  it('drops unknown keys, odd values and malformed records', () => {
    const out = ['core.autocrlf\n!evil', 'core.fsmonitor\ntrue', 'core.eol'].join('\0') + '\0'
    expect(parseSystemEolConfig(out)).toEqual([])
  })
})

describe('buildHardeningArgs extra config', () => {
  it('passes extra key=value entries as -c', () => {
    const args = buildHardeningArgs(ROOT, [], ['core.autocrlf=true'])
    expect(args[args.indexOf('core.autocrlf=true') - 1]).toBe('-c')
  })
})

describe('buildGitEnv hardening values', () => {
  it('blocks lazy fetching and drops NOSYSTEM only on request', () => {
    expect(GIT_FIXED_ENV.GIT_NO_LAZY_FETCH).toBe('1')
    expect(GIT_FIXED_ENV.GIT_ALLOW_PROTOCOL).toBe('none')
    expect(buildGitEnv()['GIT_CONFIG_NOSYSTEM']).toBe('1')
    expect(buildGitEnv({ includeSystemConfig: true })['GIT_CONFIG_NOSYSTEM']).toBeUndefined()
    expect(GIT_ENV_ALLOWLIST).toContain('XDG_CONFIG_HOME')
    expect(GIT_ENV_ALLOWLIST).toContain('PATHEXT')
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
