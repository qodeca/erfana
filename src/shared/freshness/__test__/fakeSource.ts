// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A scripted {@link PausableSource} over a {@link FakeDisk}, standing in for
 * main's watch layer in the core tests:
 *
 * - disk changes become `changed` / `deleted` events for each live
 *   subscription on that path (a paused one records `missed` instead), unless
 *   events are muted (a dead watch);
 * - the next subscribes can be scripted: `started` (default), `queued`,
 *   `refused` with a code, or `hold` – the reply waits for `releaseHeld()`,
 *   like a subscribe that answers after chokidar's `ready` (G3); its stamp is
 *   read at release time;
 * - `emit` sends any event, including one before `started`;
 * - `writeText` honours `expectedStamp` like main does; `holdNextWrite` keeps a
 *   write pending so a test can land an outside change mid-save.
 */
import type {
  FileStamp,
  LiveRefresh,
  PausableSource,
  ProbeReply,
  SubscribeRefusalCode,
  SubscribeReply,
  SubscribeRequest,
  TextReadReply,
  WatchEvent,
  WatchEventListener,
  WriteTextReply,
  WriteTextRequest,
} from '../freshnessTypes'
import { isSameContent } from '../stamp'
import type { FakeDisk } from './fakeDisk'

export type ScriptedSubscribe =
  | { readonly kind: 'started'; readonly liveRefresh?: LiveRefresh }
  | { readonly kind: 'queued' }
  | { readonly kind: 'refused'; readonly code: SubscribeRefusalCode }
  | { readonly kind: 'hold'; readonly liveRefresh?: LiveRefresh }
  | { readonly kind: 'reject'; readonly error: Error }

interface Subscription {
  readonly filePath: string
  paused: boolean
  missed: boolean
}

export class FakeSource implements PausableSource {
  private readonly listeners = new Set<WatchEventListener>()
  private readonly script: ScriptedSubscribe[] = []
  private readonly held: (() => void)[] = []
  private heldWrite: { release: () => void } | null = null
  private holdWrites = 0
  /** Live subscriptions by id. */
  readonly subscriptions = new Map<string, Subscription>()
  /** Every subscribe request, in order. */
  readonly subscribeCalls: SubscribeRequest[] = []
  readonly unsubscribeCalls: string[] = []
  readonly pauseCalls: string[] = []
  readonly writeCalls: WriteTextRequest[] = []
  probeCalls = 0
  /** `true` drops disk-driven events (a silently dead watch, a network share). */
  muted = false
  /** `true` drops a subscription once it reports `deleted`, as main's watch layer does. */
  dropOnDelete = false

  constructor(private readonly disk: FakeDisk) {
    disk.onChange((path, change) => this.onDiskChange(path, change))
  }

  private onDiskChange(path: string, change: 'changed' | 'deleted'): void {
    if (this.muted) return
    for (const [watchId, sub] of this.subscriptions) {
      if (sub.filePath !== path) continue
      if (sub.paused) {
        sub.missed = true
        continue
      }
      this.emit({ watchId, kind: change })
      if (change === 'deleted' && this.dropOnDelete) this.subscriptions.delete(watchId)
    }
  }

  /** Script the next subscribe replies, in order (default `started`). */
  scriptSubscribe(...replies: ScriptedSubscribe[]): void {
    this.script.push(...replies)
  }

  /** Answer every held subscribe. */
  releaseHeld(): void {
    for (const release of this.held.splice(0)) release()
  }

  get heldCount(): number {
    return this.held.length
  }

  emit(event: WatchEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  private startedReply(filePath: string, liveRefresh: LiveRefresh = 'full'): SubscribeReply {
    const stamp = this.disk.stamp(filePath)
    if (!stamp) return { status: 'refused', code: 'NOT_FOUND' }
    return { status: 'started', stamp, liveRefresh }
  }

  async subscribe(request: SubscribeRequest): Promise<SubscribeReply> {
    this.subscribeCalls.push(request)
    const scripted = this.script.shift() ?? { kind: 'started' }
    if (scripted.kind === 'reject') throw scripted.error
    if (scripted.kind === 'refused') return { status: 'refused', code: scripted.code }
    if (this.subscriptions.has(request.watchId)) return { status: 'refused', code: 'DUPLICATE_ID' }
    if (scripted.kind === 'queued') {
      this.subscriptions.set(request.watchId, { filePath: request.filePath, paused: false, missed: false })
      return { status: 'queued' }
    }
    if (!this.disk.exists(request.filePath)) return { status: 'refused', code: 'NOT_FOUND' }
    // Live from the moment of the call: events can reach the tracker before the reply
    this.subscriptions.set(request.watchId, { filePath: request.filePath, paused: false, missed: false })
    if (scripted.kind === 'hold') {
      await new Promise<void>((resolve) => this.held.push(resolve))
      return this.startedReply(request.filePath, scripted.liveRefresh)
    }
    return this.startedReply(request.filePath, scripted.liveRefresh)
  }

  /** Promote a queued subscription: it gets `started` as an event. */
  promote(watchId: string, liveRefresh: LiveRefresh = 'full'): void {
    const sub = this.subscriptions.get(watchId)
    const stamp = sub ? this.disk.stamp(sub.filePath) : undefined
    if (!sub || !stamp) throw new Error(`fakeSource: cannot promote ${watchId}`)
    this.emit({ watchId, kind: 'started', stamp, liveRefresh })
  }

  async unsubscribe(watchId: string): Promise<void> {
    this.unsubscribeCalls.push(watchId)
    this.subscriptions.delete(watchId)
  }

  async probe(filePath: string, knownHash?: string): Promise<ProbeReply> {
    this.probeCalls += 1
    return this.disk.probe(filePath, knownHash)
  }

  readText(filePath: string): Promise<TextReadReply> {
    return this.disk.readText(filePath)
  }

  onEvent(listener: WatchEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  async pause(watchId: string): Promise<void> {
    this.pauseCalls.push(watchId)
    const sub = this.subscriptions.get(watchId)
    if (sub) sub.paused = true
  }

  async resumeWatch(watchId: string): Promise<{ readonly missed: boolean }> {
    const sub = this.subscriptions.get(watchId)
    if (!sub) return { missed: false }
    const missed = sub.missed
    sub.paused = false
    sub.missed = false
    return { missed }
  }

  /** The next `writeText` waits until {@link releaseWrite} before it checks and writes. */
  holdNextWrite(): void {
    this.holdWrites += 1
  }

  releaseWrite(): void {
    this.heldWrite?.release()
    this.heldWrite = null
  }

  get writeHeld(): boolean {
    return this.heldWrite !== null
  }

  async writeText(request: WriteTextRequest): Promise<WriteTextReply> {
    this.writeCalls.push(request)
    if (this.holdWrites > 0) {
      this.holdWrites -= 1
      await new Promise<void>((resolve) => {
        this.heldWrite = { release: resolve }
      })
    }
    const current = this.disk.stamp(request.filePath)
    if (request.expectedStamp !== undefined) {
      if (!current) return { status: 'changed-on-disk', stamp: null }
      if (!isSameContent(current, request.expectedStamp)) return { status: 'changed-on-disk', stamp: current }
    }
    this.disk.write(request.filePath, request.content)
    return { status: 'written', stamp: this.disk.stamp(request.filePath) as FileStamp }
  }
}
