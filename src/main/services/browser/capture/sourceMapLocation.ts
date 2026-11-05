// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a React 19 element's JSX ran, through the page's source map (spec
 * 025, 025-FR-037 rule 2; owner decision 2026-11-05).
 *
 * React 19 dropped `_debugSource`. A development build keeps, on each fiber,
 * an `Error` created where the element's JSX ran (`_debugStack`); its stack
 * names a position in the served bundle. This module:
 *
 * 1. takes the frame React itself treats as the owner (the one after the JSX
 *    call: {@link ownerStackFrame}, React's own `formatOwnerStack` rule);
 * 2. accepts it only for an `http:` or `https:` script of the picked
 *    element's own frame origin;
 * 3. reads the script (at most {@link SCRIPT_MAX_BYTES}) and its trailing
 *    `sourceMappingURL` – an inline `data:application/json` map or a map of
 *    the script's own origin (at most {@link SOURCE_MAP_MAX_BYTES}); never a
 *    cross-origin, `file:` or other-scheme map;
 * 4. maps the position with `@jridgewell/trace-mapping` (no evaluation:
 *    `JSON.parse` and a VLQ decoder only);
 * 5. turns the original source into candidate paths, best first, which
 *    `sourceHints.ts` resolves against the project root under the S-13 rules.
 *
 * Production builds carry no `_debugStack`, and a build without a map has no
 * `sourceMappingURL`: both end as a miss, which is "source not found". Every
 * input is the page's, so every failure is a miss with a fixed reason (no
 * page text, no path), and nothing here throws.
 */
import { AnyMap, originalPositionFor, type SourceMapInput, type TraceMap } from '@jridgewell/trace-mapping'
import type { ReportedLocation } from './sourceHints'
import { fetchPageText, type PageFetch } from './pageResourceFetch'

/** Largest script read to find its `sourceMappingURL` (an inline map counts). */
export const SCRIPT_MAX_BYTES = 8 * 1024 * 1024
/** Largest source map read or decoded. */
export const SOURCE_MAP_MAX_BYTES = 8 * 1024 * 1024
/** The most of a stack description read; the frames needed are at its start. */
export const OWNER_STACK_TEXT_MAX = 8 * 1024
/** Longest stack frame line parsed. */
const FRAME_LINE_MAX = 2048
/** Longest candidate path kept (025-FR-037 caps page strings at 500). */
const PATH_MAX = 500
const MAPPING_URL_KEY = 'sourceMappingURL='

const isWebScript = (url: URL): boolean => url.protocol === 'http:' || url.protocol === 'https:'

/** A position in served code, as V8 reports it: line and column both 1-based. */
export interface GeneratedPosition {
  readonly url: string
  readonly line: number
  readonly column: number
}

/** Why a lookup gave nothing – fixed strings, safe to log. */
export type SourceMapMiss =
  | 'no owner frame'
  | 'script not of the frame origin'
  | 'script not read'
  | 'no source map'
  | 'source map not of the script origin'
  | 'source map not read'
  | 'source map malformed'
  | 'position not mapped'
  | 'source not of the script origin'

export type SourceMapResult = { readonly locations: readonly ReportedLocation[] } | { readonly miss: SourceMapMiss }

export interface SourceMapLookup {
  /** The picked element's frame origin (`ElementChain.frameOrigins`, last). */
  readonly frameOrigin: string | null
  readonly fetch: PageFetch
  readonly signal: AbortSignal
  /** Parsed maps of this pick mode's scripts; without it every lookup reads and parses again. */
  readonly cache?: SourceMapCache
}

/** Scripts whose parsed map is kept per tab (round-3 performance review). */
export const SOURCE_MAP_CACHE_MAX = 4

/**
 * The parsed source maps of the last few scripts, by script URL, so a second
 * pick on the same page neither reads nor parses again. The owner clears it
 * when pick mode starts over, so a rebuilt bundle is read fresh.
 */
export class SourceMapCache {
  private readonly maps = new Map<string, TraceMap>()

