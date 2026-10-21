// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { DependencyDetector } from './DependencyDetector'
import { converterRegistry, type ConverterRegistry } from './ConverterRegistry'
import { getExtensionsForDependencies } from './converters/LiteParseConverter'
import type { DependencyStatus } from './types'
import { fileService } from '../FileService'
import { DOCUMENT_IMPORT } from '../../../shared/constants'
import type { ImportToolStatus } from '../../../shared/ipc/import-schema'

/** Every extension an optional tool can unlock – the set "Check again" may add or take away. */
const TOOL_EXTENSIONS = getExtensionsForDependencies({ libreOffice: true, imageMagick: true })

export interface ImportToolStatusServiceOptions {
  detector?: DependencyDetector
  registry?: ConverterRegistry
  /** Clock, injectable for the rate-limit tests. */
  now?: () => number
  minRecheckIntervalMs?: number
}

/**
 * Owns the optional import tools' status for the session (#250).
 *
 * Wraps the per-session {@link DependencyDetector} cache and keeps the
 * converter registry in step with it: a tool found adds its extensions, a tool
 * gone takes them away again. Two entry points:
 *
 * - {@link getStatus} – the cached result; detects once if nothing has run yet.
 *   Startup and the Settings section both use it.
 * - {@link recheck} – "Check again": clears the cache and probes again, so a
 *   tool installed after launch is picked up without a restart. Rate-limited:
 *   a recheck while a probe is running joins it, and one within
 *   `minRecheckIntervalMs` of the last probe returns the current result with
 *   `throttled: true` and spawns nothing.
 */
export class ImportToolStatusService {
  private readonly detector: DependencyDetector
  private readonly registry: ConverterRegistry
  private readonly now: () => number
  private readonly minRecheckIntervalMs: number

  private current: DependencyStatus | null = null
  private inFlight: Promise<DependencyStatus> | null = null
  private lastProbeAt = Number.NEGATIVE_INFINITY

  constructor(options: ImportToolStatusServiceOptions = {}) {
    this.detector = options.detector ?? new DependencyDetector()
    this.registry = options.registry ?? converterRegistry
    this.now = options.now ?? Date.now
    this.minRecheckIntervalMs =
      options.minRecheckIntervalMs ?? DOCUMENT_IMPORT.TOOL_RECHECK_MIN_INTERVAL_MS
  }

  /** The current status, detecting once if detection has not run yet. */
  async getStatus(): Promise<ImportToolStatus> {
    const deps = this.current ?? (await this.probe())
    return this.toStatus(deps, false)
  }

  /** Clear the session cache and probe again, unless rate-limited. */
  async recheck(): Promise<ImportToolStatus> {
    if (this.inFlight) {
      return this.toStatus(await this.inFlight, true)
    }
    if (this.current && this.now() - this.lastProbeAt < this.minRecheckIntervalMs) {
      return this.toStatus(this.current, true)
    }
    this.detector.clearCache()
    return this.toStatus(await this.probe(), false)
  }

  private probe(): Promise<DependencyStatus> {
    if (this.inFlight) return this.inFlight
    this.lastProbeAt = this.now()
    const run = this.detector
      .detect()
      .then((deps) => {
        this.apply(deps)
        this.current = deps
        return deps
      })
      .finally(() => {
        this.inFlight = null
      })
    this.inFlight = run
    return run
  }

  /** Map the found tools' extensions to the document converter and unmap the rest. */
  private apply(deps: DependencyStatus): void {
    const enabled = getExtensionsForDependencies(deps)
    const enabledSet = new Set(enabled)
    this.registry.removeConverterExtensions(
      'document',
      TOOL_EXTENSIONS.filter((ext) => !enabledSet.has(ext))
    )
    if (enabled.length > 0) {
      this.registry.updateConverterExtensions('document', enabled)
    }
  }

  private toStatus(deps: DependencyStatus, throttled: boolean): ImportToolStatus {
    return {
      libreOffice: deps.libreOffice,
      imageMagick: deps.imageMagick,
      extensions: this.registry.getExtensionsByConversionType().requiresConversion,
      throttled
    }
  }
}

/**
 * Session singleton. The open project is an untrusted root: a `soffice` or
 * `magick` that PATH resolves into it is never run.
 */
export const importToolStatusService = new ImportToolStatusService({
  detector: new DependencyDetector({ untrustedRoots: () => [fileService.getProjectPath()] })
})
