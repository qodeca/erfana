// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The real-file corpus of the comment round trip (spec 024 024-NFR-003,
 * 024-AC-026): which files, from where, under which licence – built at run
 * time from files already on disk, never committed and never fetched.
 *
 * Sources, in order:
 * - `repo` – the repository's own tracked `.md`/`.markdown`/`.html`/`.htm`
 *   files (`git ls-files`), minus test fixtures (made-up edge files, not real
 *   ones) and this spec's verification folder (the reports the run writes);
 * - `node_modules` – every such file in the installed packages, each under
 *   the licence its owning package's `package.json` declares; only
 *   permissive licences are kept ({@link isPermissive});
 * - extra roots named in `CORPUS_EXTRA_ROOTS` – a JSON array of
 *   `{ "label", "dir", "licence" }`, for installed documentation such as
 *   Python's HTML docs; kept only when the licence is permissive.
 *
 * A file whose bytes another file already has is dropped, so a package
 * installed twice counts once. The manifest is what is recorded: source,
 * path, SHA-256, size and licence – never the bytes.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Which comment file kind reads a corpus file. */
export type CorpusKind = 'markdown' | 'html'

/** One corpus file, as the manifest records it. */
export interface CorpusEntry {
  /** `repo`, `node_modules` or an extra root's label. */
  readonly source: string
  /** Path below the source's root, with `/`. */
  readonly path: string
  readonly kind: CorpusKind
  readonly sha256: string
  readonly bytes: number
  /** The SPDX expression (or the declared name) the file is used under. */
  readonly licence: string
  /** Absolute path on this machine; not part of the manifest. */
  readonly absolute: string
}

/** An extra root of installed files. */
export interface ExtraRoot {
  readonly label: string
  readonly dir: string
  readonly licence: string
}

const MARKDOWN_EXT = /\.(?:md|markdown)$/i
const HTML_EXT = /\.html?$/i
/** The repository's own files are its own, used here in place, never copied. */
export const REPO_LICENCE = 'GPL-3.0-only (this repository)'
/** Repository paths that hold made-up test files or this run's own output. */
const REPO_EXCLUDED = [/(^|\/)__fixtures__\//, /^e2e\/fixtures\//, /^tests\/fixtures\//, /^specs\/spec-t3-024-unified-comments\/verification\//]

/**
 * SPDX ids treated as permissive: they allow use and redistribution without
 * a copyleft condition. Documentation licences of the same kind (CC-BY,
 * CC0) are included.
 */
const PERMISSIVE = new Set([
  '0BSD',
  'APACHE-2.0',
  'BLUEOAK-1.0.0',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  'BSD',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'PSF-2.0',
  'PYTHON-2.0',
  'UNLICENSE',
  'ZLIB'
])

/**
 * True when an SPDX expression allows the file to be used under a permissive
 * licence: every `AND` part permissive, any `OR` alternative enough.
 */
export function isPermissive(expression: string): boolean {
  const flat = expression.replace(/[()]/g, ' ').trim().toUpperCase()
  if (flat === '') return false
  return flat.split(/\s+OR\s+/).some(alternative => alternative.split(/\s+AND\s+/).every(part => PERMISSIVE.has(part.trim())))
}

/** The kind that reads `name`, or `undefined` for any other file. */
export function kindOfName(name: string): CorpusKind | undefined {
  if (MARKDOWN_EXT.test(name)) return 'markdown'
  return HTML_EXT.test(name) ? 'html' : undefined
}

/** SHA-256 (hex) of `bytes`. */
export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const toSlash = (path: string): string => path.split(sep).join('/')

/** Every regular file below `dir` whose name a kind reads; symlinks are never followed. */
function walk(dir: string, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names.sort()) {
    const full = join(dir, name)
    const stat = lstatSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (stat.isFile() && kindOfName(name) !== undefined) out.push(full)
  }
  return out
}

/** A package's declared licence: `license` (string or `{ type }`) or the first of `licenses`. */
function declaredLicence(manifest: Record<string, unknown>): string {
  const { license, licenses } = manifest
  if (typeof license === 'string') return license
  if (license !== null && typeof license === 'object' && typeof (license as { type?: unknown }).type === 'string') {
    return (license as { type: string }).type
  }
  if (Array.isArray(licenses)) {
    const types = licenses.map(l => (l !== null && typeof l === 'object' ? (l as { type?: unknown }).type : l)).filter(t => typeof t === 'string')
    return types.join(' OR ')
  }
  return ''
}

/**
 * The licence of the package that owns `file`: the nearest folder above it,
 * inside `node_modules`, whose `package.json` has a `name`. Cached per folder.
 */
function licenceFinder(root: string): (file: string) => string {
  const cache = new Map<string, string>()
  const of = (dir: string): string => {
    const cached = cache.get(dir)
    if (cached !== undefined) return cached
    let licence = ''
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
        if (typeof manifest.name === 'string') licence = declaredLicence(manifest) || 'UNKNOWN'
      } catch {
        licence = ''
      }
    }
    if (licence === '') {
      const parent = join(dir, '..')
      licence = dir === root || parent === dir ? 'UNKNOWN' : of(parent)
    }
    cache.set(dir, licence)
    return licence
  }
  return file => of(join(file, '..'))
}

