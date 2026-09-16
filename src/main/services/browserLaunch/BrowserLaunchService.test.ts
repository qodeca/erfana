// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The seven checks of `BrowserLaunchService.openFile` (issue #124, part 4
 * §4.2), on a real temporary project: what `realpath` does with a link is the
 * point, and a mock cannot prove it. The launcher is a fake – no browser runs.
 *
 * Checks 5 and 6 are pinned (RX1): a link `a.html` → `x.sh` is NOT_HTML, and a
 * folder named `x.html` is MISSING.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import {
  BrowserOpenFileResponseSchema,
  type BrowserOpenErrorCode
} from '../../../shared/ipc/browser-schema'
import type { BrowserLauncher, BrowserLaunchResult } from './browserLauncher'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

const mockResolveLauncher = vi.fn()
vi.mock('./browserLauncher', () => ({
  resolveLauncher: (...args: unknown[]) => mockResolveLauncher(...args)
}))

const { BrowserLaunchService, browserLaunchService, namesAlternateDataStream } = await import(
  './BrowserLaunchService'
)

const skipOnWindows = process.platform === 'win32'

let project: string
let outside: string
let open: ReturnType<typeof vi.fn<(realPath: string) => Promise<BrowserLaunchResult>>>
let service: InstanceType<typeof BrowserLaunchService>

function refused(code: BrowserOpenErrorCode): unknown {
  return { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
}

function file(dir: string, name: string, content = '<!doctype html>'): string {
  const target = join(dir, name)
  writeFileSync(target, content)
  return target
}

beforeEach(() => {
  vi.clearAllMocks()
  project = mkdtempSync(join(tmpdir(), 'erfana-browser-project-'))
  outside = mkdtempSync(join(tmpdir(), 'erfana-browser-outside-'))
  open = vi.fn(async () => ({ ok: true, usedFallback: false }) as BrowserLaunchResult)
  const launcher: BrowserLauncher = { open }
  service = new BrowserLaunchService({ resolveLauncher: () => launcher })
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('check 1 – a project is open', () => {
  it('refuses with NO_PROJECT and launches nothing', async () => {
    const page = file(project, 'index.html')
    expect(await service.openFile(page, null)).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_NO_PROJECT))
    expect(open).not.toHaveBeenCalled()
  })
})

describe('check 2 – the requested name is .html or .htm', () => {
  it.each(['notes.md', 'run.sh', 'page.xhtml', 'page.html.sh', 'page.html '])(
    'refuses %s with NOT_HTML',
    async name => {
      const target = file(project, name)
      expect(await service.openFile(target, project)).toEqual(
        refused(ErrorCode.OPEN_IN_BROWSER_NOT_HTML)
      )
      expect(open).not.toHaveBeenCalled()
    }
  )

  it.each(['a.html', 'b.htm', 'C.HTML', 'd.Htm'])('accepts %s, any case', async name => {
    const target = file(project, name)
    expect(await service.openFile(target, project)).toEqual({ success: true, usedFallback: false })
    expect(open).toHaveBeenCalledWith(await realpath(target))
  })

  it('runs before the project check: an outside non-HTML file is NOT_HTML', async () => {
    const target = file(outside, 'notes.md')
    expect(await service.openFile(target, project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_NOT_HTML)
    )
  })
})

describe('check 3 – lexically inside the project', () => {
  it('refuses a file in another folder with OUTSIDE_PROJECT', async () => {
    const target = file(outside, 'index.html')
    expect(await service.openFile(target, project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT)
    )
    expect(open).not.toHaveBeenCalled()
  })

  it('refuses traversal out of the project', async () => {
    file(outside, 'index.html')
    const traversal = join(project, '..', outside.split(/[\\/]/).pop()!, 'index.html')
    expect(await service.openFile(traversal, project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT)
    )
  })

  it('refuses a sibling whose name extends the project folder', async () => {
    const sibling = `${project}-evil`
    mkdirSync(sibling)
    try {
      const target = file(sibling, 'index.html')
      expect(await service.openFile(target, project)).toEqual(
        refused(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT)
      )
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })
})

describe('check 4 – canonically inside the project', () => {
  it('refuses a missing file with MISSING', async () => {
    expect(await service.openFile(join(project, 'gone.html'), project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_MISSING)
    )
    expect(open).not.toHaveBeenCalled()
  })

  it.skipIf(skipOnWindows)('refuses a link inside that points outside with OUTSIDE_PROJECT', async () => {
    const target = file(outside, 'secret.html')
    const link = join(project, 'innocent.html')
    symlinkSync(target, link, 'file')
    expect(await service.openFile(link, project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT)
    )
    expect(open).not.toHaveBeenCalled()
  })

  it.skipIf(skipOnWindows)('refuses an unverifiable path with OUTSIDE_PROJECT', async () => {
    // A regular file used as a folder makes realpath fail with ENOTDIR.
    const notAFolder = file(project, 'plain.txt', 'x')
    expect(await service.openFile(join(notAFolder, 'x.html'), project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT)
    )
  })
})

describe('check 5 – the real name is .html or .htm too (RX1)', () => {
  it.skipIf(skipOnWindows)('refuses a link a.html → x.sh with NOT_HTML', async () => {
    const script = file(project, 'x.sh', '#!/bin/sh\necho hi\n')
    const link = join(project, 'a.html')
    symlinkSync(script, link, 'file')

    expect(await service.openFile(link, project)).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_NOT_HTML))
    expect(open).not.toHaveBeenCalled()
  })
})

