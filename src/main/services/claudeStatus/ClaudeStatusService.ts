/**
 * ClaudeStatusService — singleton orchestrator for the per-terminal Claude Code
 * context status bar (#216).
 *
 * Owns one entry per registered terminal panel and turns three signals into a
 * display-only {@link ClaudeStatusSnapshot} (or `null` to hide):
 *  1. process liveness — is the `claude` CLI a descendant of the panel's PTY pid
 *     (and what is its live cwd)?
 *  2. transcript location + parse — newest `*.jsonl` for that cwd → model id +
 *     used tokens.
 *  3. window detection — 200k vs 1M via the read-only hybrid signal.
 *
 * The result is pushed to the OWNING webContents only (targeted send, design
 * §10), never broadcast. Every failure path is fail-closed → `emit(null)`; the
 * service never throws to callers.
 *
 * Concurrency invariants (design §10):
 *  - **Per-terminal generation guard.** Each `refresh` captures a monotonically
 *    increasing `gen`; after every await it re-checks the entry still exists and
 *    its generation is unchanged, aborting (no emit) on a stale run. This is a
 *    SERVICE-level invariant — it fixes the push/poll race, not just watcher
 *    staleness.
 *  - **Single serialized refresh per terminal** with queue-latest: an overlapping
 *    `refresh` sets `queued` and returns; the in-flight run loops once more after
 *    completing so the newest request always runs exactly once more.
 *  - **Watcher owns the dir set**; this service only calls `watchDir/unwatchDir`.
 *
 * @see docs/designs/216-claude-status-bar.md §3, §4, §7, §10
 */
import os from 'node:os'
import path from 'node:path'
import { logger } from '../LoggingService'
import { encodeProjectDir } from './encodeCwd'
import { locateLatestTranscript } from './ClaudeTranscriptLocator'
import { parseTranscript } from './ClaudeTranscriptParser'
import { detectWindowSize } from './ClaudeWindowDetector'
import { friendlyModelName } from './friendlyModelName'
import { clampPercent, levelFor } from './thresholds'
import { createProcessDetector } from './process/createProcessDetector'
import type { IClaudeProcessDetector } from './process/types'
import { ClaudeTranscriptWatcher } from './ClaudeTranscriptWatcher'
import type { ClaudeStatusChangePayload } from '../../../shared/ipc/claude-status-schema'

/** Minimum spacing between activity nudges per terminal (ms). */
const NUDGE_MIN_INTERVAL_MS = 1000

/** Debounce window applied to nudge-triggered refreshes (ms). */
const REFRESH_DEBOUNCE_MS = 250

/** Parsed token usage from a transcript (subset re-declared to decouple deps). */
interface ParsedTurn {
  modelId: string
  usedTokens: number
}

/** Injectable collaborators; defaults wire the real implementations. */
export interface ClaudeStatusDeps {
  /** Per-OS process detector keyed by PTY pid. */
  detector: IClaudeProcessDetector
  /** Resolve the newest transcript for a cwd, or null. */
  locateTranscript: (cwd: string) => Promise<string | null>
  /** Parse a transcript file into {modelId, usedTokens}, or null. */
  parseTranscript: (file: string) => Promise<ParsedTurn | null>
  /** Detect the 200k/1M window for a model id + used-token count. */
  detectWindowSize: (modelId: string, used: number) => Promise<200000 | 1000000>
  /** External chokidar watcher owning the watched-dir set. */
  watcher: ClaudeTranscriptWatcher
  /** Push a change payload to a webContents (wired to electron send later). */
  emit: (webContentsId: number, payload: ClaudeStatusChangePayload) => void
}

/** Per-terminal tracking state. */
interface PanelEntry {
  pid: number | undefined
  spawnCwd: string
  webContentsId: number
  /** Monotonic per-terminal refresh generation (stale-guard). */
  generation: number
  debounceTimer?: NodeJS.Timeout
  lastNudge?: number
  inFlight?: boolean
  queued?: boolean
  /** Dir currently watched for this terminal (so cwd changes can re-target). */
  watchedDir?: string
}

/**
 * Format a token count to a nearest-thousand "k" string (e.g. 84321 → "84k",
 * 95329 → "95k", 999 → "1k", 0 → "0k").
 */
function kfmt(tokens: number): string {
  const k = Math.round(tokens / 1000)
  return `${k}k`
}

/** Build the `~/.claude/projects/<ENC(cwd)>` dir for a cwd. */
function transcriptDirFor(cwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd))
}

