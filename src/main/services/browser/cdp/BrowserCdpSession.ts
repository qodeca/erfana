// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One view's DevTools-protocol session (spec 025 solution design § 4.1, § 5,
 * § 6.3; ADR 0007 decisions 1–3; 025-NFR-001 bullet 2).
 *
 * The ONLY code that calls `webContents.debugger.sendCommand` – a test fails
 * on any other caller under `src/main`. Every command goes through
 * {@link BrowserCdpSession.send}, which checks it against the allow-list of
 * the session's kind (`cdpAllowList.ts`) before anything is sent.
 *
 * What it does:
 * - The browser identity (025-FR-024, `site/browserUserAgent.ts`) goes to every
 *   target first: a waiting child has it before it runs, the top before its first load.
 * - Attaches, then `Target.setAutoAttach` with the fixed flattened options.
 *   Each child target (frame, worker, service worker) gets its enables sent
 *   without awaiting each, then `Runtime.runIfWaitingForDebugger` (P6) on a
 *   later task – see {@link RESUME_DELAY_MS} for why it must not go out from
 *   inside the attach event. The `targetAttached` event fires before the
 *   run, so a caller (the freeze) can queue its own commands ahead of it.
 * - `Runtime`, `Log` and `Network` on every target while browsing; failed
 *   requests come from `Network` by default, as only it sees a dedicated
 *   worker's (commit-8 probe, P1); `failedRequestSource: 'log'` stays;
 *   `DOM`, `CSS` and `Overlay` only between {@link enablePickDomains} and
 *   {@link disablePickDomains} (A12). `Page` is never turned on here: dialogs
 *   own it (ADR 0011), and its dialog events, when on, feed the hang probe.
 * - Flood budget per target (S6): over it, that target's log domains go off
 *   until the next navigation, and the log snapshot says "logs truncated".
 * - Console objects released after each console call is copied (P7).
 * - The hang probe on the top target (025-FR-056).
 * - A debugger detach it did not ask for (the view closing, or anything
 *   else) is recorded and announced as `detached` (Q5, S-9). Opening DevTools
 *   does not detach it (commit-8 probe, Electron 44.9.3).
 *
 * New documents: the top target's `Runtime.executionContextsCleared` clears
 * every frame's logs; a frame's new default context clears that frame's. A
 * target whose logs the flood budget turned off misses those events, so the
 * view's `did-navigate` (top) and `did-frame-navigate` (sub-frames, coarse:
 * any sub-frame navigation re-arms every flooded child target) re-enable it.
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'
import { mainClock } from '../../../utils/mainClock'
import { logger } from '../../LoggingService'
import { BrowserHangProbe } from './browserHangProbe'
import { BrowserLogBuffer, type LogSnapshot } from './browserLogBuffer'
import { CdpFloodBudget, eventPayloadSize } from './cdpFloodBudget'
import { CdpLogCollector, type FailedRequestSource, type LogScope } from './cdpLogCollector'
import { CdpRefusedError, checkCdpCommand, PICK_ONLY_DOMAINS, type CdpSessionKind } from './cdpAllowList'
import { AUTO_ATTACH_PARAMS, CONSOLE_OBJECT_GROUP, HANG_PROBE_EVALUATE_PARAMS, NETWORK_ENABLE_PARAMS } from './cdpPinned'
import {
  isRecord,
  type CdpDetachListener,
  type CdpMessageListener,
  type CdpWebContents,
  type DidFrameNavigateListener,
  type DidNavigateListener
} from './cdpTypes'
import { EventHub } from './eventHub'
import { currentBrowserUserAgentOverride, userAgentOverrideMethod, type BrowserUserAgentOverride } from '../site/browserUserAgent'
import type { BrowserCdpSessionEvents, CdpDetachCause, CdpDetachInfo, CdpTargetInfo, HangProbeControl } from './cdpSessionTypes'

export type { BrowserCdpSessionEvents, CdpDetachCause, CdpDetachInfo, CdpProtocolEvent, CdpTargetInfo, HangProbeControl } from './cdpSessionTypes'
export type { HangProbeEvent } from './browserHangProbe'
export type { LogSnapshot, LoggedConsoleEntry, LoggedFailedRequest } from './browserLogBuffer'
export type { CdpSessionKind } from './cdpAllowList'
export { CdpRefusedError } from './cdpAllowList'

