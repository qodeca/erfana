// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The files a preview page and its frames use, for live reload (issue #124,
 * WI-15; design part 2 §2.9).
 *
 * `collectPreviewFrameSources` walks breadth-first from the page on screen. The
 * page's own links come first, so its assets are the ones watched when the
 * watch budget runs out; then each frame document by depth, 1 to
 * `PREVIEW_LIMITS.MAX_FRAME_DEPTH`. A `src` frame's document is read with the
 * caller's reader – the pipeline's, bounded at `PREVIEW.MAX_ENTRY_HTML_BYTES` –
 * and only when it is an HTML page; a `srcdoc` frame's markup is already in its
 * parent, and its links resolve against the parent's folder, as the browser
 * resolves them. `srcdoc` levels count toward the depth, as in the frame guard.
 *
 * Once `PREVIEW.MAX_WATCHED_FILES` candidates are known, no further frame
 * document is read – the watch coordinator would drop what it adds – and every
 * link already found is kept, so the coordinator's dropped count still shows
 * them. At most `PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE` frame documents are
 * scanned, which bounds a page of `srcdoc` frames that hold no links and so
 * never reach the budget. A frame document that cannot be read is skipped:
 * reporting a frame that cannot load is the frame guard's and the protocol
 * handler's job.
 *
 * Fail closed: a frame document is read only when it confines inside the
 * project's real root through `confinePath` – lexically and after `realpath`,
 * the gate the protocol handler and the watch coordinator use – and it is read
 * at the real path that was checked. A frame outside the project, reached by
 * `../`, an absolute path or a symlink, is never served, so it is never read;
 * the coordinator, confining each candidate with the same gate, never watches
 * it. Without a root no frame document is read.
 *
 * Never rejects. A document the link extractor throws on ends the walk with the
 * candidates found before it; that alone is logged, by error name, never a path.
 *
 * `watchedFrameAssets` then names the watched files a frame uses, spelled as
 * the coordinator reports their changes, for `classifyReload`.
 *
 * Paths follow the host's rules (`\` on Windows); confinement and the real-path
 * dedupe stay in the watch coordinator. Files are DATA: a frame document is
 * parsed for links, never run.
 */

import { realpath } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

import { PREVIEW } from '../../../shared/constants'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { logger } from '../LoggingService'
import type { ConfineFn, WatchSetResult } from './PreviewWatchCoordinator'
import { extractFrameSources, extractStaticLinks } from './linkExtract'
import { confinePath } from './previewPathResolve'

/** The pages a frame can show whose links are followed. */
const FRAME_DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm'])

/**
 * Whether markup can hold a frame at all. parse5 makes an `<iframe>` element
 * only from this literal tag (in any case), so a document without it is spared
 * the second parse `extractFrameSources` would cost.
 */
const IFRAME_TAG_RE = /<iframe/i

/**
 * The `node:path` members the walk uses. A parameter only so a test can apply
 * the Windows rules (`path.win32`) on any host; production passes nothing.
 */
export interface PreviewFramePathApi {
  resolve(...paths: string[]): string
  dirname(path: string): string
  extname(path: string): string
}

const NATIVE_PATH: PreviewFramePathApi = { resolve, dirname, extname }

/** What `collectPreviewFrameSources` walks from. */
export interface PreviewFrameSourcesInput {
  /** The page on screen: an absolute path with native separators. */
  readonly entryPath: string
  /** The page's HTML, already read. */
  readonly entryHtml: string
  /** Reads one frame document at its confined real path; a rejection skips it. */
  readonly readHtml: (filePath: string) => Promise<string>
  /**
   * The project's real root: a frame document is read only when it confines
   * inside it. `undefined` reads no frame document at all (fail closed).
   */
  readonly realRoot: string | undefined
  /** The confining gate; `confinePath` by default. Injected for tests. */
  readonly confine?: ConfineFn
  /** Candidates past which no frame document is read; `PREVIEW.MAX_WATCHED_FILES` by default. */
  readonly budget?: number
  /** The deepest frame document read; `PREVIEW_LIMITS.MAX_FRAME_DEPTH` by default. */
  readonly maxDepth?: number
  /** The path rules to apply; the host platform's by default. */
  readonly pathApi?: PreviewFramePathApi
}

