// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One reload per comment write, and the reader put back
 * (docs/designs/html-preview-comments.md §7.5 steps 3, 5–6; M-040, M-041,
 * M-042, M-058).
 */
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { sha256Hex } from '../../../utils/atomicWriteBytesStrict'
import {
  createCommentReloadCoordinator,
  defaultHashOf,
  ECHO_WINDOW_MS,
  FALLBACK_RELOAD_MS,
  FRAME_RESTORE_WINDOW_MS,
  type ReloadCoordinatorDeps
} from './commentReloadCoordinator'
import { COMMENT_WORLD_ID, READ_SCROLL_SCRIPT } from './commentScripts'

const PAGE = '/p/index.html'
const OTHER = '/p/other.html'
const SCROLL = { x: 0, y: 1200, hash: '#pricing' }
const WRITE = { realPath: PAGE, fileHash: 'h-written', scroll: SCROLL, page: PAGE }

const committed = (filePath: string) => ({ reason: 'committed', load: { filePath } })

function harness(overrides: Partial<ReloadCoordinatorDeps> = {}) {
  let now = 0
  const timers: Array<{ run: () => void; at: number; cleared: boolean }> = []
  let page = PAGE
  const restoreAnswer = { value: true as unknown }
  const scripts: string[] = []
  const execute = vi.fn(async (world: number, [script]: { code: string }[]) => {
    expect(world).toBe(COMMENT_WORLD_ID)
    scripts.push(script.code)
    return script.code === READ_SCROLL_SCRIPT ? SCROLL : restoreAnswer.value
  })
  const reload = vi.fn()
  const hashOf = vi.fn(async (_path: string): Promise<string | undefined> => 'h-written')
  const coordinator = createCommentReloadCoordinator({
    contents: { executeJavaScriptInIsolatedWorld: execute },
    currentPage: () => page,
    reload,
    hashOf,
    now: () => now,
    setTimer: (run, ms) => {
      const timer = { run, at: now + ms, cleared: false }
      timers.push(timer)
      return timer as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: timer => {
      ;(timer as unknown as { cleared: boolean }).cleared = true
    },
    ...overrides
  })
  const advance = (ms: number): void => {
    now += ms
    for (const timer of timers) {
      if (!timer.cleared && timer.at <= now) {
        timer.cleared = true
        timer.run()
      }
    }
  }
  const restores = (): string[] => scripts.filter(code => code !== READ_SCROLL_SCRIPT)
  return {
    coordinator,
    execute,
    reload,
    hashOf,
    advance,
    restores,
    restoreAnswer,
    setPage: (next: string) => (page = next)
  }
}

/** Let the restore's promise chain settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('commentReloadCoordinator', () => {
  it('M-040 the watcher reload is the one reload; the restore runs at its did-finish-load', async () => {
    const h = harness()
    h.coordinator.arm(WRITE)
    h.advance(100)
    h.coordinator.reloadStarting()
    h.advance(FALLBACK_RELOAD_MS)
    expect(h.reload).not.toHaveBeenCalled()

    h.coordinator.pageLoadEnded(committed(PAGE))
    expect(h.restores()).toEqual([])
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.restores()).toHaveLength(1)
    expect(h.coordinator.stats()).toEqual({ reloads: 1, echoes: 0, lastRestore: 'restored' })
    // A later did-finish-load does not restore again.
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.restores()).toHaveLength(1)
  })

  it('M-040 with no watcher reload within 300 ms, the view reloads itself once', () => {
    const h = harness()
    h.coordinator.arm(WRITE)
    h.advance(FALLBACK_RELOAD_MS - 1)
    expect(h.reload).not.toHaveBeenCalled()
    h.advance(1)
    expect(h.reload).toHaveBeenCalledTimes(1)
    h.advance(FALLBACK_RELOAD_MS * 10)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('M-041 the restore puts back the hash and the scroll, clamped and quoted', async () => {
    const h = harness()
    h.coordinator.arm({ ...WRITE, scroll: { x: -5, y: 1e12, hash: '#a"b</script>' } })
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(PAGE))
    h.coordinator.didFinishLoad()
    await settle()
    const [script] = h.restores()
    expect(script).toContain('const x = 0, y = 10000000, hash = "#a\\"b</script>"')
  })

  it('M-041 a restore that cannot reach the place, or fails, says so', async () => {
    const h = harness()
    h.restoreAnswer.value = false
    h.coordinator.arm(WRITE)
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(PAGE))
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.coordinator.stats().lastRestore).toBe('unreached')

    const failing = harness()
    failing.execute.mockImplementation(async (_world, [script]) => {
      if (script.code === READ_SCROLL_SCRIPT) return SCROLL
      throw new Error('gone')
    })
    failing.coordinator.arm(WRITE)
    failing.coordinator.reloadStarting()
    failing.coordinator.pageLoadEnded(committed(PAGE))
    failing.coordinator.didFinishLoad()
    await settle()
    expect(failing.coordinator.stats().lastRestore).toBe('failed')
  })

  it('M-042 another page committing first (Back) drops the restore', async () => {
    const h = harness()
    h.coordinator.arm(WRITE)
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(OTHER))
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.restores()).toEqual([])
    expect(h.coordinator.stats().lastRestore).toBe('dropped')
  })

  it('M-042 a write whose pick was made on a page no longer on screen restores nothing', async () => {
    const h = harness()
    h.setPage(OTHER)
    h.coordinator.arm(WRITE)
    expect(h.coordinator.stats().lastRestore).toBe('dropped')
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(OTHER))
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.restores()).toEqual([])
  })

  it('M-042 a load that committed before any reload started is not the write\'s reload', async () => {
    const h = harness()
    h.coordinator.arm(WRITE)
    h.coordinator.pageLoadEnded(committed(PAGE))
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.restores()).toEqual([])
    // Only a committed end counts; a failed one changes nothing.
    h.coordinator.pageLoadEnded({ reason: 'failed', load: { filePath: PAGE } })
    expect(h.coordinator.stats().lastRestore).toBe('dropped')
  })

  it('M-058 one write is one reload: the write\'s own watcher echo is dropped', async () => {
    const h = harness()
    const record = vi.fn()
    h.coordinator.arm(WRITE)
    // Before its reload starts, the watcher change IS the reload's trigger.
    h.coordinator.filterChange(PAGE, record)
    expect(record).toHaveBeenCalledTimes(1)
    h.coordinator.reloadStarting()
    h.coordinator.filterChange(PAGE, record)
    await settle()
    expect(record).toHaveBeenCalledTimes(1)
    expect(h.coordinator.stats().echoes).toBe(1)
  })

  it('M-058 a real change after the write, another file, or a change after the echo window is recorded', async () => {
    const h = harness()
    const record = vi.fn()
    h.coordinator.arm(WRITE)
    h.coordinator.reloadStarting()

    h.hashOf.mockResolvedValueOnce('h-agent-edit')
    h.coordinator.filterChange(PAGE, record)
    await settle()
    expect(record).toHaveBeenCalledTimes(1)

    h.coordinator.filterChange('/p/style.css', record)
    expect(record).toHaveBeenCalledTimes(2)

    h.advance(ECHO_WINDOW_MS + 1)
    h.coordinator.filterChange(PAGE, record)
    expect(record).toHaveBeenCalledTimes(3)
  })

  it('M-058 with nothing armed every change is recorded at once', () => {
    const h = harness()
    const record = vi.fn()
    h.coordinator.filterChange(PAGE, record)
    expect(record).toHaveBeenCalledTimes(1)
    expect(h.hashOf).not.toHaveBeenCalled()
  })

  it('a frame write hands the frame its own scroll at its next hello, once, within the window', () => {
    const h = harness()
    const frameRestore = { realPath: '/p/frame.html', x: 3, y: 40 }
    h.coordinator.arm({ realPath: '/p/frame.html', fileHash: 'h', frameRestore })
    expect(h.coordinator.frameRestoreFor('/p/other.html')).toBeUndefined()
    expect(h.coordinator.frameRestoreFor('/p/frame.html')).toEqual({ x: 3, y: 40 })
    expect(h.coordinator.frameRestoreFor('/p/frame.html')).toBeUndefined()

    h.coordinator.arm({ realPath: '/p/frame.html', fileHash: 'h', frameRestore })
    h.advance(FRAME_RESTORE_WINDOW_MS + 1)
    expect(h.coordinator.frameRestoreFor('/p/frame.html')).toBeUndefined()
  })

  it('§19 Rev 4 the open sections go to the top frame\'s first hello after the write\'s reload commits the page – once', () => {
    const h = harness()
    const folded = { ...WRITE, scroll: { ...SCROLL, openSections: [0, 3] } }
    h.coordinator.arm(folded)
    // Before the reload commits, a hello is the old document's: nothing is due.
    expect(h.coordinator.sectionsFor(PAGE)).toBeUndefined()
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(PAGE))
    expect(h.coordinator.sectionsFor(PAGE)).toEqual([0, 3])
    expect(h.coordinator.sectionsFor(PAGE)).toBeUndefined()
    // An ordinary reload of the page later – an agent's edit – reopens nothing.
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(PAGE))
    expect(h.coordinator.sectionsFor(PAGE)).toBeUndefined()

    // A write that names no page (a frame's file): the hello's own file is the page.
    const unnamed = harness()
    unnamed.coordinator.arm({ realPath: PAGE, fileHash: 'h', scroll: { ...SCROLL, openSections: [1] } })
    unnamed.coordinator.reloadStarting()
    unnamed.coordinator.pageLoadEnded(committed(PAGE))
    expect(unnamed.coordinator.sectionsFor(PAGE)).toEqual([1])
  })

  it('§19 Rev 4 no sections for another page, a load before the reload, a write with none open, or a missed hello', () => {
    const folded = { ...WRITE, scroll: { ...SCROLL, openSections: [1] } }
    // Back to another page: dropped with the scroll (M-042).
    const back = harness()
    back.coordinator.arm(folded)
    back.coordinator.reloadStarting()
    back.coordinator.pageLoadEnded(committed(OTHER))
    expect(back.coordinator.sectionsFor(OTHER)).toBeUndefined()
    // A top frame that names another file: the one hand-out is spent on nothing.
    const stray = harness()
    stray.coordinator.arm(folded)
    stray.coordinator.reloadStarting()
    stray.coordinator.pageLoadEnded(committed(PAGE))
    expect(stray.coordinator.sectionsFor(OTHER)).toBeUndefined()
    expect(stray.coordinator.sectionsFor(PAGE)).toBeUndefined()
    // A load that committed before any reload started is not the write's reload.
    const early = harness()
    early.coordinator.arm(folded)
    early.coordinator.pageLoadEnded(committed(PAGE))
    early.coordinator.reloadStarting()
    early.coordinator.pageLoadEnded(committed(PAGE))
    expect(early.coordinator.sectionsFor(PAGE)).toBeUndefined()
    // The read found nothing open.
    const none = harness()
    none.coordinator.arm(WRITE)
    none.coordinator.reloadStarting()
    none.coordinator.pageLoadEnded(committed(PAGE))
    expect(none.coordinator.sectionsFor(PAGE)).toBeUndefined()
    // The reload's hello never came: the next commit is another load.
    const missed = harness()
    missed.coordinator.arm(folded)
    missed.coordinator.reloadStarting()
    missed.coordinator.pageLoadEnded(committed(PAGE))
    missed.coordinator.pageLoadEnded(committed(PAGE))
    expect(missed.coordinator.sectionsFor(PAGE)).toBeUndefined()
    // Nothing armed.
    expect(harness().coordinator.sectionsFor(PAGE)).toBeUndefined()
  })

  it('§19 Rev 4 reloadKeepingPlace keeps the open sections too', async () => {
    const h = harness()
    h.execute.mockResolvedValueOnce({ ...SCROLL, openSections: [2] })
    await h.coordinator.reloadKeepingPlace()
    h.coordinator.reloadStarting()
    h.coordinator.pageLoadEnded(committed(PAGE))
    expect(h.coordinator.sectionsFor(PAGE)).toEqual([2])
  })

  it('reads the top frame\'s scroll in world 996; a bad or failed read is no scroll', async () => {
    const h = harness()
    expect(await h.coordinator.captureScroll()).toEqual(SCROLL)
    h.execute.mockResolvedValueOnce({ x: Number.NaN, y: 0, hash: '' })
    expect(await h.coordinator.captureScroll()).toBeUndefined()
    h.execute.mockRejectedValueOnce(new Error('destroyed'))
    expect(await h.coordinator.captureScroll()).toBeUndefined()
  })

  it('reloadKeepingPlace reloads now and restores the place, with no echo to drop', async () => {
    const h = harness()
    await h.coordinator.reloadKeepingPlace()
    expect(h.reload).toHaveBeenCalledTimes(1)
    h.coordinator.reloadStarting()
    const record = vi.fn()
    h.coordinator.filterChange(PAGE, record)
    expect(record).toHaveBeenCalledTimes(1)
    h.coordinator.pageLoadEnded(committed(PAGE))
    h.coordinator.didFinishLoad()
    await settle()
    expect(h.restores()).toHaveLength(1)
    // No fallback timer was armed.
    h.advance(FALLBACK_RELOAD_MS * 2)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('dispose cancels the fallback and drops an echo check still reading', async () => {
    const h = harness()
    const record = vi.fn()
    h.coordinator.arm(WRITE)
    h.coordinator.reloadStarting()
    h.hashOf.mockResolvedValueOnce('h-other')
    h.coordinator.filterChange(PAGE, record)
    h.coordinator.dispose()
    await settle()
    expect(record).not.toHaveBeenCalled()

    const fresh = harness()
    fresh.coordinator.arm(WRITE)
    fresh.coordinator.dispose()
    fresh.advance(FALLBACK_RELOAD_MS)
    expect(fresh.reload).not.toHaveBeenCalled()
    fresh.coordinator.arm(WRITE)
    fresh.advance(FALLBACK_RELOAD_MS)
    expect(fresh.reload).not.toHaveBeenCalled()
    await fresh.coordinator.reloadKeepingPlace()
    expect(fresh.reload).not.toHaveBeenCalled()
  })

  it('L4 the default hash read is the writer\'s: a hard-linked or oversized file, or a link, is never an echo', async ({ skip }) => {
    const { link, mkdtemp, symlink, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'erfana-coord-'))
    try {
      const plain = join(dir, 'plain.html')
      await writeFile(plain, 'x')
      expect(await defaultHashOf(plain)).toBe(sha256Hex(Buffer.from('x')))
      const big = join(dir, 'big.html')
      await writeFile(big, Buffer.alloc(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1, 0x61))
      expect(await defaultHashOf(big)).toBeUndefined()
      const linked = join(dir, 'linked.html')
      await writeFile(linked, 'y')
      await link(linked, join(dir, 'second-name.html'))
      expect(await defaultHashOf(linked)).toBeUndefined()
      try {
        await symlink(plain, join(dir, 'symlink.html'))
      } catch {
        skip('symlinks are not available here')
      }
      expect(await defaultHashOf(join(dir, 'symlink.html'))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the default hash read answers for a real file and nothing for a missing one', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'erfana-coord-'))
    try {
      const file = join(dir, 'a.html')
      await writeFile(file, 'x')
      const h = harness({ hashOf: undefined })
      const record = vi.fn()
      h.coordinator.arm({ realPath: file, fileHash: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' })
      h.coordinator.reloadStarting()
      h.coordinator.filterChange(file, record)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(record).not.toHaveBeenCalled()
      h.coordinator.arm({ realPath: join(dir, 'gone.html'), fileHash: 'h' })
      h.coordinator.reloadStarting()
      h.coordinator.filterChange(join(dir, 'gone.html'), record)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(record).toHaveBeenCalledTimes(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