describe('check 6 – the real path is a regular file (RX1)', () => {
  it('refuses a folder named x.html with MISSING', async () => {
    const folder = join(project, 'x.html')
    mkdirSync(folder)
    expect(await service.openFile(folder, project)).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_MISSING))
    expect(open).not.toHaveBeenCalled()
  })

  it('refuses a file that is gone between realpath and stat with MISSING', async () => {
    const page = file(project, 'index.html')
    const racing = new BrowserLaunchService({
      resolveLauncher: () => ({ open }),
      stat: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    })
    expect(await racing.openFile(page, project)).toEqual(refused(ErrorCode.OPEN_IN_BROWSER_MISSING))
    expect(open).not.toHaveBeenCalled()
  })
})

describe('Windows – an NTFS stream is not an .html file (QG-7 S6)', () => {
  /** The service under one platform's rules, on any host. */
  const on = (platform: NodeJS.Platform): InstanceType<typeof BrowserLaunchService> =>
    new BrowserLaunchService({ resolveLauncher: () => ({ open }), platform })

  it.each([
    ['a drive path', 'C:\\p\\tool.exe:x.html', true],
    ['a long drive path', '\\\\?\\C:\\p\\tool.exe:x.html', true],
    ['a long UNC path', '\\\\?\\UNC\\server\\share\\tool.exe:x.html', true],
    ['a plain drive path', 'C:\\p\\a.html', false],
    ['a plain long drive path', '\\\\?\\C:\\p\\a.html', false],
    ['a UNC path', '\\\\server\\share\\a.html', false]
  ])('%s: %s names a stream: %s', (_label, filePath, expected) => {
    expect(namesAlternateDataStream(filePath)).toBe(expected)
  })

  it('refuses C:\\p\\tool.exe:x.html with NOT_HTML, before the disk is read', async () => {
    expect(await on('win32').openFile('C:\\p\\tool.exe:x.html', 'C:\\p')).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_NOT_HTML)
    )
    expect(open).not.toHaveBeenCalled()
  })

  it('lets C:\\p\\a.html past the name check', async () => {
    // Where it stops next depends on the host's path rules, never on its name.
    expect(await on('win32').openFile('C:\\p\\a.html', 'C:\\p')).not.toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_NOT_HTML)
    )
  })

  it('opens a page with no stream under the Windows rules', async () => {
    const page = file(project, 'index.html')
    expect(await on('win32').openFile(page, project)).toEqual({ success: true, usedFallback: false })
    expect(open).toHaveBeenCalledWith(await realpath(page))
  })

  it.skipIf(skipOnWindows)('refuses a real path that carries a stream (check 5)', async () => {
    const stream = file(project, 'tool.exe:x.html')
    const link = join(project, 'a.html')
    symlinkSync(stream, link, 'file')

    expect(await on('win32').openFile(link, project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_NOT_HTML)
    )
    expect(open).not.toHaveBeenCalled()
  })

  it.skipIf(skipOnWindows).each<NodeJS.Platform>(['darwin', 'linux'])(
    'leaves a:b.html alone on %s',
    async platform => {
      const page = file(project, 'a:b.html')
      expect(await on(platform).openFile(page, project)).toEqual({ success: true, usedFallback: false })
      expect(open).toHaveBeenCalledWith(await realpath(page))
    }
  )
})