/** The watch candidates of a page and its frames. */
export interface PreviewFrameSources {
  /** Absolute, deduplicated: the page's own links first, then each frame document's, by depth. */
  readonly candidates: readonly string[]
  /** The frame documents and every path a frame document references. */
  readonly frameAssets: ReadonlySet<string>
}

/** A frame document still to scan: an HTML file to read, or `srcdoc` markup in hand. */
type PendingDocument =
  | { readonly filePath: string; readonly baseDir: string }
  | { readonly srcdocHtml: string; readonly baseDir: string }

/** What the walk has found so far. */
interface FrameWalk {
  readonly path: PreviewFramePathApi
  readonly maxDepth: number
  readonly readHtml: (filePath: string) => Promise<string>
  readonly realRoot: string | undefined
  readonly confine: ConfineFn
  readonly candidates: Set<string>
  readonly frameAssets: Set<string>
  /** Frame files already queued, so a file framed twice is read once. */
  readonly queued: Set<string>
}

/**
 * Collect the watch candidates of a page and of its frames, breadth-first.
 * Never rejects: a frame document that cannot be read is skipped, and a
 * document the link extractor throws on ends the walk with the candidates
 * found before it (see `scanOrStop`).
 */
export async function collectPreviewFrameSources(
  input: PreviewFrameSourcesInput
): Promise<PreviewFrameSources> {
  const budget = input.budget ?? PREVIEW.MAX_WATCHED_FILES
  const path = input.pathApi ?? NATIVE_PATH
  const walk: FrameWalk = {
    path,
    maxDepth: input.maxDepth ?? PREVIEW_LIMITS.MAX_FRAME_DEPTH,
    readHtml: input.readHtml,
    realRoot: input.realRoot,
    confine: input.confine ?? confinePath,
    candidates: new Set(),
    frameAssets: new Set(),
    // The page itself is not queued: a frame that shows the page is read once
    // more as a frame document, so a stylesheet the two share counts as a frame's.
    queued: new Set()
  }

  let framesScanned = 0
  let level = scanOrStop(walk, input.entryHtml, path.dirname(input.entryPath), 0)
  // `scanDocument` returns no frames at the depth cap, so the walk ends there.
  for (let depth = 1; level !== null && level.length > 0; depth += 1) {
    const next: PendingDocument[] = []
    for (const pending of level) {
      if (walk.candidates.size >= budget || framesScanned >= PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE) {
        return finish(walk)
      }
      framesScanned += 1
      const html = await loadDocument(walk, pending)
      if (html === null) {
        continue
      }
      const children = scanOrStop(walk, html, pending.baseDir, depth)
      if (children === null) {
        return finish(walk)
      }
      for (const child of children) next.push(child)
    }
    level = next
  }
  return finish(walk)
}

/**
 * `scanDocument`, or `null` when the link extractor throws – on a pathological
 * page, say – so the walk ends with what it has found and still resolves. Logged
 * once, by error name only: the message can carry a path.
 */
function scanOrStop(
  walk: FrameWalk,
  html: string,
  baseDir: string,
  depth: number
): PendingDocument[] | null {
  try {
    return scanDocument(walk, html, baseDir, depth)
  } catch (error) {
    logger.warn('Preview auto-refresh: could not scan a page for its files', {
      error: error instanceof Error ? error.name : typeof error
    })
    return null
  }
}

/**
 * Record one document's links, and return the frame documents it holds – none
 * at the depth cap, where a `src` frame is refused and never loads. Such a
 * frame's path is still one of this document's links, so it is still watched.
 */
