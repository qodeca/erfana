// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Fixture servers for the spec 025 built-in browser tests.
 *
 * Starts every sample app of `04-acceptance.md` § Test fixtures – the static
 * site, the React 18 and React 19 apps, the staging site and the hostile pages –
 * each on an HTTP **and** an HTTPS server (the valid `*.test` test certificate),
 * on ports the OS assigns, so Playwright workers never collide and no test uses
 * 5173. Three more HTTPS servers present the expired, host-mismatch and
 * self-signed certificates in front of the staging site.
 *
 * Host names are `*.test`: launch Electron with {@link BROWSER_CHROMIUM_ARGS}
 * (the sealed-network `--host-resolver-rules` of the acceptance intro), and
 * every `*.test` name reaches 127.0.0.1 while any other host fails at once. A
 * server answers whatever `*.test` name it is reached by, so a test that needs
 * another site (each permission on its own host, a cross-site frame) passes
 * `{ host }` to {@link SiteHandle.url}.
 *
 * ```ts
 * import { test, expect } from './fixtures/browser/serve'
 * test('…', async ({ browserServers }) => {
 *   const url = browserServers.sites.static.url('/frames.html')
 *   const cameraPage = browserServers.sites.static.url('/permissions.html', { host: 'camera.test', secure: true })
 * })
 * ```
 *
 * See `README.md` next to this file for what each app holds.
 */

import * as path from 'node:path'
import type { SecureContextOptions } from 'node:tls'
import { createSecureContext } from 'node:tls'

import { test as base } from '../index'
import { readCaPem, readCertPair, spkiSha256 } from './server/certs'
import { HeldResponses } from './server/heldResponses'
import {
  closeServer,
  createSiteListener,
  listen,
  type ListeningServer,
  type RecordedRequest,
  type RouteHandler,
  type Scheme,
  type SiteOptions
} from './server/siteServer'
import { createStagingRoutes, type StagingControls } from './server/stagingRoutes'

export { COOKIE_PROBE_VALUE } from './server/commonRoutes'
export { HeldResponses, type HeldReply } from './server/heldResponses'
export type { RecordedRequest } from './server/siteServer'
export {
  BASIC_AUTH,
  OAUTH_CODE,
  OAUTH_USER,
  SESSION_COOKIE,
  STAGING_LOGIN,
  type StagingControls
} from './server/stagingRoutes'

/** The sealed network of the acceptance intro: `*.test` is local, everything else fails. */
export const BROWSER_HOST_RESOLVER_RULES = 'MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost'
/** Chromium switches every browser-test launch passes. */
export const BROWSER_CHROMIUM_ARGS: readonly string[] = [`--host-resolver-rules=${BROWSER_HOST_RESOLVER_RULES}`]

export type SiteName = 'static' | 'react18' | 'react19' | 'staging' | 'hostile'

const FIXTURE_DIR = __dirname

interface SiteDefinition {
  readonly dir: string
  readonly host: string
  readonly kind: 'files' | 'react' | 'staging'
}

const SITE_DEFINITIONS: Readonly<Record<SiteName, SiteDefinition>> = {
  static: { dir: 'apps/static', host: 'app.test', kind: 'files' },
  react18: { dir: 'apps/react18', host: 'react18.test', kind: 'react' },
  react19: { dir: 'apps/react19', host: 'react19.test', kind: 'react' },
  staging: { dir: 'apps/staging', host: 'staging.test', kind: 'staging' },
  hostile: { dir: 'hostile', host: 'hostile.test', kind: 'files' }
}

/** Under this prefix a React app is served as usual, but every source map answers 404. */
export const NO_SOURCE_MAPS_PREFIX = '/nomaps'

export interface UrlOptions {
  /** Host name to use instead of the site's own (any `*.test` name, or `localhost`). */
  readonly host?: string
  /** HTTPS with the valid test certificate instead of HTTP. */
  readonly secure?: boolean
}

export interface SiteHandle {
  readonly name: SiteName
  /** The site's own host name, e.g. `app.test`. */
  readonly host: string
  readonly httpPort: number
  readonly httpsPort: number
  /** `http://<host>:<httpPort>` */
  readonly http: string
  /** `https://<host>:<httpsPort>` */
  readonly https: string
  /** Absolute URL of `pathname` (which starts with `/`) on this site. */
  url(pathname: string, options?: UrlOptions): string
}

