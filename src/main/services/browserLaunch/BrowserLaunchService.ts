// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Open in default browser" – the checks between a renderer-supplied path and
 * a real browser (issue #124, design part 4 §4.2), in this order:
 *
 * | # | Check | Refusal |
 * |---|---|---|
 * | 1 | a project is open | `NO_PROJECT` |
 * | 2 | the requested name ends `.html` or `.htm`, any case – and on Windows names no NTFS stream | `NOT_HTML` |
 * | 3 | lexically inside the project | `OUTSIDE_PROJECT` |
 * | 4 | canonically inside (`resolveInsideProject`) | `missing` → `MISSING`; otherwise `OUTSIDE_PROJECT` |
 * | 5 | the REAL name passes check 2 too (a link `a.html` → `x.sh` is refused) | `NOT_HTML` |
 * | 6 | the real path is a regular file (a folder named `x.html` is refused) | `MISSING` |
 * | 7 | the launcher starts it | `LAUNCH_FAILED` |
 *
 * On Windows, `C:\p\tool.exe:x.html` ends `.html` but names an alternate data
 * stream of `tool.exe`, not an HTML file (QG-7 S6). So a `:` after the drive
 * prefix – a leading `\\?\` stripped first – is refused, in the requested
 * path and in the real one.
 *
 * The launcher gets the REAL path – the one that was checked – so a link
 * repointed between check and launch does not decide what opens. No `#section`
 * is passed on: the request carries a file path, never an address.
 *
 * The preview's excluded-folder and gitignore rules do not apply: the tree
 * offers this for every `.html` / `.htm` file, even with HTML execution off
 * (settled product decision; accepted risk RX1, recorded in `docs/security.md`).
 *
 * Logs name files through `redactPath`; the renderer's toasts carry the full
 * name.
 */
import { stat } from 'fs/promises'
import { ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import type {
  BrowserOpenErrorCode,
  BrowserOpenFileResponse
} from '../../../shared/ipc/browser-schema'
import { isLexicallyInside, resolveInsideProject } from '../../utils/projectConfinement'
import { redactPath } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import { resolveLauncher, type BrowserLauncher } from './browserLauncher'

/** `.html` or `.htm` at the very end of the name, any case. */
const HTML_NAME = /\.html?$/i

/** The Win32 long-path prefix, `\\?\`, which may come before a drive letter. */
const LONG_PATH_PREFIX = '\\\\?\\'

/** A drive letter and its colon, `C:`, at the very start. */
const DRIVE_PREFIX = /^[A-Za-z]:/

/**
 * `true` when a Windows path names an NTFS alternate data stream: a `:` after
 * the drive prefix, with a leading `\\?\` stripped first. No Windows file
 * name holds a `:`, so nothing else such a colon could mean is lost. Applied on
 * win32 only: `a:b.html` is an ordinary name on macOS and Linux.
 */
export function namesAlternateDataStream(filePath: string): boolean {
  const rest = filePath.startsWith(LONG_PATH_PREFIX)
    ? filePath.slice(LONG_PATH_PREFIX.length)
    : filePath
  return rest.replace(DRIVE_PREFIX, '').includes(':')
}

/** Collaborators, injectable for tests. */
export interface BrowserLaunchServiceDeps {
  /** Picks the launcher per call, so the e2e seam can be installed at runtime. */
  resolveLauncher: () => BrowserLauncher
  /** `fs.stat`, for the regular-file check (6). */
  stat: (filePath: string) => Promise<{ isFile(): boolean }>
  /** `process.platform`, for the stream rule of checks 2 and 5; a test sets `win32` on any host. */
  platform: NodeJS.Platform
}

/** Build the single failure shape this channel returns. */
function failure(code: BrowserOpenErrorCode): BrowserOpenFileResponse {
  return { success: false, errorCode: code, error: ERROR_MESSAGES[code] }
}

export class BrowserLaunchService {
  private readonly deps: BrowserLaunchServiceDeps

  constructor(deps: Partial<BrowserLaunchServiceDeps> = {}) {
    this.deps = {
      resolveLauncher: () => resolveLauncher(),
      stat: filePath => stat(filePath),
      platform: process.platform,
      ...deps
    }
  }

  /**
   * Run checks 1–7 and open `filePath` in the default browser.
   *
   * Never rejects for a refusal or a failed launch; both come back as a code
   * plus its `ERROR_MESSAGES` text.
   */
  async openFile(filePath: string, projectPath: string | null): Promise<BrowserOpenFileResponse> {
    if (!projectPath) return this.refuse(ErrorCode.OPEN_IN_BROWSER_NO_PROJECT, filePath)
    if (!this.isHtmlName(filePath)) return this.refuse(ErrorCode.OPEN_IN_BROWSER_NOT_HTML, filePath)
    if (!isLexicallyInside(filePath, projectPath)) {
      return this.refuse(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT, filePath)
    }

    const resolution = await resolveInsideProject(filePath, projectPath)
    if (resolution.verdict === 'missing') {
      return this.refuse(ErrorCode.OPEN_IN_BROWSER_MISSING, filePath)
    }
    if (resolution.verdict !== 'inside') {
      return this.refuse(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT, filePath)
    }

    const { realPath } = resolution
    if (!this.isHtmlName(realPath)) return this.refuse(ErrorCode.OPEN_IN_BROWSER_NOT_HTML, filePath)
    if (!(await this.isRegularFile(realPath))) {
      return this.refuse(ErrorCode.OPEN_IN_BROWSER_MISSING, filePath)
    }

    const result = await this.deps.resolveLauncher().open(realPath)
    if (!result.ok) {
      logger.warn('Open in browser: launch failed', {
        file: redactPath(realPath),
        stage: result.stage,
        cause: result.cause
      })
      return failure(ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED)
    }
    logger.info('Opened in the default browser', {
      file: redactPath(realPath),
      usedFallback: result.usedFallback
    })
    return { success: true, usedFallback: result.usedFallback }
  }

  /** Checks 2 and 5: an `.html` / `.htm` name – on Windows, of a whole file, not a stream. */
  private isHtmlName(filePath: string): boolean {
    if (!HTML_NAME.test(filePath)) return false
    return this.deps.platform !== 'win32' || !namesAlternateDataStream(filePath)
  }

  private async isRegularFile(realPath: string): Promise<boolean> {
    try {
      return (await this.deps.stat(realPath)).isFile()
    } catch {
      // Gone between `realpath` and `stat`: "missing" is the honest answer, and
      // the refusal below logs it.
      return false
    }
  }

  private refuse(code: BrowserOpenErrorCode, filePath: string): BrowserOpenFileResponse {
    logger.warn('Refused to open in browser', { code, file: redactPath(filePath) })
    return failure(code)
  }
}

/** Process-wide instance used by `browser-handlers.ts`. */
export const browserLaunchService = new BrowserLaunchService()
