// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A machine-wide readers–writer lock on OS keyboard focus for the e2e suite.
 *
 * Only one window on the machine can be the OS key window. Every test launches
 * its own Erfana, and `mainWindow.show()` activates the new app, so with two
 * workers each launch took key-window status from the other worker's app. A
 * test whose subject is native focus (pick mode, key routing, focus moving
 * into a page's `WebContentsView`) then saw its page blur with its window and
 * never get focus back.
 *
 * - A test that needs OS focus takes the lock EXCLUSIVE
 *   (`test.use({ needsOsFocus: true })`, or the {@link OS_FOCUS_TAG} tag on
 *   one test): no other e2e app is running while it
 *   does, so nothing else launches, shows or focuses a window under it.
 * - Every other test takes it SHARED, so those still run in parallel.
 * - Writers win: once an exclusive waiter is queued, no new shared holder gets
 *   in, so a focus test is not starved by a stream of short parallel tests.
 *
 * The lock lives in `os.tmpdir()`, not `.e2e-temp`, because focus is
 * per-session, not per-checkout: two worktrees running the suite at once
 * contend for the same key window.
 *
 * Every entry is a file named after the holding worker's PID. An entry whose
 * process is gone (a worker that crashed or was killed) is removed by the next
 * process that looks, so a dead holder cannot deadlock the run; a live holder
 * releases in fixture teardown, which Playwright runs on failure and timeout
 * too, and as a last resort on process exit.
 */

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, type ElectronApplication } from '@playwright/test'

export type OsFocusMode = 'shared' | 'exclusive'

/**
 * Tag for one test that needs OS focus, where `test.use({ needsOsFocus: true })`
 * would take a whole file or describe: `test('…', { tag: OS_FOCUS_TAG }, …)`.
 */
export const OS_FOCUS_TAG = '@os-focus'

/** Lock directory. Override with `ERFANA_E2E_FOCUS_LOCK_DIR` (the lock's own tests). */
export const OS_FOCUS_LOCK_DIR =
  process.env.ERFANA_E2E_FOCUS_LOCK_DIR ?? path.join(os.tmpdir(), 'erfana-e2e-os-focus')

/** Short critical section around reading and writing the entries. */
const MUTEX_DIR = 'mutex'
/** A mutex older than this was left by a process that died inside it. */
const MUTEX_STALE_MS = 10_000
/** How often a waiter looks again. */
/** How often a waiting request looks at the lock again. */
export const OS_FOCUS_LOCK_POLL_MS = 50

/**
 * How long a test waits for the lock. The longest wait is one other test of
 * the same run (the 60 s test timeout plus its teardown); the slack covers a
 * second checkout running the suite at the same time.
 */
export const OS_FOCUS_LOCK_WAIT_MS = 170_000

/** Separate fixture timeout, so waiting for the lock never eats the test's own 60 s. */
export const OS_FOCUS_LOCK_FIXTURE_TIMEOUT_MS = OS_FOCUS_LOCK_WAIT_MS + 10_000

interface Entry {
  readonly name: string
  readonly kind: 'shared' | 'exclusive' | 'waiting'
  readonly pid: number
  /** Queue order of a waiter (ms since epoch, then a random tiebreak). */
  readonly order: string
}

function parseEntry(name: string): Entry | null {
  const match = /^(shared|exclusive|waiting)\.(\d+)\.(\d+)\.([0-9a-f-]+)$/.exec(name)
  if (match === null) return null
  return {
    name,
    kind: match[1] as Entry['kind'],
    order: `${match[2].padStart(15, '0')}.${match[4]}`,
    pid: Number(match[3])
  }
}

function entryName(kind: Entry['kind'], pid: number): string {
  return `${kind}.${Date.now()}.${pid}.${randomUUID()}`
}

