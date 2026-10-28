// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A throwaway loopback HTTP server for previews that reach off the disk (#111).
 *
 * Listens on `127.0.0.1` port **0** — ephemeral, so two workers never collide,
 * and the origin the band has to name carries a non-default port, which is the
 * port-in-CSP path no unit test covers. Serves ONE script whose effect is
 * observable inside the previewed page (`document.body.dataset.remote`), and
 * records every request it receives, so a spec can prove the socket was never
 * touched before approval and was after.
 *
 * Loopback is approvable in the permission band since #108: the unit of a
 * grant is an origin, scheme and port included.
 *
 * Plain helper plus a composed fixture. Use the fixture from a spec:
 * ```ts
 * import { test, expect } from './fixtures/localServer'
 * test('…', async ({ localServer }) => { localServer.origin })
 * ```
 */

import * as http from 'http'
import type { AddressInfo } from 'net'

import { test as base } from './index'

/** The path the probe script is served at. */
export const REMOTE_PROBE_PATH = '/probe.js'

/** What the probe does inside the page — read it back with `previewEval`. */
export const REMOTE_PROBE_SCRIPT = "document.body.dataset.remote = 'loaded'\n"

/** One request the server saw. */
export interface RecordedRequest {
  path: string
  /** `Date.now()` when the request arrived. */
  at: number
}

export interface LocalServer {
  /** The live ephemeral port. */
  readonly port: number
  /** `http://127.0.0.1:<port>` — the exact string the band must name. */
  readonly origin: string
  /** Absolute URL of the probe script. */
  readonly probeUrl: string
  /** Every request received so far, oldest first. */
  readonly requests: readonly RecordedRequest[]
  close(): Promise<void>
}

/** Start the server; resolves once it is listening. */
export async function startLocalServer(): Promise<LocalServer> {
  const requests: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url ?? '', at: Date.now() })
    if (req.url === REMOTE_PROBE_PATH) {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(REMOTE_PROBE_SCRIPT)
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`

  return {
    port,
    origin,
    probeUrl: `${origin}${REMOTE_PROBE_PATH}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // Drop keep-alive sockets so close() does not wait on an idle client.
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

export const test = base.extend<{ localServer: LocalServer }>({
  // eslint-disable-next-line no-empty-pattern
  localServer: async ({}, use) => {
    const server = await startLocalServer()
    await use(server)
    await server.close()
  }
})

export { expect } from './index'
