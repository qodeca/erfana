// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * React component and source hints (spec 025, 025-FR-037, 025-FR-036; spec
 * change S-13; solution design § 4).
 *
 * In order, stopping at the first that answers, within
 * {@link SOURCE_HINTS_BUDGET_MS} in total:
 *
 * 1. the source-location attributes on the element or its nearest ancestor
 *    that has any (exactly the names of `SOURCE_ATTRIBUTE_NAMES`);
 * 2. the React lookup in the page's main world (`REACT_LOOKUP`): the nearest
 *    component, up to 5 owners and the JSX source.
 *
 * The lookup's answer is the page's: only strings pass, each cut to 500
 * code units, the owner chain to 5 ({@link parseReactAnswer}). A path the
 * page reports goes into the untrusted block as given. Main resolves it
 * against the project root; only a real file inside the project that passes
 * {@link isResolvableSourcePath} (S-13) becomes the **resolved source** of
 * the capture facts, relative to the project root. A failure anywhere gives
 * "source not found" and never blocks the send.
 */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { Clock } from '../../../../shared/clock'
import type { ReactHints } from '../../../../shared/browser/contextFile'
import { PICK_STRING_MAX, REACT_OWNER_MAX } from '../cdp/cdpPickFunctions'
import { isRecord } from '../cdp/cdpTypes'

/** The whole hint search ends after this; then "source not found" (025-FR-037). */
export const SOURCE_HINTS_BUDGET_MS = 750

/** Source files a resolved source may name (S-13). */
export const UI_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
  '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.astro', '.html', '.css', '.scss', '.less', '.mdx'
])

/** File names never offered as resolved source: agent configuration, manifests, lockfiles (S-13). */
const REFUSED_FILE_NAMES = new Set([
  'claude.md', 'agents.md', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock',
  'pnpm-lock.yaml', 'bun.lockb', 'tsconfig.json', 'deno.json', 'deno.lock'
])

export interface SourceHints {
  /** The attributes that answered, as the page has them (untrusted). */
  readonly sourceAttributes: readonly (readonly [string, string])[]
  readonly react: ReactHints | null
  /** Project-relative, confirmed to exist (capture facts). */
  readonly resolvedSource?: { readonly path: string; readonly line?: number }
  readonly sourceNotFound: boolean
}

/** What a reported location says: a path and an optional line. */
export interface ReportedLocation {
  readonly path: string
  readonly line?: number
}

const cut = (v: string): string => v.slice(0, PICK_STRING_MAX)

/** The React lookup's answer, or null for anything not of the expected shape (025-FR-037). */
export function parseReactAnswer(raw: unknown): { hints: ReactHints; location: ReportedLocation | null } | null {
  if (!isRecord(raw)) return null
  const component = typeof raw.component === 'string' ? cut(raw.component) : null
  const owners = Array.isArray(raw.owners)
    ? raw.owners.filter((o): o is string => typeof o === 'string').slice(0, REACT_OWNER_MAX).map(cut)
    : []
  let location: ReportedLocation | null = null
  let source: string | null = null
  if (isRecord(raw.source) && typeof raw.source.file === 'string' && raw.source.file !== '') {
    const line = positiveInt(raw.source.line)
    location = line === undefined ? { path: cut(raw.source.file) } : { path: cut(raw.source.file), line }
    source = line === undefined ? location.path : `${location.path}:${line}`
  }
  if (component === null && owners.length === 0 && source === null) return null
  return { hints: { component, ownerChain: owners, source }, location }
}

function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/** `path:line[:column]` → path and line. */
function splitLocation(text: string): ReportedLocation {
  const m = /^(.*?):(\d{1,9})(?::\d{1,9})?$/.exec(text)
  return m === null ? { path: text } : { path: m[1], line: Number(m[2]) }
}

/** The location the source attributes report (025-FR-037 rule 1), or null. */
export function locationFromAttributes(attrs: readonly (readonly [string, string])[]): ReportedLocation | null {
  const get = (name: string): string | undefined => attrs.find(([n]) => n === name)?.[1]
  const inspector = get('data-inspector-relative-path')
  if (inspector) {
    const line = positiveInt(get('data-inspector-line'))
    return line === undefined ? { path: inspector } : { path: inspector, line }
  }
  for (const name of ['data-source', 'data-source-file', 'data-component-path']) {
    const value = get(name)
    if (value) return splitLocation(value)
  }
  return null
}

