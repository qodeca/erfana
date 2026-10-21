// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalMoveConfirmer - asks the user before an external file is removed.
 *
 * Every move out of a folder outside the project passes through here: the
 * original is deleted only after the user answers "Move" in a native box that is
 * modal to the window owning the project. The box names each file and its
 * folder (home-relative), never a full path. Moves that arrive together, and the
 * files of one dialog pick, share a box; a box lists at most
 * {@link MAX_FILES_PER_BOX} files, and a larger batch gets further boxes.
 */
import { homedir } from 'os'
import nodePath, { type PlatformPath } from 'path'
import { SenderRateCap } from '../utils/SenderRateCap'
import { BIDI_OVERRIDES, CONTROL_CHARS } from '../utils/validateFilename'

/** How long moves arriving one after another still count as one batch */
export const COALESCE_MS = 150

/** Files named in one box */
export const MAX_FILES_PER_BOX = 10

/** Longest name or folder shown, in characters */
const MAX_SHOWN_CHARS = 80

/** Boxes one window may open per rate window */
const MAX_BOXES_PER_WINDOW = 10
const RATE_WINDOW_MS = 60_000

/** How long the files of an answered batch stay approved for their own moves */
export const APPROVAL_TTL_MS = 60_000

export type MoveAnswer = 'move' | 'cancel' | 'unavailable'

export interface MoveBoxOptions {
  type: 'question'
  buttons: string[]
  defaultId: number
  cancelId: number
  message: string
  detail: string
}

export interface MoveConfirmerDeps {
  /** Shows the box, modal to `owner`; resolves with the index of the button pressed */
  showBox: (owner: unknown, options: MoveBoxOptions) => Promise<{ response: number }>
  /** The window that owns the project and called, or null when there is none */
  resolveOwner: (senderId: number) => unknown | null
  /** False when the window cannot show a box now (minimised, hidden) */
  canShow?: (owner: unknown) => boolean
  coalesceMs?: number
  homeDir?: string
  path?: PlatformPath
  now?: () => number
  rateCap?: Pick<SenderRateCap, 'allow'>
}

export interface MoveConfirmer {
  /**
   * @param batch - The other files that came with this one (a dialog pick); they
   *                are named in the same box and approved by the same answer
   */
  confirm(
    senderId: number | null,
    sourcePath: string,
    batch?: readonly string[]
  ): Promise<MoveAnswer>
}

interface Waiting {
  sourcePath: string
  batch: readonly string[] | undefined
  resolve: (answer: MoveAnswer) => void
}

// Control, bidi and line-separator characters change how a name reads or lays out
const UNSAFE_TEXT = new RegExp(
  `${CONTROL_CHARS.source.slice(0, -1)}\\x7f-\\x9f\\u2028\\u2029]|${BIDI_OVERRIDES.source}`,
  'gu'
)

/** A name or folder as it may be shown: no hidden characters, cut at whole characters. */
export function safeShown(text: string): string {
  const cleaned = text.replace(UNSAFE_TEXT, '�')
  const chars = Array.from(cleaned)
  return chars.length > MAX_SHOWN_CHARS ? `${chars.slice(0, MAX_SHOWN_CHARS - 1).join('')}…` : cleaned
}

function folderShown(dir: string, home: string, path: PlatformPath): string {
  const relative = path.relative(home, dir)
  const inHome = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  if (!inHome) return safeShown(dir)
  return safeShown(relative === '' ? '~' : `~${path.sep}${relative}`)
}

