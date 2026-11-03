// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One fixture site: a folder served over HTTP and HTTPS, with the shared test
 * endpoints of `commonRoutes.ts`, optional site routes, origin templating and
 * a request log.
 *
 * **Origin templating.** Ports are assigned by the OS per worker, so a page
 * cannot hard-code another site's address. In `.html` and `.js` files (not in
 * a prebuilt `bundle/`), the server replaces
 * `{{origin <site> <http|https> [host]}}` with that site's origin, for example
 * `{{origin static http other.test}}` → `http://other.test:54321`. An unknown
 * site answers 500 naming the token, so a typo fails loudly.
 */

import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import type { AddressInfo } from 'node:net'
import * as path from 'node:path'
import type { SecureContextOptions } from 'node:tls'

import { handleCommonRoute } from './commonRoutes'
import type { HeldResponses } from './heldResponses'
import { sendText } from './respond'

export type Scheme = 'http' | 'https'

export interface RequestContext {
  readonly req: http.IncomingMessage
  readonly res: http.ServerResponse
  /** The request URL, resolved against `<scheme>://<host>`. */
  readonly url: URL
  readonly scheme: Scheme
  /** Host name from the `Host` header, lower case, no port. */
  readonly host: string
}

/** Returns true when it answered the request. */
export type RouteHandler = (ctx: RequestContext) => boolean | Promise<boolean>

/** One request any fixture server saw. */
export interface RecordedRequest {
  readonly site: string
  readonly scheme: Scheme
  readonly host: string
  readonly method: string
  /** Path and query, as sent. */
  readonly path: string
  /** `Date.now()` on arrival. */
  readonly at: number
}

/** Resolves `{{origin <site> <scheme> [host]}}`; undefined for an unknown site. */
export type OriginResolver = (site: string, scheme: Scheme, host?: string) => string | undefined

export interface SiteOptions {
  readonly name: string
  /** Absolute folder the site serves. */
  readonly root: string
  readonly log: RecordedRequest[]
  readonly held: HeldResponses
  readonly resolveOrigin: OriginResolver
  /** Site routes, tried after the common `/__*` endpoints and before files. */
  readonly routes?: readonly RouteHandler[]
  /** Maps a request path to the file path to serve; null answers 404. */
  readonly rewritePath?: (pathname: string) => string | null
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8'
}

const NOT_FOUND_PAGE = '<!doctype html><title>404</title><h1>404 – not found</h1>'
const TEMPLATED_EXTENSIONS = new Set(['.html', '.js'])
const ORIGIN_TOKEN = /\{\{origin ([a-z0-9]+) (https?)(?: ([a-z0-9.-]+))?\}\}/g

/** Maps a URL path into `root`, or null when it escapes it or cannot be decoded. */
export function resolveInsideRoot(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const full = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`)
  return full === root || full.startsWith(root + path.sep) ? full : null
}

function applyOriginTokens(text: string, resolveOrigin: OriginResolver): string {
  return text.replace(ORIGIN_TOKEN, (token, site: string, scheme: Scheme, host?: string) => {
    const origin = resolveOrigin(site, scheme, host)
    if (origin === undefined) throw new Error(`Unknown fixture site in ${token}`)
    return origin
  })
}

async function serveFile(ctx: RequestContext, options: SiteOptions): Promise<void> {
  const pathname = options.rewritePath ? options.rewritePath(ctx.url.pathname) : ctx.url.pathname
  if (pathname === null) {
    sendText(ctx.res, 404, NOT_FOUND_PAGE)
    return
  }
  const target = resolveInsideRoot(options.root, pathname)
  if (target === null) {
    sendText(ctx.res, 400, '<h1>400 – bad path</h1>')
    return
  }
  let file = target
  const stat = await fs.promises.stat(file).catch(() => null)
  if (stat?.isDirectory()) {
    // As a static server does: a folder URL without its slash would resolve the page's relative URLs one level up.
    if (!ctx.url.pathname.endsWith('/')) {
      ctx.res.writeHead(301, { Location: `${ctx.url.pathname}/${ctx.url.search}`, 'Cache-Control': 'no-store' })
      ctx.res.end()
      return
    }
    file = path.join(file, 'index.html')
  }
  const bytes = await fs.promises.readFile(file).catch(() => null)
  if (bytes === null) {
    sendText(ctx.res, 404, NOT_FOUND_PAGE)
    return
  }
  const ext = path.extname(file)
  const inBundle = file.split(path.sep).includes('bundle')
  const body =
    TEMPLATED_EXTENSIONS.has(ext) && !inBundle
      ? applyOriginTokens(bytes.toString('utf8'), options.resolveOrigin)
      : bytes
  ctx.res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store'
  })
  ctx.res.end(body)
}

/** The request listener for one site, bound to the scheme of its server. */
export function createSiteListener(
  options: SiteOptions,
  scheme: Scheme
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const hostHeader = req.headers.host ?? 'invalid.test'
    const url = new URL(req.url ?? '/', `${scheme}://${hostHeader}`)
    const ctx: RequestContext = { req, res, url, scheme, host: url.hostname.toLowerCase() }
    options.log.push({
      site: options.name,
      scheme,
      host: ctx.host,
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      at: Date.now()
    })
    void route(ctx, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) sendText(res, 500, message, 'text/plain; charset=utf-8')
      else res.destroy()
    })
  }
}

async function route(ctx: RequestContext, options: SiteOptions): Promise<void> {
  if (handleCommonRoute(ctx, options.held)) return
  for (const handler of options.routes ?? []) {
    if (await handler(ctx)) return
  }
  await serveFile(ctx, options)
}

export interface ListeningServer {
  readonly server: http.Server | https.Server
  readonly port: number
}

/** Starts an HTTP server, or an HTTPS one when `tls` is given, on an OS-assigned loopback port. */
export async function listen(
  listener: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  tls?: SecureContextOptions
): Promise<ListeningServer> {
  const server = tls ? https.createServer(tls, listener) : http.createServer(listener)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return { server, port: (server.address() as AddressInfo).port }
}

export function closeServer(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve) => {
    // Drop keep-alive sockets so close() does not wait on an idle client.
    server.closeAllConnections()
    server.close(() => resolve())
  })
}
