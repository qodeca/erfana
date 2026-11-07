// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A bounded read of one page resource as text, for the React 19 source map
 * lookup (spec 025, 025-FR-037; owner decision 2026-11-05).
 *
 * The bytes are the page's and untrusted. The read goes through the tab's own
 * session (`session.fetch`), so it meets the same request filter, private
 * network rule and certificate decisions as the page's own requests – a
 * served local folder refuses it, as it refuses any request not made by its
 * page. It sends no cookies or credentials, follows no redirect, and stops at
 * `maxBytes`: a `Content-Length` over the cap is refused before the body is
 * read, and a body that grows past it is cancelled mid-stream. Every failure,
 * an abort included, is null; it never rejects.
 */

/** The tab session's `fetch`, as far as this module uses it. */
export type PageFetch = (url: string, init: RequestInit) => Promise<Response>

/** The fetch of `contents`' session, read at each call (the page's session can only be read off a live `WebContents`). */
export function tabSessionFetch(contents: { readonly session: { fetch: PageFetch } }): PageFetch {
  return (url, init) => contents.session.fetch(url, init)
}

/** The text of `url`, or null for a refusal, a non-2xx answer, a body over `maxBytes`, an abort or any other failure. */
export async function fetchPageText(fetchFn: PageFetch, url: string, maxBytes: number, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return null
  try {
    const response = await fetchFn(url, { signal, redirect: 'error', credentials: 'omit' })
    const body = response.body
    if (!response.ok || body === null || declaredOver(response, maxBytes)) {
      await body?.cancel().catch(() => undefined)
      return null
    }
    const bytes = await readCapped(body, maxBytes)
    return bytes === null ? null : new TextDecoder('utf-8').decode(bytes)
  } catch {
    return null
  }
}

function declaredOver(response: Response, maxBytes: number): boolean {
  const declared = Number(response.headers.get('content-length') ?? NaN)
  return Number.isFinite(declared) && declared > maxBytes
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}