/** The top target's session key (Electron's root session has no id). */
export const TOP_TARGET = ''

/** Delay before a target's console objects are released, so a burst of calls costs one release. */
export const CONSOLE_RELEASE_DELAY_MS = 250

/**
 * Delay before a waiting child is resumed: a new task, never the attach
 * event's call stack. Electron emits `Target.attachedToTarget` synchronously
 * from inside Chromium's navigation throttle, before it defers; a resume sent
 * there (or from a microtask) clears the throttle without resuming it, and
 * the cross-site frame never commits (commit-8 probe, Electron 44.9.3).
 */
export const RESUME_DELAY_MS = 0

export interface BrowserCdpSessionOptions {
  readonly kind: CdpSessionKind
  readonly clock?: Clock
  /** Where failed requests come from (default `network`: only it sees a worker's, commit-8 probe). */
  readonly failedRequestSource?: FailedRequestSource
  /** The identity every target gets before it runs (025-FR-024; default: this process's); `null` sends none. */
  readonly userAgent?: BrowserUserAgentOverride | null
}

interface TargetRecord extends CdpTargetInfo {
  readonly parentKey: string | null
  readonly budget: CdpFloodBudget
  logsOff: boolean
  release: TimerHandle | undefined
  resume: TimerHandle | undefined
}

const LOG_DOMAINS = ['Runtime.', 'Log.', 'Network.']
const isLogEvent = (method: string): boolean => LOG_DOMAINS.some(d => method.startsWith(d))
const isFrameTarget = (t: TargetRecord): boolean => t.sessionKey === TOP_TARGET || t.type === 'iframe'
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Electron's detach reason when the page goes away (`Debugger::AgentHostClosed`). */
export const TARGET_CLOSED_REASON = 'target closed'

