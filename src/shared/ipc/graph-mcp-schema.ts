// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schemas for the MCP boundary of the graph engine (issue #21).
 *
 * Two distinct boundaries live here, deliberately in one file so the contract
 * is frozen either way:
 *
 * - **main ↔ utilityProcess**, over a `MessageChannelMain`. In-process, created
 *   and handed over by Erfana, so it carries a project fence but no token — a
 *   bearer token there would be theatre.
 * - **external client ↔ endpoint**, over an ACL'd unix socket / named pipe.
 *   That is the boundary reachable by any local process, so it carries the
 *   handshake, the 256-bit token and the consent flow.
 *
 * Contract-only for #21: nothing hosts an endpoint yet (#30).
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-ipc-contracts.md §7.10 - port + tool schemas
 * @see specs/designs/sd-021-cross-cutting.md §9.3, §9.4, §9.5 - trust boundary
 */
import { z } from 'zod'
import { GRAPH, MCP } from '../graph-constants'
import { GraphErrorCodeSchema, GraphSearchFiltersSchema, GraphSearchRequestSchema } from './graph-schema'

// ─── model-facing tool contract ──────────────────────────────────────────────

/**
 * The tool's `inputSchema`, which MCP requires servers to validate.
 *
 * Reusing {@link GraphSearchRequestSchema} verbatim would hand `registerTool` a
 * shape containing `correlationId`, `offset` and `excludeSectionId` — a
 * DB-internal integer no model can know. `MCP.MAX_TOP_K` (20) is deliberately
 * lower than the renderer's, and `offset` is not exposed at all: every MCP
 * request lands on the synchronous main-thread reader from **outside** the
 * trust boundary, so the cheapest bound is the request shape itself.
 */
export const GraphMcpToolInputSchema = GraphSearchRequestSchema.pick({
  query: true,
  k: true,
  filters: true
}).extend({
  k: z.number().int().min(1).max(MCP.MAX_TOP_K).default(GRAPH.DEFAULT_TOP_K),
  filters: GraphSearchFiltersSchema.omit({ excludeSectionId: true }).optional()
})
/**
 * `…Args`, not `…Input`. The schema keeps the name of the MCP field it
 * populates (`inputSchema`), so the house `<Base>Input` = `z.input` convention
 * applied to `GraphMcpToolInput` produced `GraphMcpToolInputInput` — a name
 * whose two `Input`s mean different things. The subject is the tool's
 * arguments, so that is what the types are called.
 */
export type GraphMcpToolArgsInput = z.input<typeof GraphMcpToolInputSchema>
export type GraphMcpToolArgs = z.output<typeof GraphMcpToolInputSchema>

const TAB = 0x09
const LINE_FEED = 0x0a
const C0_MAX = 0x1f
const C1_MIN = 0x80
const C1_MAX = 0x9f

/**
 * True when a string carries no C0 (`U+0000`–`U+001F`, except `\t` and `\n`) and
 * no C1 (`U+0080`–`U+009F`) control character.
 *
 * That range is exactly what carries ANSI escape sequences and the
 * `char(2)`/`char(3)`/`char(4)` snippet sentinels — Erfana-internal markers that
 * must never leave the process, in the payload a model trusts most.
 *
 * A code-point scan rather than a regex: a character class over this range is
 * the literal thing `no-control-regex` exists to flag, and suppressing that rule
 * on a security check reads worse than the loop.
 */
export function isControlCharFree(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === TAB || code === LINE_FEED) continue
    if (code <= C0_MAX || (code >= C1_MIN && code <= C1_MAX)) return false
  }
  return true
}

/** A model-facing string: sentinel-free and bounded. Applied to all three. */
const McpTextSchema = z
  .string()
  .max(MCP.MAX_RESULT_BYTES)
  .refine(isControlCharFree, {
    message: 'must not contain C0 (except tab/newline) or C1 control characters'
  })

/**
 * The tool's `outputSchema`.
 *
 * Indexed Markdown is attacker-influenceable the moment a user clones a shared
 * repository, and a tool result is the channel a model trusts most. Three
 * obligations wrap this shape, all owned by #30 — and the first two are
 * **expressed here**, because a schema that documents an obligation it cannot
 * fail is a comment, not a contract:
 *
 * 1. `untrustedContentNotice` is `MCP.UNTRUSTED_NOTICE`, emitted **once per
 *    response** as the first content block so a large result set cannot dilute it.
 * 2. Every string field is refused if it carries C0 (`U+0000`–`U+001F`, except
 *    `\t`/`\n`) or C1 (`U+0080`–`U+009F`), so the strip #30 performs is verified
 *    rather than assumed: ANSI escapes and the `char(2)`/`char(3)`/`char(4)`
 *    snippet sentinels must never leave Erfana.
 * 3. `MCP.MAX_RESULT_BYTES` per result and `MCP.MAX_RESPONSE_BYTES` per response,
 *    measured after serialisation; on truncation `truncated` is set so the model
 *    is told the view is partial rather than silently receiving a clipped corpus.
 *    The `.max()` bounds below are CHARACTER counts, a cheap backstop that pins
 *    the order of magnitude — #30 still measures the serialised byte size, which
 *    for non-ASCII text is up to 4x higher.
 *
 * `results` is capped at `MCP.MAX_TOP_K`, matching the input bound: an
 * unbounded array would let a mis-sized response through the one schema a
 * reviewer would expect to catch it.
 *
 * `filePath` is display-only: project-relative, NFC, forward slashes, never
 * absolute, so a tool result cannot leak the user's home-directory layout.
 */
