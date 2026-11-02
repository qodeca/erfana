// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Self-test of the spec 025 browser fixture servers (e2e/fixtures/browser/).
 *
 * No Electron app is launched: every request goes from Node straight to
 * 127.0.0.1 with the `*.test` name in the Host header and as the TLS server
 * name, which is what `--host-resolver-rules` does for Chromium. Titles do not
 * start with an acceptance ID on purpose – this checks the fixtures, it covers
 * no criterion (scripts/check-spec025-trace.mjs).
 */

import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import type { TLSSocket } from 'node:tls'

import {
  BASIC_AUTH,
  OAUTH_CODE,
  OAUTH_USER,
  SESSION_COOKIE,
  STAGING_LOGIN,
  test,
  expect,
  type BrowserFixtureServers
} from './fixtures/browser/serve'

interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** PEM to trust; omit for plain HTTP. */
  ca?: string
  /** Skip certificate checks (to read a broken certificate). */
  insecure?: boolean
}

interface FetchResult {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
  /** SHA-256 fingerprint of the server certificate (HTTPS only). */
  fingerprint?: string
}

/** GET (or `method`) a fixture URL, connecting to 127.0.0.1 as the resolver rules would. */
function fetchFixture(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const target = new URL(url)
  const secure = target.protocol === 'https:'
  const requestOptions: https.RequestOptions = {
    host: '127.0.0.1',
    port: Number(target.port),
    path: `${target.pathname}${target.search}`,
    method: options.method ?? 'GET',
    headers: { Host: target.host, ...options.headers },
    agent: false,
    ...(secure ? { servername: target.hostname, ca: options.ca, rejectUnauthorized: !options.insecure } : {})
  }
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(requestOptions, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const socket = res.socket as TLSSocket
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          fingerprint: secure ? socket.getPeerCertificate().fingerprint256 : undefined
        })
      })
    })
    request.on('error', reject)
    request.end(options.body)
  })
}

/** Resolves to the TLS error code a strict client gets, or 'OK'. */
async function tlsVerdict(url: string, ca: string): Promise<string> {
  try {
    await fetchFixture(url, { ca })
    return 'OK'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error)
  }
}

function cookieFrom(result: FetchResult): string {
  const setCookie = result.headers['set-cookie'] ?? []
  return setCookie.map((line) => line.split(';')[0]).join('; ')
}