/** A closing view detaches with "target closed" before `isDestroyed()` turns true (commit-8 probe). */
function detachCause(contents: CdpWebContents, reason: string): CdpDetachCause {
  if (contents.isDestroyed()) return 'viewClosed'
  if (reason === TARGET_CLOSED_REASON && !contents.isDevToolsOpened()) return 'viewClosed'
  return 'other'
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export class BrowserCdpSession {
  readonly kind: CdpSessionKind
  private readonly clock: Clock
  private readonly source: FailedRequestSource
  private readonly userAgent: BrowserUserAgentOverride | null
  private readonly hub = new EventHub<BrowserCdpSessionEvents>('Browser CDP')
  private readonly buffer: BrowserLogBuffer
  private readonly collector: CdpLogCollector
  private readonly probe: BrowserHangProbe
  private readonly targets = new Map<string, TargetRecord>()
  private contents: CdpWebContents | null = null
  private topUrl = ''
  private pickActive = false
  private lastDetachInfo: CdpDetachInfo | null = null

  constructor(options: BrowserCdpSessionOptions) {
    this.kind = options.kind
    this.clock = options.clock ?? mainClock
    this.source = options.failedRequestSource ?? 'network'
    this.userAgent = options.userAgent === undefined ? currentBrowserUserAgentOverride() : options.userAgent
    this.buffer = new BrowserLogBuffer(this.clock)
    this.collector = new CdpLogCollector(this.buffer, this.source)
    this.probe = new BrowserHangProbe({
      clock: this.clock,
      evaluate: () => this.send('Runtime.evaluate', HANG_PROBE_EVALUATE_PARAMS),
      onEvent: event => this.hub.emit('hang', event)
    })
    this.probe.suspend('detached')
  }

  get attached(): boolean {
    return this.contents !== null
  }

  /** The last detach Erfana did not ask for, or null. */
  get lastDetach(): CdpDetachInfo | null {
    return this.lastDetachInfo
  }

  get hangProbe(): HangProbeControl {
    return this.probe
  }

  get pickDomainsEnabled(): boolean {
    return this.pickActive
  }

  on<K extends keyof BrowserCdpSessionEvents>(event: K, listener: (payload: BrowserCdpSessionEvents[K]) => void): () => void {
    return this.hub.on(event, listener)
  }

  /**
   * Attaches to `contents`'s debugger and starts auto-attach, logs and the
   * hang probe. Call when the view is built, before its first load.
   *
   * @throws Error when already attached, when `contents` is destroyed, or when
   *   Electron refuses the attach (another client holds the debugger)
   */
  attach(contents: CdpWebContents): void {
    if (this.contents) throw new Error('BrowserCdpSession is already attached')
    if (contents.isDestroyed()) throw new Error('Cannot attach to a destroyed webContents')
    const dbg = contents.debugger
    dbg.attach('1.3')
    this.contents = contents
    this.lastDetachInfo = null
    dbg.on('message', this.onMessage)
    dbg.on('detach', this.onDetach)
    contents.on('did-navigate', this.onDidNavigate)
    contents.on('did-frame-navigate', this.onDidFrameNavigate)
    const top = this.addTarget(TOP_TARGET, '', 'page', '', null)
    this.startTarget(top)
    this.probe.resume('detached')
    this.probe.start()
  }

  /** Detaches on Erfana's own initiative (view teardown). Emits nothing. Idempotent. */
  detach(): void {
    const contents = this.contents
    if (!contents) return
    this.teardown()
    try {
      if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach()
    } catch (error) {
      logger.debug('Browser CDP: detach failed', { error: String(error) })
    }
  }

  /**
   * Sends `method` to the target `sessionKey` (default: the top target).
   *
   * @throws CdpRefusedError synchronously, before anything is sent, when the
   *   allow-list refuses the method or its params, when a pick-only domain is
   *   used outside pick mode, or when `Runtime.evaluate` names a child target
   * @throws Error synchronously when not attached or the target is unknown
   */
  send(method: string, params?: unknown, sessionKey: string = TOP_TARGET): Promise<unknown> {
    const domain = method.slice(0, method.indexOf('.'))
    if (PICK_ONLY_DOMAINS.includes(domain) && !method.endsWith('.disable') && !this.pickActive) {
      throw this.refused(method, 'pick mode is off')
    }
    if (method === 'Runtime.evaluate' && sessionKey !== TOP_TARGET) throw this.refused(method, 'top target only')
    const checked = this.check(method, params)
    const contents = this.contents
    if (!contents) throw new Error('BrowserCdpSession is not attached')
    if (!this.targets.has(sessionKey)) throw new Error('Unknown CDP target')
    return contents.debugger.sendCommand(method, checked, sessionKey === TOP_TARGET ? undefined : sessionKey)
  }

  /** Every attached target, the top one first. */
  attachedTargets(): readonly CdpTargetInfo[] {
    return [...this.targets.values()].map(({ sessionKey, targetId, type, url }) => ({ sessionKey, targetId, type, url }))
  }

  /** The recent console entries and failed requests, frozen, as of now (025-FR-038, 025-FR-053). */
  logSnapshot(): LogSnapshot {
    return this.buffer.snapshot()
  }

  /**
   * Turns `DOM`, `CSS` and `Overlay` on in every frame target (pick mode
   * starts). Frames attaching later get them too, until
   * {@link disablePickDomains}.
   *
   * @throws when the top target refuses them (child failures are logged only)
   */
  async enablePickDomains(): Promise<void> {
    if (this.kind !== 'tab') throw this.refused('DOM.enable', `not allowed for the ${this.kind} kind`)
    this.pickActive = true
    const top = this.sendAll(['DOM.enable', 'CSS.enable', 'Overlay.enable'], TOP_TARGET)
    for (const target of this.targets.values()) {
      if (target.sessionKey !== TOP_TARGET && isFrameTarget(target)) this.enablePickOn(target)
    }
    await top
  }

  /** Turns `DOM`, `CSS` and `Overlay` off in every frame target (every pick end). Never rejects. */
  async disablePickDomains(): Promise<void> {
    this.pickActive = false
    if (!this.contents) return
    const sends = [...this.targets.values()]
      .filter(isFrameTarget)
      .map(t => this.sendAll(['Overlay.disable', 'CSS.disable', 'DOM.disable'], t.sessionKey).catch(() => undefined))
    await Promise.all(sends)
  }

  private check(method: string, params: unknown): ReturnType<typeof checkCdpCommand> {
    try {
      return checkCdpCommand(this.kind, method, params)
    } catch (error) {
      if (error instanceof CdpRefusedError) logger.warn('Browser CDP: command refused', { method, rule: error.rule })
      throw error
    }
  }

  private refused(method: string, rule: string): CdpRefusedError {
    logger.warn('Browser CDP: command refused', { method, rule })
    return new CdpRefusedError(method, rule)
  }

  /** {@link send}, with a synchronous refusal turned into a rejection. */
  private sendAsync(method: string, params: unknown, sessionKey: string): Promise<unknown> {
    try {
      return this.send(method, params, sessionKey)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Sends `methods` in order without awaiting each; resolves when all are answered. */
  private sendAll(methods: readonly string[], sessionKey: string): Promise<void> {
    return Promise.all(methods.map(m => this.sendAsync(m, undefined, sessionKey))).then(() => undefined)
  }

  /** Fire and forget: a failure (a target that vanished) is logged at debug level only. */
  private fire(method: string, sessionKey: string, params?: unknown): void {
    this.sendAsync(method, params, sessionKey).catch(error =>
      logger.debug('Browser CDP: command failed', { method, error: String(error) })
    )
  }

  private enablePickOn(target: TargetRecord): void {
    this.sendAll(['DOM.enable', 'CSS.enable', 'Overlay.enable'], target.sessionKey).catch(error =>
      logger.debug('Browser CDP: pick domains failed on a frame', { error: String(error) })
    )
  }

  private addTarget(sessionKey: string, targetId: string, type: string, url: string, parentKey: string | null): TargetRecord {
    const record: TargetRecord = {
      sessionKey,
      targetId,
      type,
      url,
      parentKey,
      budget: new CdpFloodBudget(this.clock),
      logsOff: false,
      release: undefined,
      resume: undefined
    }
    this.targets.set(sessionKey, record)
    return record
  }

  /** The browser identity, auto-attach and the log domains, each sent without awaiting the last. */
  private startTarget(target: TargetRecord): void {
    if (this.userAgent !== null) this.fire(userAgentOverrideMethod(target.type), target.sessionKey, this.userAgent)
    this.fire('Target.setAutoAttach', target.sessionKey, AUTO_ATTACH_PARAMS)
    this.enableLogs(target)
  }

  private enableLogs(target: TargetRecord): void {
    this.fire('Runtime.enable', target.sessionKey)
    this.fire('Log.enable', target.sessionKey)
    if (this.source === 'network') this.fire('Network.enable', target.sessionKey, NETWORK_ENABLE_PARAMS)
  }

  private disableLogs(target: TargetRecord): void {
    this.fire('Runtime.disable', target.sessionKey)
    this.fire('Log.disable', target.sessionKey)
    if (this.source === 'network') this.fire('Network.disable', target.sessionKey)
  }

  private info(target: TargetRecord): CdpTargetInfo {
    return { sessionKey: target.sessionKey, targetId: target.targetId, type: target.type, url: target.url }
  }

  private scope(target: TargetRecord): LogScope {
    const isTop = target.sessionKey === TOP_TARGET
    return {
      sessionKey: target.sessionKey,
      rootFrameKey: isTop ? 'top' : target.targetId,
      rootOrigin: () => originOf(isTop ? this.topUrl : target.url)
    }
  }

  private readonly onMessage: CdpMessageListener = (_event, method, params, sessionId) => {
    const target = this.targets.get(sessionId ?? TOP_TARGET)
    if (!target) return
    if (target.budget.count(eventPayloadSize(params))) this.floodTripped(target)
    if (!isLogEvent(method)) {
      this.protocolEvent(target, method, params)
      return
    }
    if (target.logsOff) return
    if (method === 'Runtime.executionContextsCleared' && target.sessionKey === TOP_TARGET) this.buffer.clearAll()
    if (this.collector.handle(this.scope(target), method, params)) this.scheduleRelease(target)
  }

  private protocolEvent(target: TargetRecord, method: string, params: unknown): void {
    if (method === 'Target.attachedToTarget') this.childAttached(target, params)
    else if (method === 'Target.detachedFromTarget') this.childDetached(params)
    else if (target.sessionKey === TOP_TARGET && method === 'Page.javascriptDialogOpening') this.probe.suspend('dialog')
    else if (target.sessionKey === TOP_TARGET && method === 'Page.javascriptDialogClosed') this.probe.resume('dialog')
    this.hub.emit('protocolEvent', { target: this.info(target), method, params })
  }

  private childAttached(parent: TargetRecord, params: unknown): void {
    if (!isRecord(params) || !isRecord(params.targetInfo)) return
    const sessionKey = str(params.sessionId)
    if (!sessionKey || this.targets.has(sessionKey)) return
    const info = params.targetInfo
    const child = this.addTarget(sessionKey, str(info.targetId), str(info.type), str(info.url), parent.sessionKey)
    this.startTarget(child)
    if (this.pickActive && isFrameTarget(child)) this.enablePickOn(child)
    this.hub.emit('targetAttached', this.info(child))
    if (params.waitingForDebugger === true) this.scheduleResume(child)
  }

  /** Resumes a waiting child on a later task ({@link RESUME_DELAY_MS}); its removal clears the timer. */
  private scheduleResume(target: TargetRecord): void {
    target.resume = this.clock.setTimeout(() => {
      target.resume = undefined
      this.fire('Runtime.runIfWaitingForDebugger', target.sessionKey)
    }, RESUME_DELAY_MS)
  }

  private childDetached(params: unknown): void {
    if (!isRecord(params)) return
    const target = this.targets.get(str(params.sessionId))
    if (!target || target.sessionKey === TOP_TARGET) return
    this.removeTarget(target)
  }

  /** Removes `target` and every target attached through it. */
  private removeTarget(target: TargetRecord): void {
    for (const child of [...this.targets.values()]) {
      if (child.parentKey === target.sessionKey) this.removeTarget(child)
    }
    this.targets.delete(target.sessionKey)
    this.clearTimers(target)
    this.collector.forgetTarget(target.sessionKey)
    // A frame target goes when its frame is removed or gets a cross-site
    // document: its entries go with it. A worker's stay – its failed requests
    // count for the tab after it ends (025-FR-038).
    if (target.type === 'iframe') this.buffer.clearFrame(target.targetId)
    this.hub.emit('targetDetached', this.info(target))
  }

  private clearTimers(target: TargetRecord): void {
    this.clock.clearTimeout(target.release)
    this.clock.clearTimeout(target.resume)
    target.release = undefined
    target.resume = undefined
  }

  private floodTripped(target: TargetRecord): void {
    target.logsOff = true
    this.buffer.markTruncated(this.scope(target).rootFrameKey)
    this.disableLogs(target)
    logger.warn('Browser CDP: flood budget exceeded, logs off until navigation', { targetType: target.type })
    this.hub.emit('logsTruncated', this.info(target))
  }

  private rearm(target: TargetRecord): void {
    target.budget.reset()
    if (!target.logsOff) return
    target.logsOff = false
    this.enableLogs(target)
  }

  private scheduleRelease(target: TargetRecord): void {
    if (target.release !== undefined) return
    target.release = this.clock.setTimeout(() => {
      target.release = undefined
      if (this.targets.get(target.sessionKey) !== target) return
      this.fire('Runtime.releaseObjectGroup', target.sessionKey, { objectGroup: CONSOLE_OBJECT_GROUP })
      this.fire('Runtime.discardConsoleEntries', target.sessionKey)
    }, CONSOLE_RELEASE_DELAY_MS)
  }

  private readonly onDidNavigate: DidNavigateListener = (_event, url) => {
    this.topUrl = url
    const top = this.targets.get(TOP_TARGET)
    if (!top) return
    // With its logs on, the top target's executionContextsCleared already
    // cleared the frames, in order with the new document's first entries.
    if (top.logsOff) this.buffer.clearAll()
    this.rearm(top)
  }

  private readonly onDidFrameNavigate: DidFrameNavigateListener = (_event, _url, _code, _text, isMainFrame) => {
    if (isMainFrame) return
    for (const target of this.targets.values()) {
      if (target.sessionKey !== TOP_TARGET && target.logsOff) this.rearm(target)
    }
  }

  private readonly onDetach: CdpDetachListener = (_event, reason) => {
    const contents = this.contents
    if (!contents) return
    const cause = detachCause(contents, reason)
    this.teardown()
    this.lastDetachInfo = { cause, reason }
    logger.info('Browser CDP: debugger detached', { cause, reason })
    this.hub.emit('detached', this.lastDetachInfo)
  }

  private teardown(): void {
    const contents = this.contents
    if (!contents) return
    this.contents = null
    contents.debugger.removeListener('message', this.onMessage)
    contents.debugger.removeListener('detach', this.onDetach)
    contents.removeListener('did-navigate', this.onDidNavigate)
    contents.removeListener('did-frame-navigate', this.onDidFrameNavigate)
    for (const target of this.targets.values()) this.clearTimers(target)
    this.targets.clear()
    this.collector.reset()
    this.pickActive = false
    this.probe.suspend('detached')
    this.probe.stop()
  }
}
