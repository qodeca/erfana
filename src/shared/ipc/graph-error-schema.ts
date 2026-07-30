// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared leaf primitives for the graph boundary (issue #21): the error
 * vocabulary, path confinement, the `generation` token schema, the model-facing
 * text-safety predicate ({@link isModelSafeText}) and the two-level correlation-id
 * patterns and their direction-split schemas.
 *
 * These last two live here rather than in `graph-mcp-schema.ts` /
 * `graphCorrelation.ts` for one structural reason: `graph-schema.ts` needs both
 * (the inbound refine and the outbound pattern) and imports FROM the MCP module,
 * so a definition there would be an import cycle. `src/shared/ipc/*` also may not
 * import from `src/main/`, so the correlation patterns cannot live in
 * `graphCorrelation.ts` (main-side) either. The leaf is the one place every graph
 * schema — and the main-side generator — can reach without a cycle.
 *
 * **Layering rule — this module is the LEAF of the graph schema layer.** It
 * must never import from `graph-schema.ts` or `graph-status-schema.ts`.
 *
 * It exists because §4.2 splits the status block out of `graph-schema.ts`, which
 * re-exports it so no import path breaks. `GraphStatusSnapshotSchema` needs
 * `GraphErrorSchema`, so leaving the error block in `graph-schema.ts` would make
 * the two modules mutually dependent — and ESM evaluates a re-exported module
 * BEFORE the re-exporting one, so `GraphErrorSchema` would still be in its
 * temporal dead zone when the status schemas are constructed. Hoisting the
 * shared half here keeps the module graph acyclic: error ← status ← schema.
 *
 * Everything here is re-exported from `graph-schema.ts` — import from either.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-cross-cutting.md §9.2 - the code table with user copy
 * @see specs/designs/sd-021-graph-architecture.md §4.2 - the split point
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'
// `graph-constants.ts` and `win32-reserved.ts` both have zero imports of their
// own, so neither can re-enter the layering cycle the header forbids.
import { GRAPH } from '../graph-constants'
import { WIN32_RESERVED_BASENAMES } from '../win32-reserved'

/**
 * The 26 error codes producible on a graph or MCP channel.
 *
 * `ErrorCode` itself is too broad for this boundary: a `WHISPER_*` code would
 * validate on `graph:search` and the renderer would get no exhaustive switch.
 *
 * @see specs/designs/sd-021-cross-cutting.md §9.2 - the code table with user copy
 */
export const GRAPH_ERROR_CODES = [
  ErrorCode.GRAPH_DB_OPEN_FAILED,
  ErrorCode.GRAPH_DB_DIR_NOT_WRITABLE,
  ErrorCode.GRAPH_DB_CORRUPTED,
  ErrorCode.GRAPH_DB_SCHEMA_MISMATCH,
  ErrorCode.GRAPH_DB_REBUILD_FAILED,
  ErrorCode.GRAPH_DB_NOT_READY,
  ErrorCode.GRAPH_DB_MOVED,
  ErrorCode.GRAPH_DB_DISK_FULL,
  ErrorCode.GRAPH_FTS5_UNAVAILABLE,
  ErrorCode.GRAPH_WORKER_UNAVAILABLE,
  ErrorCode.GRAPH_WORKER_TIMEOUT,
  ErrorCode.GRAPH_WORKER_DISABLED,
  ErrorCode.GRAPH_WORKER_PROTOCOL,
  ErrorCode.GRAPH_SEARCH_FAILED,
  ErrorCode.GRAPH_SEARCH_QUERY_INVALID,
  ErrorCode.GRAPH_INDEX_ALREADY_RUNNING,
  ErrorCode.GRAPH_INDEX_FILE_UNREADABLE,
  ErrorCode.GRAPH_INDEX_FILE_TOO_LARGE,
  ErrorCode.GRAPH_INDEX_PARSE_FAILED,
  ErrorCode.GRAPH_INDEX_BATCH_FAILED,
  ErrorCode.GRAPH_INDEX_CANCELLED,
  ErrorCode.GRAPH_INDEX_STALE,
  ErrorCode.GRAPH_INDEX_PROJECT_CHANGED,
  ErrorCode.MCP_SERVER_START_FAILED,
  ErrorCode.MCP_SERVER_ALREADY_RUNNING,
  ErrorCode.MCP_TOOL_INVALID_ARGS
] as const

