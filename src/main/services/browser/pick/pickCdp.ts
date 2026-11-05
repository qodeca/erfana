// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The part of a tab's CDP session pick mode uses, and the small read helpers
 * on top of it (spec 025, solution design § 4, § 5; ADR 0007 decisions 3, 4
 * and 10).
 *
 * Every command still goes through `BrowserCdpSession.send` and its
 * allow-list; this module adds nothing the list does not allow. Page
 * functions are the pinned ones of `cdp/cdpPickFunctions.ts`.
 *
 * - {@link PickReader.call} turns the session's synchronous refusals into
 *   rejections, so a caller has one failure path.
 * - Isolated worlds (`Page.createIsolatedWorld`, the pinned world name) are
 *   created once per frame and cached until {@link PickReader.reset} – a new
 *   document, a frame gone, or pick mode ending.
 * - Object handles live in the pick object group and are released at
 *   {@link PickReader.releaseAll}.
 */
import type { LogSnapshot } from '../cdp/browserLogBuffer'
import type { BrowserCdpSessionEvents, CdpTargetInfo, HangProbeControl } from '../cdp/cdpSessionTypes'
import { ISOLATED_WORLD_NAME, PICK_OBJECT_GROUP, type CdpPageFunction } from '../cdp/cdpPinned'
import { isRecord } from '../cdp/cdpTypes'

/** The session surface pick mode needs; `BrowserCdpSession` fits it. */
export interface PickCdp {
  readonly attached: boolean
  readonly hangProbe: HangProbeControl
  send(method: string, params?: unknown, sessionKey?: string): Promise<unknown>
  attachedTargets(): readonly CdpTargetInfo[]
  on<K extends keyof BrowserCdpSessionEvents>(event: K, listener: (payload: BrowserCdpSessionEvents[K]) => void): () => void
  enablePickDomains(): Promise<void>
  disablePickDomains(): Promise<void>
  logSnapshot(): LogSnapshot
}

/** The top target's session key (`BrowserCdpSession.TOP_TARGET`). */
export const TOP_SESSION = ''

/** One DOM node, as pick mode names it: the session that owns it, its backend id and its frame. */
export interface PickNode {
  readonly sessionKey: string
  readonly backendNodeId: number
  readonly frameId: string
}

/** Thrown when a page function threw or returned nothing usable. */
export class PickReadError extends Error {
  constructor(readonly fn: string) {
    super(`Pick read failed: ${fn}`)
    this.name = 'PickReadError'
  }
}

/** `value` when `raw` is a CDP `{ result: { value } }` answer with no exception. */
function resultValue(fn: string, raw: unknown): unknown {
  if (!isRecord(raw) || raw.exceptionDetails !== undefined || !isRecord(raw.result)) throw new PickReadError(fn)
  return raw.result
}

export class PickReader {
  private readonly worlds = new Map<string, Promise<number>>()

  constructor(private readonly cdp: PickCdp) {}

