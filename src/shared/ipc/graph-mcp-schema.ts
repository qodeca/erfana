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
import {
  ConfinedRelativePathSchema,
  GraphErrorCodeSchema,
  GraphInboundCorrelationIdSchema,
  GraphOutboundCorrelationIdSchema,
  GraphSearchFiltersBaseSchema,
  GraphSearchRequestBaseSchema,
  MODIFIED_RANGE_REFINE,
  isAscendingModifiedRange,
  isModelSafeText
} from './graph-schema'

// Re-exported from the shared leaf so #30 (and this module's tests) keep one
// import path for the model-facing text-safety predicate.
export { isModelSafeText } from './graph-schema'

// ─── model-facing tool contract ──────────────────────────────────────────────

/**
 * The tool's `inputSchema`, which MCP requires servers to validate.
 *
 * Reusing {@link GraphSearchRequestBaseSchema} verbatim would hand `registerTool`
 * a shape containing `correlationId`, `offset` and `excludeSectionId` — a
 * DB-internal integer no model can know. `MCP.MAX_TOP_K` (20) is deliberately
 * lower than the renderer's, and `offset` is not exposed at all: every MCP
 * request lands on the synchronous main-thread reader from **outside** the
 * trust boundary, so the cheapest bound is the request shape itself.
 *
 * Derived from the unrefined **base** schemas, not the renderer leaves: `.pick()`
 * and `.omit()` throw on an object carrying a refinement in zod 4, and the leaves
 * are where later joint bounds attach.
 *
 * **JSON-Schema conversion.** Convert with
 * `z.toJSONSchema(GraphMcpToolArgsSchema, { io: 'input' })`. The default form and
 * `{ io: 'output' }` both **throw** (`Transforms cannot be represented in JSON
 * Schema`) because the args inherit `filters.folder`'s `.transform()`; only the
 * `io: 'input'` form avoids that throw *and* yields the optional-`k`,
 * `required: ["query"]` shape a model needs. Note that refinements are likewise
 * not representable in JSON Schema, so any later joint bound (e.g. an inverted
 * date-range check) is absent from the published `inputSchema` — zod-side
 * validation, not the published schema, is the enforcement point.
 */
export const GraphMcpToolArgsSchema = GraphSearchRequestBaseSchema.pick({
  query: true,
  k: true,
  filters: true
}).extend({
  k: z.number().int().min(1).max(MCP.MAX_TOP_K).default(GRAPH.DEFAULT_TOP_K),
  // The renderer filters LEAF carries the `modifiedAfterMs <= modifiedBeforeMs`
  // refine, but the MCP filter set omits `excludeSectionId` off the unrefined
  // BASE (`.omit()` throws on a refined object), so the same joint bound is
  // re-attached here — otherwise an inverted range would silently reach the
  // external-client reader and return nothing.
  filters: GraphSearchFiltersBaseSchema.omit({ excludeSectionId: true })
    .refine(isAscendingModifiedRange, MODIFIED_RANGE_REFINE)
    .optional()
})
/**
 * `…Args`, not `…Input`. The schema keeps the name of the MCP field it
 * populates (`inputSchema`), so the house `<Base>Input` = `z.input` convention
 * applied to `GraphMcpToolInput` produced `GraphMcpToolInputInput` — a name
 * whose two `Input`s mean different things. The subject is the tool's
 * arguments, so that is what the types are called.
 */
export type GraphMcpToolArgsInput = z.input<typeof GraphMcpToolArgsSchema>
export type GraphMcpToolArgs = z.output<typeof GraphMcpToolArgsSchema>

/** A model-facing string: sentinel-free, smuggling-free and bounded. Applied to
 *  `heading` and `snippet`, which are free text, not paths. The predicate
 *  {@link isModelSafeText} rejects C0/C1 controls (ANSI escapes, the
 *  `char(2)`/`char(3)`/`char(4)` snippet sentinels) plus the model-facing bidi
 *  and Unicode-tag smuggling vectors. */
const McpTextSchema = z
  .string()
  .max(MCP.MAX_RESULT_CHARS)
  .refine(isModelSafeText, {
    message:
      'must not contain control, bidi or Unicode tag characters (tab/newline allowed)'
  })

/**
 * `filePath` is the one result field that is also a PATH, so on top of the
 * sentinel/bounds check it is confined: project-relative, no `..`, no NTFS ADS
 * colon, no reserved device basename. This is what makes the "never absolute"
 * clause in the schema JSDoc below enforceable rather than aspirational — a tool
 * result crossing the external-client boundary cannot leak the user's
 * home-directory layout.
 */
const McpFilePathSchema = ConfinedRelativePathSchema(MCP.MAX_RESULT_CHARS).refine(
  isModelSafeText,
  {
    message:
      'must not contain control, bidi or Unicode tag characters (tab/newline allowed)'
  }
)