function scanDocument(
  walk: FrameWalk,
  html: string,
  baseDir: string,
  depth: number
): PendingDocument[] {
  const inFrame = depth > 0
  for (const link of extractStaticLinks(html)) {
    const target = walk.path.resolve(baseDir, link)
    walk.candidates.add(target)
    if (inFrame) {
      walk.frameAssets.add(target)
    }
  }
  if (depth >= walk.maxDepth || !IFRAME_TAG_RE.test(html)) {
    return []
  }

  // `src` frames first, then `srcdoc` frames: the order within one level only
  // decides which of them the budget still reaches.
  const frames = extractFrameSources(html)
  const children: PendingDocument[] = []
  for (const src of frames.src) {
    const filePath = walk.path.resolve(baseDir, src)
    walk.frameAssets.add(filePath)
    if (isFrameDocument(walk.path, filePath) && !walk.queued.has(filePath)) {
      walk.queued.add(filePath)
      children.push({ filePath, baseDir: walk.path.dirname(filePath) })
    }
  }
  for (const srcdocHtml of frames.srcdocHtml) {
    children.push({ srcdocHtml, baseDir })
  }
  return children
}

function isFrameDocument(path: PreviewFramePathApi, filePath: string): boolean {
  return FRAME_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

/**
 * A pending document's markup, or `null` when it is not followed: a file
 * outside the project, one whose check failed, or one that cannot be read.
 */
async function loadDocument(walk: FrameWalk, pending: PendingDocument): Promise<string | null> {
  if ('srcdocHtml' in pending) {
    return pending.srcdocHtml
  }
  const target = await confinedTarget(walk, pending.filePath)
  if (target === null) {
    return null
  }
  try {
    // The path that was checked, so a link repointed since cannot pick the file.
    return await walk.readHtml(target)
  } catch {
    // Missing, unreadable or a folder: nothing to follow. Whether the frame may
    // load at all is decided by the frame guard and the protocol handler.
    return null
  }
}

/** The real path of a frame file inside the project root, or `null` (fail closed). */
async function confinedTarget(walk: FrameWalk, filePath: string): Promise<string | null> {
  if (walk.realRoot === undefined) {
    return null
  }
  try {
    const verdict = await walk.confine(walk.realRoot, filePath)
    return verdict.ok ? verdict.realTarget : null
  } catch {
    return null
  }
}

function finish(walk: FrameWalk): PreviewFrameSources {
  return { candidates: [...walk.candidates], frameAssets: walk.frameAssets }
}

/**
 * The watched files a frame uses, spelled as the watch coordinator reports
 * their changes.
 *
 * The coordinator watches REAL paths, while the walk builds paths from the
 * page's own path, which can run through a symlink (`/var` → `/private/var` on
 * macOS, a linked project folder, a Windows short name). A frame asset watched
 * under its own spelling is kept as it is. One the coordinator neither watched
 * nor dropped was confined under another spelling, and only that one costs a
 * `realpath` – never more calls than the coordinator itself made.
 *
 * @param frameAssets - `PreviewFrameSources.frameAssets`
 * @param watchSet - what the coordinator did with the candidates
 * @param realPath - resolves a path; `fs.promises.realpath` by default
 */
export async function watchedFrameAssets(
  frameAssets: ReadonlySet<string>,
  watchSet: WatchSetResult,
  realPath: (filePath: string) => Promise<string> = filePath => realpath(filePath)
): Promise<ReadonlySet<string>> {
  const watched = new Set(watchSet.watched)
  const found = new Set<string>()
  if (frameAssets.size === 0 || watched.size === 0) {
    return found
  }
  const dropped = new Set(watchSet.dropped.map(entry => entry.candidate))
  for (const asset of frameAssets) {
    if (watched.has(asset)) {
      found.add(asset)
    } else if (!dropped.has(asset)) {
      const real = await realPath(asset).catch(() => null)
      if (real !== null && watched.has(real)) {
        found.add(real)
      }
    }
  }
  return found
}
