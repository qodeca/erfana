// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Window subscriptions for the `FileWatcherService` suites (#478): subscribe a
 * window to a file with a fresh `watchId`, release the newest one, and read
 * the `file-watch:event` sends back as `{ window, filePath, kind }` – each
 * event names its subscription, never a path, so this helper remembers which
 * id was for which file.
 */
import { randomUUID } from 'crypto'
import type { SubscribeReply, WatchEndReason } from '../../../../shared/freshness/freshnessTypes'
import type { TimingProfileName } from '../../../../shared/freshness/timingProfiles'
import type { FileWatcherService } from '../../FileWatcherService'

/** One send the fake Electron window recorded; `id` is the window's webContents id when the suite records it. */
export interface RecordedSend {
  readonly id?: number
  readonly channel: string
  readonly payload: Record<string, unknown>
}

/** A `file-watch:event` send, read back. */
export interface SeenEvent {
  readonly window: number | undefined
  readonly filePath: string | undefined
  readonly watchId: string
  readonly kind: string
  readonly reason?: WatchEndReason
}

interface Held {
  readonly watchId: string
  readonly filePath: string
  readonly window: number
}

export class WindowWatches {
  private readonly held: Held[] = []
  private readonly byId = new Map<string, Held>()

  constructor(
    private readonly svc: Pick<FileWatcherService, 'subscribe' | 'unsubscribe' | 'pauseSubscription' | 'resumeSubscription'>,
    private readonly sends: readonly RecordedSend[]
  ) {}

  /** Subscribe `window` to `filePath` with a new id. */
  async watch(filePath: string, window = 1, profile: TimingProfileName = 'editor'): Promise<SubscribeReply & { watchId: string }> {
    const watchId = randomUUID()
    const held = { watchId, filePath, window }
    this.held.push(held)
    this.byId.set(watchId, held)
    const reply = await this.svc.subscribe({ owner: { kind: 'window', webContentsId: window }, watchId, filePath, profile })
    return { ...reply, watchId }
  }

  /** Subscribe and require `started`. */
  async started(filePath: string, window = 1): Promise<string> {
    const reply = await this.watch(filePath, window)
    if (reply.status !== 'started') throw new Error(`setup: subscribe answered ${JSON.stringify(reply)}`)
    return reply.watchId
  }

  /** Release the newest subscription of `window` on `filePath`. */
  async unwatch(filePath: string, window = 1): Promise<void> {
    let index = -1
    this.held.forEach((h, i) => {
      if (h.filePath === filePath && h.window === window) index = i
    })
    if (index < 0) return
    const [held] = this.held.splice(index, 1)
    await this.svc.unsubscribe({ kind: 'window', webContentsId: window }, held.watchId)
  }

  /** Pause every subscription of `window` on `filePath` (an own save). */
  pause(filePath: string, window = 1): void {
    for (const h of this.held) {
      if (h.filePath === filePath && h.window === window) {
        this.svc.pauseSubscription({ kind: 'window', webContentsId: window }, h.watchId)
      }
    }
  }

  /** End those pauses; whether any of them missed a change. */
  resume(filePath: string, window = 1): boolean {
    let missed = false
    for (const h of this.held) {
      if (h.filePath === filePath && h.window === window) {
        missed = this.svc.resumeSubscription({ kind: 'window', webContentsId: window }, h.watchId).missed || missed
      }
    }
    return missed
  }

  /** Every `file-watch:event` send so far, read back. */
  events(): SeenEvent[] {
    return this.sends
      .filter(send => send.channel === 'file-watch:event')
      .map(send => {
        const watchId = String(send.payload.watchId)
        const held = this.byId.get(watchId)
        return {
          window: send.id ?? held?.window,
          filePath: held?.filePath,
          watchId,
          kind: String(send.payload.kind),
          ...(send.payload.reason !== undefined ? { reason: send.payload.reason as WatchEndReason } : {})
        }
      })
  }

  /** The windows that got `kind` for `filePath`, one entry per subscription event, in order. */
  to(filePath: string, kind: string): number[] {
    return this.events()
      .filter(event => event.filePath === filePath && event.kind === kind)
      .map(event => event.window ?? 0)
  }

  /** The files that got `kind`, one entry per event. */
  filesWith(kind: string): string[] {
    return this.events()
      .filter(event => event.kind === kind)
      .map(event => event.filePath ?? '?')
  }

  /** The kinds sent so far, in order. */
  kinds(): string[] {
    return this.events().map(event => event.kind)
  }
}
