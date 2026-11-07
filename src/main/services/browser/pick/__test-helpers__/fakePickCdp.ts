// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A fake of the CDP session surface pick mode uses (`PickCdp`). Each method
 * has a handler a test sets (`on('DOM.getBoxModel', …)`); a method with no
 * handler resolves `{}`. Every command is recorded with its session key.
 * Protocol events, target attach and detach are emitted by the test.
 */
import type { LogSnapshot } from '../../cdp/browserLogBuffer'
import { PICK_ONLY_DOMAINS } from '../../cdp/cdpAllowList'
import type { BrowserCdpSessionEvents, CdpTargetInfo, HangProbeControl } from '../../cdp/cdpSessionTypes'
import type { PickCdp } from '../pickCdp'

export interface SentPickCommand {
  readonly method: string
  readonly params: unknown
  readonly sessionKey: string
}

export type PickHandler = (params: Record<string, unknown>, sessionKey: string) => unknown

type Listener = (payload: unknown) => void

export class FakePickCdp implements PickCdp {
  attached = true
  readonly sent: SentPickCommand[] = []
  targets: CdpTargetInfo[] = [{ sessionKey: '', targetId: 'top', type: 'page', url: 'https://app.test/' }]
  logs: LogSnapshot = { console: [], failedRequests: [], truncated: false }
  readonly hangProbeCalls: string[] = []
  readonly hangProbe: HangProbeControl = {
    isHung: false,
    setVisible: () => undefined,
    suspend: (reason) => void this.hangProbeCalls.push(`suspend:${reason}`),
    resume: (reason) => void this.hangProbeCalls.push(`resume:${reason}`),
    wait: () => undefined
  }
  enabled = 0
  disabled = 0
  /**
   * Refuse DOM, CSS and Overlay commands (synchronously) while the pick
   * domains are off, as `BrowserCdpSession.send` does. Off by default, so
   * tests of a single module need not turn pick mode on.
   */
  gatePickDomains = false
  enableError: Error | null = null
  private readonly handlers = new Map<string, PickHandler>()
  private readonly listeners = new Map<string, Set<Listener>>()

  /** Answer `method` with `handler` (a throw or a rejected promise is a refusal). */
  handle(method: string, handler: PickHandler): this {
    this.handlers.set(method, handler)
    return this
  }

  send(method: string, params?: unknown, sessionKey = ''): Promise<unknown> {
    this.sent.push({ method, params, sessionKey })
    const domain = method.slice(0, method.indexOf('.'))
    if (this.gatePickDomains && PICK_ONLY_DOMAINS.includes(domain) && !method.endsWith('.disable') && this.enabled <= this.disabled) {
      throw new Error(`CDP refused ${method}: pick mode is off`)
    }
    const handler = this.handlers.get(method)
    if (handler === undefined) return Promise.resolve({})
    return Promise.resolve().then(() => handler((params ?? {}) as Record<string, unknown>, sessionKey))
  }

  /** The commands sent for `method`. */
  calls(method: string): SentPickCommand[] {
    return this.sent.filter((c) => c.method === method)
  }

  attachedTargets(): readonly CdpTargetInfo[] {
    return this.targets
  }

  on<K extends keyof BrowserCdpSessionEvents>(event: K, listener: (payload: BrowserCdpSessionEvents[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener)
    return () => set.delete(listener as Listener)
  }

  emit<K extends keyof BrowserCdpSessionEvents>(event: K, payload: BrowserCdpSessionEvents[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload)
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  async enablePickDomains(): Promise<void> {
    this.enabled += 1
    if (this.enableError !== null) throw this.enableError
  }

  async disablePickDomains(): Promise<void> {
    this.disabled += 1
  }

  logSnapshot(): LogSnapshot {
    return this.logs
  }
}

/** A frame target as `attachedTargets` lists it. */
export function frameTarget(sessionKey: string, targetId: string, url = 'https://other.test/'): CdpTargetInfo {
  return { sessionKey, targetId, type: 'iframe', url }
}