/** `z.enum` over an externally-declared TS enum — `z.nativeEnum` is deprecated. */
export const GraphErrorCodeSchema = z.enum(GRAPH_ERROR_CODES)
export type GraphErrorCode = z.infer<typeof GraphErrorCodeSchema>

/**
 * The rebuild `generation` token as it crosses every boundary: a **decimal
 * string**, not a JS number (D5).
 *
 * It is `randomBytes(8)` read as a signed 64-bit integer (contract C2 needs
 * difference, not monotonicity), so it routinely exceeds `Number.MAX_SAFE_INTEGER`
 * — `1n === 1` is permanently false and a value above 2^53 is lossy as a number.
 * A single representation on all three hops keeps it lossless: on disk in
 * `graph_meta.value` (TEXT), on the worker `ready` reply, and on the status
 * snapshot. The **main-side owner** is the only place it is a `bigint`: the
 * worker adapter does `BigInt(ready.generation)` before
 * `IGraphReadConnection.attach(dbPath, generation)`, and the snapshot builder
 * does `reader.generation().toString()` on the way back out.
 *
 * `.max(20)` bounds it to the width of the most negative int64
 * (`-9223372036854775808`, 20 chars); the regex pins it to an optionally-signed
 * run of digits so `BigInt(...)` on an accepted value cannot throw.
 */
export const GraphGenerationSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^-?\d+$/, { message: 'generation must be a decimal integer string' })

// ─── model-facing text safety (§9.3) ─────────────────────────────────────────

const TAB = 0x09
const LINE_FEED = 0x0a
const C0_MAX = 0x1f
const C1_MIN = 0x80
const C1_MAX = 0x9f
/** Lone/unpaired UTF-16 surrogate — a valid pair is iterated as one astral code
 *  point (≥ U+10000), so anything the code-point scan still sees in this range is
 *  unpaired and cannot render as text. */
const SURROGATE_MIN = 0xd800
const SURROGATE_MAX = 0xdfff
/** Bidi embeddings/overrides U+202A–U+202E (LRE/RLE/PDF/LRO/RLO). */
const BIDI_EMBED_MIN = 0x202a
const BIDI_EMBED_MAX = 0x202e
/** Bidi isolates U+2066–U+2069 (LRI/RLI/FSI/PDI). */
const BIDI_ISOLATE_MIN = 0x2066
const BIDI_ISOLATE_MAX = 0x2069
/** Unicode tag block U+E0000–U+E007F: invisible, mirrors ASCII, read as text by
 *  models — the canonical text-smuggling vector. */
const TAG_MIN = 0xe0000
const TAG_MAX = 0xe007f

/**
 * True when a string is safe to hand a model verbatim: no C0 (`U+0000`–`U+001F`,
 * except `\t`/`\n`), no C1 (`U+0080`–`U+009F`), no unpaired surrogate, no bidi
 * control (`U+202A`–`U+202E`, `U+2066`–`U+2069`) and no Unicode tag character
 * (`U+E0000`–`U+E007F`).
 *
 * The C0/C1 range is exactly what carries ANSI escape sequences and the
 * `char(2)`/`char(3)`/`char(4)` snippet sentinels — Erfana-internal markers that
 * must never leave the process. The bidi and tag ranges close the *model-facing*
 * smuggling vectors: tag characters are invisible ASCII mirrors a model still
 * reads, and bidi overrides can reorder rendered text to disguise an instruction.
 *
 * A **code-point** scan (`for…of`), not `charCodeAt`: a tag character arrives as
 * a surrogate PAIR (high `U+DB40`, low `U+DC00`–`U+DC7F`), so a `charCodeAt` loop
 * comparing two more 16-bit ranges would miss the astral block entirely. Iterating
 * by code point also makes the unpaired-surrogate test exact — a valid pair is
 * yielded as its combined astral value and never enters the surrogate range.
 *
 * A loop rather than a regex character class: such a class over these ranges is
 * the literal thing `no-control-regex` exists to flag, and suppressing that rule
 * on a security check reads worse than the scan.
 */
