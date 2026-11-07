// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fake Electron `webContents` and `debugger` for the CDP unit tests. The
 * debugger records every command; each reply is decided by `reply` (default:
 * resolve `{}` at once), and a test can hold replies to prove that commands
 * were sent without awaiting each other.
 */
import type {
  CdpDebugger,
  CdpDetachListener,
  CdpMessageListener,
  CdpWebContents,
  DidFrameNavigateListener,
  DidNavigateListener
} from '../cdpTypes'

export interface SentCommand {
  readonly method: string
  readonly params: unknown
  readonly sessionId: string | undefined
}

export type Reply = (command: SentCommand) => Promise<unknown>

export class FakeDebugger implements CdpDebugger {
  readonly sent: SentCommand[] = []
  attached = false
  attachError: Error | null = null
  reply: Reply = () => Promise.resolve({})
  private readonly messageListeners = new Set<CdpMessageListener>()
  private readonly detachListeners = new Set<CdpDetachListener>()

  attach(): void {
    if (this.attachError) throw this.attachError
    this.attached = true
  }

  detach(): void {
    this.attached = false
  }

  isAttached(): boolean {
    return this.attached
  }

  sendCommand(method: string, commandParams?: unknown, sessionId?: string): Promise<unknown> {
    const command = { method, params: commandParams, sessionId }
    this.sent.push(command)
    return this.reply(command)
  }

  on(event: 'message', listener: CdpMessageListener): this
  on(event: 'detach', listener: CdpDetachListener): this
  on(event: 'message' | 'detach', listener: CdpMessageListener | CdpDetachListener): this {
    if (event === 'message') this.messageListeners.add(listener as CdpMessageListener)
    else this.detachListeners.add(listener as CdpDetachListener)
    return this
  }

  removeListener(event: 'message', listener: CdpMessageListener): this
  removeListener(event: 'detach', listener: CdpDetachListener): this
  removeListener(event: 'message' | 'detach', listener: CdpMessageListener | CdpDetachListener): this {
    if (event === 'message') this.messageListeners.delete(listener as CdpMessageListener)
    else this.detachListeners.delete(listener as CdpDetachListener)
    return this
  }

  get listenerCount(): number {
    return this.messageListeners.size + this.detachListeners.size
  }

  /** Delivers a CDP event, as Electron does (`''` is the top target). */
  emit(method: string, params: unknown = {}, sessionId = ''): void {
    for (const listener of [...this.messageListeners]) listener({}, method, params, sessionId)
  }

  emitDetach(reason = 'target closed'): void {
    this.attached = false
    for (const listener of [...this.detachListeners]) listener({}, reason)
  }

  /** Methods sent, optionally to one session (`''` = top). */
  methods(sessionId?: string): string[] {
    return this.sent
      .filter(c => sessionId === undefined || (c.sessionId ?? '') === sessionId)
      .map(c => c.method)
  }

  clearSent(): void {
    this.sent.length = 0
  }
}

export class FakeContents implements CdpWebContents {
  readonly debugger = new FakeDebugger()
  destroyed = false
  devToolsOpened = false
  private readonly navigate = new Set<DidNavigateListener>()
  private readonly frameNavigate = new Set<DidFrameNavigateListener>()

  isDestroyed(): boolean {
    return this.destroyed
  }

  isDevToolsOpened(): boolean {
    return this.devToolsOpened
  }

  on(event: 'did-navigate', listener: DidNavigateListener): this
  on(event: 'did-frame-navigate', listener: DidFrameNavigateListener): this
  on(event: 'did-navigate' | 'did-frame-navigate', listener: DidNavigateListener | DidFrameNavigateListener): this {
    if (event === 'did-navigate') this.navigate.add(listener as DidNavigateListener)
    else this.frameNavigate.add(listener as DidFrameNavigateListener)
    return this
  }

  removeListener(event: 'did-navigate', listener: DidNavigateListener): this
  removeListener(event: 'did-frame-navigate', listener: DidFrameNavigateListener): this
  removeListener(event: 'did-navigate' | 'did-frame-navigate', listener: DidNavigateListener | DidFrameNavigateListener): this {
    if (event === 'did-navigate') this.navigate.delete(listener as DidNavigateListener)
    else this.frameNavigate.delete(listener as DidFrameNavigateListener)
    return this
  }

  get listenerCount(): number {
    return this.navigate.size + this.frameNavigate.size
  }

  emitDidNavigate(url: string): void {
    for (const listener of [...this.navigate]) listener({}, url)
  }

  emitDidFrameNavigate(url: string, isMainFrame: boolean): void {
    for (const listener of [...this.frameNavigate]) listener({}, url, 200, 'OK', isMainFrame)
  }
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** A console call event as `Runtime.consoleAPICalled` delivers it. */
export function consoleCall(type: string, text: string, executionContextId = 1): Record<string, unknown> {
  return { type, args: [{ type: 'string', value: text }], executionContextId, timestamp: 0 }
}

/** A default execution context for `frameId` (a new document). */
export function defaultContext(id: number, frameId: string, origin: string): Record<string, unknown> {
  return { context: { id, origin, name: '', auxData: { frameId, isDefault: true, type: 'default' } } }
}
