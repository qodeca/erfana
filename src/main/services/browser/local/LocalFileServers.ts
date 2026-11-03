// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every served local folder of this process (spec 025, 025-FR-005 rule 1,
 * 025-FR-010; ADR 0012 option 4 – the per-folder loopback server, solution
 * design § 11 Q4: working assumption, owner decision pending). The whole
 * mechanism lives in `browser/local/`, so the owner can still swap it.
 *
 * - **Open** ({@link LocalFileServers.open}): the file's real path decides
 *   the served folder – its parent. One server per project per folder,
 *   shared by the tabs that opened a file there (so the folder keeps one
 *   origin); started on first use, at most {@link MAX_LOCAL_SERVERS} at once.
 *   Refused: a missing file or a folder, a file inside a dot-folder (below
 *   the project root when inside it, anywhere otherwise), a volume root or a
 *   system folder as the served folder, and Erfana's own files.
 * - **Arm** ({@link LocalFileServers.arm}): `BrowserTab` arms the exact
 *   address of a load the user started (the bar, **Open in browser tab**,
 *   Reload, Back, Forward); the server serves that document, once, with the
 *   folder's origin, and every other document sandboxed (S-7). An arm lapses
 *   after {@link ARM_LIFETIME_MS}.
 * - **Gate** ({@link LocalFileServers.allowsRequest}): the browser session's
 *   request filter asks it about every request. A request to a served folder
 *   goes ahead only when the requesting tab's top-level page is on the same
 *   server, or – for a top-level load – when it is armed. So a web page, a
 *   page of another folder, a page-opened tab or popup, and a page's
 *   navigation from elsewhere never reach a folder (S-7).
 * - **Address shown** ({@link LocalFileServers.displayAddress}): the bar shows
 *   `file://<path>`, never the loopback address (spec change S-6).
 * - **Close**: when the last tab holding a server closes
 *   ({@link LocalFileServers.releaseTab}), on project switch or close
 *   ({@link LocalFileServers.closeProject}, teardown stage `closeViews`), and
 *   on quit ({@link LocalFileServers.closeAll}).
 *
 * Logs never carry a path (`src/main/services/CLAUDE.md`, `redactPath`).
 */
import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isInsideRoot, isSamePath, pathBelowRoot } from '../../../utils/pathCompare'
import { isFilesystemRoot, isSystemDirectory } from '../../../utils/pathSecurity'
import { redactedLogError, redactPath } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import type { AppAddresses } from '../browserNavigationPolicy'
import { LocalFolderServer, type LocalFolderServerOptions } from './LocalFolderServer'

/** How many folders may be served at once in this process. */
export const MAX_LOCAL_SERVERS = 32
/** How long an armed address waits for its load. */
export const ARM_LIFETIME_MS = 30_000
/** How many arms may wait at once; the oldest goes first. */
const MAX_ARMS = 64

export interface LocalOpenRequest {
  readonly tabId: string
  readonly projectRoot: string
  readonly caseSensitive: boolean
  /** An absolute path, as typed or as the preview names it. */
  readonly filePath: string
}

export type LocalOpenResult =
  | { readonly ok: true; readonly url: string; readonly displayUrl: string }
  | { readonly ok: false; readonly reason: 'local-file' | 'app-entry' }

/** A browser-session request, as the request filter sees it. */
export interface LocalGateRequest {
  readonly url: string
  readonly resourceType: string
  /** The requesting tab's top-level address, or `null` when no page is known. */
  readonly topUrl: string | null
}

/** The server seam; the real one is {@link LocalFolderServer}. */
export type LocalServerHandle = Pick<LocalFolderServer, 'realRoot' | 'token' | 'origin' | 'start' | 'close' | 'addressOf'>

export interface LocalFileServersDeps {
  readonly now: () => number
  readonly appAddresses: () => AppAddresses
  readonly createServer?: (options: LocalFolderServerOptions) => LocalServerHandle
  /**
   * Folders never served: by default a volume root and the system folders of
   * `pathSecurity.isSystemDirectory` (which include `/tmp`, `/var` and
   * `/private` on macOS and Linux). A test seam.
   */
  readonly refusesFolder?: (folder: string) => boolean
}