  get(scriptUrl: string): TraceMap | undefined {
    const map = this.maps.get(scriptUrl)
    if (map !== undefined) {
      this.maps.delete(scriptUrl)
      this.maps.set(scriptUrl, map)
    }
    return map
  }

  set(scriptUrl: string, map: TraceMap): void {
    this.maps.delete(scriptUrl)
    this.maps.set(scriptUrl, map)
    while (this.maps.size > SOURCE_MAP_CACHE_MAX) this.maps.delete(this.maps.keys().next().value as string)
  }

  clear(): void {
    this.maps.clear()
  }
}

/**
 * The owner frame of a React 19 `_debugStack` description: drop the message,
 * then the JSX call's own frame; the next frame is where the JSX ran.
 */
export function ownerStackFrame(stack: string): GeneratedPosition | null {
  const frames = stack
    .slice(0, OWNER_STACK_TEXT_MAX)
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
  const owner = frames[1]
  return owner === undefined || owner.length > FRAME_LINE_MAX ? null : parseFrame(owner)
}

/** `at name (url:line:col)` or `at url:line:col`; eval and native frames give null. */
export function parseFrame(line: string): GeneratedPosition | null {
  let text = line.trim().replace(/^at\s+/, '')
  if (text.endsWith(')')) {
    const open = text.lastIndexOf(' (')
    if (open < 0) return null
    text = text.slice(open + 2, -1)
  }
  if (/[\s()]/.test(text)) return null
  const m = /^(.+):(\d{1,9}):(\d{1,9})$/.exec(text)
  if (m === null) return null
  const lineNo = Number(m[2])
  const column = Number(m[3])
  return lineNo > 0 && column > 0 ? { url: m[1], line: lineNo, column } : null
}