/** True while `pid` is a running process (EPERM: alive, owned by someone else). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function delay(ms: number): Promise<void> {
  // KNOWN_WAIT: lock poll interval – there is no cross-process event to await
  // for "another worker released the lock" (fs.watch is not reliable on every
  // platform the suite runs on). Bounded by OS_FOCUS_LOCK_WAIT_MS.
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Take the mutex directory, clearing one a dead process left behind. */
async function withMutex<T>(dir: string, body: () => T, deadline: number): Promise<T> {
  const mutex = path.join(dir, MUTEX_DIR)
  for (;;) {
    try {
      fs.mkdirSync(mutex)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      clearStaleMutex(mutex)
      if (Date.now() > deadline) throw new Error(`os-focus lock: mutex ${mutex} was never released`)
      await delay(OS_FOCUS_LOCK_POLL_MS)
      continue
    }
    try {
      fs.writeFileSync(path.join(mutex, 'owner'), String(process.pid))
      return body()
    } finally {
      fs.rmSync(mutex, { recursive: true, force: true })
    }
  }
}

function clearStaleMutex(mutex: string): void {
  try {
    const owner = Number(fs.readFileSync(path.join(mutex, 'owner'), 'utf-8'))
    if (Number.isInteger(owner) && owner > 0 && !isProcessAlive(owner)) {
      fs.rmSync(mutex, { recursive: true, force: true })
    }
  } catch {
    // No owner file yet: the owner is between mkdir and write, or died there.
    try {
      if (Date.now() - fs.statSync(mutex).mtimeMs > MUTEX_STALE_MS) {
        fs.rmSync(mutex, { recursive: true, force: true })
      }
    } catch {
      // Gone already – released between our checks.
    }
  }
}

/** Read the live entries, deleting every one whose process is gone. */
function liveEntries(dir: string): Entry[] {
  const live: Entry[] = []
  for (const name of fs.readdirSync(dir)) {
    const entry = parseEntry(name)
    if (entry === null) continue
    if (isProcessAlive(entry.pid)) live.push(entry)
    else fs.rmSync(path.join(dir, name), { force: true })
  }
  return live
}

function describeHolders(entries: readonly Entry[]): string {
  if (entries.length === 0) return 'none'
  return entries.map((e) => `${e.kind} pid ${e.pid}`).join(', ')
}

/** Files this process holds, removed synchronously if the process exits mid-test. */
const ownedFiles = new Set<string>()
let exitHookInstalled = false

function own(file: string): void {
  ownedFiles.add(file)
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on('exit', () => {
      for (const f of ownedFiles) fs.rmSync(f, { force: true })
    })
  }
}

function disown(file: string): void {
  fs.rmSync(file, { force: true })
  ownedFiles.delete(file)
}

export interface OsFocusLease {
  readonly mode: OsFocusMode
  release(): void
}

/**
 * Take the lock in `mode`, waiting (bounded) for the holders it conflicts with.
 *
 * @throws When the lock is not granted within `waitMs`, naming the holders.
 */
export async function acquireOsFocusLock(
  mode: OsFocusMode,
  options: { dir?: string; waitMs?: number } = {}
): Promise<OsFocusLease> {
  const dir = options.dir ?? OS_FOCUS_LOCK_DIR
  const deadline = Date.now() + (options.waitMs ?? OS_FOCUS_LOCK_WAIT_MS)
  fs.mkdirSync(dir, { recursive: true })

  // An exclusive request queues first, so new shared requests stop getting in.
  let waiting: string | null = null
  if (mode === 'exclusive') {
    waiting = path.join(dir, entryName('waiting', process.pid))
    const file = waiting
    await withMutex(dir, () => fs.writeFileSync(file, ''), deadline)
    own(waiting)
  }
  const myOrder = waiting === null ? null : parseEntry(path.basename(waiting))?.order ?? null

  try {
    let last: Entry[] = []
    for (;;) {
      const granted = await withMutex(
        dir,
        () => {
          const ownWaiting = waiting === null ? null : path.basename(waiting)
          const others = liveEntries(dir).filter((e) => e.name !== ownWaiting)
          last = others
          const blocked =
            mode === 'shared'
              ? others.some((e) => e.kind === 'exclusive' || e.kind === 'waiting')
              : others.some(
                  (e) =>
                    e.kind === 'shared' ||
                    e.kind === 'exclusive' ||
                    (e.kind === 'waiting' && myOrder !== null && e.order < myOrder)
                )
          if (blocked) return null
          const held = path.join(dir, entryName(mode, process.pid))
          fs.writeFileSync(held, '')
          own(held)
          if (waiting !== null) disown(waiting)
          return held
        },
        deadline
      )
      if (granted !== null) {
        return {
          mode,
          release: () => disown(granted)
        }
      }
      if (Date.now() > deadline) {
        throw new Error(
          `os-focus lock: no ${mode} lease within ${options.waitMs ?? OS_FOCUS_LOCK_WAIT_MS} ms ` +
            `(holders: ${describeHolders(last)}; dir ${dir})`
        )
      }
      await delay(OS_FOCUS_LOCK_POLL_MS)
    }
  } catch (error) {
    if (waiting !== null) disown(waiting)
    throw error
  }
}

