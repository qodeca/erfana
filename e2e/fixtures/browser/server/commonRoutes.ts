// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test endpoints every fixture site answers, under the reserved `/__` prefix:
 *
 * | Path | Answer |
 * |---|---|
 * | `/__hold/<key>` | held until the test releases it (`heldResponses.ts`) |
 * | `/__status/<code>` | that status (a 500, a 404 for the recent-errors list) |
 * | `/__redirect?to=<path or http(s) URL>` | 302 to it |
 * | `/__download/<name>?bytes=N` | an attachment named `<name>`, N bytes (default 1024) |
 * | `/__download-drop/<name>?bytes=N` | announces N bytes, sends half, then drops the connection |
 * | `/__download-held/<name>?key=K&bytes=N` | sends half, then the rest only when the test calls `held.release(K)` |
 * | `/__bytes/<n>` | n cacheable bytes (HTTP cache size tests); vary `?v=` for distinct entries |
 * | `/__headers` | the request headers as JSON, CORS-open (user-agent and `Sec-CH-UA` checks) |
 * | `/__cors` | `{"ok":true}`, CORS-open – the control for the CORS-blocked request |
 * | `/__cookie-probe` | sets the persistent cookie `probe=erfana-cookie-probe-7f3a` |
 *
 * Any other path is CORS-closed, so a cross-origin `fetch` of it is blocked.
 */

import { Readable } from 'node:stream'

import { HOLD_KEY_PATTERN, type HeldResponses } from './heldResponses'
import { escapeHtml, sendJson, sendText } from './respond'
import type { RequestContext } from './siteServer'

/** Cap for one generated body, so a typo cannot stream gigabytes. */
export const MAX_GENERATED_BYTES = 64 * 1024 * 1024
export const COOKIE_PROBE_VALUE = 'erfana-cookie-probe-7f3a'
const DEFAULT_DOWNLOAD_BYTES = 1024
const CHUNK_BYTES = 64 * 1024
const CORS_OPEN = { 'Access-Control-Allow-Origin': '*' }

function byteCount(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback
  if (!/^\d{1,9}$/.test(raw)) return null
  const value = Number(raw)
  return value <= MAX_GENERATED_BYTES ? value : null
}

/** A deterministic body of `total` bytes, streamed in chunks. */
function generatedBody(total: number): Readable {
  const line = Buffer.from('erfana browser fixture bytes\n')
  return Readable.from(
    (function* chunks() {
      let left = total
      while (left > 0) {
        const size = Math.min(left, CHUNK_BYTES)
        const chunk = Buffer.alloc(size)
        for (let offset = 0; offset < size; offset += line.length) line.copy(chunk, offset)
        left -= size
        yield chunk
      }
    })()
  )
}

/** RFC 6266 `filename*` keeps any name intact and cannot inject a header. */
function attachment(name: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
}

function isSafeRedirect(to: string): boolean {
  if (to.startsWith('/') && !to.startsWith('//')) return true
  try {
    const url = new URL(to)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function lastSegment(pathname: string, prefix: string): string {
  try {
    return decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    return ''
  }
}

function handleStatus(ctx: RequestContext): void {
  const code = Number(ctx.url.pathname.slice('/__status/'.length))
  if (!Number.isInteger(code) || code < 200 || code > 599) {
    sendText(ctx.res, 400, '<h1>400 – status must be 200–599</h1>')
    return
  }
  if (code === 204 || code === 304) {
    ctx.res.writeHead(code, { 'Cache-Control': 'no-store' })
    ctx.res.end()
    return
  }
  sendText(ctx.res, code, `<!doctype html><title>${code}</title><h1>Status ${code}</h1>`)
}

type DownloadMode = 'full' | 'drop' | 'held'

function handleDownload(ctx: RequestContext, prefix: string, mode: DownloadMode, held: HeldResponses): void {
  const name = lastSegment(ctx.url.pathname, prefix)
  const total = byteCount(ctx.url.searchParams.get('bytes'), DEFAULT_DOWNLOAD_BYTES)
  const key = ctx.url.searchParams.get('key') ?? ''
  if (name === '' || total === null || (mode === 'held' && !HOLD_KEY_PATTERN.test(key))) {
    sendText(ctx.res, 400, '<h1>400 – name, a byte count up to 64 MiB and (held) a key required</h1>')
    return
  }
  ctx.res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': attachment(name),
    'Content-Length': String(total),
    'Cache-Control': 'no-store'
  })
  if (mode === 'full') {
    generatedBody(total).pipe(ctx.res)
    return
  }
  const half = Math.floor(total / 2)
  const firstHalf = generatedBody(half)
  firstHalf.on('end', () => {
    // drop: a hard close, so the client sees a truncated transfer, not a clean end.
    if (mode === 'drop') ctx.res.socket?.destroy()
    else held.holdRest(key, ctx.res, () => generatedBody(total - half).pipe(ctx.res))
  })
  firstHalf.pipe(ctx.res, { end: false })
}

function handleBytes(ctx: RequestContext): void {
  const total = byteCount(lastSegment(ctx.url.pathname, '/__bytes/'), 0)
  if (total === null) {
    sendText(ctx.res, 400, '<h1>400 – byte count up to 64 MiB required</h1>')
    return
  }
  ctx.res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(total),
    'Cache-Control': 'public, max-age=31536000, immutable'
  })
  generatedBody(total).pipe(ctx.res)
}

/** Returns true when the path is one of the common endpoints and was answered. */
export function handleCommonRoute(ctx: RequestContext, held: HeldResponses): boolean {
  const { pathname } = ctx.url
  if (!pathname.startsWith('/__')) return false

  if (pathname.startsWith('/__hold/')) {
    const key = lastSegment(pathname, '/__hold/')
    if (!held.hold(key, ctx.res)) sendText(ctx.res, 400, '<h1>400 – hold key must match [A-Za-z0-9_-]{1,64}</h1>')
    return true
  }
  if (pathname.startsWith('/__status/')) {
    handleStatus(ctx)
    return true
  }
  if (pathname === '/__redirect') {
    const to = ctx.url.searchParams.get('to') ?? ''
    if (!isSafeRedirect(to)) {
      sendText(ctx.res, 400, `<h1>400 – unsafe redirect target ${escapeHtml(to)}</h1>`)
      return true
    }
    ctx.res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' })
    ctx.res.end()
    return true
  }
  if (pathname.startsWith('/__download/')) {
    handleDownload(ctx, '/__download/', 'full', held)
    return true
  }
  if (pathname.startsWith('/__download-drop/')) {
    handleDownload(ctx, '/__download-drop/', 'drop', held)
    return true
  }
  if (pathname.startsWith('/__download-held/')) {
    handleDownload(ctx, '/__download-held/', 'held', held)
    return true
  }
  if (pathname.startsWith('/__bytes/')) {
    handleBytes(ctx)
    return true
  }
  if (pathname === '/__headers') {
    sendJson(ctx.res, 200, ctx.req.headers, CORS_OPEN)
    return true
  }
  if (pathname === '/__cors') {
    sendJson(ctx.res, 200, { ok: true }, CORS_OPEN)
    return true
  }
  if (pathname === '/__cookie-probe') {
    sendText(ctx.res, 200, '<!doctype html><title>cookie probe</title><h1>Cookie set</h1>', undefined, {
      'Set-Cookie': `probe=${COOKIE_PROBE_VALUE}; Max-Age=86400; Path=/; SameSite=Lax`
    })
    return true
  }
  return false
}