describe('check 7 – the launch', () => {
  it('launches the REAL path, not the requested one', async () => {
    const page = file(project, 'index.html')
    await service.openFile(page, project)
    // On macOS the temp folder itself is an alias (/var → /private/var).
    expect(open).toHaveBeenCalledWith(await realpath(page))
  })

  it.skipIf(skipOnWindows)('launches the target of an in-project link, never the link', async () => {
    mkdirSync(join(project, 'real'))
    const target = file(join(project, 'real'), 'page.html')
    const link = join(project, 'alias.html')
    symlinkSync(target, link, 'file')

    expect(await service.openFile(link, project)).toEqual({ success: true, usedFallback: false })
    expect(open).toHaveBeenCalledWith(await realpath(target))
  })

  it('passes the fallback flag on', async () => {
    open.mockResolvedValue({ ok: true, usedFallback: true })
    const page = file(project, 'index.html')
    expect(await service.openFile(page, project)).toEqual({ success: true, usedFallback: true })
  })

  it('answers LAUNCH_FAILED when the launcher reports a failure', async () => {
    open.mockResolvedValue({ ok: false, stage: 'browser', cause: 'exit 1' })
    const page = file(project, 'index.html')
    expect(await service.openFile(page, project)).toEqual(
      refused(ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED)
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Open in browser: launch failed',
      expect.objectContaining({ stage: 'browser', cause: 'exit 1' })
    )
  })

  it('opens a file with spaces and non-ASCII characters in its name', async () => {
    const page = file(project, 'My Page zażółć.html')
    expect(await service.openFile(page, project)).toEqual({ success: true, usedFallback: false })
    expect(open).toHaveBeenCalledWith(await realpath(page))
  })
})

describe('what leaves the service', () => {
  it('every answer matches the wire schema', async () => {
    const page = file(project, 'index.html')
    const answers = [
      await service.openFile(page, project),
      await service.openFile(page, null),
      await service.openFile(join(project, 'gone.html'), project),
      await service.openFile(file(outside, 'o.html'), project)
    ]
    for (const answer of answers) {
      expect(BrowserOpenFileResponseSchema.safeParse(answer).success).toBe(true)
    }
  })

  it('never logs the project folder – only the redacted file name', async () => {
    open.mockResolvedValue({ ok: false, stage: 'fallback', cause: 'refused' })
    await service.openFile(file(project, 'index.html'), project)
    await service.openFile(file(outside, 'o.html'), project)
    await service.openFile(join(project, 'gone.html'), project)

    const logged = JSON.stringify([...mockLogger.warn.mock.calls, ...mockLogger.info.mock.calls])
    expect(logged).toContain('[redacted]/index.html')
    expect(logged).not.toContain(project)
    expect(logged).not.toContain(await realpath(project))
  })
})

describe('the default collaborators', () => {
  it('resolves the launcher on every call, so a runtime seam is seen', async () => {
    mockResolveLauncher.mockReturnValue({ open })
    const page = file(project, 'index.html')

    await browserLaunchService.openFile(page, project)
    await browserLaunchService.openFile(page, project)

    expect(mockResolveLauncher).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledTimes(2)
  })
})