export function isModelSafeText(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number
    if (cp === TAB || cp === LINE_FEED) continue
    if (cp <= C0_MAX || (cp >= C1_MIN && cp <= C1_MAX)) return false
    if (cp >= SURROGATE_MIN && cp <= SURROGATE_MAX) return false
    if (cp >= BIDI_EMBED_MIN && cp <= BIDI_EMBED_MAX) return false
    if (cp >= BIDI_ISOLATE_MIN && cp <= BIDI_ISOLATE_MAX) return false
    if (cp >= TAG_MIN && cp <= TAG_MAX) return false
  }
  return true
}

// ─── correlation ids (§7.9) ──────────────────────────────────────────────────

/** Bound on an inbound, caller-supplied correlation id — long enough for any
 *  minted form, short enough that it cannot be a smuggling channel. */
const MAX_CORRELATION_ID_LENGTH = 128

/** The main-minted correlation-id shape (`idx-<epochMs>-<12 hex>`); the value
 *  `generateGraphCorrelationId` produces. */
export const GRAPH_CORRELATION_ID_PATTERN = /^idx-\d+-[0-9a-f]{12}$/

/** The main-minted job-id shape (`job-<epochMs>-<12 hex>`); the value
 *  `generateGraphJobId` produces. */
export const GRAPH_JOB_ID_PATTERN = /^job-\d+-[0-9a-f]{12}$/

/**
 * Outbound / echo / response correlation id, pinned to the main-minted pattern
 * (D6). Every reply, push and echo carries a value main produced, so the
 * boundary can afford the tight shape.
 *
 * Its inbound counterpart {@link GraphInboundCorrelationIdSchema} is deliberately
 * looser: §7.9 lets a caller supply its own id, which the pattern would reject.
 * Main reconciles the two — it echoes a caller id only when the id it emits still
 * satisfies this pattern, otherwise it mints a fresh one (#26 runtime).
 */
export const GraphOutboundCorrelationIdSchema = z
  .string()
  .regex(GRAPH_CORRELATION_ID_PATTERN, {
    message: 'correlationId must match idx-<epochMs>-<12 hex>'
  })

/** Outbound / echo job id, pinned to the main-minted pattern (D6). */
export const GraphOutboundJobIdSchema = z
  .string()
  .regex(GRAPH_JOB_ID_PATTERN, { message: 'jobId must match job-<epochMs>-<12 hex>' })

/**
 * Inbound, caller-supplied correlation id (D6): bounded and model-safe, but NOT
 * pattern-pinned. §7.9 requires main to echo a caller-supplied id, and the
 * outbound pattern matches only main-minted ids — pinning inbound would reject
 * every request that supplied its own trace id. `.min(1)` keeps "absent" (the
 * field is optional) distinct from "blank".
 */
export const GraphInboundCorrelationIdSchema = z
  .string()
  .min(1)
  .max(MAX_CORRELATION_ID_LENGTH)
  .refine(isModelSafeText, {
    message: 'correlationId must be free of control, bidi and Unicode tag characters'
  })

// ─── path confinement (§9.5 c) ───────────────────────────────────────────────