export interface CertServerHandle {
  readonly host: string
  readonly port: number
  /** `https://<host>:<port>` */
  readonly origin: string
  url(pathname: string): string
}

export interface SelfSignedServerHandle extends CertServerHandle {
  /**
   * Switches the certificate new connections get: `first` (`selfsigned.pem`,
   * the default) or `second` (`selfsigned-b.pem`, same host, new key) – the
   * "accepted host presents a new certificate" case.
   */
  presentCertificate(which: 'first' | 'second'): void
}

export interface BrowserFixtureServers {
  readonly sites: Readonly<Record<SiteName, SiteHandle>>
  /** HTTPS servers in front of the staging site with a broken certificate each. */
  readonly certServers: {
    readonly expired: CertServerHandle
    readonly mismatch: CertServerHandle
    readonly selfSigned: SelfSignedServerHandle
  }
  /** Responses held until the test releases them (`/__hold/<key>` on any site). */
  readonly held: HeldResponses
  /** Staging site switches (the basic-auth password). */
  readonly staging: StagingControls
  /** Every request any fixture server saw, oldest first. */
  readonly requests: readonly RecordedRequest[]
  clearRequests(): void
  readonly tls: {
    /** The test CA, PEM. */
    readonly caPem: string
    /** Base64 SHA-256 SPKI of the valid leaf, for `--ignore-certificate-errors-spki-list`. */
    readonly validSpkiSha256: string
  }
  readonly chromiumArgs: readonly string[]
  close(): Promise<void>
}

const CERT_SERVER_HOSTS = { expired: 'expired.test', mismatch: 'mismatch.test', selfsigned: 'selfsigned.test' } as const

function tlsOptions(name: Parameters<typeof readCertPair>[0]): SecureContextOptions {
  const pair = readCertPair(name)
  return { cert: pair.cert, key: pair.key }
}

/** Staging pages answer on extensionless paths (`/login`, as the spec names them) from plain files. */
const STAGING_PAGES: Readonly<Record<string, string>> = {
  '/app': '/app.html',
  '/login': '/login.html',
  '/authorize': '/authorize.html'
}

function stagingRewrite(pathname: string): string {
  return STAGING_PAGES[pathname] ?? pathname
}

function siteRoutes(definition: SiteDefinition, stagingRoutes: readonly RouteHandler[]): Partial<SiteOptions> {
  if (definition.kind === 'staging') return { routes: stagingRoutes, rewritePath: stagingRewrite }
  if (definition.kind !== 'react') return {}
  return {
    rewritePath: (pathname) => {
      if (pathname !== NO_SOURCE_MAPS_PREFIX && !pathname.startsWith(`${NO_SOURCE_MAPS_PREFIX}/`)) return pathname
      return pathname.endsWith('.map') ? null : pathname.slice(NO_SOURCE_MAPS_PREFIX.length) || '/'
    }
  }
}

function makeSiteHandle(name: SiteName, host: string, httpPort: number, httpsPort: number): SiteHandle {
  const origin = (secure: boolean, h: string): string =>
    secure ? `https://${h}:${httpsPort}` : `http://${h}:${httpPort}`
  return {
    name,
    host,
    httpPort,
    httpsPort,
    http: origin(false, host),
    https: origin(true, host),
    url: (pathname, options = {}) => `${origin(options.secure ?? false, options.host ?? host)}${pathname}`
  }
}

function makeCertHandle(host: string, port: number): CertServerHandle {
  const origin = `https://${host}:${port}`
  return { host, port, origin, url: (pathname) => `${origin}${pathname}` }
}

