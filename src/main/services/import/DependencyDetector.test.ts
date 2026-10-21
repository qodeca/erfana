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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { tmpdir } from 'os'

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

import { execFile } from 'child_process'
import { DependencyDetector } from './DependencyDetector'
import type { LibreOfficeResolution } from './conversionToolGuard'

const mockedExecFile = vi.mocked(execFile)

/** execFile succeeds for the given absolute paths only. */
function probeSucceedsFor(...paths: string[]): void {
  mockedExecFile.mockImplementation(
    (command: string, _args: unknown, _options: unknown, callback: unknown) => {
      const cb = callback as (error: Error | null) => void
      cb(paths.includes(command) ? null : new Error('exit 1'))
      return { on: vi.fn() } as unknown as ChildProcess
    }
  )
}

function detectorWith(resolution: LibreOfficeResolution, roots: string[] = []) {
  const resolve = vi.fn(() => resolution)
  return { detector: new DependencyDetector({ resolve, untrustedRoots: () => roots }), resolve }
}

const SOFFICE = '/usr/bin/soffice'

describe('DependencyDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports found when the resolved LibreOffice answers --version', async () => {
    probeSucceedsFor(SOFFICE)
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'found' })
    expect(mockedExecFile).toHaveBeenCalledWith(SOFFICE, ['--version'], expect.any(Object), expect.any(Function))
  })

  it('reports missing when the candidate fails the liveness probe (a planted stub)', async () => {
    probeSucceedsFor()
    const { detector } = detectorWith({ state: 'found', path: SOFFICE })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing' })
  })

  it('reports missing without running anything when nothing resolves', async () => {
    const { detector } = detectorWith({ state: 'missing' })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing' })
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it('reports unsafe – and never runs the binary – when a conversion would refuse it', async () => {
    probeSucceedsFor('/work/repo/soffice')
    const { detector } = detectorWith({ state: 'unsafe', name: 'soffice', path: '/work/repo/soffice' })

    expect(await detector.detect()).toEqual({ libreOffice: 'unsafe' })
    expect(mockedExecFile).not.toHaveBeenCalled()
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

    const options = mockedExecFile.mock.calls[0][2] as { cwd?: string; env?: NodeJS.ProcessEnv; windowsHide?: boolean }
    expect(options.cwd).toBe(tmpdir())
    expect(options.windowsHide).toBe(true)
    expect(options.env).not.toHaveProperty('SAL_USE_VCLPLUGIN')
    delete process.env['SAL_USE_VCLPLUGIN']
  })

  it('never runs a relative path, whatever the lookup returns', async () => {
    probeSucceedsFor('soffice')
    const { detector } = detectorWith({ state: 'found', path: 'soffice' })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing' })
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it('treats a throwing lookup as missing', async () => {
    const detector = new DependencyDetector({
      resolve: () => {
        throw new Error('boom')
      }
    })

    expect(await detector.detect()).toEqual({ libreOffice: 'missing' })
  })

  it('resolves to missing when execFile throws or the child emits error', async () => {
    mockedExecFile.mockImplementationOnce(() => {
      throw new Error('spawn EACCES')
    })
    const first = detectorWith({ state: 'found', path: SOFFICE }).detector
    expect(await first.detect()).toEqual({ libreOffice: 'missing' })

    mockedExecFile.mockImplementationOnce(((_c: unknown, _a: unknown, _o: unknown, _cb: unknown) => ({
      on: (event: string, handler: (e: Error) => void) => {
        if (event === 'error') handler(new Error('spawn ENOENT'))
      }
    })) as unknown as typeof execFile)
    const second = detectorWith({ state: 'found', path: SOFFICE }).detector
    expect(await second.detect()).toEqual({ libreOffice: 'missing' })
  })

  describe('caching', () => {
    it('serves the cached result without probing again', async () => {
      probeSucceedsFor(SOFFICE)
      const { detector, resolve } = detectorWith({ state: 'found', path: SOFFICE })

      const first = await detector.detect()
      const second = await detector.detect()

      expect(second).toBe(first)
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(mockedExecFile).toHaveBeenCalledTimes(1)
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
