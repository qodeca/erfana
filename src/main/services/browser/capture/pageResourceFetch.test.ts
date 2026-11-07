// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { fetchPageText, tabSessionFetch, type PageFetch } from './pageResourceFetch'

const live = (): AbortSignal => new AbortController().signal
const answer = (response: Response): PageFetch => async () => response

/** A body streamed in `chunks` with no Content-Length; records whether it was cancelled. */
function streamed(chunks: string[]): { response: Response; cancelled: () => boolean } {
  let cancelled = false
  const encoder = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]))
      else controller.close()
    },
    cancel() {
      cancelled = true
    }
  })
  // The stream itself as the body (a real Response wraps it, and its cancel reaches the source only later).
  const response = { ok: true, body, headers: new Headers() } as unknown as Response
  return { response, cancelled: () => cancelled }
}

describe('fetchPageText', () => {
  it('reads the text of a 2xx answer, sending no credentials and following no redirect', async () => {
    let init: RequestInit | undefined
    const fetchFn: PageFetch = async (_url, i) => {
      init = i
      return new Response('héllo')
    }
    const signal = live()
    expect(await fetchPageText(fetchFn, 'https://a.test/x.js', 100, signal)).toBe('héllo')
    expect(init).toEqual({ signal, redirect: 'error', credentials: 'omit' })
  })

  it('joins a streamed body of several chunks', async () => {
    const { response } = streamed(['ab', 'cd', 'e'])
    expect(await fetchPageText(answer(response), 'u', 5, live())).toBe('abcde')
  })

  it('gives null for a non-2xx answer or an answer with no body', async () => {
    expect(await fetchPageText(answer(new Response('x', { status: 404 })), 'u', 100, live())).toBeNull()
    expect(await fetchPageText(answer(new Response(null)), 'u', 100, live())).toBeNull()
  })

  it('refuses a declared length over the cap before reading, and cancels a body that grows past it', async () => {
    expect(await fetchPageText(answer(new Response('xx', { headers: { 'content-length': '11' } })), 'u', 10, live())).toBeNull()
    const growing = streamed(['12345', '67890', 'x', 'y', 'z'])
    expect(await fetchPageText(answer(growing.response), 'u', 10, live())).toBeNull()
    expect(growing.cancelled()).toBe(true)
    expect(await fetchPageText(answer(new Response('0123456789')), 'u', 10, live())).toBe('0123456789')
  })

  it('still gives null when cancelling the refused body fails', async () => {
    const failingCancel = (): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(8))
        },
        cancel() {
          throw new Error('cancel failed')
        }
      })
    const notOk = { ok: false, body: failingCancel(), headers: new Headers() } as unknown as Response
    expect(await fetchPageText(answer(notOk), 'u', 100, live())).toBeNull()
    const tooBig = { ok: true, body: failingCancel(), headers: new Headers() } as unknown as Response
    expect(await fetchPageText(answer(tooBig), 'u', 10, live())).toBeNull()
  })

  it('gives null for a rejected fetch, and never fetches once aborted', async () => {
    expect(await fetchPageText(async () => Promise.reject(new Error('refused')), 'u', 10, live())).toBeNull()
    const aborted = new AbortController()
    aborted.abort()
    let called = false
    const fetchFn: PageFetch = async () => {
      called = true
      return new Response('x')
    }
    expect(await fetchPageText(fetchFn, 'u', 10, aborted.signal)).toBeNull()
    expect(called).toBe(false)
  })
})

describe('tabSessionFetch', () => {
  it("calls the contents' session fetch with the URL and options as given", async () => {
    const calls: [string, RequestInit][] = []
    const contents = { session: { fetch: async (url: string, init: RequestInit) => (calls.push([url, init]), new Response('ok')) } }
    const init = { redirect: 'error' } as const
    expect(await (await tabSessionFetch(contents)('https://a.test/x.js', init)).text()).toBe('ok')
    expect(calls).toEqual([['https://a.test/x.js', init]])
  })
})
