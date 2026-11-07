// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Responses the server holds until the test releases them (spec 025
 * acceptance, "Test rules": a fixture's state changes only when the test says
 * so, never on a wall-clock wait).
 *
 * Any site answers `GET /__hold/<key>` by keeping the request open. The test
 * waits for it to arrive, asserts whatever "while loading" state it needs, then
 * releases it with a page of its choosing – or asserts it was aborted (Stop,
 * a closed tab).
 *
 * ```ts
 * const url = servers.sites.static.url('/__hold/slow-b')
 * await page.click('#go') // navigates to url by script
 * await servers.held.waitForRequest('slow-b')
 * // … assert the address bar still shows the committed page …
 * servers.held.release('slow-b', { title: 'Page B', colour: '#2e7d32' })
 * ```
 */

import type * as http from 'node:http'

import { escapeHtml } from './respond'

/** Keys are path segments; anything else is refused with 400. */
export const HOLD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** What a released request answers with. Every field has a default. */
export interface HeldReply {
  /** HTTP status, default 200. */
  status?: number
  /** `<title>` of the default page, default the key. */
  title?: string
  /** Body background of the default page, default `#2e7d32`, so a PNG check can tell it apart. */
  colour?: string
  /** A full body to send instead of the default page. */
  body?: string
  /** Content type of `body`, default `text/html; charset=utf-8`. */
  contentType?: string
}

interface Waiter {
  readonly count: number
  readonly resolve: () => void
}

interface Parked {
  readonly res: http.ServerResponse
  /** Set for a response whose headers already went out: release() calls it instead of answering. */
  readonly resume?: () => void
}

interface KeyState {
  arrived: number
  aborted: number
  pending: Parked[]
  arrivalWaiters: Waiter[]
  abortWaiters: Waiter[]
}

const DEFAULT_COLOUR = '#2e7d32'

function defaultPage(key: string, reply: HeldReply): string {
  const title = escapeHtml(reply.title ?? key)
  const colour = escapeHtml(reply.colour ?? DEFAULT_COLOUR)
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="background:${colour}"><h1 id="held">${escapeHtml(key)}</h1></body></html>`
  )
}

export class HeldResponses {
  private readonly keys = new Map<string, KeyState>()

  private state(key: string): KeyState {
    let entry = this.keys.get(key)
    if (!entry) {
      entry = { arrived: 0, aborted: 0, pending: [], arrivalWaiters: [], abortWaiters: [] }
      this.keys.set(key, entry)
    }
    return entry
  }

  /** Server side: park the response. Returns false when the key is malformed. */
  hold(key: string, res: http.ServerResponse): boolean {
    return this.park(key, { res })
  }

  /**
   * Server side: park a response that is already under way (headers and part
   * of the body sent); `release(key)` calls `resume` to finish it. Returns
   * false when the key is malformed.
   */
  holdRest(key: string, res: http.ServerResponse, resume: () => void): boolean {
    return this.park(key, { res, resume })
  }

  private park(key: string, parked: Parked): boolean {
    if (!HOLD_KEY_PATTERN.test(key)) return false
    const entry = this.state(key)
    const { res } = parked
    entry.pending.push(parked)
    entry.arrived += 1
    res.on('close', () => {
      if (res.writableFinished) return
      const index = entry.pending.indexOf(parked)
      if (index === -1) return
      entry.pending.splice(index, 1)
      entry.aborted += 1
      entry.abortWaiters = settle(entry.abortWaiters, entry.aborted)
    })
    entry.arrivalWaiters = settle(entry.arrivalWaiters, entry.arrived)
    return true
  }

  /** Resolves once `count` requests for `key` have arrived in total (default 1). */
  waitForRequest(key: string, count = 1): Promise<void> {
    const entry = this.state(key)
    if (entry.arrived >= count) return Promise.resolve()
    return new Promise((resolve) => entry.arrivalWaiters.push({ count, resolve }))
  }

  /** Resolves once `count` held requests for `key` were closed by the client (Stop, tab closed). */
  waitForAbort(key: string, count = 1): Promise<void> {
    const entry = this.state(key)
    if (entry.aborted >= count) return Promise.resolve()
    return new Promise((resolve) => entry.abortWaiters.push({ count, resolve }))
  }

  /** How many requests for `key` are being held right now. */
  heldCount(key: string): number {
    return this.keys.get(key)?.pending.length ?? 0
  }

  /**
   * Answers every request held for `key`. Throws when none is held, so a test
   * that releases too early fails at the release, not at a later timeout.
   */
  release(key: string, reply: HeldReply = {}): void {
    const entry = this.keys.get(key)
    if (!entry || entry.pending.length === 0) {
      throw new Error(`No request is held for "${key}" – await waitForRequest("${key}") first`)
    }
    const parkedResponses = entry.pending.splice(0)
    for (const { res, resume } of parkedResponses) {
      if (resume) {
        resume()
        continue
      }
      res.writeHead(reply.status ?? 200, {
        'Content-Type': reply.contentType ?? 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(reply.body ?? defaultPage(key, reply))
    }
  }

  /** Ends every held response with 503 – used when the servers shut down. */
  releaseAll(): void {
    for (const [key, entry] of this.keys) {
      if (entry.pending.length > 0) this.release(key, { status: 503, title: 'fixture server closed' })
    }
  }
}

function settle(waiters: Waiter[], reached: number): Waiter[] {
  const remaining: Waiter[] = []
  for (const waiter of waiters) {
    if (reached >= waiter.count) waiter.resolve()
    else remaining.push(waiter)
  }
  return remaining
}