function defaultRefusesFolder(folder: string): boolean {
  return isFilesystemRoot(folder) || isSystemDirectory(folder)
}

interface Entry {
  readonly server: LocalServerHandle
  readonly projectRoot: string
  readonly caseSensitive: boolean
  readonly holders: Set<string>
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** The arm key of an address: origin, path and query, no fragment. */
function armKey(url: string): string | null {
  const parsed = parse(url)
  if (parsed === null) return null
  parsed.hash = ''
  return parsed.href
}

/** Whether a dot-prefixed folder holds `realFile`: below the project root when inside it, anywhere otherwise. */
function insideDotFolder(realFile: string, projectRoot: string, caseSensitive: boolean): boolean {
  const below = pathBelowRoot(realFile, projectRoot, caseSensitive)
  const folders = (below ?? realFile).split(sep).slice(0, -1)
  return folders.some((segment) => segment.startsWith('.'))
}

export class LocalFileServers {
  private readonly entries = new Map<string, Entry>()
  private readonly starting = new Map<string, Promise<Entry | null>>()
  private readonly arms = new Map<string, number>()

  constructor(private readonly deps: LocalFileServersDeps) {}

  /** Serve `filePath`'s folder for `tabId` and answer the address to load and the one to show. */
  async open(request: LocalOpenRequest): Promise<LocalOpenResult> {
    if (!isAbsolute(request.filePath)) return { ok: false, reason: 'local-file' }
    let realFile: string
    try {
      realFile = await realpath(request.filePath)
      if (!(await stat(realFile)).isFile()) return { ok: false, reason: 'local-file' }
    } catch {
      return { ok: false, reason: 'local-file' }
    }
    if (this.isAppFile(realFile)) return { ok: false, reason: 'app-entry' }
    const folder = dirname(realFile)
    if (
      (this.deps.refusesFolder ?? defaultRefusesFolder)(folder) ||
      insideDotFolder(realFile, request.projectRoot, request.caseSensitive) ||
      basename(realFile).startsWith('.')
    ) {
      logger.warn('Refused to serve a local file', { file: redactPath(realFile) })
      return { ok: false, reason: 'local-file' }
    }
    const entry = await this.entryFor(request, folder)
    if (entry === null) return { ok: false, reason: 'local-file' }
    entry.holders.add(request.tabId)
    return { ok: true, url: entry.server.addressOf([basename(realFile)]), displayUrl: pathToFileURL(realFile).href }
  }

  /** Arm `url` for one Erfana-started top-level load; ignored for an address no server owns. */
  arm(url: string): void {
    const key = armKey(url)
    if (key === null || this.serverOf(url) === null) return
    this.arms.delete(key)
    this.arms.set(key, this.deps.now() + ARM_LIFETIME_MS)
    while (this.arms.size > MAX_ARMS) this.arms.delete(this.arms.keys().next().value!)
  }

  /** Whether `url` is the address of a served folder. */
  isLocalAddress(url: string): boolean {
    return this.serverOf(url) !== null
  }

  /** May this browser-session request go ahead? True for every address no server owns. */
  allowsRequest(request: LocalGateRequest): boolean {
    const parsed = parse(request.url)
    const entry = parsed === null ? undefined : this.entries.get(parsed.origin)
    if (parsed === null || entry === undefined) return true
    if (!parsed.pathname.startsWith(`/${entry.server.token}/`)) return false
    if (request.resourceType === 'mainFrame' && this.isArmed(request.url)) return true
    return request.topUrl !== null && this.serverOf(request.topUrl) === entry.server
  }

  /** `file://<path>` for a served address (fragment and query kept), or `null` for any other. */
  displayAddress(url: string): string | null {
    const parsed = parse(url)
    const server = parsed === null ? null : this.serverOf(url)
    if (parsed === null || server === null) return null
    try {
      const rel = parsed.pathname.slice(server.token.length + 2).split('/').map(decodeURIComponent)
      const file = pathToFileURL([server.realRoot, ...rel].join(sep))
      file.search = parsed.search
      file.hash = parsed.hash
      return file.href
    } catch {
      return null
    }
  }