test.describe('browser fixture servers', () => {
  test('serves one page from every app over HTTP and HTTPS', async ({ browserServers }) => {
    const { sites, tls } = browserServers
    const pages: Array<[keyof BrowserFixtureServers['sites'], string, string]> = [
      ['static', '/', 'Static fixture – page A'],
      ['react18', '/', 'React 18 fixture'],
      ['react19', '/', 'React 19 fixture'],
      ['staging', '/', 'Staging – home'],
      ['hostile', '/ipc.html', 'Hostile – call IPC']
    ]
    for (const [site, pathname, title] of pages) {
      for (const secure of [false, true]) {
        const result = await fetchFixture(sites[site].url(pathname, { secure }), { ca: tls.caPem })
        expect(result.status, `${site} ${secure ? 'https' : 'http'}`).toBe(200)
        expect(result.body).toContain(`<title>${title}</title>`)
      }
    }
    const bundle = await fetchFixture(sites.react18.url('/bundle/dev/app.js'))
    expect(bundle.status).toBe(200)
    expect(bundle.body.startsWith('// SPDX-License-Identifier: GPL-3.0-only AND MIT')).toBe(true)
    expect(bundle.body).toContain('//# sourceMappingURL=app.js.map')
  })

  test('fills origin tokens with this worker’s ports', async ({ browserServers }) => {
    const { sites } = browserServers
    const frames = await fetchFixture(sites.static.url('/frames.html'))
    expect(frames.body).not.toContain('{{origin')
    expect(frames.body).toContain(`http://other.test:${sites.static.httpPort}`)
    expect(frames.body).toContain(`https://other.test:${sites.static.httpsPort}`)
    const login = await fetchFixture(sites.staging.url('/login'))
    expect(login.status).toBe(200)
    expect(login.body).toContain(`https://auth.test:${sites.staging.httpsPort}`)
  })

  test('the valid certificate verifies; expired, mismatched and self-signed ones do not', async ({
    browserServers
  }) => {
    const { sites, certServers, tls } = browserServers
    expect(await tlsVerdict(sites.staging.https + '/', tls.caPem)).toBe('OK')
    expect(await tlsVerdict(sites.static.url('/', { secure: true, host: 'camera.test' }), tls.caPem)).toBe('OK')
    expect(await tlsVerdict(certServers.expired.url('/'), tls.caPem)).toBe('CERT_HAS_EXPIRED')
    expect(await tlsVerdict(certServers.mismatch.url('/'), tls.caPem)).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
    expect(await tlsVerdict(certServers.selfSigned.url('/'), tls.caPem)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
    expect(tls.validSpkiSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/)

    const first = await fetchFixture(certServers.selfSigned.url('/'), { insecure: true })
    expect(first.body).toContain('<title>Staging – home</title>')
    certServers.selfSigned.presentCertificate('second')
    const second = await fetchFixture(certServers.selfSigned.url('/'), { insecure: true })
    certServers.selfSigned.presentCertificate('first')
    expect(second.fingerprint).toBeDefined()
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  test('holds a response until the test releases it, and sees an abort', async ({ browserServers }) => {
    const { sites, held } = browserServers
    let answered = false
    const pending = fetchFixture(sites.static.url('/__hold/self-test')).then((result) => {
      answered = true
      return result
    })
    await held.waitForRequest('self-test')
    expect(held.heldCount('self-test')).toBe(1)
    expect(answered).toBe(false)
    held.release('self-test', { title: 'Released page', colour: '#1565c0' })
    const result = await pending
    expect(result.status).toBe(200)
    expect(result.body).toContain('<title>Released page</title>')
    expect(() => held.release('self-test')).toThrow(/No request is held/)

    const aborted = http.get({
      host: '127.0.0.1',
      port: sites.static.httpPort,
      path: '/__hold/self-test-abort',
      headers: { Host: sites.static.host },
      agent: false
    })
    aborted.on('error', () => undefined)
    await held.waitForRequest('self-test-abort')
    aborted.destroy()
    await held.waitForAbort('self-test-abort')
    expect(held.heldCount('self-test-abort')).toBe(0)
  })

  test('staging: cookie login, basic auth and the popup code exchange', async ({ browserServers }) => {
    const { sites, staging, tls } = browserServers
    const origin = sites.staging.https
    const form = (username: string, password: string): FetchOptions => ({
      method: 'POST',
      ca: tls.caPem,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }).toString()
    })

    expect((await fetchFixture(`${origin}/session`, form(STAGING_LOGIN.username, 'wrong'))).status).toBe(401)
    const login = await fetchFixture(`${origin}/session`, form(STAGING_LOGIN.username, STAGING_LOGIN.password))
    expect(login.status).toBe(303)
    expect(login.headers['set-cookie']?.[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=.*Max-Age=\\d+.*HttpOnly.*Secure`))
    const me = await fetchFixture(`${origin}/api/me`, { ca: tls.caPem, headers: { Cookie: cookieFrom(login) } })
    expect(JSON.parse(me.body)).toEqual({ user: STAGING_LOGIN.username })

    const basicUrl = sites.staging.url('/basic')
    const challenge = await fetchFixture(basicUrl)
    expect(challenge.status).toBe(401)
    expect(challenge.headers['www-authenticate']).toContain(`realm="${BASIC_AUTH.realm}"`)
    const auth = (password: string): FetchOptions => ({
      headers: { Authorization: `Basic ${Buffer.from(`${BASIC_AUTH.username}:${password}`).toString('base64')}` }
    })
    expect((await fetchFixture(basicUrl, auth(BASIC_AUTH.password))).status).toBe(200)
    staging.setBasicPassword('changed')
    expect((await fetchFixture(basicUrl, auth(BASIC_AUTH.password))).status).toBe(401)
    staging.resetBasicPassword()
    expect((await fetchFixture(basicUrl, auth(BASIC_AUTH.password))).status).toBe(200)

    const exchange = (code: string): FetchOptions => ({
      method: 'POST',
      ca: tls.caPem,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    expect((await fetchFixture(`${origin}/oauth/exchange`, exchange('nope'))).status).toBe(400)
    const exchanged = await fetchFixture(`${origin}/oauth/exchange`, exchange(OAUTH_CODE))
    expect(JSON.parse(exchanged.body)).toEqual({ user: OAUTH_USER })
    const authorize = await fetchFixture(sites.staging.url('/authorize', { host: 'auth.test', secure: true }), {
      ca: tls.caPem
    })
    expect(authorize.body).toContain(OAUTH_CODE)
  })

  test('React apps: source maps, the no-maps variant and the production build', async ({ browserServers }) => {
    const { sites } = browserServers
    const react = sites.react18
    expect((await fetchFixture(react.url('/bundle/dev/app.js.map'))).status).toBe(200)
    expect((await fetchFixture(react.url('/nomaps/bundle/dev/app.js'))).status).toBe(200)
    expect((await fetchFixture(react.url('/nomaps/bundle/dev/app.js.map'))).status).toBe(404)
    const slashless = await fetchFixture(react.url('/nomaps'))
    expect(slashless.status).toBe(301)
    expect(slashless.headers.location).toBe('/nomaps/')
    const prod = await fetchFixture(react.url('/prod/'))
    expect(prod.body).toContain('../bundle/prod/app.js')
    expect((await fetchFixture(react.url('/bundle/prod/app.js.map'))).status).toBe(404)
  })

  test('common endpoints and path confinement', async ({ browserServers }) => {
    const { sites } = browserServers
    const site = sites.static
    expect((await fetchFixture(site.url('/__status/500'))).status).toBe(500)
    const redirect = await fetchFixture(site.url('/__redirect?to=/page-b.html'))
    expect(redirect.status).toBe(302)
    expect(redirect.headers.location).toBe('/page-b.html')
    expect((await fetchFixture(site.url('/__redirect?to=//evil.test/'))).status).toBe(400)

    const download = await fetchFixture(site.url('/__download/report.txt?bytes=2048'))
    expect(download.headers['content-disposition']).toBe("attachment; filename*=UTF-8''report.txt")
    expect(download.body.length).toBe(2048)
    await expect(fetchFixture(site.url('/__download-drop/dropped.bin?bytes=65536'))).rejects.toThrow()

    const headers = await fetchFixture(site.url('/__headers'), { headers: { 'Sec-CH-UA': '"Chromium";v="1"' } })
    expect(JSON.parse(headers.body)['sec-ch-ua']).toBe('"Chromium";v="1"')

    const traversal = await fetchFixture(site.url('/..%2F..%2Fserve.ts'))
    expect(traversal.status).toBe(404)
    expect(traversal.body).not.toContain('startBrowserFixtureServers')
    expect(browserServers.requests.some((r) => r.path === '/__status/500' && r.site === 'static')).toBe(true)
  })

  test('the React inspector page points its source attributes at each opening tag', () => {
    const appsDir = path.join(__dirname, 'fixtures', 'browser', 'apps')
    for (const app of ['react18', 'react19']) {
      const file = path.join(appsDir, app, 'src', 'pages', 'InspectorPage.tsx')
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      const text = lines.join('\n')
      const found = [
        ...text.matchAll(/data-inspector-relative-path="([^"]+)"\s+data-inspector-line="(\d+)"\s+data-inspector-column="(\d+)"/g)
      ]
      expect(found.length, app).toBe(3)
      for (const [, relativePath, line, column] of found) {
        expect(relativePath).toBe('src/pages/InspectorPage.tsx')
        expect(lines[Number(line) - 1].charAt(Number(column) - 1), `${app} ${line}:${column}`).toBe('<')
      }
    }
  })
})
