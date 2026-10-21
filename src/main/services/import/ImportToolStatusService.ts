// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { DependencyDetector } from './DependencyDetector'
import { converterRegistry, type ConverterRegistry } from './ConverterRegistry'
import { getExtensionsForDependencies } from './converters/LiteParseConverter'
import type { DependencyStatus } from './types'
import { fileService } from '../FileService'
import { DOCUMENT_IMPORT } from '../../../shared/constants'
import type { DependencyReadyEvent, ImportToolStatus } from '../../../shared/ipc/import-schema'
import { IMPORT_CHANNELS } from '../../../shared/ipc/import-channels'
import { broadcastToAllWindows } from '../../utils/ipcBroadcast'
import { setUntrustedRootsProvider } from './conversionToolGuard'
export { missingToolsDialogMessage } from './missingToolsMessage'

/** Every extension LibreOffice can unlock – the set "Check again" may add or take away. */
const TOOL_EXTENSIONS = getExtensionsForDependencies({ libreOffice: 'found' })

export interface ImportToolStatusServiceOptions {
  detector?: DependencyDetector
  registry?: ConverterRegistry
  /** Clock, injectable for the rate-limit tests. */
  now?: () => number
  minRecheckIntervalMs?: number
  /** Called after every probe's result is applied – the singleton broadcasts it to every window. */
  onApplied?: (status: ImportToolStatus) => void
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
 *   `minRecheckIntervalMs` of the END of the last probe returns the current
 *   result with `throttled: true` and spawns nothing. Measured from the end, a
 *   slow probe (up to 5 s per tool) cannot be followed back-to-back.
 */
export class ImportToolStatusService {
  private readonly detector: DependencyDetector
  private readonly registry: ConverterRegistry
  private readonly now: () => number
  private readonly minRecheckIntervalMs: number
  private readonly onApplied?: (status: ImportToolStatus) => void

  private current: DependencyStatus | null = null
  private inFlight: Promise<DependencyStatus> | null = null
  private lastProbeAt = Number.NEGATIVE_INFINITY

  constructor(options: ImportToolStatusServiceOptions = {}) {
    this.detector = options.detector ?? new DependencyDetector()
    this.registry = options.registry ?? converterRegistry
    this.now = options.now ?? Date.now
    this.minRecheckIntervalMs =
      options.minRecheckIntervalMs ?? DOCUMENT_IMPORT.TOOL_RECHECK_MIN_INTERVAL_MS
    this.onApplied = options.onApplied
  }

  /** The current status, detecting once if detection has not run yet. */
  async getStatus(): Promise<ImportToolStatus> {
    const deps = this.current ?? (await this.probe())
    return this.toStatus(deps, false)
  }

  /** The last applied result, or null before the first probe finished. Never probes. */
  peek(): DependencyStatus | null {
    return this.current
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
    const run = this.detector
      .detect()
      .then((deps) => {
        this.apply(deps)
        this.current = deps
        this.onApplied?.(this.toStatus(deps, false))
        return deps
      })
      .finally(() => {
        this.lastProbeAt = this.now()
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
      unsafe: deps.libreOffice === 'unsafe' ? (deps.unsafe ?? null) : null,
      extensions: this.registry.getExtensionsByConversionType().requiresConversion,
      throttled
    }
  }
}

/**
 * Session singleton. The open project is an untrusted root: a LibreOffice
 * (or a `which` / `powershell` helper) that PATH resolves into it is never run
 * – not by detection, and not by a conversion (`conversionToolGuard`). Every applied result is
 * broadcast as `import:dependenciesReady`, so all windows stay in step after a
 * "Check again".
 */
const projectRoots = (): ReadonlyArray<string | null> => [fileService.getProjectPath()]
setUntrustedRootsProvider(projectRoots)

export const importToolStatusService = new ImportToolStatusService({
  detector: new DependencyDetector({ untrustedRoots: projectRoots }),
  onApplied: (status) => {
    const payload: DependencyReadyEvent = {
      libreOffice: status.libreOffice,
      unsafe: status.unsafe,
      extensions: status.extensions
    }
    broadcastToAllWindows(IMPORT_CHANNELS.DEPENDENCIES_READY, payload)
  }
})
