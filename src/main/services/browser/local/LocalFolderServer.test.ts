// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One served local folder on a real loopback socket (spec 025, 025-FR-005
 * rule 1; ADR 0012 option 4). Requests are made with `node:http`, so the raw
 * path and every header – including a forged `Host` and missing fetch
 * metadata – reach the server exactly as written.
 */
import { request } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { LOCAL_SERVER_HOST, LocalFolderServer } from './LocalFolderServer'
import { LOCAL_SANDBOX_POLICY } from './localResponsePolicy'

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

let base: string
let root: string
let server: LocalFolderServer
let arms: Set<string>
let veto: (p: string) => boolean
let armThrows: boolean

const SUBRESOURCE = { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'same-origin' }
const BIG_BYTES = 300 * 1024

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-local-server-')))
  root = join(base, 'site')
  await mkdir(join(root, 'sub'), { recursive: true })
  await mkdir(join(root, '.erfana'))
  await writeFile(join(root, 'index.html'), '<p>index</p>')
  await writeFile(join(root, 'canary.txt'), 'CANARY')
  await writeFile(join(root, 'sub', 'image.svg'), '<svg/>')
  await writeFile(join(root, 'empty.css'), '')
  await writeFile(join(root, 'big.bin'), Buffer.alloc(BIG_BYTES, 7))
  await writeFile(join(root, '.erfana', 'x.svg'), '<svg/>')
  await writeFile(join(base, 'outside.txt'), 'OUTSIDE')
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

beforeEach(async () => {
  arms = new Set()
  veto = () => false
  armThrows = false
  server = new LocalFolderServer({
    realRoot: root,
    consumeArm: (address) => {
      if (armThrows) throw new Error('boom')
      return arms.delete(address)
    },
    refusesTarget: (p) => veto(p)
  })
  await server.start()
})

afterEach(async () => {
  await server.close()
})

function port(): number {
  return Number(new URL(server.origin).port)
}

