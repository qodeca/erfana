// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PauseController } from '../utils/PauseController'
import { ThrottledWorker, AtomicSaveDetector } from './watcher'

// ---------------------------------------------------------------------------
// IPC capture
// ---------------------------------------------------------------------------
const sends: Array<{ id: number; channel: string; payload: unknown }> = []

vi.mock('electron', () => {
  const mkWin = (id: number) => ({
    isDestroyed: () => false,
    webContents: { id, send: (ch: string, p: any) => sends.push({ id, channel: ch, payload: p }) },
  })
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mkWin(1)])
    }
  }
})

// ---------------------------------------------------------------------------
// fs mocks – controlled via mockStatResult for per-test flexibility
// ---------------------------------------------------------------------------
let mockStatResult: 'exists' | 'missing' = 'missing'

vi.mock('fs', () => ({
  existsSync: vi.fn(() => mockStatResult === 'exists')
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn(() =>
    mockStatResult === 'exists'
      ? Promise.resolve({ isFile: () => true })
      : Promise.reject(new Error('ENOENT'))
  )
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a watched directory with REAL ThrottledWorker and AtomicSaveDetector
 * wired to the service's private processEvents method.
 */
function seedWatchedDirectory(svc: any, dirPath: string) {
  const fakeWatcher = { close: vi.fn(async () => {}) }

  const throttledWorker = new ThrottledWorker<any>(
    { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
    { onWork: (events: any) => (svc as any).processEvents(dirPath, events) }
  )

  const atomicSaveDetector = new AtomicSaveDetector()

  const watched = {
    dirPath,
    watcher: fakeWatcher,
    webContentsIds: new Set([1]),
    pauseController: new PauseController(),
    throttledWorker,
    atomicSaveDetector,
    version: svc.switchVersion
  }
  svc.watchedDirectories.set(dirPath, watched)
  return watched
}

/**
 * Extract the summary from the first send payload.
 */
function firstPayload(): any {
  return sends[0]?.payload
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('DirectoryWatcherService pipeline integration', () => {
  let svc: any

  beforeEach(async () => {
    vi.useFakeTimers()
    sends.length = 0
    mockStatResult = 'missing'

    const mod = await import('./DirectoryWatcherService')
    svc = mod.directoryWatcherService

    // Clear pending restarts and restart attempts from prior tests
    for (const timeout of svc.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()
  })

  afterEach(() => {
    // Dispose all watched directories to prevent test leakage
    for (const [, watched] of svc.watchedDirectories.entries()) {
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
    }
    svc.watchedDirectories.clear()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // AC-001: External file creation refreshes tree within 500ms
  // -------------------------------------------------------------------------
  describe('AC-001: External file creation refreshes tree within 500ms', () => {
    it('sends IPC after ThrottledWorker collection delay (75ms)', () => {
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'add', path: '/proj/newfile.md' })

      // Just before collection delay – nothing sent yet
      vi.advanceTimersByTime(74)
      expect(sends.length).toBe(0)

      // Cross the 75ms boundary
      vi.advanceTimersByTime(2)
      expect(sends.length).toBe(1)

      const payload = firstPayload() as any
      expect(sends[0].channel).toBe('directory-watch:changed')
      expect(payload.summary.add).toBe(1)
      // Total latency 76ms is well within 500ms budget
    })

    it('does not send IPC before collection delay', () => {
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'add', path: '/proj/newfile.md' })

      vi.advanceTimersByTime(50)
      expect(sends.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC-002: External file deletion refreshes tree within 500ms
  // -------------------------------------------------------------------------
  describe('AC-002: External file deletion refreshes tree within 500ms', () => {
    it('routes unlink through AtomicSaveDetector then sends IPC', async () => {
      mockStatResult = 'missing'
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'unlink', path: '/proj/file.md' })

      // AtomicSaveDetector fires at 100ms (async callback)
      await vi.advanceTimersByTimeAsync(100)

      // ThrottledWorker collection delay fires at +75ms
      await vi.advanceTimersByTimeAsync(80)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(sends[0].channel).toBe('directory-watch:changed')
      expect(payload.summary.unlink).toBe(1)
      // Total latency ~180ms < 500ms budget
    })
  })

  // -------------------------------------------------------------------------
  // AC-003: External directory creation refreshes tree within 500ms
  // -------------------------------------------------------------------------
  describe('AC-003: External directory creation refreshes tree within 500ms', () => {
    it('sends IPC for addDir event after collection delay', () => {
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'addDir', path: '/proj/newdir' })

      vi.advanceTimersByTime(76)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(sends[0].channel).toBe('directory-watch:changed')
      expect(payload.summary.addDir).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // In-place content modifications broadcast through directory-watch:changed
  //
  // Closes the gap where chokidar 'change' events (from fs.writeFile + similar
  // in-place writes by Monaco autosave, terminal commands, external editors)
  // were silently dropped because watcher.on('change', ...) was never wired.
  // useGitStatus.debouncedRefresh relies on directory-watch:changed to wake on
  // edits — without these events the Project Tree git badge never updated
  // until the user clicked manual refresh.
  // -------------------------------------------------------------------------
  describe('In-place content change events broadcast through directory-watch:changed', () => {
    it('routes a single change event through the pipeline and surfaces summary.change=1', () => {
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'change', path: '/proj/notes.md' })

      // Cross the ThrottledWorker collection window (75ms)
      vi.advanceTimersByTime(76)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(sends[0].channel).toBe('directory-watch:changed')
      expect(payload.summary.change).toBe(1)
      // Structural keys must be absent — this was a pure content edit
      expect(payload.summary.add).toBeUndefined()
      expect(payload.summary.unlink).toBeUndefined()
    })

    it('coalesces back-to-back change events on the same path into a single broadcast', () => {
      seedWatchedDirectory(svc, '/proj')

      // Simulate three rapid autosaves on the same file inside one collection window
      svc.queueEvent('/proj', { type: 'change', path: '/proj/notes.md' })
      svc.queueEvent('/proj', { type: 'change', path: '/proj/notes.md' })
      svc.queueEvent('/proj', { type: 'change', path: '/proj/notes.md' })

      vi.advanceTimersByTime(76)

      // EventCoalescer Rule 4: change+change → single change
      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(payload.summary.change).toBe(1)
      expect(payload.eventCount).toBe(1)
      // Confirms coalescedCount captures the two suppressed events
      expect(payload.originalEventCount).toBe(3)
      expect(payload.coalescedCount).toBe(2)
    })

    it('preserves cross-path events: add A + change B coalesce into one broadcast with both summary keys (lens-review Finding 9)', () => {
      // Realistic save burst: one file edited while another is created
      // (e.g., editor saves notes.md while a side terminal creates new.md).
      // EventCoalescer's per-path stack means both events survive into a
      // single broadcast — neither is suppressed by the other.
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'add', path: '/proj/new.md' })
      svc.queueEvent('/proj', { type: 'change', path: '/proj/notes.md' })

      vi.advanceTimersByTime(76)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(payload.summary.add).toBe(1)
      expect(payload.summary.change).toBe(1)
      expect(payload.eventCount).toBe(2)
    })

    it('applies EventCoalescer Rule 3: add + change on the same path → add only (lens-review Finding 9)', () => {
      // When a file is created then immediately written in the same window,
      // the change event collapses into the create — the renderer needs a
      // single "file appeared" signal, not "appeared then modified".
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'add', path: '/proj/x.md' })
      svc.queueEvent('/proj', { type: 'change', path: '/proj/x.md' })

      vi.advanceTimersByTime(76)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(payload.summary.add).toBe(1)
      expect(payload.summary.change).toBeUndefined()
      expect(payload.eventCount).toBe(1)
      // The change was coalesced away by Rule 3
      expect(payload.coalescedCount).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC-008: Rapid event coalescing (50 files)
  // -------------------------------------------------------------------------
  describe('AC-008: Rapid event coalescing (50 files)', () => {
    it('50 rapid add events produce a single IPC message', () => {
      seedWatchedDirectory(svc, '/proj')

      for (let i = 0; i < 50; i++) {
        svc.queueEvent('/proj', { type: 'add', path: `/proj/file${i}.md` })
      }

      vi.advanceTimersByTime(76)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(payload.eventCount).toBe(50)
    })

    it('all 50 files appear in the coalesced summary', () => {
      seedWatchedDirectory(svc, '/proj')

      for (let i = 0; i < 50; i++) {
        svc.queueEvent('/proj', { type: 'add', path: `/proj/file${i}.md` })
      }

      vi.advanceTimersByTime(76)

      const payload = firstPayload() as any
      expect(payload.summary.add).toBe(50)
    })

    it('completes well within 2 second budget', () => {
      seedWatchedDirectory(svc, '/proj')

      for (let i = 0; i < 50; i++) {
        svc.queueEvent('/proj', { type: 'add', path: `/proj/file${i}.md` })
      }

      vi.advanceTimersByTime(76)
      expect(sends.length).toBe(1)

      // Advancing further should not produce additional sends
      vi.advanceTimersByTime(2000)
      expect(sends.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC-013: Atomic save detection
  // -------------------------------------------------------------------------
  describe('AC-013: Atomic save detection', () => {
    it('unlink with file reappearance emits single change event', async () => {
      mockStatResult = 'exists'
      seedWatchedDirectory(svc, '/proj')

      svc.queueEvent('/proj', { type: 'unlink', path: '/proj/file.md' })

      // AtomicSaveDetector fires at 100ms, detects file exists, emits change
      await vi.advanceTimersByTimeAsync(110)

      // ThrottledWorker collection delay
      await vi.advanceTimersByTimeAsync(80)

      expect(sends.length).toBe(1)
      const payload = firstPayload() as any
      expect(payload.summary.change).toBe(1)
      expect(payload.summary.unlink).toBeUndefined()
    })

    it('rapid unlink+add coalesces correctly – file never appears deleted', async () => {
      mockStatResult = 'exists'
      seedWatchedDirectory(svc, '/proj')

      // unlink goes to AtomicSaveDetector (waits 100ms)
      svc.queueEvent('/proj', { type: 'unlink', path: '/proj/file.md' })
      // add goes directly to ThrottledWorker buffer
      svc.queueEvent('/proj', { type: 'add', path: '/proj/file.md' })

      // Timeline:
      //   t=0ms   : add buffered in ThrottledWorker, collection scheduled at t=75ms
      //   t=75ms  : ThrottledWorker fires batch 1 with [add] → IPC send #1 (add:1)
      //   t=100ms : AtomicSaveDetector fires, file exists → emits change to ThrottledWorker
      //   t=175ms : ThrottledWorker fires batch 2 with [change] → IPC send #2 (change:1)
      //
      // Two separate IPC messages are expected because the add event's collection
      // window closes (75ms) before the AtomicSaveDetector resolves (100ms).
      // The critical invariant is: NO send ever contains summary.unlink.

      // Advance past AtomicSaveDetector (100ms) + ThrottledWorker collection (75ms)
      await vi.advanceTimersByTimeAsync(200)

      expect(sends.length).toBe(2)

      // First send: the add event
      const firstSend = sends[0].payload as any
      expect(firstSend.summary.add).toBe(1)
      expect(firstSend.summary.unlink).toBeUndefined()

      // Second send: the change event (atomic save detected)
      const secondSend = sends[1].payload as any
      expect(secondSend.summary.change).toBe(1)
      expect(secondSend.summary.unlink).toBeUndefined()

      // Critical: no send ever contained an unlink event
      for (const s of sends) {
        const payload = s.payload as any
        expect(payload.summary.unlink).toBeUndefined()
      }
    })
  })

  // -------------------------------------------------------------------------
  // Pause guard – supports AC-010 proof at main process level
  // -------------------------------------------------------------------------
  describe('Pause guard drops events during internal operations', () => {
    it('drops events when PauseController is paused', () => {
      const watched = seedWatchedDirectory(svc, '/proj')

      watched.pauseController.pause()

      svc.queueEvent('/proj', { type: 'add', path: '/proj/file.md' })

      vi.advanceTimersByTime(200)
      expect(sends.length).toBe(0)
    })

    it('processes events after PauseController is resumed', () => {
      const watched = seedWatchedDirectory(svc, '/proj')

      watched.pauseController.pause()
      watched.pauseController.resume()

      svc.queueEvent('/proj', { type: 'add', path: '/proj/file.md' })

      vi.advanceTimersByTime(76)
      expect(sends.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // 016-NFR-001: Main-process-only latency budget (< 200 ms, virtual clock)
  //
  // The e2e counterpart (`e2e/directory-watcher.e2e.ts`) asserts a wider
  // platform-dependent ceiling (6 s on Windows, 2 s on POSIX) because the
  // real pipeline includes chokidar + Defender + UI reconciliation + IPC.
  // This integration test isolates the main-process portion under fake
  // timers so the NFR-001 regression signal is preserved even when the
  // e2e test's wider ceiling masks incremental slowdowns.
  // -------------------------------------------------------------------------
  describe('016-NFR-001: Main-process pipeline latency budget', () => {
    it('single file-add event reaches IPC within 200 ms virtual latency', () => {
      const NFR_001_MAIN_PROCESS_BUDGET_MS = 200
      seedWatchedDirectory(svc, '/proj')

      const startVirtual = Date.now()
      svc.queueEvent('/proj', { type: 'add', path: '/proj/file.md' })

      // Collection delay (75 ms) gates the first IPC send. Advance the
      // virtual clock in small increments to detect the exact crossing.
      let latencyMs = 0
      while (sends.length === 0 && latencyMs <= NFR_001_MAIN_PROCESS_BUDGET_MS) {
        vi.advanceTimersByTime(1)
        latencyMs = Date.now() - startVirtual
      }

      expect(sends.length).toBe(1)
      expect(latencyMs).toBeLessThan(NFR_001_MAIN_PROCESS_BUDGET_MS)
      // Typical pass: ~75-80 ms (ThrottledWorker collection delay + microtasks).
    })

    it('atomic-save detection (unlink→exists) reaches IPC within 200 ms virtual latency', async () => {
      const NFR_001_MAIN_PROCESS_BUDGET_MS = 200
      mockStatResult = 'exists'
      seedWatchedDirectory(svc, '/proj')

      const startVirtual = Date.now()
      svc.queueEvent('/proj', { type: 'unlink', path: '/proj/file.md' })

      // AtomicSaveDetector + ThrottledWorker = ~175 ms expected.
      // Advance in chunks until first IPC or budget exhaustion.
      let latencyMs = 0
      while (sends.length === 0 && latencyMs <= NFR_001_MAIN_PROCESS_BUDGET_MS) {
        await vi.advanceTimersByTimeAsync(5)
        latencyMs = Date.now() - startVirtual
      }

      expect(sends.length).toBe(1)
      expect(latencyMs).toBeLessThan(NFR_001_MAIN_PROCESS_BUDGET_MS)
      // Typical pass: ~175-185 ms (100 ms AtomicSave + 75 ms ThrottledWorker).
    })
  })
})