/**
 * The tool's `outputSchema`.
 *
 * Indexed Markdown is attacker-influenceable the moment a user clones a shared
 * repository, and a tool result is the channel a model trusts most. Three
 * obligations wrap this shape, all owned by #30 — and the first two are
 * **expressed here**, because a schema that documents an obligation it cannot
 * fail is a comment, not a contract:
 *
 * 1. `untrustedContentNotice` is pinned to the exact `MCP.UNTRUSTED_NOTICE`
 *    literal — `z.literal`, not `z.string().min(1)`, so a truncated, localised or
 *    tampered guardrail cannot validate. The literal pins the VALUE only; #30
 *    still owns the ORDERING obligation (emitted **once per response** as the
 *    first content block so a large result set cannot dilute it), which a schema
 *    on a single field cannot express.
 * 2. Every string field is refused if it carries C0 (`U+0000`–`U+001F`, except
 *    `\t`/`\n`) or C1 (`U+0080`–`U+009F`), so the strip #30 performs is verified
 *    rather than assumed: ANSI escapes and the `char(2)`/`char(3)`/`char(4)`
 *    snippet sentinels must never leave Erfana.
 * 3. `MCP.MAX_RESULT_CHARS` per model-facing text field and
 *    `MCP.MAX_RESPONSE_BYTES` per response. The per-field `.max()` bounds are
 *    CHARACTER counts (`z.string().max()` measures UTF-16 code units, not bytes),
 *    sized so `MAX_TOP_K × 3 fields × MAX_RESULT_CHARS` cannot exceed the response
 *    byte budget even at the UTF-8 worst case of 3 bytes/char ([#21]). Because
 *    per-field char caps alone do not bound the JSON envelope (keys, structure,
 *    `score`), the true per-response backstop is the object-level
 *    serialised-length refine below, which measures `TextEncoder`-encoded BYTES
 *    against `MCP.MAX_RESPONSE_BYTES`. On truncation `truncated` is set so the
 *    model is told the view is partial rather than silently receiving a clipped
 *    corpus.
 *
 * `results` is capped at `MCP.MAX_TOP_K`, matching the input bound: an
 * unbounded array would let a mis-sized response through the one schema a
 * reviewer would expect to catch it.
 *
 * `filePath` is display-only: project-relative, NFC, forward slashes, never
 * absolute, so a tool result cannot leak the user's home-directory layout — now
 * enforced by {@link McpFilePathSchema}, not just documented.
 */
export const GraphMcpToolResultSchema = z
  .object({
    untrustedContentNotice: z.literal(MCP.UNTRUSTED_NOTICE),
    results: z
      .array(
        z.object({
          filePath: McpFilePathSchema,
          heading: McpTextSchema,
          snippet: McpTextSchema,
          score: z.number()
        })
      )
      .max(MCP.MAX_TOP_K),
    truncated: z.boolean()
  })
  // The true per-response backstop: per-field CHARACTER caps bound the fields but
  // not the serialised JSON envelope. `TextEncoder`, not `Buffer.byteLength`,
  // because this module is renderer-reachable through the IPC layer and `Buffer`
  // is a Node-only global absent in the sandboxed renderer — `TextEncoder` is a
  // Web/Node standard and gives the same UTF-8 byte length in both processes.
  .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= MCP.MAX_RESPONSE_BYTES, {
    message: `serialised result must not exceed MCP.MAX_RESPONSE_BYTES (${MCP.MAX_RESPONSE_BYTES} bytes)`
  })
export type GraphMcpToolResult = z.output<typeof GraphMcpToolResultSchema>

// ─── main ↔ utilityProcess port ──────────────────────────────────────────────

export const GraphPortSearchRequestSchema = z.strictObject({
  kind: z.literal('graph:search'),
  /** Inbound at the port boundary an external client reaches: bounded +
   *  model-safe, not pattern-pinned (D6). */
  correlationId: GraphInboundCorrelationIdSchema,
  /** Fenced like a worker message: one port would otherwise span arbitrary
   *  project switches, answering an in-flight search from whichever reader was
   *  attached when the handler ran. */
  switchVersion: z.number().int().nonnegative(),
  payload: GraphMcpToolArgsSchema
})

/** FR-044: complete pending requests before shutdown. */
export const GraphPortDrainRequestSchema = z.strictObject({
  kind: z.literal('graph:drain'),
  /** Inbound request id: bounded + model-safe, not pattern-pinned (D6). */
  correlationId: GraphInboundCorrelationIdSchema
})

export const GraphPortRequestSchema = z.discriminatedUnion('kind', [
  GraphPortSearchRequestSchema,
  GraphPortDrainRequestSchema
])
export type GraphPortRequestInput = z.input<typeof GraphPortRequestSchema>
export type GraphPortRequest = z.output<typeof GraphPortRequestSchema>

export const GraphPortSearchResultSchema = z.strictObject({
  kind: z.literal('graph:search:result'),
  correlationId: GraphOutboundCorrelationIdSchema,
  payload: GraphMcpToolResultSchema
})

export const GraphPortSearchErrorSchema = z.strictObject({
  kind: z.literal('graph:search:error'),
  correlationId: GraphOutboundCorrelationIdSchema,
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
  correlationId: GraphOutboundCorrelationIdSchema,
  retryAfterMs: z.number().int().positive()
})

export const GraphPortDrainedSchema = z.strictObject({
  kind: z.literal('graph:drained'),
  correlationId: GraphOutboundCorrelationIdSchema,
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
  /**
   * Supplied by an unauthenticated local process BEFORE the token is validated,
   * then rendered in the consent dialog and written to the connection log. Two
   * refines guard it: {@link isModelSafeText} rejects ANSI, C1 and bidi/tag
   * smuggling, and a single-line check rejects tab/newline — which
   * `isModelSafeText` deliberately PERMITS for multi-line model text but which a
   * one-line identifier must never carry, since a newline is the log-line forgery
   * vector this field is guarded against. #30 renders it as plain text, never markup.
   */
  clientName: z
    .string()
    .max(128)
    .refine(isModelSafeText, {
      message: 'clientName must not contain control, bidi or Unicode tag characters'
    })
    .refine((v) => !/[\t\n]/.test(v), {
      message: 'clientName must be a single line (no tab or newline)'
    })
})
export type GraphMcpConnect = z.output<typeof GraphMcpConnectSchema>

export const GraphMcpConnectAckSchema = z.strictObject({
  kind: z.literal('mcp:connected'),
  projectName: z.string().max(256),
  /** `MCP.BETA_DISCLAIMER`. */
  disclaimer: z.string()
})
export type GraphMcpConnectAck = z.output<typeof GraphMcpConnectAckSchema>
