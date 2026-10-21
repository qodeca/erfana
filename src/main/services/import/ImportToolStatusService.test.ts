// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ImportToolStatusService – cache reset, rate limit and registry sync (#250).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DependencyStatus } from './types'

vi.mock('../FileService', () => ({ fileService: { getProjectPath: () => null } }))
vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../TranscriptionService', () => ({ transcriptionService: {} }))
vi.mock('../AudioMetadataService', () => ({ audioMetadataService: {} }))
vi.mock('../AudioExtractionService', () => ({ audioExtractionService: {} }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { ImportToolStatusService } from './ImportToolStatusService'
import { createConverterRegistry, type ConverterRegistry } from './ConverterRegistry'
import type { DependencyDetector } from './DependencyDetector'

/** A detector double: `detect()` answers from `answers`, counting real probes. */
function fakeDetector(answers: DependencyStatus[]) {
  let cached: DependencyStatus | null = null
  let probes = 0
  const detector = {
    detect: vi.fn(async () => {
      if (cached) return cached
      probes++
      cached = answers[Math.min(probes - 1, answers.length - 1)]
      return cached
    }),
    clearCache: vi.fn(() => {
      cached = null
    })
  }
  return { detector: detector as unknown as DependencyDetector, raw: detector, probes: () => probes }
}

const NONE = { libreOffice: false, imageMagick: false }
const BOTH = { libreOffice: true, imageMagick: true }

describe('ImportToolStatusService', () => {
  let registry: ConverterRegistry
  let clock: number

  beforeEach(() => {
    registry = createConverterRegistry()
    clock = 1_000_000
  })

  function build(answers: DependencyStatus[]) {
    const fake = fakeDetector(answers)
    const service = new ImportToolStatusService({
      detector: fake.detector,
      registry,
      now: () => clock,
      minRecheckIntervalMs: 3000
    })
    return { service, ...fake }
  }

  it('getStatus detects once and then serves the session cache', async () => {
    const { service, probes } = build([NONE])

    const first = await service.getStatus()
    const second = await service.getStatus()

    expect(first).toMatchObject({ libreOffice: false, imageMagick: false, throttled: false })
    expect(first.extensions).toContain('pdf')
    expect(first.extensions).not.toContain('docx')
    expect(second.throttled).toBe(false)
    expect(probes()).toBe(1)
  })

  it('recheck clears the detector cache and probes again – a tool installed after launch appears', async () => {
    const { service, raw, probes } = build([NONE, BOTH])
    await service.getStatus()
    expect(registry.getConverter('docx')?.category).not.toBe('document')

    clock += 3000
    const status = await service.recheck()

    expect(raw.clearCache).toHaveBeenCalledTimes(1)
    expect(probes()).toBe(2)
    expect(status).toMatchObject({ libreOffice: true, imageMagick: true, throttled: false })
    expect(status.extensions).toEqual(expect.arrayContaining(['pdf', 'docx', 'png']))
    expect(registry.getConverter('docx')?.category).toBe('document')
    expect(registry.getConverter('png')?.category).toBe('document')
  })

  it('a tool that disappears takes its extensions away again, and .rtf goes back to text', async () => {
    const { service } = build([BOTH, NONE])
    await service.getStatus()
    expect(registry.getConverter('rtf')?.category).toBe('document')

    clock += 5000
    const status = await service.recheck()

    expect(status.extensions).toContain('pdf')
    expect(status.extensions).not.toContain('docx')
    expect(status.extensions).not.toContain('png')
    expect(registry.getConverter('docx')).toBeUndefined()
    expect(registry.getConverter('rtf')?.category).toBe('text')
    expect(registry.getConverter('pdf')?.category).toBe('document')
  })

  it('rate-limits: a recheck inside the window spawns nothing and says so', async () => {
    const { service, raw, probes } = build([NONE, BOTH])
    await service.getStatus()

    clock += 2999
    const status = await service.recheck()

    expect(status).toMatchObject({ libreOffice: false, throttled: true })
    expect(raw.clearCache).not.toHaveBeenCalled()
    expect(probes()).toBe(1)
  })

  it('rate-limits a burst of rechecks to one probe per window', async () => {
    const { service, probes } = build([NONE, BOTH, NONE])
    await service.getStatus()
    clock += 3000

    const results = []
    for (let i = 0; i < 20; i++) {
      results.push(await service.recheck())
      clock += 10
    }

    expect(probes()).toBe(2)
    expect(results.filter((r) => !r.throttled)).toHaveLength(1)
  })

  it('a recheck while a probe is running joins it instead of starting another', async () => {
    let release: (deps: DependencyStatus) => void = () => {}
    const detector = {
      detect: vi.fn(() => new Promise<DependencyStatus>((resolve) => { release = resolve })),
      clearCache: vi.fn()
    }
    const service = new ImportToolStatusService({
      detector: detector as unknown as DependencyDetector,
      registry,
      now: () => clock
    })

    const startup = service.getStatus()
    const recheck = service.recheck()
    release(BOTH)

    await expect(startup).resolves.toMatchObject({ libreOffice: true, throttled: false })
    await expect(recheck).resolves.toMatchObject({ libreOffice: true, throttled: true })
    expect(detector.detect).toHaveBeenCalledTimes(1)
    expect(detector.clearCache).not.toHaveBeenCalled()
  })

  it('a first-ever recheck (nothing detected yet) probes', async () => {
    const { service, probes } = build([BOTH])

    const status = await service.recheck()

    expect(status).toMatchObject({ libreOffice: true, throttled: false })
    expect(probes()).toBe(1)
  })
})