/**
 * True if `value` contains a NUL or any C0 control char (including newline /
 * carriage return / tab). Defense-in-depth guard for an untrusted cwd before it
 * reaches path building or transcript location (§10). Implemented by code-point
 * scan rather than a control-range regex literal to keep raw control bytes out
 * of source.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= 0x1f) return true
  }
  return false
}

export class ClaudeStatusService {
  private readonly entries = new Map<string, PanelEntry>()
  private readonly deps: ClaudeStatusDeps

  constructor(deps?: Partial<ClaudeStatusDeps>) {
    const watcher = deps?.watcher ?? new ClaudeTranscriptWatcher()
    this.deps = {
      detector: deps?.detector ?? createProcessDetector(),
      locateTranscript: deps?.locateTranscript ?? ((cwd) => locateLatestTranscript(cwd)),
      parseTranscript: deps?.parseTranscript ?? ((file) => parseTranscript(file)),
      detectWindowSize:
        deps?.detectWindowSize ?? ((modelId, used) => detectWindowSize(modelId, used)),
      watcher,
      emit: deps?.emit ?? (() => {})
    }

    // A transcript-dir change fans out to every terminal watching that dir.
    //
    // PERF (design §10): the watcher-driven refresh here and the activity nudge
    // (`nudge` → `refresh`) can both fire for the same change, but `refresh` is
    // serialized per terminal with queue-latest, so overlapping requests collapse
    // to ONE extra run. Combined with the two short-TTL caches now in place —
    // process liveness (MacClaudeProcessDetector, ~4s) and the settings `[1m]`
    // signal (ClaudeWindowDetector, ~5s) — a steady-state refresh skips both
    // process spawns and the settings read, bounding its cost to a single
    // transcript tail-read per change. No extra scheduler/throttle is warranted.
    // PERF (possible future win): a watcher-driven refresh could pass a "claude is
    // alive" hint (a transcript write implies the CLI is running) to skip even the
    // cached liveness check; deferred as a low-value optimisation given the cache.
    this.deps.watcher.onChange((dir) => {
      for (const [terminalId, entry] of this.entries) {
        if (entry.watchedDir === dir) void this.refresh(terminalId)
      }
    })
  }

  /**
   * Register (or re-register) a panel. Re-registration of an existing terminalId
   * updates its fields and bumps the generation (invalidating any in-flight
   * refresh). The PTY pid is main-owned and NEVER renderer-supplied (design §10).
   */
  registerPanel(
    terminalId: string,
    pid: number | undefined,
    spawnCwd: string,
    webContentsId: number
  ): void {
    const existing = this.entries.get(terminalId)
    if (existing) {
      existing.pid = pid
      existing.spawnCwd = spawnCwd
      existing.webContentsId = webContentsId
      existing.generation += 1
    } else {
      this.entries.set(terminalId, {
        pid,
        spawnCwd,
        webContentsId,
        generation: 0
      })
    }
    void this.refresh(terminalId)
  }

  /**
   * Activity-triggered light re-check. Gated to at most once per
   * {@link NUDGE_MIN_INTERVAL_MS} per terminal, then debounced into a refresh.
   */
  nudge(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return

    const now = Date.now()
    if (entry.lastNudge !== undefined && now - entry.lastNudge < NUDGE_MIN_INTERVAL_MS) {
      return
    }
    entry.lastNudge = now

    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = undefined
      void this.refresh(terminalId)
    }, REFRESH_DEBOUNCE_MS)
  }

  /**
   * Recompute and push the snapshot for one terminal. Serialized per terminal:
   * if a run is in-flight, mark `queued` and return; the active run reruns once
   * after completing (queue-latest). Stale runs (generation changed or entry
   * removed mid-await) abort without emitting.
   */
  async refresh(terminalId: string): Promise<void> {
    const entry = this.entries.get(terminalId)
    if (!entry) return

    if (entry.inFlight) {
      entry.queued = true
      return
    }

    entry.inFlight = true
    try {
      do {
        entry.queued = false
        await this.runRefresh(terminalId)
      } while (this.entries.get(terminalId)?.queued)
    } finally {
      const current = this.entries.get(terminalId)
      if (current) current.inFlight = false
    }
  }

  /**
   * One refresh pass. Captures a generation at start and re-checks it after every
   * await; any mismatch (or a removed/re-registered entry) aborts with no emit.
   */
  private async runRefresh(terminalId: string): Promise<void> {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    const gen = ++entry.generation

    /** True iff this run is still the live generation for an existing entry. */
    const isStale = (): boolean => {
      const e = this.entries.get(terminalId)
      return !e || e.generation !== gen
    }

    try {
      // 1. Liveness. pid undefined → not running.
      if (entry.pid === undefined) {
        this.ensureUnwatched(terminalId)
        if (!isStale()) this.emitNull(terminalId)
        return
      }

      const detection = await this.deps.detector.isClaudeRunning(entry.pid)
      if (isStale()) return
      if (!detection.running) {
        this.ensureUnwatched(terminalId)
        this.emitNull(terminalId)
        return
      }

      // 2. cwd = live process cwd, else spawn cwd; (re)target the watcher.
      const cwd = detection.cwd ?? entry.spawnCwd

      // Defense-in-depth (§10): reject a cwd carrying NUL / control chars /
      // newlines before it ever reaches path building or transcript location.
      // Fail-closed — hide the bar, never throw.
      if (hasControlChars(cwd)) {
        this.ensureUnwatched(terminalId)
        this.emitNull(terminalId)
        return
      }

      this.ensureWatching(terminalId, cwd)

      // 3. Locate + parse transcript.
      const file = await this.deps.locateTranscript(cwd)
      if (isStale()) return
      if (file === null) {
        this.emitNull(terminalId)
        return
      }

      const parsed = await this.deps.parseTranscript(file)
      if (isStale()) return
      if (parsed === null) {
        this.emitNull(terminalId)
        return
      }

      // 4. Window detection + snapshot composition.
      const windowSize = await this.deps.detectWindowSize(parsed.modelId, parsed.usedTokens)
      if (isStale()) return

      const used = parsed.usedTokens
      const rawPercentage = windowSize > 0 ? (used / windowSize) * 100 : 0
      const payload: ClaudeStatusChangePayload = {
        terminalId,
        snapshot: {
          terminalId,
          modelId: parsed.modelId,
          friendlyName: friendlyModelName(parsed.modelId),
          windowSize,
          usedTokens: used,
          percent: clampPercent(used, windowSize),
          level: levelFor(rawPercentage),
          tooltip: `${kfmt(used)} / ${windowSize === 1000000 ? '1M' : '200k'}`
        }
      }

      // 5. Final generation re-check before the targeted send.
      if (isStale()) return
      this.emitTo(entry.webContentsId, payload)
    } catch (error) {
      // Fail-closed: any unexpected error hides the bar.
      logger.warn('ClaudeStatusService: refresh failed', {
        terminalId,
        error: error instanceof Error ? error.message : String(error)
      })
      if (!isStale()) this.emitNull(terminalId)
    }
  }

  /**
   * Idempotent teardown for a single terminal: cancels its debounce timer,
   * unwatches its dir, and removes the entry. Safe to call twice / on unknown id.
   * Does not emit (the panel is gone).
   */
  unregisterPanel(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = undefined
    }
    if (entry.watchedDir) {
      this.deps.watcher.unwatchDir(entry.watchedDir, terminalId)
      entry.watchedDir = undefined
    }
    this.entries.delete(terminalId)
  }

  /**
   * Tear down every terminal owned by `webContentsId` (window close / HMR, where
   * the renderer unmount may not fire).
   */
  cleanupForWebContentsId(webContentsId: number): void {
    const toRemove: string[] = []
    for (const [terminalId, entry] of this.entries) {
      if (entry.webContentsId === webContentsId) toRemove.push(terminalId)
    }
    for (const terminalId of toRemove) this.unregisterPanel(terminalId)
  }

  /** Dispose: clear all timers, close every watcher, and clear the map. */
  async dispose(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer)
        entry.debounceTimer = undefined
      }
    }
    await this.deps.watcher.closeAll()
    this.entries.clear()
  }

  /** Watch the transcript dir for `cwd`, re-targeting if the cwd changed. */
  private ensureWatching(terminalId: string, cwd: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return

    const dir = transcriptDirFor(cwd)
    if (entry.watchedDir === dir) return

    if (entry.watchedDir) {
      this.deps.watcher.unwatchDir(entry.watchedDir, terminalId)
    }
    this.deps.watcher.watchDir(dir, terminalId)
    entry.watchedDir = dir
  }

  /** Stop watching this terminal's dir (no claude / not running). */
  private ensureUnwatched(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry?.watchedDir) return
    this.deps.watcher.unwatchDir(entry.watchedDir, terminalId)
    entry.watchedDir = undefined
  }

  /** Emit a null snapshot (hide the bar) to a terminal's owning webContents. */
  private emitNull(terminalId: string): void {
    const entry = this.entries.get(terminalId)
    if (!entry) return
    this.emitTo(entry.webContentsId, { terminalId, snapshot: null })
  }

  /** Guarded targeted send. */
  private emitTo(webContentsId: number, payload: ClaudeStatusChangePayload): void {
    try {
      this.deps.emit(webContentsId, payload)
    } catch (error) {
      logger.warn('ClaudeStatusService: emit failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