  /** Send one command; a synchronous refusal becomes a rejection. */
  call(method: string, params: unknown, sessionKey: string): Promise<unknown> {
    try {
      return this.cdp.send(method, params, sessionKey)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Forget the isolated worlds (a new document, a frame gone, pick mode ended). */
  reset(): void {
    this.worlds.clear()
  }

  /** Forget the isolated worlds of one session (its target went). */
  forgetSession(sessionKey: string): void {
    for (const key of [...this.worlds.keys()]) if (key.startsWith(`${sessionKey}|`)) this.worlds.delete(key)
  }

  /** Release every pick handle in every attached frame target. Never rejects. */
  async releaseAll(): Promise<void> {
    const keys = this.cdp.attachedTargets().map((t) => t.sessionKey)
    await Promise.all(
      keys.map((key) => this.call('Runtime.releaseObjectGroup', { objectGroup: PICK_OBJECT_GROUP }, key).catch(() => undefined))
    )
  }

  /**
   * A handle to `node` in Erfana's isolated world (`world: 'isolated'`) or in
   * the page's main world (`'main'`, the React lookup only).
   */
  async resolve(node: PickNode, world: 'isolated' | 'main'): Promise<string> {
    const base = { backendNodeId: node.backendNodeId, objectGroup: PICK_OBJECT_GROUP }
    if (world === 'main') return objectIdOf(await this.call('DOM.resolveNode', base, node.sessionKey))
    try {
      const executionContextId = await this.world(node)
      return objectIdOf(await this.call('DOM.resolveNode', { ...base, executionContextId }, node.sessionKey))
    } catch {
      // A stale world (the frame got a new document): make a fresh one once.
      this.worlds.delete(worldKey(node))
      const executionContextId = await this.world(node)
      return objectIdOf(await this.call('DOM.resolveNode', { ...base, executionContextId }, node.sessionKey))
    }
  }

  /** Run a pinned function on `objectId` and return its value. */
  async callValue(sessionKey: string, objectId: string, fn: CdpPageFunction, args: readonly unknown[] = []): Promise<unknown> {
    const raw = await this.call('Runtime.callFunctionOn', this.callParams(objectId, fn, args, true), sessionKey)
    const result = resultValue(fn.name, raw) as Record<string, unknown>
    return result.value
  }

  /** Run a pinned function on `objectId` and return the handle it returned, or null. */
  async callObject(sessionKey: string, objectId: string, fn: CdpPageFunction, args: readonly unknown[] = []): Promise<string | null> {
    const raw = await this.call('Runtime.callFunctionOn', this.callParams(objectId, fn, args, false), sessionKey)
    const result = resultValue(fn.name, raw) as Record<string, unknown>
    return typeof result.objectId === 'string' && result.objectId !== '' ? result.objectId : null
  }

  /**
   * Run a pinned function on `objectId` that returns an `Error` by handle,
   * and give that error's protocol description – V8 writes its stack there –
   * or null when the result is not an error. The handle stays in the pick
   * object group until {@link releaseAll}.
   */
  async callErrorDescription(sessionKey: string, objectId: string, fn: CdpPageFunction): Promise<string | null> {
    const raw = await this.call('Runtime.callFunctionOn', this.callParams(objectId, fn, [], false), sessionKey)
    const result = resultValue(fn.name, raw) as Record<string, unknown>
    return result.subtype === 'error' && typeof result.description === 'string' ? result.description : null
  }

  /** Run a pinned function on `node` in the isolated world. */
  async valueOn(node: PickNode, fn: CdpPageFunction, args: readonly unknown[] = []): Promise<unknown> {
    return this.callValue(node.sessionKey, await this.resolve(node, 'isolated'), fn, args)
  }

  private callParams(objectId: string, fn: CdpPageFunction, args: readonly unknown[], byValue: boolean): Record<string, unknown> {
    return {
      functionDeclaration: fn.source,
      objectId,
      throwOnSideEffect: fn.throwOnSideEffect,
      returnByValue: byValue,
      silent: true,
      objectGroup: PICK_OBJECT_GROUP,
      userGesture: false,
      awaitPromise: false,
      ...(args.length === 0 ? {} : { arguments: args.map((value) => ({ value })) })
    }
  }

  private world(node: PickNode): Promise<number> {
    const key = worldKey(node)
    let world = this.worlds.get(key)
    if (world === undefined) {
      world = this.call('Page.createIsolatedWorld', { frameId: node.frameId, worldName: ISOLATED_WORLD_NAME, grantUniveralAccess: false }, node.sessionKey).then(
        (raw) => {
          const id = isRecord(raw) ? raw.executionContextId : undefined
          if (typeof id !== 'number') throw new PickReadError('createIsolatedWorld')
          return id
        }
      )
      world.catch(() => this.worlds.delete(key))
      this.worlds.set(key, world)
    }
    return world
  }
}

const worldKey = (node: PickNode): string => `${node.sessionKey}|${node.frameId}`

function objectIdOf(raw: unknown): string {
  const object = isRecord(raw) ? raw.object : undefined
  const id = isRecord(object) ? object.objectId : undefined
  if (typeof id !== 'string' || id === '') throw new PickReadError('resolveNode')
  return id
}

/** A number field of a CDP answer, or `fallback`. */
export function numberField(raw: unknown, key: string, fallback = 0): number {
  const value = isRecord(raw) ? raw[key] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A string field of a CDP answer, or `''`. */
export function stringField(raw: unknown, key: string): string {
  const value = isRecord(raw) ? raw[key] : undefined
  return typeof value === 'string' ? value : ''
}