export const GraphMcpToolResultSchema = z.object({
  untrustedContentNotice: z.string().min(1),
  results: z
    .array(
      z.object({
        filePath: McpTextSchema,
        heading: McpTextSchema,
        snippet: McpTextSchema,
        score: z.number()
      })
    )
    .max(MCP.MAX_TOP_K),
  truncated: z.boolean()
})
export type GraphMcpToolResult = z.output<typeof GraphMcpToolResultSchema>

// ─── main ↔ utilityProcess port ──────────────────────────────────────────────

export const GraphPortSearchRequestSchema = z.strictObject({
  kind: z.literal('graph:search'),
  correlationId: z.string().min(1),
  /** Fenced like a worker message: one port would otherwise span arbitrary
   *  project switches, answering an in-flight search from whichever reader was
   *  attached when the handler ran. */
  switchVersion: z.number().int().nonnegative(),
  payload: GraphMcpToolInputSchema
})

/** FR-044: complete pending requests before shutdown. */
export const GraphPortDrainRequestSchema = z.strictObject({
  kind: z.literal('graph:drain'),
  correlationId: z.string().min(1)
})

export const GraphPortRequestSchema = z.discriminatedUnion('kind', [
  GraphPortSearchRequestSchema,
  GraphPortDrainRequestSchema
])
export type GraphPortRequestInput = z.input<typeof GraphPortRequestSchema>
export type GraphPortRequest = z.output<typeof GraphPortRequestSchema>

export const GraphPortSearchResultSchema = z.strictObject({
  kind: z.literal('graph:search:result'),
  correlationId: z.string().min(1),
  payload: GraphMcpToolResultSchema
})

export const GraphPortSearchErrorSchema = z.strictObject({
  kind: z.literal('graph:search:error'),
  correlationId: z.string().min(1),
  code: GraphErrorCodeSchema
})

/**
 * FR-042 backpressure needs a signal, or the peer cannot tell throttled from
 * hung. `MessagePortMain` has no flow control, so the bounded queue
 * (`MCP.MAX_INFLIGHT` / `MCP.MAX_QUEUE_DEPTH`) replaces unbounded delay-queueing
 * — a rejection in transport terms, a delay in client terms (erratum E9).
 */
export const GraphPortThrottledSchema = z.strictObject({
  kind: z.literal('graph:throttled'),
  correlationId: z.string().min(1),
  retryAfterMs: z.number().int().positive()
})

export const GraphPortDrainedSchema = z.strictObject({
  kind: z.literal('graph:drained'),
  correlationId: z.string().min(1),
  completed: z.number().int().nonnegative()
})

export const GraphPortResponseSchema = z.discriminatedUnion('kind', [
  GraphPortSearchResultSchema,
  GraphPortSearchErrorSchema,
  GraphPortThrottledSchema,
  GraphPortDrainedSchema
])
export type GraphPortResponseInput = z.input<typeof GraphPortResponseSchema>
export type GraphPortResponse = z.output<typeof GraphPortResponseSchema>

// ─── external client handshake (§9.4) ────────────────────────────────────────

/**
 * OS ACLs bound the *user*; this token bounds the *process*.
 *
 * Comparison is constant-time, and a bad token closes the socket with no error
 * detail. The token is surfaced in Settings with a copy action and a ready-made
 * `.mcp.json` snippet, so the user never has to read it out of a file.
 */
export const GraphMcpConnectSchema = z.strictObject({
  kind: z.literal('mcp:connect'),
  /** 256-bit, `randomBytes(32)` hex, minted at project open and rotated on every open. */
  token: z.string().regex(/^[0-9a-f]{64}$/),
  protocolVersion: z.literal(1),
  clientName: z.string().max(128)
})
export type GraphMcpConnect = z.output<typeof GraphMcpConnectSchema>

export const GraphMcpConnectAckSchema = z.strictObject({
  kind: z.literal('mcp:connected'),
  projectName: z.string().max(256),
  /** `MCP.BETA_DISCLAIMER`. */
  disclaimer: z.string()
})
export type GraphMcpConnectAck = z.output<typeof GraphMcpConnectAckSchema>