/** Wording of the box for the files of one chunk. */
export function describeMove(
  sourcePaths: readonly string[],
  home: string = homedir(),
  path: PlatformPath = nodePath
): MoveBoxOptions {
  const lines = sourcePaths.map(
    (p) => `${safeShown(path.basename(p))} – ${folderShown(path.dirname(p), home, path)}`
  )
  if (lines.length === 1) {
    return {
      type: 'question',
      buttons: ['Move', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Move "${safeShown(path.basename(sourcePaths[0]))}" into the project?`,
      detail: `From ${folderShown(path.dirname(sourcePaths[0]), home, path)}\nThe original file will be removed from its current folder.`
    }
  }
  return {
    type: 'question',
    buttons: ['Move', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Move ${lines.length} files into the project?`,
    detail: `${lines.join('\n')}\n\nThe original files will be removed from their current folders.`
  }
}

export class ExternalMoveConfirmerImpl implements MoveConfirmer {
  private readonly waiting = new Map<number, Waiting[]>()
  private readonly open = new Set<number>()
  private readonly approved = new Map<number, Map<string, number>>()
  private readonly coalesceMs: number
  private readonly home: string
  private readonly path: PlatformPath
  private readonly now: () => number
  private readonly rateCap: Pick<SenderRateCap, 'allow'>

  constructor(private readonly deps: MoveConfirmerDeps) {
    this.coalesceMs = deps.coalesceMs ?? COALESCE_MS
    this.home = deps.homeDir ?? homedir()
    this.path = deps.path ?? nodePath
    this.now = deps.now ?? ((): number => Date.now())
    this.rateCap =
      deps.rateCap ??
      new SenderRateCap(
        { maxRecords: MAX_BOXES_PER_WINDOW, maxBytes: Number.MAX_SAFE_INTEGER },
        { maxRecords: MAX_BOXES_PER_WINDOW, maxBytes: Number.MAX_SAFE_INTEGER },
        RATE_WINDOW_MS,
        () => {}
      )
  }

  confirm(
    senderId: number | null,
    sourcePath: string,
    batch?: readonly string[]
  ): Promise<MoveAnswer> {
    if (senderId === null) return Promise.resolve('unavailable')
    if (this.takeApproval(senderId, sourcePath)) return Promise.resolve('move')
    return new Promise<MoveAnswer>((resolve) => {
      const queue = this.waiting.get(senderId)
      if (queue) {
        queue.push({ sourcePath, batch, resolve })
        return
      }
      this.waiting.set(senderId, [{ sourcePath, batch, resolve }])
      // While a box is open the next one waits for it
      if (!this.open.has(senderId)) this.schedule(senderId)
    })
  }

  private schedule(senderId: number): void {
    setTimeout(() => void this.ask(senderId), this.coalesceMs)
  }

  private takeApproval(senderId: number, sourcePath: string): boolean {
    const entries = this.approved.get(senderId)
    const expires = entries?.get(sourcePath)
    if (expires === undefined) return false
    entries?.delete(sourcePath)
    return expires > this.now()
  }

  private approve(senderId: number, paths: readonly string[]): void {
    let entries = this.approved.get(senderId)
    if (!entries) {
      entries = new Map()
      this.approved.set(senderId, entries)
    }
    const expires = this.now() + APPROVAL_TTL_MS
    for (const p of paths) entries.set(p, expires)
  }

  private async ask(senderId: number): Promise<void> {
    const entries = this.waiting.get(senderId) ?? []
    this.waiting.delete(senderId)
    this.open.add(senderId)
    try {
      // The files to name: the waiting ones, then the rest of any dialog pick
      const waitingPaths = new Set(entries.map((entry) => entry.sourcePath))
      const named = [...waitingPaths]
      for (const entry of entries) {
        for (const p of entry.batch ?? []) {
          if (!named.includes(p)) named.push(p)
        }
      }
      const answers = new Map<string, MoveAnswer>()
      for (let i = 0; i < named.length; i += MAX_FILES_PER_BOX) {
        const chunk = named.slice(i, i + MAX_FILES_PER_BOX)
        const answer = await this.askChunk(senderId, chunk)
        for (const p of chunk) answers.set(p, answer)
        if (answer === 'move') {
          this.approve(senderId, chunk.filter((p) => !waitingPaths.has(p)))
        }
      }
      for (const entry of entries) entry.resolve(answers.get(entry.sourcePath) ?? 'cancel')
    } finally {
      this.open.delete(senderId)
      if (this.waiting.has(senderId)) this.schedule(senderId)
    }
  }

  private async askChunk(senderId: number, chunk: readonly string[]): Promise<MoveAnswer> {
    try {
      const owner = this.deps.resolveOwner(senderId)
      if (owner === null || (this.deps.canShow && !this.deps.canShow(owner))) return 'unavailable'
      if (!this.rateCap.allow(senderId, 1, false)) return 'unavailable'
      const { response } = await this.deps.showBox(
        owner,
        describeMove(chunk, this.home, this.path)
      )
      return response === 0 ? 'move' : 'cancel'
    } catch {
      return 'cancel'
    }
  }
}