/**
 * Whether a project-relative path may be a resolved source (S-13): a UI
 * source extension, no dot-folder or dot-file segment, not under
 * `node_modules`, not agent configuration, a manifest, a lockfile or CI.
 */
export function isResolvableSourcePath(rel: string): boolean {
  const parts = rel.split('/')
  if (parts.some((p) => p === '' || p === '..' || p.startsWith('.'))) return false
  if (parts.some((p) => p.toLowerCase() === 'node_modules')) return false
  const name = parts[parts.length - 1].toLowerCase()
  if (REFUSED_FILE_NAMES.has(name)) return false
  return UI_SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

/**
 * The project-relative path of `reported` when it names a real file inside
 * `projectRoot` (a canonical path) that may be a resolved source; else null.
 * Absolute paths, `file://` URLs and project-relative paths are accepted;
 * a link out of the project resolves outside it and is refused.
 */
export async function resolveSourcePath(projectRoot: string, reported: string): Promise<string | null> {
  let path = reported
  if (/^file:\/\//i.test(path)) {
    try {
      path = decodeURIComponent(new URL(path).pathname)
    } catch {
      return null
    }
  }
  // eslint-disable-next-line no-control-regex -- control characters are refused here
  if (path === '' || /[\u0000-\u001f]/.test(path)) return null
  const candidate = isAbsolute(path) ? path : join(projectRoot, path)
  try {
    const real = await realpath(candidate)
    if (!(await stat(real)).isFile()) return null
    const rel = relative(projectRoot, real)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    const posix = rel.split(sep).join('/')
    return isResolvableSourcePath(posix) ? posix : null
  } catch {
    return null
  }
}

export interface HintSources {
  /** Attributes of the element first, then each ancestor up to the root. */
  readonly attributesNearestFirst: readonly (readonly (readonly [string, string])[])[]
  /** The React lookup; absent when it may not run (the page is frozen). */
  readonly reactLookup?: () => Promise<unknown>
  readonly projectRoot: string | null
  readonly clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>
}

/** Resolve within `ms` or give `fallback`. */
function within<T>(clock: HintSources['clock'], ms: number, work: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = clock.setTimeout(() => resolve(fallback), ms)
    work.then(
      (value) => {
        clock.clearTimeout(timer)
        resolve(value)
      },
      () => {
        clock.clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

/** The hints of 025-FR-037 within the 750 ms budget. Never rejects. */
export function collectSourceHints(sources: HintSources): Promise<SourceHints> {
  const notFound: SourceHints = { sourceAttributes: [], react: null, sourceNotFound: true }
  return within(sources.clock, SOURCE_HINTS_BUDGET_MS, findHints(sources), notFound)
}

async function findHints(sources: HintSources): Promise<SourceHints> {
  const attrs = sources.attributesNearestFirst.find((list) => list.length > 0)
  if (attrs !== undefined) {
    const resolvedSource = await resolveLocation(sources.projectRoot, locationFromAttributes(attrs))
    return { sourceAttributes: attrs, react: null, sourceNotFound: false, ...(resolvedSource ? { resolvedSource } : {}) }
  }
  if (sources.reactLookup === undefined) return { sourceAttributes: [], react: null, sourceNotFound: true }
  const answer = parseReactAnswer(await sources.reactLookup())
  if (answer === null) return { sourceAttributes: [], react: null, sourceNotFound: true }
  const resolvedSource = await resolveLocation(sources.projectRoot, answer.location)
  return {
    sourceAttributes: [],
    react: answer.hints,
    sourceNotFound: answer.hints.source === null,
    ...(resolvedSource ? { resolvedSource } : {})
  }
}

async function resolveLocation(projectRoot: string | null, location: ReportedLocation | null): Promise<SourceHints['resolvedSource']> {
  if (projectRoot === null || location === null) return undefined
  const path = await resolveSourcePath(projectRoot, location.path)
  if (path === null) return undefined
  return location.line === undefined ? { path } : { path, line: location.line }
}
