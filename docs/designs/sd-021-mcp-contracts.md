<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# SD-021 part 4b — MCP port and tool contracts (AC-1)

Part of the SD-021 set — index in [`sd-021-graph-architecture.md` §0](sd-021-graph-architecture.md). Split from [`sd-021-ipc-contracts.md`](sd-021-ipc-contracts.md) §7 to keep both files under the 500-line design-doc cap. Covers **§7.10** — the MCP `utilityProcess` port schemas and the model-facing tool contract consumed by #30.

---

### 7.10 MCP port and tool contracts (B7)

Revision 2 named `GraphPortRequestSchema`/`GraphPortResponseSchema` in prose and defined neither. Four gaps #30 would hit immediately, all closed here.

```ts
/** main ↔ utilityProcess over MessageChannelMain. `requestId` renamed to
 *  correlationId — it was the one boundary leaving the main process and used a
 *  different identifier from every other payload, breaking §7.9 there. */
// Inbound port REQUESTS use GraphInboundCorrelationIdSchema (bounded + model-safe);
// port RESPONSES use GraphOutboundCorrelationIdSchema (pattern-pinned) — D6.
export const GraphPortRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('graph:search'), correlationId: GraphInboundCorrelationIdSchema,
    /** Fenced like a worker message: one port spans arbitrary project switches (M7). */
    switchVersion: z.number().int().nonnegative(),
    payload: GraphMcpToolArgsSchema }),
  /** FR-044: complete pending requests before shutdown. */
  z.strictObject({ kind: z.literal('graph:drain'), correlationId: GraphInboundCorrelationIdSchema })
])

export const GraphPortResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('graph:search:result'), correlationId: GraphOutboundCorrelationIdSchema,
    payload: GraphMcpToolResultSchema }),
  z.strictObject({ kind: z.literal('graph:search:error'), correlationId: GraphOutboundCorrelationIdSchema,
    code: GraphErrorCodeSchema }),
  /** FR-042 backpressure needs a SIGNAL, or the peer cannot tell throttled from hung. */
  z.strictObject({ kind: z.literal('graph:throttled'), correlationId: GraphOutboundCorrelationIdSchema,
    retryAfterMs: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('graph:drained'), correlationId: GraphOutboundCorrelationIdSchema,
    completed: z.number().int().nonnegative() })
])
```

**Model-facing tool input.** Reusing `GraphSearchRequestSchema` verbatim would have handed `registerTool` a shape containing `correlationId`, `offset` and `excludeSectionId` — a DB-internal integer no model can know — while MCP requires a valid `inputSchema` that servers MUST validate.

```ts
// Derived from the unrefined BASE object, not the renderer leaf: zod 4 throws on
// `.pick()`/`.omit()` applied to an object that carries a refinement, and the
// leaves are where later joint bounds (`offset + k`, `modifiedAfterMs <=
// modifiedBeforeMs`) attach. See §7.0's base/leaf split.
export const GraphMcpToolArgsSchema = GraphSearchRequestBaseSchema
  .pick({ query: true, k: true, filters: true })
  .extend({
    k: z.number().int().min(1).max(MCP.MAX_TOP_K).default(GRAPH.DEFAULT_TOP_K),
    // Omit off the UNREFINED base (.omit() throws on a refined object), then
    // re-attach the same `modifiedAfterMs <= modifiedBeforeMs` refine the renderer
    // leaf carries — so an inverted range cannot silently reach the external reader.
    filters: GraphSearchFiltersBaseSchema.omit({ excludeSectionId: true })
      .refine(isAscendingModifiedRange, { path: ['modifiedAfterMs'] }).optional()
  })

// JSON-Schema: convert with `z.toJSONSchema(GraphMcpToolArgsSchema, { io: 'input' })`.
// The default and `{ io: 'output' }` forms throw (`Transforms cannot be represented
// in JSON Schema`) on the inherited `filters.folder` transform; `io:'input'` both
// avoids that and yields `required: ["query"]`. Refinements are likewise NOT
// representable in JSON Schema, so later joint bounds are absent from the published
// `inputSchema` — zod-side validation, not the published schema, enforces them.

/** Declared as the tool's outputSchema. The untrusted-data envelope, control-char
 *  stripping and byte caps that wrap it are contracted in §9.4 (B1). */
/** The strip and the payload caps are EXPRESSED here, not just described:
 *  a schema that documents an obligation it cannot fail is a comment. McpText =
 *  z.string().max(MCP.MAX_RESULT_CHARS).refine(isModelSafeText) — the refine
 *  rejects C0 except tab/newline and all of C1 (which carry ANSI escapes and
 *  Erfana's char(2)/char(3)/char(4) snippet sentinels), AND the model-facing
 *  smuggling vectors: unpaired surrogates, bidi controls (U+202A–U+202E,
 *  U+2066–U+2069) and the Unicode tag block (U+E0000–U+E007F, an invisible ASCII
 *  mirror a model still reads). isModelSafeText scans by CODE POINT, so a tag
 *  char arriving as a surrogate pair is caught. `.max()` counts UTF-16 CHARACTERS,
 *  not bytes — MAX_RESULT_CHARS is sized as MAX_RESPONSE_BYTES / (3 × MAX_TOP_K)
 *  ([#21]) so MAX_TOP_K × 3 fields × cap cannot exceed the response byte budget
 *  even at 3 bytes/char. The true per-response backstop is the object-level
 *  serialised-BYTE refine below (TextEncoder, portable to the sandboxed renderer,
 *  not Buffer). */
// filePath is the one result field that is ALSO a path, so it is confined on top
// of the sentinel/bounds check (project-relative, no `..`, no ADS colon, no
// reserved device name): McpFilePath = ConfinedRelativePathSchema(MAX_RESULT_CHARS)
// .refine(isModelSafeText). This makes the "never absolute" clause enforceable
// at the external-client boundary. heading/snippet are free text, not paths.
export const GraphMcpToolResultSchema = z.object({
  // Pinned to the exact literal (S-[14]), not `.min(1)`: a truncated, localised or
  // tampered guardrail must not validate. #30 still owns emitting it once, first,
  // per response — the literal pins the VALUE, not the ordering.
  untrustedContentNotice: z.literal(MCP.UNTRUSTED_NOTICE),
  results: z.array(z.object({
    filePath: McpFilePath, heading: McpText, snippet: McpText, score: z.number()
  })).max(MCP.MAX_TOP_K),
  truncated: z.boolean()
}).refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= MCP.MAX_RESPONSE_BYTES)
```

`MCP.MAX_TOP_K` (20) is deliberately lower than the renderer's 100, and `offset` is not exposed at all: every MCP request lands on the synchronous main-thread reader from **outside** the trust boundary, so the cheapest bound is the request shape itself.
