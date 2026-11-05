// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import type { PageFetch } from './pageResourceFetch'
import {
  decodeDataMap,
  findSourceMappingUrl,
  SourceMapCache,
  SOURCE_MAP_CACHE_MAX,
  SOURCE_MAP_CACHE_TEXT_MAX,
  locateInSourceMap,
  ownerStackFrame,
  parseFrame,
  parseSourceMap,
  SCRIPT_MAX_BYTES,
  SOURCE_MAP_MAX_BYTES,
  sourceCandidates
} from './sourceMapLocation'

const ORIGIN = 'https://app.test'
const SCRIPT_URL = `${ORIGIN}/bundle/app.js`

/** Generated line 2, any column → `sources[0]` line 16 (0-based 15). */
const MAP = { version: 3, sources: ['../src/components/ItemRow.tsx'], names: [], mappings: ';AAeA' }
const script = (ref: string): string => `// header\nfunction ItemRow() { return jsxDEV("span") }\n//# sourceMappingURL=${ref}\n`

/** A React 19 `_debugStack` description: message, the JSX call frame, then the owner frame. */
const stackAt = (url: string, line = 2, column = 22): string =>
  ['Error: react-stack-top-frame', `    at exports.jsxDEV (${ORIGIN}/bundle/react.js:9:3)`, `    at ItemRow (${url}:${line}:${column})`, '    at renderWithHooks (x)'].join('\n')

/** A page fetch answering from `files` (URL → body), 404 otherwise, recording each URL. */
function pageFetch(files: Record<string, string | Response>): PageFetch & { urls: string[]; inits: RequestInit[] } {
  const urls: string[] = []
  const inits: RequestInit[] = []
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    urls.push(url)
    inits.push(init)
    const body = files[url]
    if (body === undefined) return new Response('missing', { status: 404 })
    return typeof body === 'string' ? new Response(body) : body
  }
  return Object.assign(fn, { urls, inits })
}

const lookup = (fetch: PageFetch, signal = new AbortController().signal) => ({ frameOrigin: ORIGIN, fetch, signal })