/** Starts every fixture server. Close them with `close()`; the Playwright fixture below does it per worker. */
export async function startBrowserFixtureServers(): Promise<BrowserFixtureServers> {
  const log: RecordedRequest[] = []
  const held = new HeldResponses()
  const staging = createStagingRoutes()
  const validTls = tlsOptions('valid')
  const ports = new Map<string, { http?: number; https: number }>()
  const started: ListeningServer[] = []

  const resolveOrigin = (site: string, scheme: Scheme, host?: string): string | undefined => {
    const entry = ports.get(site)
    if (!entry) return undefined
    const defaultHost =
      site in SITE_DEFINITIONS
        ? SITE_DEFINITIONS[site as SiteName].host
        : CERT_SERVER_HOSTS[site as keyof typeof CERT_SERVER_HOSTS]
    const port = scheme === 'https' ? entry.https : entry.http
    return port === undefined ? undefined : `${scheme}://${host ?? defaultHost}:${port}`
  }

  const start = async (
    listener: Parameters<typeof listen>[0],
    tls?: SecureContextOptions
  ): Promise<ListeningServer> => {
    const server = await listen(listener, tls)
    started.push(server)
    return server
  }

  try {
    const handles = {} as Record<SiteName, SiteHandle>
    for (const name of Object.keys(SITE_DEFINITIONS) as SiteName[]) {
      const definition = SITE_DEFINITIONS[name]
      const options: SiteOptions = {
        name,
        root: path.join(FIXTURE_DIR, definition.dir),
        log,
        held,
        resolveOrigin,
        ...siteRoutes(definition, staging.routes)
      }
      const plain = await start(createSiteListener(options, 'http'))
      const secure = await start(createSiteListener(options, 'https'), validTls)
      ports.set(name, { http: plain.port, https: secure.port })
      handles[name] = makeSiteHandle(name, definition.host, plain.port, secure.port)
    }

    const stagingOptions = (name: string): SiteOptions => ({
      name,
      root: path.join(FIXTURE_DIR, SITE_DEFINITIONS.staging.dir),
      log,
      held,
      resolveOrigin,
      routes: staging.routes,
      rewritePath: stagingRewrite
    })
    const expired = await start(createSiteListener(stagingOptions('expired'), 'https'), tlsOptions('expired'))
    const mismatch = await start(createSiteListener(stagingOptions('mismatch'), 'https'), tlsOptions('mismatch'))
    const selfSignedTls = { first: tlsOptions('selfsigned'), second: tlsOptions('selfsigned-b') }
    const selfSigned = await start(
      createSiteListener(stagingOptions('selfsigned'), 'https'),
      selfSignedTls.first
    )
    ports.set('expired', { https: expired.port })
    ports.set('mismatch', { https: mismatch.port })
    ports.set('selfsigned', { https: selfSigned.port })

    const selfSignedServer = selfSigned.server
    const certServers = {
      expired: makeCertHandle(CERT_SERVER_HOSTS.expired, expired.port),
      mismatch: makeCertHandle(CERT_SERVER_HOSTS.mismatch, mismatch.port),
      selfSigned: {
        ...makeCertHandle(CERT_SERVER_HOSTS.selfsigned, selfSigned.port),
        presentCertificate: (which: 'first' | 'second') => {
          if (!('setSecureContext' in selfSignedServer)) throw new Error('self-signed server is not HTTPS')
          // Validates the pair before swapping, so a bad file fails here, not at the next handshake.
          createSecureContext(selfSignedTls[which])
          selfSignedServer.setSecureContext(selfSignedTls[which])
        }
      }
    }

    const caPem = readCaPem()
    return {
      sites: handles,
      certServers,
      held,
      staging: staging.controls,
      requests: log,
      clearRequests: () => {
        log.length = 0
      },
      tls: { caPem, validSpkiSha256: spkiSha256(readCertPair('valid').cert) },
      chromiumArgs: BROWSER_CHROMIUM_ARGS,
      close: async () => {
        held.releaseAll()
        await Promise.all(started.map(({ server }) => closeServer(server)))
      }
    }
  } catch (error) {
    held.releaseAll()
    await Promise.all(started.map(({ server }) => closeServer(server)))
    throw error
  }
}

/** Worker-scoped: one set of servers per Playwright worker, closed when the worker ends. */
export const test = base.extend<object, { browserServers: BrowserFixtureServers }>({
  browserServers: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const servers = await startBrowserFixtureServers()
      try {
        await use(servers)
      } finally {
        await servers.close()
      }
    },
    { scope: 'worker' }
  ]
})

export { expect } from '../index'
