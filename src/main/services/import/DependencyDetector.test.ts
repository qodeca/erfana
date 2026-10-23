// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DependencyDetector.test.ts
 *
 * The detector asks `resolveLibreOffice` (the replay of LiteParse's own
 * lookup, tested in conversionToolGuard.test.ts) which LibreOffice a
 * conversion would run. On macOS and Linux a `found` candidate is probed with
 * a hardened `--version`; on Windows soffice is never run (the resolver's
 * file check is the answer).
 *
 * @see Issue #132 – LiteParse document import
 * @see Issue #250 – detection agrees with what a conversion would run
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { tmpdir } from 'os'

const fsMocks = vi.hoisted(() => ({
  mkdtempSync: vi.fn(() => '/tmp/erfana-lo-probe-x'),
  rmSync: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))
vi.mock('fs', () => ({ ...fsMocks, default: fsMocks }))

import { spawn } from 'child_process'
import { DependencyDetector, killActiveLibreOfficeProbes } from './DependencyDetector'
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
    setPlatform('linux')
  })
  afterEach(() => {
    setPlatform(realPlatform)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('Windows – soffice.exe is never launched', () => {
    beforeEach(() => setPlatform('win32'))

    it('reports found without spawning anything when the install exists', async () => {
      const { detector } = detectorWith({ state: 'found', path: WIN_SOFFICE })

      expect(await detector.detect()).toEqual({ libreOffice: 'found', unsafe: null })
      expect(mockedSpawn).not.toHaveBeenCalled()
      expect(fsMocks.mkdtempSync).not.toHaveBeenCalled()
    })

    it('reports missing without spawning when nothing is installed', async () => {
      const { detector } = detectorWith({ state: 'missing' })

      expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
      expect(mockedSpawn).not.toHaveBeenCalled()
    })
  })

  describe('macOS – the bundle binary still runs a hardened --version', () => {
    beforeEach(() => setPlatform('darwin'))
    const BIN = '/Applications/LibreOffice.app/Contents/MacOS/soffice'

    it('spawns with stdio ignored, headless, a private profile, and no kill on a clean exit', async () => {
      probeSucceedsFor(BIN)
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const { detector } = detectorWith({ state: 'found', path: BIN })

      expect(await detector.detect()).toEqual({ libreOffice: 'found', unsafe: null })
      const [command, args, options] = mockedSpawn.mock.calls[0]
      expect(command).toBe(BIN)
      expect(args).toEqual(['--version', '--headless', '--norestore', expect.stringMatching(/^-env:UserInstallation=file:\/\/\//)])
      expect(options).toMatchObject({ stdio: 'ignore', windowsHide: true, detached: true })
      expect(kill).not.toHaveBeenCalled()
      expect(fsMocks.rmSync).toHaveBeenCalledWith('/tmp/erfana-lo-probe-x', { recursive: true, force: true })
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

  it('resolves to missing when spawn throws, and removes the profile', async () => {
    mockedSpawn.mockImplementationOnce(() => {
      throw new Error('spawn EACCES')
    })
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(fsMocks.rmSync).toHaveBeenCalledWith('/tmp/erfana-lo-probe-x', { recursive: true, force: true })
  })

  it('kills the group, removes the profile and reports missing when the child emits error', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockedSpawn.mockImplementationOnce((() => ({
      pid: 77,
      on: (event: string, handler: (e: Error) => void) => {
        if (event === 'error') handler(new Error('spawn ENOENT'))
      }
    })) as unknown as typeof spawn)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(kill).toHaveBeenCalledWith(-77, 'SIGKILL')
    expect(fsMocks.rmSync).toHaveBeenCalledWith('/tmp/erfana-lo-probe-x', { recursive: true, force: true })
  })

  it('kills the group on a non-zero exit', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    probeSucceedsFor()
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
  })

  it('kills the group, removes the profile and reports missing when it hangs past the timeout', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockedSpawn.mockImplementationOnce((() => ({ pid: 4242, on: vi.fn() })) as unknown as typeof spawn)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    const result = detector.detect()
    await vi.advanceTimersByTimeAsync(6000)

    expect(await result).toEqual({ libreOffice: 'missing', unsafe: null })
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    expect(fsMocks.rmSync).toHaveBeenCalledWith('/tmp/erfana-lo-probe-x', { recursive: true, force: true })
  })

  it('kills an in-flight probe when the app quits', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockedSpawn.mockImplementationOnce((() => ({ pid: 555, on: vi.fn() })) as unknown as typeof spawn)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    const result = detector.detect()
    await vi.advanceTimersByTimeAsync(10)
    killActiveLibreOfficeProbes()

    expect(kill).toHaveBeenCalledWith(-555, 'SIGKILL')
    await vi.advanceTimersByTimeAsync(6000)
    await result
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