/**
 * True when a path component can normalise onto `..`.
 *
 * Exact equality with `'..'` is not enough on Windows, and Erfana ships there:
 * **Win32 strips trailing spaces and periods from every path component**, so
 * `'.. '` (dot-dot-space) and `'.. .'` both resolve to `..` and an exact
 * comparison accepts them. Generalised: a component built only from dots and
 * spaces that carries two or more dots normalises to a traversal — or to
 * nothing — and can never name a real file, so it is refused outright. A single
 * dot (`'./a.md'`) stays acceptable, and `'a..b'` / `'...md'` are ordinary names.
 */
function isTraversalSegment(segment: string): boolean {
  if (!/^[. ]+$/.test(segment)) return false
  const dotCount = segment.length - segment.replace(/\./g, '').length
  return dotCount >= 2
}

/**
 * The final path component, split on either separator with simple string logic.
 *
 * Deliberately NOT `node:path.basename`: this module is renderer-reachable (it
 * is pulled in through the IPC layer) and `process.platform` is `undefined`
 * under the sandbox, so a platform-aware path parser is both unavailable and
 * wrong to use in a cross-boundary contract.
 */
function basenameOf(p: string): string {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return cut === -1 ? p : p.slice(cut + 1)
}

/**
 * True when the path's basename is an NTFS alternate-data-stream reference
 * (`notes.md:hidden`) or a Windows reserved device name (`COM1`, `NUL`,
 * `CON.md`).
 *
 * **Unconditional, not platform-gated (D3).** `src/shared/` has no platform
 * signal and may not read `process.platform`, and a schema that validated
 * differently per process would be a per-boundary contract, not one contract.
 * The trade-off — `notes.md:hidden` is a legal POSIX filename — is accepted: a
 * colon in a project-relative Markdown path is pathological, and this module
 * already rejects UNC and drive paths unconditionally on the same reasoning.
 *
 * Mirrors the basename-only check in `LocalWhisperService.validateAudioPath`
 * (colon anywhere in the basename → ADS; name-without-extension in the reserved
 * set → device name), and shares {@link WIN32_RESERVED_BASENAMES} with it so the
 * two lists cannot drift (D4).
 *
 * @see src/main/services/LocalWhisperService.ts - validateAudioPath
 */
function hasWin32ReservedOrAdsBasename(p: string): boolean {
  const base = basenameOf(p)
  // NTFS ADS: a colon in the basename (a drive-letter colon is a whole-path
  // concern, handled by the drive-qualified reject in the callers).
  if (base.includes(':')) return true
  const nameSansExt = base.replace(/\.[^.]*$/, '').toUpperCase()
  return WIN32_RESERVED_BASENAMES.has(nameSansExt)
}

/** The structural checks a confined path must pass regardless of truncation. */
function hasConfinedPrefix(p: string): boolean {
  if (p.length === 0) return false
  if (p.startsWith('/') || p.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(p)) return false
  if (hasWin32ReservedOrAdsBasename(p)) return false
  return true
}

/**
 * True when `p` is a non-empty, project-relative path with no `..` segment, no
 * NTFS ADS colon and no Windows reserved device basename.
 *
 * Rejects POSIX absolutes, Windows drive-qualified paths and UNC paths, in both
 * separator conventions, because the indexer reads whatever it is handed — an
 * absolute path or `../../../.ssh/id_rsa` would be a read-into-index primitive
 * reachable through the MCP surface.
 *
 * Display/validation only. Real confinement stays main-side via `realpath`.
 *
 * @see specs/designs/sd-021-cross-cutting.md §9.5 (c) - path confinement
 */
export function isConfinedRelativePath(p: string): boolean {
  if (!hasConfinedPrefix(p)) return false
  return !p.split(/[/\\]/).some(isTraversalSegment)
}

