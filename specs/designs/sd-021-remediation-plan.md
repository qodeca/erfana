<!--
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
SPDX-License-Identifier: GPL-3.0-only
-->

# SD-021 remediation plan — lens-review findings

**Source:** lens review of the #21 implementation (2026-07-29), 5 areas, 34 findings — 2 blockers, 14 majors, 17 minors, 1 nit.
**Scope rule unchanged:** #21 commits contract code only. Every item below is a schema, constant, SQL string, test, comment or config edit. Nothing here wires anything to runtime.

The organising question for every finding is **"is this cheap now and expensive after #23 starts?"** — because once #23–#32 build against a frozen shape, changing it is a reopen. That question, not severity alone, drives the batching.

---

## 1. Batches

| Batch | What | Why now | Items |
|---|---|---|---|
| **A — CI regression** | Restore the vitest glob | A live regression this branch introduced; 34 existing assertions left the required check | 1 |
| **B — Frozen contracts** | Schema, interface and DDL shapes downstream issues build against | Reopen cost after #23 starts | 2–9, 12–21, 27–29, 31 |
| **C — Test discriminating power** | Tests that cannot fail | The suite is the only thing standing between a frozen contract and a false downstream belief | 10, 22–26 |
| **D — Documentation truth** | Stale or misleading comments | Cheap; a wrong comment here becomes a wrong implementation there | 30, 32–34 |
| **E — Already tracked** | Coverage config | Filed as #35, hard prerequisite for #23 | 11 |

Batches A and B are the ones that must land before this issue closes. C and D should ride along in the same pass. E is out of scope for #21 by prior decision.

---

## 2. Batch A — CI regression (do first, independently)

**[1] vitest `include` narrowing dropped two suites; the comment is inverted.** `vitest.main.ts:10-19`

The pre-change glob `scripts/**/*.test.{js,mjs,ts}` matched `scripts/fuses.test.mjs` (29 tests) and `scripts/ensure-media-binaries.test.mjs` (5 tests). Narrowing to `scripts/spikes/**` removed 34 assertions — Electron fuse verification, node-pty spawn-helper chmod, foreign-prebuild pruning, media-binary SHA verification — from the branch-protection-required `test` job. The comment asserts those files were never collected, which is false.

- Restore `scripts/**/*.test.{js,mjs,ts}`; it already covers `spikes/`.
- Rewrite the comment to state what is actually true.
- Confirm the count returns to its pre-branch value.

This is independent of every other item and should be verified on its own before batch B begins, so the test-count baseline is trustworthy for the rest of the work.

---

## 3. Batch B — frozen contracts

### B1. Correctness defects that fail silently (highest value)

**[2] The rebuild erases its own safety budget.** `graphSchema.ts:213`, `:224`, `:391` — **blocker**
`GRAPH_REBUILD_PROGRAM` drops `graph_meta`; `GRAPH_STAMP_SQL` restores only three of six keys. The three budget keys are destroyed, so `rebuildBudget` reads all-NULL, which the query's own comment defines as "never rebuilt". `MAX_AUTO_REBUILDS_PER_SESSION` becomes unreachable and the cooldown compares against NULL — an unbounded rebuild loop with Settings showing nothing.
*Fix:* exclude `graph_meta` from the DROP half and use a targeted `DELETE ... WHERE key IN (...)`, or read the three values pre-DROP and extend the stamp to re-insert them. Add a test asserting the budget survives a rebuild.

**[3] FTS rowid alignment is unenforceable and both audits are blind to it.** `graphSchema.ts:176`, `:405`, `:409`
A misaligned posting satisfies both orphan audits and FTS5's own integrity check, then serves one file's heading with another's body.
*Fix:* add an alignment-sensitive audit comparing `fts.text`/`fts.heading` against the joined rows; assert `last_insert_rowid()` equals the section id in the writer's batch.

**[4] Snippet sentinels are forgeable by document text.** `graphSchema.ts:294-295`, `:343-344`
Nothing strips C0 characters at ingest, so a Markdown file containing U+0004 forges `snippetTruncated`, and U+0002/U+0003 forge highlight spans — breaking the schema's declared `occurrencesInSnippet === offsets.length` invariant.
*Fix:* strip C0 (except tab/LF/CR) before text reaches `contents` and `sections_fts`, plus an audit query for existing rows. Decide whether `snippetTruncated` should instead derive from token count.

