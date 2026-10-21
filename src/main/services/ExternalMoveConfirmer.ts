// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalMoveConfirmer - asks the user before an external file is removed.
 *
 * A file picked in the Add files dialog needs no question (the pick was the
 * answer). A file that arrives some other way, such as a drop, is moved only
 * after the user answers a native box that is modal to the window owning the
 * project. Moves that arrive together share one box; the box shows the name of
 * each file (never a full path).
 */
import { basename } from 'path'

/** How long moves arriving one after another still count as one batch */
export const COALESCE_MS = 150

/** Names listed in the box before "and N more" */
export const MAX_LISTED_NAMES = 3

/** Longest name shown in full */
const MAX_NAME_CHARS = 80

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
  coalesceMs?: number
}

export interface MoveConfirmer {
  confirm(senderId: number | null, sourcePath: string): Promise<MoveAnswer>
}

interface Waiting {
  sourcePath: string
  resolve: (answer: MoveAnswer) => void
}

const shortName = (sourcePath: string): string => {
  const name = basename(sourcePath)
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name
}

/** Wording of the box for the files in one batch. */
export function describeMove(sourcePaths: readonly string[]): MoveBoxOptions {
  const names = sourcePaths.map(shortName)
  let message: string
  if (names.length === 1) {
    message = `Move "${names[0]}" into the project?`
  } else {
    const listed = names.slice(0, MAX_LISTED_NAMES).map((n) => `"${n}"`).join(', ')
    const more = names.length > MAX_LISTED_NAMES ? ` and ${names.length - MAX_LISTED_NAMES} more` : ''
    message = `Move ${names.length} files into the project? ${listed}${more}`
  }
  return {
    type: 'question',
    buttons: ['Move', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail:
      names.length === 1
        ? 'The original file will be removed from its current folder.'
        : 'The original files will be removed from their current folders.'
  }
}

export class ExternalMoveConfirmerImpl implements MoveConfirmer {
  private readonly waiting = new Map<number, Waiting[]>()
  private readonly coalesceMs: number

  constructor(private readonly deps: MoveConfirmerDeps) {
    this.coalesceMs = deps.coalesceMs ?? COALESCE_MS
  }

  confirm(senderId: number | null, sourcePath: string): Promise<MoveAnswer> {
    if (senderId === null) return Promise.resolve('unavailable')
    return new Promise<MoveAnswer>((resolve) => {
      const queue = this.waiting.get(senderId)
      if (queue) {
        queue.push({ sourcePath, resolve })
        return
      }
      this.waiting.set(senderId, [{ sourcePath, resolve }])
      setTimeout(() => void this.ask(senderId), this.coalesceMs)
    })
  }

  private async ask(senderId: number): Promise<void> {
    const batch = this.waiting.get(senderId) ?? []
    this.waiting.delete(senderId)
    let answer: MoveAnswer = 'cancel'
    try {
      const owner = this.deps.resolveOwner(senderId)
      if (owner === null) {
        answer = 'unavailable'
      } else {
        const { response } = await this.deps.showBox(
          owner,
          describeMove(batch.map((entry) => entry.sourcePath))
        )
        answer = response === 0 ? 'move' : 'cancel'
      }
    } catch {
      answer = 'cancel'
    }
    for (const entry of batch) entry.resolve(answer)
  }
}