/**
 * Move the app's first window so the OS mouse pointer is not over it.
 *
 * The real pointer is an input source too: wherever it rests, the view under
 * it gets real mouse events once the app is in front, so a built-in browser
 * page saw a hover the test never sent (pick mode highlighting `html` "before
 * the mouse reached the page"). Every launch opens the window at the same
 * centred spot, so a pointer parked there hit every test. Only the position
 * changes, never the size, so layouts are untouched.
 *
 * Tries each corner of each display's work area, then – on a screen too small
 * for any of them – a place partly off screen beside the pointer.
 *
 * @param required - Fail when no position avoids the pointer (tests that hold
 *   the exclusive lease); otherwise best effort.
 */
export async function movePointerOffWindow(app: ElectronApplication, required: boolean): Promise<void> {
  const result = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) return { clear: false, detail: 'no window' }
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const contains = (x: number, y: number): boolean =>
      c.x >= x && c.x < x + b.width && c.y >= y && c.y < y + b.height
    if (!contains(b.x, b.y)) return { clear: true, detail: 'already clear' }
    const candidates: Array<[number, number]> = []
    for (const { workArea: wa } of screen.getAllDisplays()) {
      if (b.width > wa.width || b.height > wa.height) continue
      for (const x of [wa.x, wa.x + wa.width - b.width]) {
        for (const y of [wa.y, wa.y + wa.height - b.height]) candidates.push([x, y])
      }
    }
    const here = screen.getDisplayNearestPoint(c).workArea
    candidates.push([c.x + 1, Math.max(here.y, b.y)], [c.x - b.width - 1, Math.max(here.y, b.y)])
    for (const [x, y] of candidates) {
      if (contains(x, y)) continue
      win.setPosition(x, y)
      const now = win.getBounds()
      if (!contains(now.x, now.y)) return { clear: true, detail: `moved to ${now.x},${now.y}` }
    }
    return { clear: false, detail: `pointer at ${c.x},${c.y}, window ${b.width}×${b.height}` }
  })
  if (required && !result.clear) {
    throw new Error(
      `the mouse pointer rests over the test window and no position avoids it (${result.detail}) – ` +
        'real mouse events would reach the page; park the pointer at a screen corner'
    )
  }
}

/** How long the OS gets to make the app the key window. */
const KEY_WINDOW_BUDGET_MS = 5_000

/**
 * Make the app's first window the OS key window and wait until it is, for a
 * test that holds the exclusive lease. FAILS naming the host when the OS will
 * not (a locked screen, an inactive session, or another application that
 * keeps itself in front), so a focus assertion never reports a host problem
 * as a product bug.
 */
export async function focusAppWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.focus()
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused() ?? false), {
      timeout: KEY_WINDOW_BUDGET_MS,
      message:
        'the OS would not make Erfana the key window (locked screen, inactive session, or another ' +
        'application holding the front?) – a test with needsOsFocus cannot run on this host'
    })
    .toBe(true)
}
