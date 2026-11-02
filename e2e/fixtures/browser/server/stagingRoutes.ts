// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Server side of the staging site (`../apps/staging/`): a cookie login, HTTP
 * basic auth on `/basic`, and the code exchange of the OAuth-style popup
 * sign-in on `/login`. The pages themselves are plain files in the site folder.
 *
 * | Route | Behaviour |
 * |---|---|
 * | `GET /api/me` | `{"user": <name or null>}` from the session cookie |
 * | `POST /session` | form login; right credentials set the session cookie and 303 to `/` |
 * | `POST /logout` | clears the session cookie, 303 to `/` |
 * | `GET /basic`, `/basic/*` | basic auth, realm `Staging`; 401 with an HTML body when missing or wrong |
 * | `POST /oauth/exchange` | `{"code"}` from the popup; the right code sets the session cookie |
 */

import type * as http from 'node:http'

import { escapeHtml, readBody, sendJson, sendText } from './respond'
import type { RequestContext, RouteHandler } from './siteServer'

/** Credentials of the cookie login form. */
export const STAGING_LOGIN = { username: 'qa@staging.test', password: 'staging-password' } as const
/** Default credentials and realm of `/basic`. */
export const BASIC_AUTH = { username: 'staging', password: 'basic-password', realm: 'Staging' } as const
/** The code the popup's authorize page posts back to its opener. */
export const OAUTH_CODE = 'fixture-oauth-code'
export const OAUTH_USER = 'oauth-user'
export const SESSION_COOKIE = 'staging_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export interface StagingControls {
  /** Changes the `/basic` password, so a remembered credential stops working. */
  setBasicPassword(password: string): void
  /** Back to {@link BASIC_AUTH}.password. */
  resetBasicPassword(): void
}

function readCookie(req: http.IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/** Persistent (Max-Age) so it survives a restart; Secure only where the scheme allows it. */
function sessionCookie(ctx: RequestContext, user: string | null): string {
  const secure = ctx.scheme === 'https' ? '; Secure' : ''
  const value = user === null ? '' : encodeURIComponent(user)
  const maxAge = user === null ? 0 : SESSION_MAX_AGE_SECONDS
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`
}

function basicCredentials(req: http.IncomingMessage): { username: string; password: string } | null {
  const header = req.headers.authorization ?? ''
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header)
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon === -1 ? null : { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`
}

async function handleSessionLogin(ctx: RequestContext): Promise<void> {
  const form = new URLSearchParams(await readBody(ctx.req))
  const ok =
    form.get('username') === STAGING_LOGIN.username && form.get('password') === STAGING_LOGIN.password
  if (!ok) {
    sendText(
      ctx.res,
      401,
      page('Sign-in failed', '<h1 id="login-error">Wrong user name or password</h1><a href="/">Try again</a>')
    )
    return
  }
  ctx.res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie(ctx, STAGING_LOGIN.username) })
  ctx.res.end()
}

async function handleOauthExchange(ctx: RequestContext): Promise<void> {
  let code: unknown
  try {
    code = (JSON.parse(await readBody(ctx.req)) as { code?: unknown }).code
  } catch {
    code = undefined
  }
  if (code !== OAUTH_CODE) {
    sendJson(ctx.res, 400, { error: 'invalid code' })
    return
  }
  sendJson(ctx.res, 200, { user: OAUTH_USER }, { 'Set-Cookie': sessionCookie(ctx, OAUTH_USER) })
}

export function createStagingRoutes(): { routes: RouteHandler[]; controls: StagingControls } {
  let basicPassword: string = BASIC_AUTH.password

  const handleBasic = (ctx: RequestContext): void => {
    const given = basicCredentials(ctx.req)
    if (given?.username === BASIC_AUTH.username && given.password === basicPassword) {
      sendText(ctx.res, 200, page('Basic auth – signed in', `<h1 id="basic-ok">Signed in as ${BASIC_AUTH.username}</h1>`))
      return
    }
    sendText(
      ctx.res,
      401,
      page('401 – sign-in required', '<h1 id="basic-401">401 – sign-in required</h1>'),
      undefined,
      { 'WWW-Authenticate': `Basic realm="${BASIC_AUTH.realm}", charset="UTF-8"` }
    )
  }

  const route: RouteHandler = async (ctx) => {
    const { pathname } = ctx.url
    const method = ctx.req.method ?? 'GET'
    if (pathname === '/api/me') {
      sendJson(ctx.res, 200, { user: readCookie(ctx.req, SESSION_COOKIE) || null })
      return true
    }
    if (pathname === '/session' && method === 'POST') {
      await handleSessionLogin(ctx)
      return true
    }
    if (pathname === '/logout' && method === 'POST') {
      ctx.res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie(ctx, null) })
      ctx.res.end()
      return true
    }
    if (pathname === '/basic' || pathname.startsWith('/basic/')) {
      handleBasic(ctx)
      return true
    }
    if (pathname === '/oauth/exchange' && method === 'POST') {
      await handleOauthExchange(ctx)
      return true
    }
    return false
  }

  return {
    routes: [route],
    controls: {
      setBasicPassword: (password) => {
        basicPassword = password
      },
      resetBasicPassword: () => {
        basicPassword = BASIC_AUTH.password
      }
    }
  }
}