  /** A tab closed: it holds no server any more, and a server no tab holds closes. */
  releaseTab(tabId: string): void {
    for (const [origin, entry] of this.entries) {
      if (entry.holders.delete(tabId) && entry.holders.size === 0) this.closeEntry(origin, entry)
    }
  }

  /** Close every server of the project at `projectRoot` (teardown stage `closeViews`). */
  async closeProject(projectRoot: string): Promise<void> {
    const closing: Promise<void>[] = []
    for (const [origin, entry] of this.entries) {
      if (isSamePath(entry.projectRoot, projectRoot, entry.caseSensitive)) closing.push(this.closeEntry(origin, entry))
    }
    await Promise.all(closing)
  }

  /** Close every server (quit). Never rejects. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.entries].map(([origin, entry]) => this.closeEntry(origin, entry)))
    this.arms.clear()
  }

  /** How many folders are served now. */
  get size(): number {
    return this.entries.size
  }

  private async entryFor(request: LocalOpenRequest, folder: string): Promise<Entry | null> {
    const found = this.findEntry(request.projectRoot, folder)
    if (found !== null) return found
    const key = `${request.caseSensitive ? request.projectRoot : request.projectRoot.toLowerCase()}\0${folder}`
    const pending = this.starting.get(key) ?? this.startEntry(request, folder)
    this.starting.set(key, pending)
    try {
      return await pending
    } finally {
      this.starting.delete(key)
    }
  }

  private async startEntry(request: LocalOpenRequest, folder: string): Promise<Entry | null> {
    if (this.entries.size >= MAX_LOCAL_SERVERS) {
      logger.warn('Refused to serve another local folder: too many are served', { max: MAX_LOCAL_SERVERS })
      return null
    }
    const options: LocalFolderServerOptions = {
      realRoot: folder,
      consumeArm: (address) => this.consumeArm(address),
      refusesTarget: (realPath) => this.isAppFile(realPath)
    }
    const server = this.deps.createServer?.(options) ?? new LocalFolderServer(options)
    try {
      await server.start()
    } catch (error) {
      logger.error('A local folder could not be served', redactedLogError(error))
      return null
    }
    const entry: Entry = {
      server,
      projectRoot: request.projectRoot,
      caseSensitive: request.caseSensitive,
      holders: new Set()
    }
    this.entries.set(server.origin, entry)
    return entry
  }

  private findEntry(projectRoot: string, folder: string): Entry | null {
    for (const entry of this.entries.values()) {
      if (entry.server.realRoot === folder && isSamePath(entry.projectRoot, projectRoot, entry.caseSensitive)) return entry
    }
    return null
  }

  private serverOf(url: string): LocalServerHandle | null {
    const parsed = parse(url)
    const entry = parsed === null ? undefined : this.entries.get(parsed.origin)
    if (parsed === null || entry === undefined) return null
    return parsed.pathname.startsWith(`/${entry.server.token}/`) ? entry.server : null
  }

  private isArmed(url: string): boolean {
    const key = armKey(url)
    const expires = key === null ? undefined : this.arms.get(key)
    return expires !== undefined && expires > this.deps.now()
  }

  private consumeArm(address: string): boolean {
    const armed = this.isArmed(address)
    const key = armKey(address)
    if (key !== null) this.arms.delete(key)
    return armed
  }

  /** Erfana's renderer entry, or anything under its resources folder (025-FR-005 rule 3). */
  private isAppFile(realPath: string): boolean {
    const app = this.deps.appAddresses()
    const caseSensitive = process.platform === 'linux'
    if (isInsideRoot(realPath, app.resourcesDir, caseSensitive)) return true
    try {
      return isSamePath(realPath, fileURLToPath(app.rendererEntry), caseSensitive)
    } catch {
      return false
    }
  }

  private closeEntry(origin: string, entry: Entry): Promise<void> {
    this.entries.delete(origin)
    return entry.server.close().catch((error: unknown) => {
      logger.warn('A local folder server did not close cleanly', { error: redactedLogError(error)?.message ?? String(error) })
    })
  }
}
