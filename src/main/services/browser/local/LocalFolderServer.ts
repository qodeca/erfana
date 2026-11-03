// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One served folder: a static HTTP server on `127.0.0.1` and a port the
 * operating system picks (spec 025, 025-FR-005 rule 1; ADR 0012 option 4,
 * solution design § 11 Q4 – working assumption, owner decision pending).
 *
 * Addresses are `http://127.0.0.1:<port>/<token>/<path>`. The port makes the
 * folder its own origin, so two folders never share storage; the token – 128
 * random bits, new for every server – makes the address unguessable to
 * another local process or page. A request is answered in this order:
 *
 * 1. `Host` is exactly `127.0.0.1:<port>` (a DNS-rebinding page names another
 *    host) – else 403;
 * 2. `GET` or `HEAD` – else 405;
 * 3. the path starts with `/<token>/` (compared in constant time) – else 404;
 * 4. the fetch metadata allows it (`localResponsePolicy.ts`) – else 403;
 * 5. the path is well formed and names no refused file (`localRequestPath.ts`)
 *    – else 400 or 403;
 * 6. the file is confined to the folder by its real path
 *    (`localConfinedFile.ts`) – else 403 or 404;
 * 7. the file is streamed with the policy's headers and its content type.
 *
 * Nothing from the request reaches a response header or a log line.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pipeline } from 'node:stream'
import { logger } from '../../LoggingService'
import { mimeForExtension } from '../../preview/previewResponseHeaders'
import { openConfinedFile } from './localConfinedFile'
import { parseLocalRequestPath } from './localRequestPath'
import { decideLocalRequest, localResponseHeaders, LOCAL_REFUSAL_HEADERS } from './localResponsePolicy'

/** The only interface a served folder listens on. */
export const LOCAL_SERVER_HOST = '127.0.0.1'
const TOKEN_BYTES = 16

export interface LocalFolderServerOptions {
  /** The served folder's `realpath`. */
  readonly realRoot: string
  /**
   * Use up the one-shot arm of `address` (origin, path and query, no
   * fragment); true when `BrowserTab` armed it for an Erfana-started load.
   */
  readonly consumeArm: (address: string) => boolean
  /** A veto on a resolved file path: Erfana's own files. */
  readonly refusesTarget: (realPath: string) => boolean
  readonly platform?: NodeJS.Platform
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

export class LocalFolderServer {
  readonly realRoot: string
  /** Hex; the first path segment of every address. */
  readonly token = randomBytes(TOKEN_BYTES).toString('hex')
  private readonly options: LocalFolderServerOptions
  private readonly server: Server
  private port = 0
  private closed: Promise<void> | null = null

  constructor(options: LocalFolderServerOptions) {
    this.options = options
    this.realRoot = options.realRoot
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => this.refuse(res, 500))
    })
  }

  /** Listen on `127.0.0.1` and a free port; rejects when the socket cannot open. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      this.server.once('error', onError)
      this.server.listen({ host: LOCAL_SERVER_HOST, port: 0, exclusive: true }, () => {
        this.server.off('error', onError)
        this.port = (this.server.address() as AddressInfo).port
        resolve()
      })
    })
  }

  /** `http://127.0.0.1:<port>` – the folder's origin. */
  get origin(): string {
    return `http://${LOCAL_SERVER_HOST}:${this.port}`
  }

  /** The address of `segments` below the folder. */
  addressOf(segments: readonly string[]): string {
    return `${this.origin}/${this.token}/${segments.map(encodeURIComponent).join('/')}`
  }

  /** Stop listening and drop every open connection; resolves once the socket closed. */
  close(): Promise<void> {
    this.closed ??= new Promise<void>((resolve) => {
      this.server.close(() => resolve())
      this.server.closeAllConnections()
    })
    return this.closed
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (header(req, 'host') !== `${LOCAL_SERVER_HOST}:${this.port}`) return this.refuse(res, 403)
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.refuse(res, 405, { Allow: 'GET, HEAD' })
    const target = req.url ?? ''
    const queryAt = target.indexOf('?')
    const path = queryAt === -1 ? target : target.slice(0, queryAt)
    const rest = this.belowToken(path)
    if (rest === null) return this.refuse(res, 404)
    const decision = decideLocalRequest(
      { dest: header(req, 'sec-fetch-dest'), site: header(req, 'sec-fetch-site') },
      () => this.options.consumeArm(`${this.origin}${target}`)
    )
    if (!decision.serve) return this.refuse(res, 403)
    const parsed = parseLocalRequestPath(rest, this.options.platform)
    if (!parsed.ok) return this.refuse(res, parsed.status)
    const file = await openConfinedFile(this.realRoot, parsed.segments, this.options.refusesTarget)
    if (!file.ok) return this.refuse(res, file.status)
    res.writeHead(200, localResponseHeaders(mimeForExtension(file.ext), file.size, decision))
    if (req.method === 'HEAD' || file.size === 0) {
      res.end()
      await file.handle.close()
      return
    }
    // `end` caps the body at the size the headers announced, should the file grow meanwhile.
    pipeline(file.handle.createReadStream({ start: 0, end: file.size - 1 }), res, (error) => {
      if (error) logger.debug('A local-file response ended early', { code: (error as NodeJS.ErrnoException).code ?? 'unknown' })
    })
  }

  /** The raw path after `/<token>/`, or `null` when the token does not match. */
  private belowToken(path: string): string | null {
    const prefixEnd = 1 + this.token.length
    if (path.length <= prefixEnd || path[0] !== '/' || path[prefixEnd] !== '/') return null
    const given = Buffer.from(path.slice(1, prefixEnd))
    const expected = Buffer.from(this.token)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    return path.slice(prefixEnd + 1)
  }

  private refuse(res: ServerResponse, status: number, extra: Record<string, string> = {}): void {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(status, { ...LOCAL_REFUSAL_HEADERS, ...extra })
    res.end()
  }
}