/**
 * Truncation-tolerant confinement for the status paths (`currentFilePath`,
 * `recentSkips[].relativePath`, `queuedFilePaths[]`).
 *
 * #29 truncates those three at `MAX_STATUS_PATH_LENGTH` on a **byte** boundary,
 * which can sever a segment into a spurious trailing `..` (dots are ubiquitous
 * in real paths). Under strict {@link isConfinedRelativePath} that lone
 * artefact would fail the WHOLE snapshot's `safeParse` and blank the status
 * panel over a cosmetic trim — turning a schema documented as "a backstop, never
 * the enforcement point" into a landmine.
 *
 * The fix keeps every structural guard (no absolute, drive, UNC, ADS or reserved
 * name) and every NON-final traversal segment — so `../secret`, `a/../../x` and
 * `../..` are still rejected — but exempts the FINAL segment from the traversal
 * check, because it is the one a byte-truncation can corrupt. A genuine escape
 * needs a traversal segment that is not last (there is real path after it) or a
 * leading `../`, both of which remain refused.
 */
export function isConfinedTruncatedPath(p: string): boolean {
  if (!hasConfinedPrefix(p)) return false
  const segments = p.split(/[/\\]/)
  return !segments.slice(0, -1).some(isTraversalSegment)
}

const CONFINED_PATH_MESSAGE =
  'must be a project-relative path with no ".." segment, NTFS ADS colon or reserved device name'

/**
 * Factory for the shared confined-relative-path field: a bounded, non-empty
 * string refined by {@link isConfinedRelativePath}. The length bound `n` is the
 * only free parameter — each boundary passes its own ceiling
 * (`MAX_STATUS_PATH_LENGTH` on the status surface, `4096`/`MAX_RESULT_BYTES`
 * elsewhere).
 *
 * `truncatable: true` swaps in {@link isConfinedTruncatedPath} for the three
 * status paths #29 truncates, so a severed trailing `..` does not blank the
 * snapshot (see that predicate). This second parameter exists solely to satisfy
 * the truncation-safety contract; every other call site takes the strict
 * default.
 *
 * NOTE: `folder` cannot use this factory verbatim — its `.transform()` that
 * appends a trailing `/` must sit between `.max()` and the confinement refine —
 * so it applies {@link isConfinedRelativePath} directly, in the correct order.
 *
 * @see specs/designs/sd-021-ipc-contracts.md §7 - the confined fields
 */
export function ConfinedRelativePathSchema(n: number, options?: { truncatable?: boolean }) {
  const predicate = options?.truncatable ? isConfinedTruncatedPath : isConfinedRelativePath
  return z
    .string()
    .min(1)
    .max(n)
    .refine(predicate, { message: CONFINED_PATH_MESSAGE })
}

// ─── errors ──────────────────────────────────────────────────────────────────

/**
 * Structured error carried on every graph response.
 *
 * No free-form message: user copy is looked up from `ERROR_MESSAGES` in the
 * renderer, so a SQLite string or an absolute path can never cross IPC.
 */
export const GraphErrorSchema = z.object({
  code: GraphErrorCodeSchema,
  atMs: z.number().int().nonnegative(),
  /**
   * Project-relative path when the error is attributable to one file. Never
   * absolute — and the {@link isConfinedRelativePath} refine is what makes that
   * sentence enforceable rather than aspirational: an attributed error is the
   * one payload composed from a path the indexer was *given*, and it is rendered
   * in the skip list and the Settings diagnostics.
   *
   * Shares `MAX_STATUS_PATH_LENGTH` with the other relative paths in the status
   * payload: `lastError` rides inside `GraphStatusSnapshotSchema`, so a ceiling
   * of its own could reject the snapshot that carries it.
   */
  relativePath: z
    .string()
    .max(GRAPH.MAX_STATUS_PATH_LENGTH)
    .refine(isConfinedRelativePath, {
      message: 'relativePath must be project-relative and free of ".." segments'
    })
    .nullable()
    .default(null)
})
export type GraphError = z.output<typeof GraphErrorSchema>