**[5] `generation` is three types across three hops.** `graphSchema.ts:375`, `IGraphReadConnection.ts:105`/`:113`, `graph-status-schema.ts:129`
better-sqlite3 returns INTEGER as a JS number unless `safeIntegers()` is enabled, so `1n === 1` is permanently false and any equality check silently never fires; above 2^53 it is also lossy. The snapshot re-widens it to an unbounded unvalidated string, so `BigInt(snapshot.generation)` throws on accepted values.
*Fix:* pick one representation. Export one `GraphGenerationSchema` used on both the worker reply and the snapshot; test a value above `Number.MAX_SAFE_INTEGER`.

**[20] `graph_meta` enforces neither its key set nor its column discipline.** `graphSchema.ts:93-98`
Writing the version into the wrong column violates nothing, and the version query then returns NULL — which triggers discard-and-rebuild. Combined with [2], one column mix-up becomes a permanent loop.
*Fix:* `CHECK (key IN (...))` plus a per-key column-discipline CHECK.

### B2. Contracts that cannot express what their comments promise

**[8] Path confinement guards two fields and skips three.** `graph-schema.ts:104`/`:89`, `graph-worker-schema.ts:93`, `graph-mcp-schema.ts:125`
The MCP `filePath` comment claims "never absolute, so a tool result cannot leak the user's home-directory layout" — nothing enforces it, on the one field crossing to an external client.
*Fix:* hoist a shared `ConfinedRelativePathSchema` into the leaf module; apply to all five sites, parameterising only the length bound.

**[14] The untrusted-content notice is unpinned.** `graph-mcp-schema.ts:121`
`z.string().min(1)` on the single field carrying the injection guardrail, in a file whose own comment argues that an unfailable schema "is a comment, not a contract".
*Fix:* `z.literal(MCP.UNTRUSTED_NOTICE)`.

**[13] The FTS5 sanitiser is frozen as prose.** `IGraphReadConnection.ts:43`
Every other security control was frozen as an exported, tested predicate; this one — the only thing between user text and the FTS5 parser — is a comment. An implementation binding the raw query typechecks and satisfies every committed schema.
*Fix:* commit `buildMatchExpression` and its property test in #21, and brand the `match` type so binding a raw query is a compile error.

**[15] Trace identifiers are unbounded and pattern-free on every boundary.** ~12 sites
The patterns are defined, exported and tested but wired into no schema.
*Fix:* define `CorrelationIdSchema`/`JobIdSchema` and use them everywhere; at minimum `.max(128)` plus a control-character refinement if externally-minted ids must be tolerated.

**[12] The control-character check misses the Unicode tag block.** `graph-mcp-schema.ts:74`
Sized for ANSI escapes, not for model-facing smuggling. U+E0000–U+E007F renders as nothing and reads as text to a model.
*Fix:* extend the existing scan to the tag block and unpaired surrogates; consider bidi controls; rename to reflect the broader contract.

**[9] No worker reply variant can answer `close`.** `graph-worker-schema.ts:260-265`
Every close fails `safeParse`, is dropped as a protocol error, hangs to the timeout and force-terminates the worker — which the interface documents as the *failure* path.
*Fix:* add a `closed` variant carrying `checkpointed` and phase durations; return it from `close()`.

**[6] "Already validated" is not expressible.** `IGraphQueryService.ts:37` vs `IGraphSearchService.ts:49`
The resolved type is assignable to the input type, so parse-once, parse-twice and parse-never all typecheck, and the two interface headers state contradictory contracts.
*Fix:* either take the resolved types at the query interface, or brand the validated form.

### B3. Bounds and validation gaps

**[7]** `filters.folder` accepts `''`, which the transform turns into `'/'` — silent zero results. Add `.min(1)`; document that "no filter" means omitting the key. Note `.max()` runs pre-transform, so the output can exceed the ceiling by one.
**[19]** `offset + k` is unbounded jointly, so deep pages return one row while `hasMore` reads false. Add an object-level refinement and bind `probeLimit` as `min(MAX_COUNT_PROBE, offset + k + 1)`. Same gap on `modifiedAfterMs <= modifiedBeforeMs`.
**[21]** `MAX_RESULT_BYTES` used as `.max()` counts UTF-16 code units — ~22× the documented response cap, not the claimed 4×. Rename to `MAX_RESULT_CHARS`, re-derive the bound, add a serialised-length refinement.
**[29]** The response ceiling has no schema expression, and `GraphSearchResponseSchema` bounds nothing — in deliberate contrast to the status snapshot, which bounds every path and array. Bound `results` and give the strings their siblings' ceilings.
**[27]** `clientName` is length-bounded but not control-character checked, on a field an unauthenticated local process controls and that is rendered in a consent dialog and logged.
**[28]** Windows alternate data streams (`notes.md:hidden`) and reserved device names (`COM1`, `NUL`) pass the path check. The repo already ships this check at `LocalWhisperService.ts:225-239` — factor it out and call it under `isWindows()`.

