# Implementation roadmap

*Roadmap for active drafts. Shipped specs (021 LiteParse v0.9.0, 022 git-status offloading v0.9.0, 009 media import v0.8.0) are removed once archived; see `specs/registry.json` for lifecycle.*

## Delivery model (decided 2026-07-23)

- **Value-recut releases**: spec boundaries ≠ release boundaries – each release is defined by user-visible value; plumbing rides inside whichever release needs it.
- **Both surfaces first-class**: every release ships its human UI slice AND its agent MCP slice; under scope pressure, cut depth (fewer FRs done well), never a whole surface.
- **Differentiation thesis**: integration is the moat (build over copy) – live index on every save, per-project lifecycle, in-app UI; commoditization of generic search by agent built-ins is acceptable.
- **Quality order**: relevance > freshness > footprint; conflicts resolve toward relevance.
- **No deadline**: cadence emerges from dogfooding; quality-first.
- **Fold trigger**: if user zero stops using it (~a month of dogfooding without missing it), the chain pauses and remaining scope is re-cut.
- **Beta contracts**: MCP tool schemas and the DB schema ship beta-labelled until frozen (~one month stable + two releases without churn).
- **Success measure**: dogfood observation + spec NFR gates; no telemetry is collected.

## Dependency map

```
GRAPH ENGINE (sequential chain):       INDEPENDENT:
004 Foundation                          013 CLI prompts
 ↓ required                             020 Google Drive
005 Vector search
 ↓ optional (but recommended)
006 Knowledge graph
 ↓ required
007 Temporal queries

008 Polish – requires 004+005, optionally 006+007
```

### Hard dependencies

| Spec | Requires |
|------|----------|
| 005 | **004** – database, sections table, FTS5, indexing |
| 006 | **004** – database, sections table, indexing |
| 007 | **006** – entities and edges tables |
| 008 | **004 + 005** – database + embeddings; optionally 006 for Mermaid entity viz |

### Soft dependencies (enhance but don't block)

- 006 benefits from 005 (semantic entity matching)
- 008 benefits from 006 (entity neighborhood visualization)
- 005 benefits from 008 (index-rebuild progress reuses 008's reindex-progress UX when available)
- 013 enhances 020 (multi-tool AI prompts for Drive content)

---

## Sequential implementation order

| # | Spec | Tier | FRs | Rationale |
|---|------|------|-----|-----------|
| 1 | **004** Graph engine foundation | T4 | 50 | Foundational – unlocks entire graph pipeline. Largest single spec, best tackled with full focus |
| 2 | **005** Vector search & hybrid retrieval | T3 | 40 | First graph dependency – needs 004's database + sections table |
| 3 | **006** Knowledge graph & entities | T3 | 32 | Needs 004; benefits from 005's vector similarity for semantic entity matching |
| 4 | **007** Temporal queries & timeline | T3 | 26 | Needs 006's edges table to extend with temporal fields |
| 5 | **008** Graph engine polish | T3 | 31 | Needs 004+005 (required) + 006 (Mermaid viz) + 007 (temporal health). Gets all optional enhancements |
| – | **020** Google Drive link integration | T4 | 50 | **Deferred behind the graph chain** (decision 2026-07-23) |
| – | **013** Multi-CLI tool prompts | T3 | 13 | **Deferred behind the graph chain** (decision 2026-07-23) |

## Release map (initial cut)

Spec is the provisional scope source; each release is refined at kickoff per the delivery model.

| Release | Headline user value | Provisional scope source |
|---------|--------------------|--------------------------|
| R1 | "Find anything in your project" – indexed search panel, live index on save, `erfana_graph_search` (beta) | spec 004 |
| R2 | "Search by meaning" – semantic/hybrid RRF search, enable-and-download model, `erfana_graph_related` (beta) | spec 005 |
| R3 | "See the connections" – entities, backlinks, Knowledge Panel, `erfana_graph_entities`/`_backlinks`/`_traverse` | spec 006 |
| R4 | "What did we know when" – as-of historical queries, `erfana_graph_timeline` (timeline UI as tail depth) | spec 007 |
| R5 | "Grows with your project" – health, migration, compression ladder, contract freeze | spec 008 |

Per the delivery model: plumbing/tail items may move across releases; cuts reduce depth, never a whole surface; boundaries here are provisional, not commitments.

---

## Rationale for ordering decisions

**004 first**: Foundational for the entire graph pipeline. Largest spec (50 FRs + 11 NFRs); best tackled with full focus before dependent specs start. Previously 021 took the #1 slot — that shipped in v0.9.0 (archived); dialog patterns (DocumentImportDialog, progress streaming, dependency detection) from 021 still inform 020's design.

**004 → 005 → 006**: Strict dependency chain. 006 placed after 005 (not just 004) so it can use vector similarity for semantic entity matching – the optional dependency is worth respecting.

**Chain runs uninterrupted (decision 2026-07-23)**: 004→005→006→007→008 with no interleaved work. 020 and 013 are explicitly deferred behind the chain; the earlier "mental break" rationale for slotting 020 mid-chain was dropped in favor of focus.

**007 → 008**: 007 extends 006's edges table. 008 is the "polish" spec – it leverages everything: database (004), embeddings (005), entities (006), and temporal data (007).

---

## Risk factors

| Risk | Spec | Status (decisions 2026-07-23) |
|------|------|-------------------------------|
| Native modules in packaged Electron (better-sqlite3, Sharp, onnxruntime) | 004, 005 | **Accepted as-is** – no structural countermeasures by decision. Context: better-sqlite3 v13 N-API prebuilds lower the risk (pending Electron 39 prebuild-coverage verification at pin time); exact sqlite-vec pin + rebuild-from-BLOBs path (005-FR-040) exist in-spec |
| Chain stalls before completion (no deadline, solo maintainer) | 004–008 | **Accepted as-is** – no structural countermeasures by decision; the fold trigger (delivery model) is the only guard |
| HF model availability / first-run download | 005+ | Accepted; 008's model-migration flow is the designed swap path if the artifact is ever gated or removed |
| OAuth + Google Picker complexity | 020 | Deferred with 020 |
