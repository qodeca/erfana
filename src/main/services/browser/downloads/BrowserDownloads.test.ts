// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Downloads from browser tabs (spec 025, 025-FR-020, S-18): the save dialog in
 * the Downloads folder, cancel, finished and failed notices, partial files
 * deleted, downloads that outlive their tab, and "several files".
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const fsHooks = vi.hoisted(() => ({ renameError: null as NodeJS.ErrnoException | null, copyError: null as NodeJS.ErrnoException | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (fsHooks.renameError !== null) throw fsHooks.renameError
      return real.rename(from, to)
    },
    copyFile: async (from: string, to: string) => {
      if (fsHooks.copyError !== null) {
        writeFileSync(to, 'half')
        throw fsHooks.copyError
      }
      return real.copyFile(from, to)
    }
  }
})
vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import { NoticeEventSchema, StripEventSchema, type NoticeEvent, type StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { STRIP_INPUT_GUARD_MS, TabStrip } from '../permissions/tabStrip'
import {
  BrowserDownloads,
  MAX_REMEMBERED_DOWNLOADS,
  SEVERAL_FILES_TEXT,
  failureOf,
  isInsideErfanaFolder,
  type DownloadItemLike,
  type DownloadTab,
  type SaveDialogRequest
} from './BrowserDownloads'

class FakeItem extends EventEmitter implements DownloadItemLike {
  savePath = ''
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' = 'progressing'
  paused = false
  constructor(
    private readonly name: string,
    private readonly gesture = false
  ) {
    super()
  }
  getFilename = (): string => this.name
  setSavePath = vi.fn((path: string) => {
    this.savePath = path
  })
  hasUserGesture = (): boolean => this.gesture
  pause = vi.fn(() => {
    this.paused = true
  })
  resume = vi.fn(() => {
    this.paused = false
  })
  cancel = vi.fn(() => {
    // Chromium cancels an interrupted (resumable) download too: it ends `cancelled`.
    if (this.state === 'interrupted') {
      this.state = 'cancelled'
      this.emit('done', {}, 'cancelled')
      return
    }
    this.end('cancelled')
  })
  getState = (): FakeItem['state'] => this.state
  /** The connection dropped and Chromium could resume: Electron sends `updated`, never `done`. */
  interruptResumable(): void {
    this.state = 'interrupted'
    this.emit('updated', {}, 'interrupted')
  }
  /** Chromium writes the partial file and its `.crdownload` next to the save path. */
  receive(): void {
    writeFileSync(`${this.savePath}.crdownload`, 'part')
  }
  end(state: 'completed' | 'cancelled' | 'interrupted'): void {
    if (this.state !== 'progressing') return
    if (state === 'completed') writeFileSync(this.savePath, 'file body')
    this.state = state
    this.emit('done', {}, state)
  }
}

let base: string
let downloadsDir: string
let stagingRoot: string
let clock: TestClock
let strip: TabStrip
let stripEvents: StripEvent[]
let notices: NoticeEvent[]
let dialogAnswer: (defaultPath: string) => Promise<string | null>
let showSaveDialog: Mock<(parent: unknown, request: SaveDialogRequest) => Promise<string | null>>
let showItemInFolder: Mock<(path: string) => void>
let downloads: BrowserDownloads
let tab: DownloadTab
let tabOpen: boolean
const WINDOW = { id: 7 }

beforeEach(() => {
  fsHooks.renameError = null
  fsHooks.copyError = null
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-dl-')))
  downloadsDir = join(base, 'Downloads')
  stagingRoot = join(base, 'tmp')
  mkdirSync(downloadsDir)
  mkdirSync(stagingRoot)
  clock = createManualClock(0)
  stripEvents = []
  notices = []
  strip = new TabStrip({ tabId: 'browser-tab-1', clock, emit: (e) => stripEvents.push(e), newId: () => 'row1' })
  dialogAnswer = async (defaultPath) => defaultPath
  showSaveDialog = vi.fn((_parent: unknown, request: SaveDialogRequest) => dialogAnswer(request.defaultPath))
  showItemInFolder = vi.fn<(path: string) => void>()
  let n = 0
  downloads = new BrowserDownloads({
    downloadsDir: () => downloadsDir,
    stagingRoot: () => stagingRoot,
    showSaveDialog,
    showItemInFolder,
    newId: () => `dl${++n}`
  })
  tabOpen = true
  tab = {
    tabId: 'browser-tab-1',
    windowId: 7,
    strip,
    load: { started: 0, decision: null },
    isOpen: () => tabOpen,
    requester: () => ({ origin: { kind: 'web', scheme: null, subdomain: '', registrableDomain: 'photos.test', port: null, punycode: false }, inside: null }),
    notice: (e) => notices.push(e),
    parentWindow: () => WINDOW
  }
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function start(item: FakeItem, from: DownloadTab | null = tab): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() }
  downloads.willDownload(event, item, from)
  return event
}

describe('BrowserDownloads', () => {
  it('025-AC-020 opens the save dialog in the Downloads folder with the sanitised name, then saves and notifies', async () => {
    const item = new FakeItem('../../evil\u202Etxt.exe')
    start(item)
    expect(item.savePath.startsWith(join(stagingRoot, 'erfana-download-'))).toBe(true)
    expect(item.savePath.endsWith('eviltxt.exe')).toBe(true)
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalled())
    expect(showSaveDialog).toHaveBeenCalledWith(WINDOW, {
      defaultPath: join(downloadsDir, 'eviltxt.exe'),
      title: 'This file can run programs on your computer',
      message: 'eviltxt.exe can run programs on your computer. Save it only if you trust the site it came from.'
    })
    item.receive()
    item.end('completed')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(readFileSync(join(downloadsDir, 'eviltxt.exe'), 'utf8')).toBe('file body')
    expect(notices).toEqual([
      { tabId: 'browser-tab-1', kind: 'downloadDone', text: 'Downloaded eviltxt.exe', download: { fileName: 'eviltxt.exe', downloadId: 'dl1', reason: null } }
    ])
    expect(NoticeEventSchema.safeParse(notices[0]).success).toBe(true)
    expect(readdirSync(stagingRoot)).toEqual([])
  })

  it('025-AC-020 a file that cannot run programs gets the plain dialog, with no warning', async () => {
    const item = new FakeItem('report.pdf')
    start(item)
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalled())
    expect(showSaveDialog).toHaveBeenCalledWith(WINDOW, { defaultPath: join(downloadsDir, 'report.pdf') })
    item.end('cancelled')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
  })

  it('025-AC-020 the dialog still opens, with the bare name, when the OS cannot name the Downloads folder', async () => {
    downloads = new BrowserDownloads({
      downloadsDir: () => {
        throw new Error("Failed to get 'downloads' path")
      },
      stagingRoot: () => stagingRoot,
      showSaveDialog,
      showItemInFolder,
      newId: () => 'dl1'
    })
    const chosen = join(base, 'report.pdf')
    dialogAnswer = async () => chosen
    const item = new FakeItem('report.pdf')
    start(item)
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalled())
    expect(showSaveDialog).toHaveBeenCalledWith(WINDOW, { defaultPath: 'report.pdf' })
    item.receive()
    item.end('completed')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(readFileSync(chosen, 'utf8')).toBe('file body')
    expect(notices.map((n) => n.kind)).toEqual(['downloadDone'])
  })

  it('025-AC-020 Show in folder works only from the window the download was announced to', async () => {
    const item = new FakeItem('a.pdf')
    start(item)
    item.end('completed')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(downloads.showInFolder(8, 'dl1')).toBe(false)
    expect(downloads.showInFolder(7, 'nope')).toBe(false)
    expect(downloads.showInFolder(7, 'dl1')).toBe(true)
    expect(showItemInFolder).toHaveBeenCalledWith(join(downloadsDir, 'a.pdf'))
  })

  it('025-AC-020 Cancel in the dialog cancels the download and leaves no file', async () => {
    dialogAnswer = async () => null
    const item = new FakeItem('a.pdf')
    start(item)
    item.receive()
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(item.cancel).toHaveBeenCalled()
    expect(existsSync(join(downloadsDir, 'a.pdf'))).toBe(false)
    expect(readdirSync(stagingRoot)).toEqual([])
    expect(notices).toEqual([])
  })

  it('a save dialog that fails counts as Cancel', async () => {
    dialogAnswer = async () => {
      throw new Error('no window')
    }
    const item = new FakeItem('a.pdf')
    start(item)
    await vi.waitFor(() => expect(item.cancel).toHaveBeenCalled())
    expect(item.cancel).toHaveBeenCalled()
    expect(notices).toEqual([])
  })

  it('025-AC-020 an interrupted download shows an error naming the file and deletes the partial and .crdownload files', async () => {
    const item = new FakeItem('a.pdf')
    start(item)
    item.receive()
    expect(readdirSync(dirname(item.savePath))).toEqual(['a.pdf.crdownload'])
    item.end('interrupted')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(notices).toEqual([
      {
        tabId: 'browser-tab-1',
        kind: 'downloadFailed',
        text: 'Couldn\u2019t download a.pdf. The download was interrupted. The partial file was deleted.',
        download: { fileName: 'a.pdf', downloadId: null, reason: 'interrupted' }
      }
    ])
    expect(existsSync(join(downloadsDir, 'a.pdf'))).toBe(false)
    expect(readdirSync(stagingRoot)).toEqual([])
  })

  it('025-AC-020 a dropped connection Chromium could resume (updated, no done) is cancelled, shows the interrupted error and deletes the partial files', async () => {
    const item = new FakeItem('dropped.bin')
    start(item)
    item.receive()
    item.interruptResumable()
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(item.cancel).toHaveBeenCalledTimes(1)
    expect(notices[0]).toEqual({
      tabId: 'browser-tab-1',
      kind: 'downloadFailed',
      text: 'Couldn’t download dropped.bin. The download was interrupted. The partial file was deleted.',
      download: { fileName: 'dropped.bin', downloadId: null, reason: 'interrupted' }
    })
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(existsSync(join(downloadsDir, 'dropped.bin'))).toBe(false)
    // A second `updated` with the same state does not cancel again.
    item.emit('updated', {}, 'interrupted')
    expect(item.cancel).toHaveBeenCalledTimes(1)
  })

  it('025-AC-020 a folder that cannot be written shows an error and leaves no file', async () => {
    dialogAnswer = async () => join(base, 'missing-folder', 'a.pdf')
    const item = new FakeItem('a.pdf')
    start(item)
    item.end('completed')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toEqual([]))
    expect(notices[0]).toMatchObject({ kind: 'downloadFailed', download: { fileName: 'a.pdf', reason: 'folderNotWritable' } })
    expect(notices[0].text).toContain('Erfana can\u2019t write to that folder.')
    expect(readdirSync(stagingRoot)).toEqual([])
  })

  it('copies across volumes, and deletes a half-copied target when the disk fills', async () => {
    fsHooks.renameError = Object.assign(new Error('cross-device'), { code: 'EXDEV' })
    const first = new FakeItem('a.pdf')
    start(first)
    first.end('completed')
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(readFileSync(join(downloadsDir, 'a.pdf'), 'utf8')).toBe('file body')
    expect(notices[0].kind).toBe('downloadDone')

    fsHooks.copyError = Object.assign(new Error('full'), { code: 'ENOSPC' })
    const second = new FakeItem('b.pdf', true)
    start(second)
    second.end('completed')
    await vi.waitFor(() => expect(notices).toHaveLength(2))
    expect(notices[1]).toMatchObject({ kind: 'downloadFailed', download: { fileName: 'b.pdf', reason: 'diskFull' } })
    expect(existsSync(join(downloadsDir, 'b.pdf'))).toBe(false)
  })

  it('S-18 refuses to save inside a .erfana folder', async () => {
    dialogAnswer = async () => join(base, 'project', '.Erfana', 'x', 'a.pdf')
    const item = new FakeItem('a.pdf')
    start(item)
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(item.cancel).toHaveBeenCalled()
    expect(notices[0]).toMatchObject({ kind: 'downloadFailed', download: { reason: 'refusedFolder' } })
    expect(notices[0].text).not.toContain('partial')
  })

  it('025-AC-020 a download continues when its tab closes; its notice carries no tab id', async () => {
    const item = new FakeItem('a.pdf')
    start(item)
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalled())
    tabOpen = false
    strip.dispose()
    item.end('completed')
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(existsSync(join(downloadsDir, 'a.pdf'))).toBe(true)
    expect(notices[0]).toMatchObject({ tabId: null, kind: 'downloadDone' })
  })

  it('025-AC-020 a second automatic download asks "This site wants to download several files"; Block starts nothing', async () => {
    start(new FakeItem('one.pdf'))
    const second = new FakeItem('two.pdf')
    start(second)
    expect(second.pause).toHaveBeenCalled()
    expect(stripEvents[0]).toMatchObject({ op: 'add', row: { kind: 'download', text: SEVERAL_FILES_TEXT, answers: ['block', 'allow'], requester: { origin: { registrableDomain: 'photos.test' } } } })
    expect(StripEventSchema.safeParse(stripEvents[0]).success).toBe(true)
    clock.advance(STRIP_INPUT_GUARD_MS)
    expect(strip.answer('row1', 'block')).toBe('accepted')
    await vi.waitFor(() => expect(readdirSync(stagingRoot)).toHaveLength(1))
    expect(second.cancel).toHaveBeenCalled()
    expect(showSaveDialog).toHaveBeenCalledTimes(1)
    expect(readdirSync(stagingRoot)).toHaveLength(1)

    const third = new FakeItem('three.pdf')
    start(third)
    await vi.waitFor(() => expect(third.cancel).toHaveBeenCalled())
    expect(third.cancel).toHaveBeenCalled()
    expect(stripEvents.filter((e) => e.op === 'add')).toHaveLength(1)
  })

  it('Allow on the several-files prompt resumes the download and holds for the rest of the page load', async () => {
    start(new FakeItem('one.pdf'))
    const second = new FakeItem('two.pdf')
    start(second)
    clock.advance(STRIP_INPUT_GUARD_MS)
    strip.answer('row1', 'allow')
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(2))
    expect(second.resume).toHaveBeenCalled()
    expect(showSaveDialog).toHaveBeenCalledTimes(2)
    const third = new FakeItem('three.pdf')
    start(third)
    expect(third.pause).not.toHaveBeenCalled()
  })

  it('a withdrawn several-files prompt (navigation) cancels the download', async () => {
    start(new FakeItem('one.pdf'))
    const second = new FakeItem('two.pdf')
    start(second)
    strip.withdrawAll()
    await vi.waitFor(() => expect(second.cancel).toHaveBeenCalled())
    expect(second.cancel).toHaveBeenCalled()
    expect(tab.load.decision).toBeNull()
  })

  it('a download the user started (a click) never asks', async () => {
    start(new FakeItem('one.pdf'))
    const second = new FakeItem('two.pdf', true)
    start(second)
    expect(second.pause).not.toHaveBeenCalled()
    expect(stripEvents).toEqual([])
  })

  it('cancels a download no browser tab started', () => {
    const item = new FakeItem('a.pdf')
    expect(start(item, null).preventDefault).toHaveBeenCalled()
    expect(item.setSavePath).not.toHaveBeenCalled()
  })

  it('cancels with an error notice when no staging folder can be made', () => {
    stagingRoot = join(base, 'no-such-dir')
    const item = new FakeItem('a.pdf')
    expect(start(item).preventDefault).toHaveBeenCalled()
    expect(notices[0]).toMatchObject({ kind: 'downloadFailed', download: { reason: 'interrupted' } })
  })

  it(`remembers the last ${MAX_REMEMBERED_DOWNLOADS} finished downloads for Show in folder`, async () => {
    for (let i = 0; i <= MAX_REMEMBERED_DOWNLOADS; i += 1) {
      const item = new FakeItem(`f${i}.txt`, true)
      start(item)
      item.end('completed')
    }
    await vi.waitFor(() => expect(notices).toHaveLength(MAX_REMEMBERED_DOWNLOADS + 1))
    expect(downloads.showInFolder(7, 'dl1')).toBe(false)
    expect(downloads.showInFolder(7, `dl${MAX_REMEMBERED_DOWNLOADS + 1}`)).toBe(true)
  })
})

describe('download helpers', () => {
  it.each([
    ['/Users/me/Downloads/a.pdf', false],
    ['/proj/.erfana/browser/a.pdf', true],
    ['C:\\proj\\.ERFANA\\a.pdf', true],
    ['/proj/.erfana', false]
  ])('isInsideErfanaFolder(%s) is %s', (path, expected) => {
    expect(isInsideErfanaFolder(path)).toBe(expected)
  })

  it('maps a full disk and every other write error', () => {
    expect(failureOf(Object.assign(new Error(), { code: 'ENOSPC' }))).toBe('diskFull')
    expect(failureOf(Object.assign(new Error(), { code: 'EDQUOT' }))).toBe('diskFull')
    expect(failureOf(Object.assign(new Error(), { code: 'EACCES' }))).toBe('folderNotWritable')
    expect(failureOf(null)).toBe('folderNotWritable')
  })
})