### B4. Schema hygiene with downstream cost

**[16]** `GraphMcpToolInputSchema` throws on JSON-Schema conversion (inherited transform); `k`'s default also marks it required in the output form. Document `{ io: 'input' }` and add a conversion test — three lines that turn a documented obligation into an enforced one.
**[17]** The SQLite floor is 3.37.0 but `json_each` needs 3.38.0 — a gate meant to fail closed fails open on the one query the DDL never exercises. Raise the floor, or replace `json_each(:ids)` with a bounded `IN (?,?,…)` list.
**[18]** `idx_sections_file` is a strict prefix of `idx_sections_file_ordinal` — a write on every insert for no read benefit; SQLite documents this as an anti-pattern. Delete it and its DROP.
**[31]** `GraphMcpToolInputSchema` breaks the `XSchema` → `X` naming rule, so its type is unreachable by search in a codebase with no barrel index. Rename to `GraphMcpToolArgsSchema`.

---

## 4. Batch C — tests that cannot fail

**[10]** Three of six `searchPage` filters (`after`, `before`, `excludeKey`) are never exercised with a non-null value; `fileType` is asserted only negatively. Inverting any of them leaves the suite green. Add positive and negative pairs for each.
**[22]** The DROP/CREATE drift guard compares a value to itself — both sides evaluate to `created.length - 1` by construction.
**[23]** The correlation-id collision test asserts a set of two distinct random ids has size 2 — true regardless of prefix, which is the property it is named for.
**[24]** The namespace test restates something proven two lines earlier and never imports the module it is meant to check against.
**[25]** A test name promises three guarantees and checks two; the same over-promise appears on the snapshot's `generation` field, which has no format constraint and no rejection case.
**[26]** The version gate is tested only in the newer-than-expected direction, while the contract covers both — and #23 will lift this oracle into the production writer.

Each is small. [10] is the one with real mutation-coverage value; the rest are correctness-of-the-suite items.

---

## 5. Batch D — documentation truth

**[30]** Drop the hard-coded "26" from `IGraphIndexWorker.ts:61-62`; the count belongs only where a test asserts it.
**[32]** The layering header omits the two modules that import from it — add one line naming them.
**[33]** The envelope rationale is duplicated byte-for-byte across two modules; keep one, cross-reference the other.
**[34]** A test header names the wrong file it was split from.

---

## 6. Sequencing

1. **Batch A alone**, verified independently, to re-establish a trustworthy test baseline.
2. **B1** (silent-failure correctness) — these change the DDL, so they should settle before anything that tests against it.
3. **B2 + B3** (contract expressiveness and bounds) — largely independent of each other; several share the "hoist a shared predicate" shape and are cheaper done together.
4. **C** — after B, so tests are written against final shapes rather than rewritten twice.
5. **B4 + D** — hygiene, no dependencies, can ride along at any point.

Full battery (`typecheck`, `lint`, `test`, `check:headers`) after each batch, with the test count reported against the corrected baseline from step 1.

---

## 7. Deliberately out of scope

- **[11] Coverage config** — filed as issue #35, already a stated hard prerequisite for #23.
- **The 5 remaining high-severity dependency advisories** — deferred by explicit product-owner decision; they need a major bump of the document-import library and their own testing pass.
- **The ~7 lower-severity items** the reviewers reported but did not itemise (a missing non-negative CHECK on `corpus_stats.last_indexed_at_ms`, a mis-described audit scan cost, an unused FTS5 `rank MATCH` optimisation, missing narrowed types for worker message variants, an unchecked generic on `queryAll`/`queryGet`, `jobId` optionality drift). Worth a pass, but none blocks the freeze.

---

## 8. Design-document impact

Several batch-B fixes change what the design says, not just what the code does. The seven design files must be updated in the same pass so the design set stays the normative source:

- `sd-021-db-schema.md` — the rebuild program's key handling [2], the ingest control-character contract [4], `graph_meta` CHECKs [20], the SQLite floor [17], the dropped index [18].
- `sd-021-ipc-contracts.md` — the shared confinement schema [8], the joint `offset`/`k` bound [19], the byte-vs-character correction [21], response bounds [29], the naming change [31].
- `sd-021-worker-contracts.md` — the `closed` message variant [9].
- `sd-021-cross-cutting.md` — the sanitiser moving from prose to committed code [13], the widened control-character contract [12], correlation-id validation [15].
- `sd-021-errata-and-risks.md` — the §11 test-plan rows for every new test.