function send(path: string, headers: Record<string, string> = SUBRESOURCE, method = 'GET', host?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: LOCAL_SERVER_HOST, port: port(), path, method, headers: { host: host ?? `${LOCAL_SERVER_HOST}:${port()}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

const under = (rest: string): string => `/${server.token}/${rest}`

describe('LocalFolderServer', () => {
  it('listens on 127.0.0.1 with a 128-bit token, and builds encoded addresses', () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.token).toMatch(/^[0-9a-f]{32}$/)
    expect(server.addressOf(['sub', 'a b#?.svg'])).toBe(`${server.origin}/${server.token}/sub/a%20b%23%3F.svg`)
  })

  it('gives every server its own token and port', async () => {
    const other = new LocalFolderServer({ realRoot: root, consumeArm: () => false, refusesTarget: () => false })
    await other.start()
    expect(other.token).not.toBe(server.token)
    expect(other.origin).not.toBe(server.origin)
    await other.close()
  })

  it('serves a file of the folder with its type and the no-store, nosniff, no-referrer headers', async () => {
    const reply = await send(under('sub/image.svg'))
    expect(reply).toMatchObject({ status: 200, body: '<svg/>' })
    expect(reply.headers).toMatchObject({
      'content-type': 'image/svg+xml',
      'content-length': '6',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    })
    expect(reply.headers['cross-origin-resource-policy']).toBeUndefined()
  })

  it('streams a large file whole and answers HEAD and an empty file without a body', async () => {
    const big = await send(under('big.bin'))
    expect(big.status).toBe(200)
    expect(big.body.length).toBe(BIG_BYTES)
    const head = await send(under('sub/image.svg'), SUBRESOURCE, 'HEAD')
    expect(head).toMatchObject({ status: 200, body: '' })
    expect(head.headers['content-length']).toBe('6')
    expect(await send(under('empty.css'), { 'sec-fetch-dest': 'style', 'sec-fetch-site': 'same-origin' })).toMatchObject({ status: 200, body: '' })
  })

  it('refuses a forged Host (DNS rebinding) and a method other than GET and HEAD', async () => {
    expect((await send(under('canary.txt'), SUBRESOURCE, 'GET', 'evil.test')).status).toBe(403)
    expect((await send(under('canary.txt'), SUBRESOURCE, 'GET', `localhost:${port()}`)).status).toBe(403)
    const post = await send(under('canary.txt'), SUBRESOURCE, 'POST')
    expect(post.status).toBe(405)
    expect(post.headers['allow']).toBe('GET, HEAD')
  })

  it('answers 404 without the token, with a wrong or a shortened one, and for the bare token', async () => {
    expect((await send('/canary.txt')).status).toBe(404)
    expect((await send(`/${'0'.repeat(32)}/canary.txt`)).status).toBe(404)
    expect((await send(`/${server.token.slice(0, 31)}/canary.txt`)).status).toBe(404)
    expect((await send(`/${server.token}`)).status).toBe(404)
    expect((await send(`/${server.token}x/canary.txt`)).status).toBe(404)
  })

  it('refuses every script read: fetch and XHR (empty), a service worker and a client with no fetch metadata', async () => {
    for (const dest of ['empty', 'serviceworker', 'sharedworker']) {
      const reply = await send(under('canary.txt'), { 'sec-fetch-dest': dest, 'sec-fetch-site': 'same-origin' })
      expect(reply).toMatchObject({ status: 403, body: '' })
    }
    expect((await send(under('canary.txt'), {})).status).toBe(403)
  })

  it('serves an armed document once with the folder origin, then sandboxed (S-7)', async () => {
    const address = `${server.origin}${under('index.html')}`
    arms.add(address)
    const top = await send(under('index.html'), { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' })
    expect(top.status).toBe(200)
    expect(top.headers['content-security-policy']).toBeUndefined()
    expect(top.headers['cross-origin-opener-policy']).toBe('noopener-allow-popups')
    expect(arms.size).toBe(0)
    const again = await send(under('index.html'), { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' })
    expect(again.headers['content-security-policy']).toBe(LOCAL_SANDBOX_POLICY)
    const framed = await send(under('canary.txt'), { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' })
    expect(framed.status).toBe(200)
    expect(framed.headers['content-security-policy']).toBe(LOCAL_SANDBOX_POLICY)
  })

  it('keys the arm by origin, path and query', async () => {
    arms.add(`${server.origin}${under('index.html')}?a=1`)
    const other = await send(under('index.html'), { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' })
    expect(other.headers['content-security-policy']).toBe(LOCAL_SANDBOX_POLICY)
    const exact = await send(`${under('index.html')}?a=1`, { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' })
    expect(exact.headers['content-security-policy']).toBeUndefined()
  })

  it.each([
    ['../outside.txt', 400],
    ['%2e%2e/outside.txt', 400],
    ['sub%2f..%2f..%2foutside.txt', 400],
    ['.erfana/x.svg', 403],
    ['sub/', 403],
    ['', 403],
    ['missing.svg', 404]
  ])('refuses %j with %i and never sends the file', async (rest, status) => {
    const reply = await send(under(rest))
    expect(reply.status).toBe(status)
    expect(reply.body).not.toContain('OUTSIDE')
  })

  it('refuses a file the veto names (Erfana\'s own files)', async () => {
    veto = (p) => p.endsWith('canary.txt')
    expect((await send(under('canary.txt'))).status).toBe(403)
  })

  it('answers 500 when serving throws, without a body', async () => {
    armThrows = true
    expect(await send(under('index.html'), { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' })).toMatchObject({ status: 500, body: '' })
  })

  it('answers 404 when the resolve check throws', async () => {
    veto = () => {
      throw new Error('boom')
    }
    expect((await send(under('canary.txt'))).status).toBe(404)
  })

  it('stops listening on close, and a second close is the same close', async () => {
    const closing = server.close()
    expect(server.close()).toBe(closing)
    await closing
    await expect(send(under('canary.txt'))).rejects.toThrow()
  })

  it('rejects start when the socket cannot open', async () => {
    const broken = new LocalFolderServer({ realRoot: root, consumeArm: () => false, refusesTarget: () => false })
    const internal = broken as unknown as { server: { listen: (o: unknown, cb: () => void) => void; emit: (e: string, x: unknown) => void } }
    internal.server.listen = () => {
      internal.server.emit('error', new Error('EACCES'))
    }
    await expect(broken.start()).rejects.toThrow('EACCES')
  })
})