describe('sourceMapLocation (025-FR-037, React 19)', () => {
  describe('ownerStackFrame and parseFrame', () => {
    it("takes the frame after the JSX call, as React's own formatOwnerStack does", () => {
      expect(ownerStackFrame(stackAt(SCRIPT_URL, 7, 12))).toEqual({ url: SCRIPT_URL, line: 7, column: 12 })
    })

    it('gives null without an owner frame, or for an over-long frame line', () => {
      expect(ownerStackFrame('Error: react-stack-top-frame\n    at jsxDEV (a.js:1:1)')).toBeNull()
      expect(ownerStackFrame('')).toBeNull()
      expect(ownerStackFrame(`Error\n    at a (b:1:1)\n    at x (${ORIGIN}/${'a'.repeat(3000)}.js:1:1)`)).toBeNull()
    })

    it.each([
      ['    at App (https://a.test/x.js?v=1:3:4)', { url: 'https://a.test/x.js?v=1', line: 3, column: 4 }],
      ['    at https://a.test/x.js:3:4', { url: 'https://a.test/x.js', line: 3, column: 4 }],
      ['    at eval (eval at f (https://a.test/x.js:1:2), <anonymous>:3:4)', null],
      ['    at Array.map (<anonymous>)', null],
      ['    at native', null],
      ['    at x (https://a.test/x.js:0:4)', null],
      ['    at x (https://a.test/x.js:1)', null],
      ['    at x)', null]
    ])('%s', (line, expected) => {
      expect(parseFrame(line)).toEqual(expected)
    })
  })

  describe('findSourceMappingUrl', () => {
    it('reads the comment on the last line, // or /* form', () => {
      expect(findSourceMappingUrl(script('app.js.map'))).toBe('app.js.map')
      expect(findSourceMappingUrl('a()\n/*# sourceMappingURL=a.map */')).toBe('a.map')
      expect(findSourceMappingUrl('a()\n//@ sourceMappingURL=old.map')).toBe('old.map')
    })

    it('gives null without one, inside code, or when code follows it', () => {
      expect(findSourceMappingUrl('a()')).toBeNull()
      expect(findSourceMappingUrl('const s = "sourceMappingURL=x.map"')).toBeNull()
      expect(findSourceMappingUrl('//# sourceMappingURL=a.map\nmore()')).toBeNull()
    })

    it('stays linear on a long run of spaces, so a page cannot stall the main process (round-3 security review)', () => {
      const spaces = ' '.repeat(200_000)
      const started = performance.now()
      expect(findSourceMappingUrl('//# sourceMappingURL=a' + spaces + 'b')).toBeNull()
      expect(findSourceMappingUrl('//# sourceMappingURL=a.map' + spaces)).toBe('a.map')
      expect(findSourceMappingUrl('/*# sourceMappingURL=a.map' + spaces + '*/' + spaces)).toBe('a.map')
      expect(performance.now() - started).toBeLessThan(200)
    })
  })

  describe('decodeDataMap', () => {
    it('decodes base64 and percent-encoded JSON maps only', () => {
      const json = JSON.stringify(MAP)
      expect(decodeDataMap(`data:application/json;charset=utf-8;base64,${Buffer.from(json).toString('base64')}`)).toBe(json)
      expect(decodeDataMap(`data:application/json,${encodeURIComponent(json)}`)).toBe(json)
      expect(decodeDataMap('data:text/javascript;base64,AAAA')).toBeNull()
      expect(decodeDataMap('data:application/json')).toBeNull()
      expect(decodeDataMap('data:application/json,%zz')).toBeNull()
    })

    it('refuses a map over the size cap before decoding it', () => {
      expect(decodeDataMap(`data:application/json;base64,${'A'.repeat(Math.ceil((SOURCE_MAP_MAX_BYTES * 4) / 3) + 8)}`)).toBeNull()
      expect(decodeDataMap(`data:application/json,${'a'.repeat(SOURCE_MAP_MAX_BYTES + 1)}`)).toBeNull()
    })
  })

  describe('parseSourceMap', () => {
    it('parses a version 3 map, with or without the XSSI guard line', () => {
      expect(parseSourceMap(JSON.stringify(MAP), `${SCRIPT_URL}.map`)).not.toBeNull()
      expect(parseSourceMap(`)]}'\n${JSON.stringify(MAP)}`, `${SCRIPT_URL}.map`)).not.toBeNull()
    })

    it('gives null for malformed JSON, another version, a non-object or a bad shape', () => {
      expect(parseSourceMap('{nope', SCRIPT_URL)).toBeNull()
      expect(parseSourceMap(JSON.stringify({ ...MAP, version: 2 }), SCRIPT_URL)).toBeNull()
      expect(parseSourceMap('null', SCRIPT_URL)).toBeNull()
      expect(parseSourceMap(JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, url: 'x.map' }] }), SCRIPT_URL)).toBeNull()
    })
  })

  describe('sourceCandidates', () => {
    it.each([
      ['a served same-origin path', `${ORIGIN}/src/App.tsx`, null, ['src/App.tsx']],
      ["Vite's /@fs/ absolute path", `${ORIGIN}/@fs/Users/me/app/src/App.tsx`, null, ['/Users/me/app/src/App.tsx']],
      ["Vite's /@fs/ Windows path", `${ORIGIN}/@fs/C:/app/src/App.tsx`, null, ['C:/app/src/App.tsx']],
      ['a percent-encoded path', `${ORIGIN}/src/My%20App.tsx`, null, ['src/My App.tsx']],
      ['a file: URL', 'file:///Users/me/app/src/App.tsx', null, ['file:///Users/me/app/src/App.tsx']],
      ['a webpack source', 'webpack://app/./src/App.tsx', null, ['src/App.tsx']],
      ['an absolute raw entry, after the served path', `${ORIGIN}/Users/me/app/src/App.tsx`, '/Users/me/app/src/App.tsx', ['Users/me/app/src/App.tsx', '/Users/me/app/src/App.tsx']],
      ['a Windows raw entry', 'webpack:///C:/x', 'C:\\app\\App.tsx', ['C:/x', 'C:\\app\\App.tsx']],
      ['another web origin', 'https://cdn.test/src/App.tsx', null, []],
      ['a malformed escape', `${ORIGIN}/src/%zz.tsx`, 'src/a.tsx', []],
      ['not a URL', 'not a url', null, []]
    ])('%s', (_name, resolved, raw, expected) => {
      expect(sourceCandidates(resolved, raw, ORIGIN)).toEqual(expected)
    })

    it('drops a path over 500 code units', () => {
      expect(sourceCandidates(`${ORIGIN}/${'a'.repeat(600)}.tsx`, null, ORIGIN)).toEqual([])
    })
  })

  describe('locateInSourceMap', () => {
    it('maps the owner frame through a same-origin map file to the served source path', async () => {
      const fetch = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: JSON.stringify(MAP) })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(fetch))).toEqual({ locations: [{ path: 'src/components/ItemRow.tsx', line: 16 }] })
      expect(fetch.urls).toEqual([SCRIPT_URL, `${SCRIPT_URL}.map`])
      for (const init of fetch.inits) expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' })
    })

    it('reads and parses a script\'s map once while the cache holds it, and again after it is cleared (round-3 performance review)', async () => {
      const fetch = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: JSON.stringify(MAP) })
      const cache = new SourceMapCache()
      const expected = { locations: [{ path: 'src/components/ItemRow.tsx', line: 16 }] }
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), { ...lookup(fetch), cache })).toEqual(expected)
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), { ...lookup(fetch), cache })).toEqual(expected)
      expect(fetch.urls).toHaveLength(2)
      cache.clear()
      await locateInSourceMap(stackAt(SCRIPT_URL), { ...lookup(fetch), cache })
      expect(fetch.urls).toHaveLength(4)
    })

    it('does not keep a map over the cache text limit (round-4 security review)', async () => {
      const big = { ...MAP, x_pad: 'p'.repeat(SOURCE_MAP_CACHE_TEXT_MAX) }
      const fetch = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: JSON.stringify(big) })
      const cache = new SourceMapCache()
      await locateInSourceMap(stackAt(SCRIPT_URL), { ...lookup(fetch), cache })
      expect(cache.get(SCRIPT_URL)).toBeUndefined()
    })

    it('keeps the last few scripts only, the least recently used leaving first', () => {
      const cache = new SourceMapCache()
      const map = {} as never
      for (let i = 0; i <= SOURCE_MAP_CACHE_MAX; i++) cache.set(`s${i}`, map)
      expect(cache.get('s0')).toBeUndefined()
      expect(cache.get('s1')).toBe(map)
      cache.set('new', map)
      expect(cache.get('s1')).toBe(map)
      expect(cache.get('s2')).toBeUndefined()
    })

    it('maps through an inline data: map, whose sources resolve against the script', async () => {
      const inline = `data:application/json;base64,${Buffer.from(JSON.stringify(MAP)).toString('base64')}`
      const fetch = pageFetch({ [SCRIPT_URL]: script(inline) })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(fetch))).toEqual({ locations: [{ path: 'src/components/ItemRow.tsx', line: 16 }] })
      expect(fetch.urls).toEqual([SCRIPT_URL])
    })

    it('never reads a script of another origin than the frame, or a non-web script', async () => {
      const fetch = pageFetch({})
      expect(await locateInSourceMap(stackAt('https://cdn.test/app.js'), lookup(fetch))).toEqual({ miss: 'script not of the frame origin' })
      expect(await locateInSourceMap(stackAt('file:///etc/app.js'), lookup(fetch))).toEqual({ miss: 'script not of the frame origin' })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), { ...lookup(fetch), frameOrigin: null })).toEqual({ miss: 'script not of the frame origin' })
      expect(await locateInSourceMap('Error', lookup(fetch))).toEqual({ miss: 'no owner frame' })
      expect(fetch.urls).toEqual([])
    })

    it('never reads a map of another origin, a file: map or a map of another scheme', async () => {
      for (const ref of ['https://cdn.test/app.js.map', 'file:///etc/passwd', 'javascript:alert(1)', 'erfana-local://x/app.js.map', 'http://[bad']) {
        const fetch = pageFetch({ [SCRIPT_URL]: script(ref) })
        expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(fetch)), ref).toEqual({ miss: 'source map not of the script origin' })
        expect(fetch.urls).toEqual([SCRIPT_URL])
      }
    })

    it('says no source map for a production build, and not read for a map that answers 404 or an unreadable script', async () => {
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(pageFetch({ [SCRIPT_URL]: 'minified()' })))).toEqual({ miss: 'no source map' })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(pageFetch({ [SCRIPT_URL]: script('app.js.map') })))).toEqual({ miss: 'source map not read' })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(pageFetch({})))).toEqual({ miss: 'script not read' })
      const badInline = pageFetch({ [SCRIPT_URL]: script('data:text/plain,x') })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(badInline))).toEqual({ miss: 'source map not read' })
    })

    it('refuses an oversized script or map', async () => {
      const big = new Response('x', { headers: { 'content-length': String(SCRIPT_MAX_BYTES + 1) } })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(pageFetch({ [SCRIPT_URL]: big })))).toEqual({ miss: 'script not read' })
      const bigMap = new Response('{}', { headers: { 'content-length': String(SOURCE_MAP_MAX_BYTES + 1) } })
      const fetch = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: bigMap })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(fetch))).toEqual({ miss: 'source map not read' })
    })

    it('says malformed for a map that is not JSON or not version 3', async () => {
      for (const body of ['{nope', JSON.stringify({ ...MAP, version: 2 }), JSON.stringify({ version: 3, mappings: 5 })]) {
        const fetch = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: body })
        expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(fetch)), body).toEqual({ miss: 'source map malformed' })
      }
    })

    it('says not mapped for a position the map does not cover, and refuses a source of another origin', async () => {
      const fetch = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: JSON.stringify(MAP) })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL, 1, 1), lookup(fetch))).toEqual({ miss: 'position not mapped' })
      const absolute = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: JSON.stringify({ ...MAP, sources: ['/home/me/app/src/Row.tsx'] }) })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(absolute))).toEqual({
        locations: [
          { path: 'home/me/app/src/Row.tsx', line: 16 },
          { path: '/home/me/app/src/Row.tsx', line: 16 }
        ]
      })
      const foreign = pageFetch({ [SCRIPT_URL]: script('app.js.map'), [`${SCRIPT_URL}.map`]: JSON.stringify({ ...MAP, sources: ['https://cdn.test/src/App.tsx'] }) })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(foreign))).toEqual({ miss: 'source not of the script origin' })
    })

    it('stops when the signal aborts: a fetch that never answers ends as not read', async () => {
      const budget = new AbortController()
      const hanging: PageFetch = (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      const pending = locateInSourceMap(stackAt(SCRIPT_URL), lookup(hanging, budget.signal))
      budget.abort()
      expect(await pending).toEqual({ miss: 'script not read' })
      expect(await locateInSourceMap(stackAt(SCRIPT_URL), lookup(pageFetch({ [SCRIPT_URL]: script('a.map') }), budget.signal))).toEqual({ miss: 'script not read' })
    })
  })
})