function entryOf(source: string, root: string, absolute: string, licence: string): CorpusEntry {
  const bytes = readFileSync(absolute)
  return {
    source,
    path: toSlash(relative(root, absolute)),
    kind: kindOfName(absolute)!,
    sha256: sha256(bytes),
    bytes: bytes.length,
    licence,
    absolute
  }
}

/** The repository's tracked corpus files. */
function repoEntries(repoRoot: string): CorpusEntry[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', '*.md', '*.markdown', '*.html', '*.htm'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return listed
    .split('\0')
    .filter(path => path !== '' && !REPO_EXCLUDED.some(rule => rule.test(path)))
    .sort()
    .map(path => join(repoRoot, path))
    .filter(absolute => existsSync(absolute) && lstatSync(absolute).isFile())
    .map(absolute => entryOf('repo', repoRoot, absolute, REPO_LICENCE))
}

/** The installed packages' corpus files under a permissive licence. */
function packageEntries(repoRoot: string): { entries: CorpusEntry[]; notPermissive: number } {
  const root = join(repoRoot, 'node_modules')
  const licenceOf = licenceFinder(root)
  const entries: CorpusEntry[] = []
  let notPermissive = 0
  for (const absolute of walk(root)) {
    const licence = licenceOf(absolute)
    if (!isPermissive(licence)) {
      notPermissive += 1
      continue
    }
    entries.push(entryOf('node_modules', root, absolute, licence))
  }
  return { entries, notPermissive }
}

/** The extra roots `CORPUS_EXTRA_ROOTS` names (module comment); `[]` when unset. */
export function extraRootsFromEnv(value = process.env.CORPUS_EXTRA_ROOTS): ExtraRoot[] {
  if (value === undefined || value.trim() === '') return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('CORPUS_EXTRA_ROOTS must be a JSON array of { label, dir, licence }')
  return parsed.map((root: unknown) => {
    const { label, dir, licence } = (root ?? {}) as Partial<ExtraRoot>
    if (typeof label !== 'string' || typeof dir !== 'string' || typeof licence !== 'string') {
      throw new Error('each CORPUS_EXTRA_ROOTS item needs string label, dir and licence')
    }
    if (!existsSync(dir)) throw new Error(`CORPUS_EXTRA_ROOTS: ${label}: ${dir} does not exist`)
    return { label, dir, licence }
  })
}

/** What was collected, and what was left out and why. */
export interface CorpusCollection {
  readonly entries: readonly CorpusEntry[]
  readonly skippedNotPermissive: number
  readonly skippedDuplicate: number
}

/** Every corpus file, in source then path order, each set of bytes once. */
export function collectCorpus(repoRoot: string, extras: readonly ExtraRoot[] = []): CorpusCollection {
  const packages = packageEntries(repoRoot)
  let notPermissive = packages.notPermissive
  const all = [...repoEntries(repoRoot), ...packages.entries]
  for (const extra of extras) {
    if (!isPermissive(extra.licence)) {
      notPermissive += walk(extra.dir).length
      continue
    }
    all.push(...walk(extra.dir).map(absolute => entryOf(extra.label, extra.dir, absolute, extra.licence)))
  }
  const seen = new Set<string>()
  const entries = all.filter(entry => (seen.has(entry.sha256) ? false : (seen.add(entry.sha256), true)))
  return { entries, skippedNotPermissive: notPermissive, skippedDuplicate: all.length - entries.length }
}

/**
 * The corpus frozen for one run: each file's bytes copied once into `dir`
 * (git-ignored) under their SHA-256, and every entry pointing there. Every
 * shard and the merge then read the same bytes, however the repository's
 * own files change while the run goes on. A file that changed between the
 * walk and the copy keeps the bytes copied, under their own hash.
 */
export function snapshotCorpus(collection: CorpusCollection, dir: string): CorpusCollection {
  mkdirSync(dir, { recursive: true })
  const seen = new Set<string>()
  const entries: CorpusEntry[] = []
  for (const entry of collection.entries) {
    const bytes = readFileSync(entry.absolute)
    const hash = sha256(bytes)
    if (seen.has(hash)) continue
    seen.add(hash)
    const absolute = join(dir, hash)
    if (!existsSync(absolute)) writeFileSync(absolute, bytes)
    entries.push({ ...entry, sha256: hash, bytes: bytes.length, absolute })
  }
  return { ...collection, entries, skippedDuplicate: collection.skippedDuplicate + collection.entries.length - entries.length }
}

/** The manifest as recorded: one line per file, tab-separated, no machine paths. */
export function manifestText(entries: readonly CorpusEntry[]): string {
  const header = 'source\tpath\tkind\tbytes\tsha256\tlicence'
  return [header, ...entries.map(e => [e.source, e.path, e.kind, e.bytes, e.sha256, e.licence].join('\t'))].join('\n') + '\n'
}
