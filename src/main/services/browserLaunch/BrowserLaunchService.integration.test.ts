// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Open in default browser" end to end in main (issue #124, WI-21; design
 * part 4 §4.1–§4.4 – acceptance P4-AC4), on real temporary folders with real
 * symlinks, for a project opened THROUGH A SYMLINKED FOLDER.
 *
 * Real: the `browser:openFile` handler behind the real process-wide gate and
 * the real `isTrustedSender`, the Zod contract, `fileService`'s project path,
 * `BrowserLaunchService`'s seven checks with `realpath` on the real disk, and
 * `resolveLauncher` with the default-browser lookup. Faked: Electron (`app`,
 * `shell`, `ipcMain`) and the last step – the launch goes to the e2e seam
 * (`ERFANA_E2E_BROWSER_SEAM=1` in an unpackaged build), so no browser and no
 * child process ever starts; one test runs the macOS command builder against
 * a fake `execFile`.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import { BROWSER_CHANNELS } from '../../../shared/ipc/browser-channels'
import {
  BrowserOpenFileResponseSchema,
  type BrowserOpenErrorCode
} from '../../../shared/ipc/browser-schema'

const mockLookup = vi.fn<(url: string) => Promise<{ path: string }>>()
const mockOpenPath = vi.fn<(filePath: string) => Promise<string>>()
const mockIpcHandle = vi.fn()
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getApplicationInfoForProtocol: (url: string) => mockLookup(url)
  },
  shell: { openPath: (filePath: string) => mockOpenPath(filePath) },
  ipcMain: { handle: (...args: unknown[]) => mockIpcHandle(...args), removeHandler: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
// The genuine sender predicates; `setupTests.main.ts` stubs them true.
vi.unmock('../../ipc/senderValidation')
const mockLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

const { registerBrowserHandlers } = await import('../../ipc/browser-handlers')
const { RENDERER_FILE_URL } = await import('../../ipc/senderValidation')
const { fileService } = await import('../FileService')
const { BrowserLaunchService } = await import('./BrowserLaunchService')
const { createBrowserLauncher, E2E_BROWSER_SEAM_ENV } = await import('./browserLauncher')

type Gated = (event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>
interface SeamCall {
  via: 'browser' | 'fallback'
  appPath: string | null
  filePath: string
}

const BROWSER_APP = '/Applications/Test Browser.app'
/** Linux never looks the default browser up: it goes straight to the `.html` app. */
const LOOKS_UP = process.platform === 'darwin'
const TRUSTED = { senderFrame: { url: RENDERER_FILE_URL, parent: null }, sender: { id: 7 } } as unknown as IpcMainInvokeEvent

const seam = vi.fn<(launch: SeamCall) => Promise<void>>()
const scope = globalThis as { __erfanaE2eBrowserLaunch?: unknown }
let gated: Gated
let base: string
let site: string
let realSite: string
/** The project as the user opened it: through the link, never resolved. */
let project: string

function refused(code: BrowserOpenErrorCode): unknown {
  return { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
}

function launchedAs(realPath: string): SeamCall {
  return LOOKS_UP
    ? { via: 'browser', appPath: BROWSER_APP, filePath: realPath }
    : { via: 'fallback', appPath: null, filePath: realPath }
}

async function openFile(filePath: string): Promise<unknown> {
  const response = await gated(TRUSTED, { filePath })
  expect(BrowserOpenFileResponseSchema.safeParse(response).success).toBe(true)
  return response
}

function file(dir: string, rel: string, content = '<!doctype html><title>page</title>'): void {
  writeFileSync(join(dir, rel), content)
}

beforeAll(() => {
  registerBrowserHandlers()
  gated = mockIpcHandle.mock.calls.find((call) => call[0] === BROWSER_CHANNELS.OPEN_FILE)![1]
})

describe.skipIf(process.platform === 'win32')('open in default browser (P4-AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Deliberately NOT realpath'd: on macOS the temp folder is itself behind `/var`.
    base = mkdtempSync(join(tmpdir(), 'erfana-browser-it-'))
    site = join(base, 'site')
    const outside = join(base, 'outside')
    mkdirSync(join(site, 'pages'), { recursive: true })
    mkdirSync(join(site, 'x.html'))
    mkdirSync(outside)
    for (const rel of ['index.html', 'my page ü.html', 'pages/real.html', 'UPPER.HTM']) file(site, rel)
    file(site, 'run.sh', '#!/bin/sh\necho hi\n')
    file(outside, 'page.html')
    symlinkSync(join(site, 'pages', 'real.html'), join(site, 'alias.html'))
    symlinkSync(join(outside, 'page.html'), join(site, 'escape.html'))
    symlinkSync(outside, join(site, 'outdir'), 'dir')
    symlinkSync(join(site, 'run.sh'), join(site, 'script.html'))
    symlinkSync(join(site, 'index.html'), join(site, 'page.sh'))
    symlinkSync(join(base, 'nowhere.html'), join(site, 'dangling.html'))
    symlinkSync(site, join(base, 'site-link'), 'dir')
    project = join(base, 'site-link')
    realSite = realpathSync.native(site)
    fileService.setProjectPath(project)

    process.env[E2E_BROWSER_SEAM_ENV] = '1'
    scope.__erfanaE2eBrowserLaunch = seam
    seam.mockResolvedValue(undefined)
    mockLookup.mockResolvedValue({ path: BROWSER_APP })
    mockOpenPath.mockResolvedValue('')
  })

  afterEach(() => {
    delete process.env[E2E_BROWSER_SEAM_ENV]
    delete scope.__erfanaE2eBrowserLaunch
    fileService.setProjectPath('')
    rmSync(base, { recursive: true, force: true })
  })

  describe('a project opened through a symlinked folder', () => {
    it('opens a page named in project space by launching its real path', async () => {
      expect(await openFile(join(project, 'index.html'))).toEqual({ success: true, usedFallback: !LOOKS_UP })
      expect(seam).toHaveBeenCalledExactlyOnceWith(launchedAs(join(realSite, 'index.html')))
    })

    it('launches the target of a link inside the project, never the link', async () => {
      await openFile(join(project, 'alias.html'))
      expect(seam).toHaveBeenCalledWith(launchedAs(join(realSite, 'pages', 'real.html')))
    })

    it('keeps a name with spaces and non-ASCII characters whole, and takes .HTM in any case', async () => {
      await openFile(join(project, 'my page ü.html'))
      await openFile(join(project, 'UPPER.HTM'))
      expect(seam.mock.calls.map(([call]) => call.filePath)).toEqual([
        join(realSite, 'my page ü.html'),
        join(realSite, 'UPPER.HTM')
      ])
    })

    it('refuses the same page named through the real folder – check 3 is lexical', async () => {
      // The renderer names files in project space (the tree, and `pageChanged`
      // since #124), so this is pinned rather than supported.
      expect(await openFile(join(realSite, 'index.html'))).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT))
      expect(seam).not.toHaveBeenCalled()
    })
  })

  describe('refusals, each before anything launches', () => {
    it.each([
      ['a link to a file outside the project', 'escape.html', ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT],
      ['a page behind a linked folder that leaves it', 'outdir/page.html', ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT],
      ['a climb out of the project', '../outside/page.html', ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT],
      ['a link named .html to a script (the real name is checked)', 'script.html', ErrorCode.OPEN_IN_BROWSER_NOT_HTML],
      ['a non-HTML name, even one that links to a page', 'page.sh', ErrorCode.OPEN_IN_BROWSER_NOT_HTML],
      ['a folder named x.html', 'x.html', ErrorCode.OPEN_IN_BROWSER_MISSING],
      ['a page that does not exist', 'missing.html', ErrorCode.OPEN_IN_BROWSER_MISSING],
      ['a dangling link', 'dangling.html', ErrorCode.OPEN_IN_BROWSER_MISSING]
    ])('refuses %s (%s)', async (_label, rel, code) => {
      expect(await openFile(join(project, rel))).toEqual(refused(code as BrowserOpenErrorCode))
      expect(seam).not.toHaveBeenCalled()
      expect(mockOpenPath).not.toHaveBeenCalled()
    })

    it('refuses with NO_PROJECT when no project is open', async () => {
      fileService.setProjectPath('')
      expect(await openFile(join(project, 'index.html'))).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_NO_PROJECT))
      expect(seam).not.toHaveBeenCalled()
    })
  })

  describe('the launch', () => {
    it('falls back to the .html app when the default-browser lookup fails', async () => {
      mockLookup.mockRejectedValue(new Error('no handler'))

      expect(await openFile(join(project, 'index.html'))).toEqual({ success: true, usedFallback: true })
      expect(seam).toHaveBeenCalledWith({ via: 'fallback', appPath: null, filePath: join(realSite, 'index.html') })
    })

    it('answers LAUNCH_FAILED when the launch fails, and no log line names the folder', async () => {
      seam.mockRejectedValue(Object.assign(new Error(`spawn failed: ${join(realSite, 'index.html')}`), { code: 'ENOENT' }))

      expect(await openFile(join(project, 'index.html'))).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED))
      const logged = JSON.stringify([mockLogger.info, mockLogger.warn, mockLogger.error].map((fn) => fn.mock.calls))
      expect(logged).not.toContain(realSite)
      expect(logged).not.toContain(project)
    })

    it('runs /usr/bin/open on macOS with the real path as one argument', async () => {
      const execFile = vi.fn(async (_file: string, _args: readonly string[]) => {})
      const launcher = createBrowserLauncher({
        platform: 'darwin',
        getApplicationInfoForProtocol: async () => ({ path: BROWSER_APP }),
        execFile
      })
      const service = new BrowserLaunchService({ resolveLauncher: () => launcher })

      expect(await service.openFile(join(project, 'my page ü.html'), project)).toEqual({ success: true, usedFallback: false })
      expect(execFile).toHaveBeenCalledExactlyOnceWith('/usr/bin/open', ['-a', BROWSER_APP, join(realSite, 'my page ü.html')])
    })
  })

  describe('senders', () => {
    it.each([
      ['a previewed page', { url: `erfana-preview://${'0'.repeat(32)}/index.html`, parent: null }],
      ['a subframe of the app renderer', { url: RENDERER_FILE_URL, parent: {} }]
    ])('refuses %s before the payload is read', (_label, frame) => {
      const event = { senderFrame: frame, sender: { id: 9 } } as unknown as IpcMainInvokeEvent
      expect(() => gated(event, { filePath: join(project, 'index.html') })).toThrow(/Untrusted sender/)
      expect(seam).not.toHaveBeenCalled()
    })

    it('refuses a payload outside the contract', async () => {
      expect(await gated(TRUSTED, { filePath: join(project, 'index.html'), extra: 1 })).toEqual(
        refused(ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST)
      )
      expect(seam).not.toHaveBeenCalled()
    })
  })
})