/** The `sourceMappingURL` of a script's last line, or null. */
export function findSourceMappingUrl(script: string): string | null {
  const at = script.lastIndexOf(MAPPING_URL_KEY)
  if (at < 0) return null
  if (!/(?:\/\/|\/\*)[#@][ \t]*$/.test(script.slice(Math.max(0, at - 16), at))) return null
  // Trimmed first, and no two parts of the pattern match the same character, so the match is linear on
  // any page text (round-3 security review: `[ \t]*` then `\s*` backtracked quadratically).
  const m = /^([^\s'"*]+)(?:[ \t]*\*\/)?$/.exec(script.slice(at + MAPPING_URL_KEY.length).trimEnd())
  return m === null ? null : m[1]
}

/** The JSON of an inline `data:application/json` map within the size cap, or null. */
export function decodeDataMap(url: string): string | null {
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const meta = url.slice(5, comma).toLowerCase().split(';')
  if (meta[0] !== 'application/json') return null
  const payload = url.slice(comma + 1)
  if (meta.includes('base64')) {
    if (Math.floor((payload.length * 3) / 4) > SOURCE_MAP_MAX_BYTES) return null
    return Buffer.from(payload, 'base64').toString('utf8')
  }
  if (payload.length > SOURCE_MAP_MAX_BYTES) return null
  try {
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

/** A parsed version 3 map (plain or sectioned), or null for anything else. */
export function parseSourceMap(text: string, mapUrl: string): TraceMap | null {
  // A map may start with the `)]}'` XSSI guard line, which the format allows.
  const json = text.startsWith(")]}'") ? text.slice(text.indexOf('\n') + 1) : text
  try {
    const raw: unknown = JSON.parse(json)
    if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== 3) return null
    return new AnyMap(raw as SourceMapInput, mapUrl)
  } catch {
    return null
  }
}

/**
 * Candidate paths of the original source `resolved` (the map's source,
 * resolved against the map's URL) whose raw entry was `raw`; `scriptOrigin`
 * is the origin both came from. Best first: what the dev server serves it as
 * (`/src/App.tsx` → `src/App.tsx`, Vite's `/@fs/<absolute>`), a `file:` URL,
 * a bundler scheme (`webpack://app/./src/App.tsx` → `src/App.tsx`), then the
 * raw entry when it is an absolute file path. A source of another web origin
 * gives none.
 */
export function sourceCandidates(resolved: string, raw: string | null, scriptOrigin: string): string[] {
  const out: string[] = []
  const fromUrl = candidateOfUrl(resolved, scriptOrigin)
  if (fromUrl !== null) out.push(fromUrl)
  if (raw !== null && (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw))) out.push(raw)
  return [...new Set(out.filter((p) => p !== '' && p.length <= PATH_MAX))]
}

function candidateOfUrl(resolved: string, scriptOrigin: string): string | null {
  let url: URL
  let path: string
  try {
    url = new URL(resolved)
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (url.protocol === 'file:') return url.href
  if (!isWebScript(url)) return path.replace(/^\/+/, '')
  if (url.origin !== scriptOrigin) return null
  // Vite serves a file outside its root as `/@fs/<absolute path>` (`/@fs/C:/…` on Windows).
  return path.startsWith('/@fs/') ? path.slice(4).replace(/^\/([A-Za-z]:\/)/, '$1') : path.slice(1)
}

/** The original source locations of `stack`'s owner frame (see the module comment). Never rejects. */
export async function locateInSourceMap(stack: string, lookup: SourceMapLookup): Promise<SourceMapResult> {
  const frame = ownerStackFrame(stack)
  if (frame === null) return { miss: 'no owner frame' }
  const script = webUrl(frame.url)
  if (script === null || lookup.frameOrigin === null || script.origin !== lookup.frameOrigin) return { miss: 'script not of the frame origin' }
  const cached = lookup.cache?.get(script.href)
  if (cached !== undefined) return mapPosition(cached, frame, script.origin)
  const scriptText = await fetchPageText(lookup.fetch, script.href, SCRIPT_MAX_BYTES, lookup.signal)
  if (scriptText === null) return { miss: 'script not read' }
  const ref = findSourceMappingUrl(scriptText)
  if (ref === null) return { miss: 'no source map' }
  const loaded = await loadMap(ref, script, lookup)
  if ('miss' in loaded) return loaded
  const map = parseSourceMap(loaded.text, loaded.mapUrl)
  if (map === null) return { miss: 'source map malformed' }
  lookup.cache?.set(script.href, map)
  return mapPosition(map, frame, script.origin)
}

function webUrl(text: string, base?: URL): URL | null {
  try {
    const url = new URL(text, base)
    return isWebScript(url) ? url : null
  } catch {
    return null
  }
}

async function loadMap(ref: string, script: URL, lookup: SourceMapLookup): Promise<{ text: string; mapUrl: string } | { miss: SourceMapMiss }> {
  if (/^data:/i.test(ref)) {
    const text = decodeDataMap(ref)
    // An inline map's sources resolve against the script that carries it.
    return text === null ? { miss: 'source map not read' } : { text, mapUrl: script.href }
  }
  const mapUrl = webUrl(ref, script)
  if (mapUrl === null || mapUrl.origin !== script.origin) return { miss: 'source map not of the script origin' }
  const text = await fetchPageText(lookup.fetch, mapUrl.href, SOURCE_MAP_MAX_BYTES, lookup.signal)
  return text === null ? { miss: 'source map not read' } : { text, mapUrl: mapUrl.href }
}

function mapPosition(map: TraceMap, frame: GeneratedPosition, scriptOrigin: string): SourceMapResult {
  let original: ReturnType<typeof originalPositionFor>
  try {
    // trace-mapping columns are 0-based; V8's are 1-based.
    original = originalPositionFor(map, { line: frame.line, column: frame.column - 1 })
  } catch {
    return { miss: 'source map malformed' }
  }
  if (original.source === null || original.line === null || original.line < 1) return { miss: 'position not mapped' }
  const raw = map.sources[map.resolvedSources.indexOf(original.source)] ?? null
  const paths = sourceCandidates(original.source, raw, scriptOrigin)
  if (paths.length === 0) return { miss: 'source not of the script origin' }
  const line = original.line
  return { locations: paths.map((path) => ({ path, line })) }
}
