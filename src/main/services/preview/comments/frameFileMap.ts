// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which file each frame of one preview view shows
 * (docs/designs/comments/html-preview-comments.md §4.2 "frameFileMap", §9.1 S8, S9,
 * §19 R3-14; tests M-050, SEC-09).
 *
 * The ONLY source of "this frame's file" for comments. It is set from
 * `did-frame-navigate`, which Electron emits for the main frame and every
 * sub-frame when a document commits – never from a frame's live `url`, which
 * a page can change with `pushState`, and never from anything the page sends.
 * In-page steps (`pushState`, `#hash`) fire `did-navigate-in-page` instead, so
 * they cannot move a frame to another file (SEC-09).
 *
 * A URL counts only when it is this view's own `erfana-preview://<token>/…`:
 * `about:blank`, `about:srcdoc`, a refused frame's address (Chromium shows an
 * error page there and emits no `did-frame-navigate`, R3-14) and anything
 * else leave the frame with no file. The path is decoded and confined exactly
 * as the protocol handler serves it – safe segments, `confinePath` without
 * build folders against the real root – so the recorded real path is the one
 * the served bytes and their token table were read from.
 *
 * Confinement is asynchronous, so a frame's entry is a promise until it
 * settles; `fileOf` waits for it, `peek` answers only once it has. A newer
 * navigation of the same frame supersedes an older one still confining.
 */
import { extname, join } from 'node:path'
import { confinePath, isSafeSegment, type ConfineVerdict } from '../previewPathResolve'
import { toProjectPath } from '../previewUrl'

/** The file a frame shows, as main recorded it. */
export interface FrameFile {
  /** The confined real path – the key of locks, token tables and the writer. */
  readonly realPath: string
  /** The same file in project space: the spelling the editor's tabs use. */
  readonly projectPath: string
  /** Project-relative, `/`-separated. */
  readonly displayPath: string
  /** `.html` or `.htm`: a document comments can be written into. */
  readonly commentable: boolean
}

/** What the map is built from. */
export interface FrameFileMapDeps {
  /** This view's root token: the only host a frame's file may come from. */
  readonly token: string
  /** The `fs.promises.realpath` of the project root. */
  readonly realRoot: string
  /** The project root as the tree spells it. */
  readonly projectPath: string
  /** Defaults to `confinePath` (no build folders). */
  readonly confine?: (realRoot: string, candidate: string) => Promise<ConfineVerdict>
  readonly platform?: NodeJS.Platform
}

/** One view's frame → file record. */
export interface FrameFileMap {
  /** A document committed in frame `frameTreeNodeId` at `url`. */
  navigated(frameTreeNodeId: number, url: string): void
  /** The frame's file, once its latest navigation is confined; `undefined` for none. */
  fileOf(frameTreeNodeId: number): Promise<FrameFile | undefined>
  /** The frame's file if already known. */
  peek(frameTreeNodeId: number): FrameFile | undefined
  /** Forget every frame not in `live` (frames that went with their page). */
  retain(live: ReadonlySet<number>): void
  /** Forget everything (the view is gone). */
  clear(): void
}

const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm'])

/**
 * The decoded path segments of `url` when it is `erfana-preview://<token>/…`
 * with nothing else in the authority; `undefined` otherwise.
 */
export function previewUrlSegments(url: string, token: string, platform?: NodeJS.Platform): string[] | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'erfana-preview:' || parsed.hostname !== token) return undefined
  if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return undefined
  let segments: string[]
  try {
    segments = parsed.pathname.split('/').filter(segment => segment !== '').map(decodeURIComponent)
  } catch {
    return undefined
  }
  if (segments.length === 0 || !segments.every(segment => isSafeSegment(segment, platform))) return undefined
  return segments
}

interface Entry {
  readonly serial: number
  readonly pending: Promise<FrameFile | undefined>
  settled?: FrameFile
}

/** Build one view's frame → file record. */
export function createFrameFileMap(deps: FrameFileMapDeps): FrameFileMap {
  const confine = deps.confine ?? ((root: string, candidate: string) => confinePath(root, candidate))
  const entries = new Map<number, Entry>()
  let serial = 0

  async function resolve(segments: string[]): Promise<FrameFile | undefined> {
    const verdict = await confine(deps.realRoot, join(deps.realRoot, ...segments))
    if (!verdict.ok) return undefined
    return {
      realPath: verdict.realTarget,
      projectPath: toProjectPath(deps.projectPath, deps.realRoot, verdict.realTarget),
      displayPath: verdict.rel.split(/[\\/]/).join('/'),
      commentable: HTML_EXTENSIONS.has(extname(verdict.realTarget).toLowerCase())
    }
  }

  return {
    navigated(frameTreeNodeId, url) {
      serial += 1
      const segments = previewUrlSegments(url, deps.token, deps.platform)
      if (segments === undefined) {
        entries.delete(frameTreeNodeId)
        return
      }
      const mine = serial
      const pending = resolve(segments).catch(() => undefined)
      const entry: Entry = { serial: mine, pending }
      entries.set(frameTreeNodeId, entry)
      void pending.then(file => {
        if (entries.get(frameTreeNodeId)?.serial === mine && file !== undefined) entry.settled = file
        if (entries.get(frameTreeNodeId)?.serial === mine && file === undefined) entries.delete(frameTreeNodeId)
      })
    },
    async fileOf(frameTreeNodeId) {
      const entry = entries.get(frameTreeNodeId)
      if (entry === undefined) return undefined
      const file = await entry.pending
      // A newer navigation of the frame won meanwhile: its answer, not this one.
      const current = entries.get(frameTreeNodeId)
      return current === entry ? file : current?.pending
    },
    peek: frameTreeNodeId => entries.get(frameTreeNodeId)?.settled,
    retain(live) {
      for (const id of [...entries.keys()]) if (!live.has(id)) entries.delete(id)
    },
    clear() {
      entries.clear()
    }
  }
}
