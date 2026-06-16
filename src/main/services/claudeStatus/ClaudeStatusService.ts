// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import { locateTranscriptCandidates, MAX_CANDIDATES } from './ClaudeTranscriptLocator'
import { parseTranscript, type ParsedTurn } from './ClaudeTranscriptParser'
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

/**
 * Max transcript candidates to parse per refresh before giving up. The locator
 * returns them newest-first; parsing stops at the first usable turn, so this only
 * needs to be deep enough to skip a metadata-only sidecar (or two) and reach the
 * real conversation file. Bound to the locator's own cap so every candidate it
 * returns is actually attempted (no silently-unreachable tail candidate).
 */
const MAX_PARSE_ATTEMPTS = MAX_CANDIDATES

/**
 * Why a refresh produced no visible bar. Diagnostic only — never shown to the
 * user; carried in logs so a hidden bar is no longer an indistinguishable silent
 * null (six causes used to collapse into one).
 */
type HideReason =
  | 'pid-unknown'
  | 'not-running'
  | 'cwd-rejected'
  | 'no-transcript'
  | 'no-usable-turn'
  | 'exception'

/** Displayed outcome of a refresh pass, for log-on-transition. */
type RefreshOutcome = 'shown' | HideReason

/** Injectable collaborators; defaults wire the real implementations. */
export interface ClaudeStatusDeps {
  /** Per-OS process detector keyed by PTY pid. */
  detector: IClaudeProcessDetector
  /**
   * Resolve eligible transcripts for a cwd, **newest-first** (empty if none).
   * `minMtimeMs` (the running claude's start time, when known) floors selection
   * so a fresh launch never resolves a prior session's transcript (#216). The
   * caller parses them in order and uses the first with a usable turn, so a
   * metadata-only sidecar that wins "newest" no longer hides the bar.
   */
  locateTranscripts: (cwd: string, minMtimeMs?: number) => Promise<string[]>
  /** Parse a transcript file into {modelId, usedTokens}, or null. */
  parseTranscript: (file: string) => Promise<ParsedTurn | null>
  /**
   * Detect the 200k/1M window for a model id + used-token count. `forceExtended`
   * (a fresh `/model …[1m]` override) forces the 1M window instantly. `opts`
   * threads the settings-cache seam (`settingsPath`/`now`) so the path is
   * injectable end-to-end from service tests with a controlled clock.
   */
  detectWindowSize: (
    modelId: string,
    used: number,
    forceExtended?: boolean,
    opts?: { settingsPath?: string; now?: () => number }
  ) => Promise<200000 | 1000000>
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
  /** Last displayed outcome, so a state CHANGE logs once (no per-pass spam). */
  lastOutcome?: RefreshOutcome
  /**
   * Sticky 1M-window bit (finding #5): set once the CURRENT model is detected at
   * 1M, so a post-compaction token reset (which would otherwise re-resolve to 200k
   * on a threshold-only session) cannot visibly shrink the badge. Scoped to
   * {@link windowModelId}: it is cleared the moment the model id changes or the
   * user explicitly drops `[1m]`, so a mid-session model switch (e.g. Opus 1M →
   * Sonnet 200k) downgrades immediately. Window DETECTION still runs every refresh
   * on the real token count; this only smooths the post-compaction dip for an
   * UNCHANGED model.
   */
  observedExtended?: boolean
  /** Model id the {@link observedExtended} sticky bit currently applies to. */
  windowModelId?: string
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
      locateTranscripts:
        deps?.locateTranscripts ??
        ((cwd, minMtimeMs) => locateTranscriptCandidates(cwd, { minMtimeMs })),
      parseTranscript: deps?.parseTranscript ?? ((file) => parseTranscript(file)),
      detectWindowSize:
        deps?.detectWindowSize ??
        ((modelId, used, forceExtended, opts) =>
          detectWindowSize(modelId, used, forceExtended, opts)),
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
      // A pid change means a new claude session — drop the sticky 1M bit (and the
      // model it applied to) so the window is re-detected from scratch (finding #5).
      if (existing.pid !== pid) {
        existing.observedExtended = undefined
        existing.windowModelId = undefined
      }
      // Clear any pending nudge debounce so its closure can't fire a refresh
      // against the just-superseded generation (finding #14).
      if (existing.debounceTimer) {
        clearTimeout(existing.debounceTimer)
        existing.debounceTimer = undefined
      }
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
        if (!isStale()) this.emitNull(terminalId, 'pid-unknown')
        return
      }

      const detection = await this.deps.detector.isClaudeRunning(entry.pid)
      if (isStale()) return
      if (!detection.running) {
        this.ensureUnwatched(terminalId)
        this.emitNull(terminalId, 'not-running')
        return
      }

      // 2. cwd = live process cwd, else spawn cwd; (re)target the watcher.
      const cwd = detection.cwd ?? entry.spawnCwd

      // Defense-in-depth (§10): reject a cwd carrying NUL / control chars /
      // newlines before it ever reaches path building or transcript location.
      // Fail-closed — hide the bar, never throw.
      if (hasControlChars(cwd)) {
        this.ensureUnwatched(terminalId)
        this.emitNull(terminalId, 'cwd-rejected')
        return
      }

      this.ensureWatching(terminalId, cwd)

      // 3. Locate candidates (newest-first) and parse them in order. Floor by the
      // running claude's start time so a fresh launch hides until its own session
      // writes a turn (#216). Selecting the first candidate that yields a usable
      // turn — rather than the single newest file — skips a metadata-only sidecar
      // (ai-title/last-prompt/mode) that wins "newest" but has no assistant turn.
      const candidates = await this.deps.locateTranscripts(cwd, detection.startedAtMs)
      if (isStale()) return
      if (candidates.length === 0) {
        this.emitNull(terminalId, 'no-transcript')
        return
      }

      let parsed: ParsedTurn | null = null
      let chosenFile: string | null = null
      const attempts = Math.min(candidates.length, MAX_PARSE_ATTEMPTS)
      for (let i = 0; i < attempts; i++) {
        const candidate = await this.deps.parseTranscript(candidates[i])
        if (isStale()) return
        if (candidate !== null) {
          parsed = candidate
          chosenFile = candidates[i]
          break
        }
      }
      if (parsed === null) {
        this.emitNull(terminalId, 'no-usable-turn')
        return
      }

      // 4. Window detection + snapshot composition. Detection runs on the REAL
      // (pre-compaction) token count so a >200k signal still upgrades to 1M.
      const detectedWindow = await this.deps.detectWindowSize(
        parsed.modelId,
        parsed.usedTokens,
        parsed.modelForcedExtended
      )
      if (isStale()) return

      // Invalidate the sticky 1M bit on any genuine model/mode change so a
      // mid-session switch (e.g. Opus 1M → Sonnet 200k) downgrades immediately:
      //  - the model id changed (a switch re-evaluates from scratch), or
      //  - the user explicitly selected standard mode (`/model …` without `[1m]`).
      if (entry.windowModelId !== parsed.modelId) {
        entry.observedExtended = false
        entry.windowModelId = parsed.modelId
      }
      if (parsed.modelForcedStandard) entry.observedExtended = false

      // Sticky 1M (finding #5), now scoped to the current model: once THIS model is
      // observed at 1M, keep it so a post-compaction token reset cannot shrink the
      // badge 1M→200k for the unchanged model. `entry` is the live object here
      // (isStale() above caught any re-registration).
      if (detectedWindow === 1000000) entry.observedExtended = true
      const windowSize: 200000 | 1000000 = entry.observedExtended ? 1000000 : detectedWindow

      const used = parsed.justCompacted ? 0 : parsed.usedTokens
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

      // 5. Final generation re-check, then re-fetch the live entry before the
      // targeted send so the emit can never target a since-removed panel even if
      // an await is later inserted before this point (finding #14).
      if (isStale()) return
      const live = this.entries.get(terminalId)
      if (!live) return
      this.recordOutcome(terminalId, 'shown', {
        pid: entry.pid,
        candidates: candidates.length,
        chosenFile: chosenFile ? path.basename(chosenFile) : undefined,
        windowSize,
        used
      })
      this.emitTo(live.webContentsId, payload)
    } catch (error) {
      // Fail-closed: any unexpected error hides the bar.
      logger.warn('ClaudeStatusService: refresh failed', {
        terminalId,
        error: error instanceof Error ? error.message : String(error)
      })
      if (!isStale()) this.emitNull(terminalId, 'exception')
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
    // Drop the detector's cached liveness for this PTY so the cache doesn't grow
    // unbounded as terminals open and close over a long session (finding #2).
    if (entry.pid !== undefined) this.deps.detector.forget?.(entry.pid)
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

  /**
   * Emit a null snapshot (hide the bar) to a terminal's owning webContents, with
   * a diagnostic `reason` recorded so the hide is no longer an indistinguishable
   * silent null.
   */
  private emitNull(terminalId: string, reason: HideReason): void {
    this.recordOutcome(terminalId, reason)
    const entry = this.entries.get(terminalId)
    if (!entry) return
    this.emitTo(entry.webContentsId, { terminalId, snapshot: null })
  }

  /**
   * Record the outcome of a refresh pass: one structured debug record per pass
   * (the decision boundary), plus an info-level log ONLY when the displayed state
   * changes (shown↔hidden-reason). The per-pass debug stays quiet at info, and
   * the transition log gives a free audit trail of why each bar flipped without
   * flooding the debounced refresh loop. Paths are logged as basenames only.
   */
  private recordOutcome(
    terminalId: string,
    outcome: RefreshOutcome,
    meta?: Record<string, unknown>
  ): void {
    logger.debug('claudeStatus.refresh', { terminalId, outcome, ...meta })
    const entry = this.entries.get(terminalId)
    if (entry && entry.lastOutcome !== outcome) {
      logger.info('claudeStatus.transition', {
        terminalId,
        from: entry.lastOutcome ?? 'init',
        to: outcome
      })
      entry.lastOutcome = outcome
    }
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
