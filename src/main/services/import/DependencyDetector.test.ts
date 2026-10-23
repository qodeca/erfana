// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DependencyDetector.test.ts
 *
 * The detector asks `resolveLibreOffice` (the replay of LiteParse's own
 * lookup, tested in conversionToolGuard.test.ts) which LibreOffice a
 * conversion would run, then probes a `found` candidate with `--version`.
 *
 * @see Issue #132 – LiteParse document import
 * @see Issue #250 – detection agrees with what a conversion would run
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { tmpdir } from 'os'

const fsMocks = vi.hoisted(() => ({
  mkdtempSync: vi.fn(() => '/tmp/erfana-lo-probe-x'),
  readFileSync: vi.fn(),
  realpathSync: Object.assign(vi.fn((p: string) => p), { native: vi.fn((p: string) => p) }),
  rmSync: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))
vi.mock('fs', () => ({ ...fsMocks, default: fsMocks }))

import { spawn } from 'child_process'
import { DependencyDetector, parseIniVersion, parsePlistVersion } from './DependencyDetector'
import type { LibreOfficeResolution } from './conversionToolGuard'

const mockedSpawn = vi.mocked(spawn)
const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/** spawn returns a child that exits with `code` for the given absolute paths only. */
function probeSucceedsFor(...paths: string[]): void {
  mockedSpawn.mockImplementation(((command: string) => {
    const handlers: Record<string, (arg?: unknown) => void> = {}
    setImmediate(() => handlers['exit']?.(paths.includes(command) ? 0 : 1))
    return {
      pid: 4242,
      on: (event: string, handler: (arg?: unknown) => void) => {
        handlers[event] = handler
      }
    } as unknown as ChildProcess
  }) as unknown as typeof spawn)
}

function detectorWith(resolution: LibreOfficeResolution, roots: string[] = []) {
  const resolve = vi.fn(() => resolution)
  return { detector: new DependencyDetector({ resolve, untrustedRoots: () => roots }), resolve }
}

const SOFFICE = '/usr/bin/soffice'
const WIN_SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'

describe('DependencyDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.realpathSync.native.mockImplementation((p: string) => p)
    setPlatform('linux')
  })
  afterEach(() => setPlatform(realPlatform))

  describe('Windows – soffice.exe is never launched', () => {
    beforeEach(() => setPlatform('win32'))

    it('reports found without spawning anything, and reads the version from version.ini', async () => {
      fsMocks.readFileSync.mockReturnValue('[Version]\r\nProductVersion=26.8.1\r\n')
      const { detector } = detectorWith({ state: 'found', path: WIN_SOFFICE })

      expect(await detector.detect()).toEqual({ libreOffice: 'found', unsafe: null, version: '26.8.1' })
      expect(mockedSpawn).not.toHaveBeenCalled()
      expect(fsMocks.readFileSync).toHaveBeenCalledWith('C:\\Program Files\\LibreOffice\\program\\version.ini', 'utf8')
    })

    it('still reports found, with no version, when version.ini is unreadable', async () => {
      fsMocks.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      const { detector } = detectorWith({ state: 'found', path: WIN_SOFFICE })

      expect(await detector.detect()).toEqual({ libreOffice: 'found', unsafe: null, version: null })
      expect(mockedSpawn).not.toHaveBeenCalled()
    })

    it('reports missing without spawning when nothing is installed', async () => {
      const { detector } = detectorWith({ state: 'missing' })

      expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
      expect(mockedSpawn).not.toHaveBeenCalled()
    })
  })

  describe('macOS', () => {
    beforeEach(() => setPlatform('darwin'))
    const BIN = '/Applications/LibreOffice.app/Contents/MacOS/soffice'

    it('reads the version from the bundle Info.plist and spawns nothing', async () => {
      fsMocks.readFileSync.mockReturnValue(
        '<dict><key>CFBundleShortVersionString</key>\n<string>25.2.3</string></dict>'
      )
      const { detector } = detectorWith({ state: 'found', path: BIN })

      expect(await detector.detect()).toEqual({ libreOffice: 'found', unsafe: null, version: '25.2.3' })
      expect(fsMocks.readFileSync).toHaveBeenCalledWith('/Applications/LibreOffice.app/Contents/Info.plist', 'utf8')
      expect(mockedSpawn).not.toHaveBeenCalled()
    })

    it('reports missing when the bundle has no readable version', async () => {
      fsMocks.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      const { detector } = detectorWith({ state: 'found', path: BIN })

      expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
      expect(mockedSpawn).not.toHaveBeenCalled()
    })
  })

  describe('version parsers', () => {
    it('parses ProductVersion from an ini and ignores text without one', () => {
      expect(parseIniVersion('[Version]\nProductVersion = 7.6.4.1\n')).toBe('7.6.4.1')
      expect(parseIniVersion('[Version]\nbuildid=abc\n')).toBeNull()
      expect(parseIniVersion(null)).toBeNull()
    })

    it('parses CFBundleShortVersionString from a plist', () => {
      expect(parsePlistVersion('<key>CFBundleShortVersionString</key><string>24.8.0</string>')).toBe('24.8.0')
      expect(parsePlistVersion('<key>Other</key><string>1</string>')).toBeNull()
      expect(parsePlistVersion(null)).toBeNull()
    })
  })

  it('reports found when the resolved LibreOffice answers --version', async () => {
    probeSucceedsFor(SOFFICE)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'found', unsafe: null })
    const [command, args, options] = mockedSpawn.mock.calls[0]
    expect(command).toBe(SOFFICE)
    expect(args).toEqual(['--version', '--headless', '--norestore', expect.stringMatching(/^-env:UserInstallation=file:\/\/\//)])
    expect(options).toMatchObject({ stdio: 'ignore', windowsHide: true, detached: true })
    expect(fsMocks.rmSync).toHaveBeenCalledWith('/tmp/erfana-lo-probe-x', { recursive: true, force: true })
  })

  it('reports missing when the candidate fails the liveness probe (a planted stub)', async () => {
    probeSucceedsFor()
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
  })

  it('reports missing without running anything when nothing resolves', async () => {
    const { detector } = detectorWith({ state: 'missing' })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('reports unsafe – and never runs the binary – when a conversion would refuse it', async () => {
    probeSucceedsFor('/work/repo/soffice')
    const { detector } = detectorWith({ state: 'unsafe', name: 'soffice', path: '/work/repo/soffice', reason: 'temp' })

    expect(await detector.detect()).toEqual({ libreOffice: 'unsafe', unsafe: { tool: 'soffice', reason: 'temp' } })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it.each(['unresolvable', 'ambiguous', 'network'] as const)('reports the %s reason and the helper at fault', async (reason) => {
    const { detector } = detectorWith({ state: 'unsafe', name: 'which', path: 'C:\\Repo\\which.exe', reason })

    expect(await detector.detect()).toEqual({ libreOffice: 'unsafe', unsafe: { tool: 'which', reason } })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('passes the untrusted roots to the lookup on every detection', async () => {
    probeSucceedsFor(SOFFICE)
    const { detector, resolve } = detectorWith({ state: 'found', path: SOFFICE }, ['/work/repo'])

    await detector.detect()

    expect(resolve).toHaveBeenCalledWith(['/work/repo'])
  })

  it('probes from the temp folder with a minimal env', async () => {
    process.env['SAL_USE_VCLPLUGIN'] = 'evil'
    probeSucceedsFor(SOFFICE)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    await detector.detect()

    const options = mockedSpawn.mock.calls[0][2] as { cwd?: string; env?: NodeJS.ProcessEnv; windowsHide?: boolean }
    expect(options.cwd).toBe(tmpdir())
    expect(options.windowsHide).toBe(true)
    expect(options.env).not.toHaveProperty('SAL_USE_VCLPLUGIN')
    delete process.env['SAL_USE_VCLPLUGIN']
  })

  it('never runs a relative path, whatever the lookup returns', async () => {
    probeSucceedsFor('soffice')
    const { detector } = detectorWith({ state: 'found', path: 'soffice' })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('treats a throwing lookup as missing', async () => {
    const detector = new DependencyDetector({
      resolve: () => {
        throw new Error('boom')
      }
    })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
  })

  it('resolves to missing when spawn throws or the child emits error', async () => {
    mockedSpawn.mockImplementationOnce(() => {
      throw new Error('spawn EACCES')
    })
    const first = detectorWith({ state: 'found', path: SOFFICE }).detector
    expect(await first.detect()).toEqual({ libreOffice: 'missing', unsafe: null })

    mockedSpawn.mockImplementationOnce((() => ({
      pid: 1,
      on: (event: string, handler: (e: Error) => void) => {
        if (event === 'error') handler(new Error('spawn ENOENT'))
      }
    })) as unknown as typeof spawn)
    const second = detectorWith({ state: 'found', path: SOFFICE }).detector
    expect(await second.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
  })

  it('kills the probe process group and reports missing when it hangs past the timeout', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockedSpawn.mockImplementationOnce((() => ({ pid: 4242, on: vi.fn() })) as unknown as typeof spawn)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    const result = detector.detect()
    await vi.advanceTimersByTimeAsync(6000)

    expect(await result).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    kill.mockRestore()
    vi.useRealTimers()
  })

  describe('caching', () => {
    it('serves the cached result without probing again', async () => {
      probeSucceedsFor(SOFFICE)
      const { detector, resolve } = detectorWith({ state: 'found', path: SOFFICE })

      const first = await detector.detect()
      const second = await detector.detect()

      expect(second).toBe(first)
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(mockedSpawn).toHaveBeenCalledTimes(1)
    })

    it('shares one detection between concurrent callers', async () => {
      probeSucceedsFor(SOFFICE)
      const { detector, resolve } = detectorWith({ state: 'found', path: SOFFICE })

      const [a, b] = await Promise.all([detector.detect(), detector.detect()])

      expect(a).toEqual(b)
      expect(resolve).toHaveBeenCalledTimes(1)
    })

    it('probes again after clearCache()', async () => {
      probeSucceedsFor(SOFFICE)
      const { detector, resolve } = detectorWith({ state: 'found', path: SOFFICE })

      await detector.detect()
      detector.clearCache()
      await detector.detect()

      expect(resolve).toHaveBeenCalledTimes(2)
    })
  })
})
