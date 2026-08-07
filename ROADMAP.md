# Implementation roadmap

*Roadmap for active drafts. Shipped specs (021 LiteParse v0.9.0, 022 git-status offloading v0.9.0, 009 media import v0.8.0) are removed once archived; see `specs/registry.json` for lifecycle.*

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
- 013 enhances 020 (multi-tool AI prompts for Drive content)

---

## Sequential implementation order

> **The graph chain (004–008) is already underway on the `graph` branch, not here.** Its R1 contracts are frozen under [#21](https://github.com/qodeca/erfana/issues/21) — schemas, DDL, `IGraph*` interfaces, error codes and the `specs/designs/sd-021-*` design set — and the refreshed spec requirements live there too. `develop` deliberately carries none of it, so the table below reflects the pre-freeze plan. Before starting any of 004–008, branch off `graph` and read its `specs/` and design set first; starting from `develop` means re-implementing work that already exists. See the Branching model section in `CLAUDE.md`.

> **Chain status (verified 2026-08-07 against `gh issue list --repo qodeca/erfana --state all`):** the release-1 umbrella is [#17](https://github.com/qodeca/erfana/issues/17) "Graph engine R1: project search (spec 004)", still open. The analysis and architecture issues [#19](https://github.com/qodeca/erfana/issues/19), [#20](https://github.com/qodeca/erfana/issues/20) and [#21](https://github.com/qodeca/erfana/issues/21) are all **closed** – the contract freeze they describe has landed on `graph`. The implementation chain [#22](https://github.com/qodeca/erfana/issues/22)–[#32](https://github.com/qodeca/erfana/issues/32) (DB layer, preprocessing, indexing, search API, the three UI surfaces, MCP server, testing) is open and is where graph work now happens.

| # | Spec | Tier | FRs | Rationale |
|---|------|------|-----|-----------|
| 1 | **004** Graph engine foundation | T4 | 50 | Foundational – unlocks entire graph pipeline. Sequenced first for its dependencies, not its size; large enough (50 FRs + 11 NFRs) to deserve full focus |
| 2 | **005** Vector search & hybrid retrieval | T3 | 38 | First graph dependency – needs 004's database + sections table |
| 3 | **006** Knowledge graph & entities | T3 | 27 | Needs 004; benefits from 005's vector similarity for semantic entity matching |
| 4 | **020** Google Drive link integration | T4 | 51 | Independent but complex (OAuth, Picker, 4 services). Placed here as a break between graph milestones |
| 5 | **007** Temporal queries & timeline | T3 | 24 | Needs 006's edges table to extend with temporal fields |
| 6 | **008** Graph engine polish | T3 | 30 | Needs 004+005 (required) + 006 (Mermaid viz) + 007 (temporal health). Gets all optional enhancements |
| 7 | **013** Multi-CLI tool prompts | T3 | 8 | Lowest complexity, no dependencies. Enhances AI prompts across all features retroactively |

---

## Rationale for ordering decisions

**004 first**: Foundational for the entire graph pipeline. It leads on **dependencies, not size** – 020 is in fact the larger spec (51 FRs + 15 NFRs = 66 requirements, versus 004's 50 + 11 = 61; `specs/registry.json` counts 110 against 107). 004 goes first because 005–008 cannot start without its database, sections table and indexing, and at 61 requirements it still deserves full focus before dependent specs start. Previously 021 took the #1 slot — that shipped in v0.9.0 (archived); dialog patterns (DocumentImportDialog, progress streaming, dependency detection) from 021 still inform 020's design.

**004 → 005 → 006**: Strict dependency chain. 006 placed after 005 (not just 004) so it can use vector similarity for semantic entity matching – the optional dependency is worth respecting.

**020 between 006 and 007**: A context switch from graph work. 020 is independent, so it can slot anywhere, but placing it here provides a mental break from the graph pipeline and lets the graph architecture settle before the final two specs.

**007 → 008**: 007 extends 006's edges table. 008 is the "polish" spec – it leverages everything: database (004), embeddings (005), entities (006), and temporal data (007).

**013 last**: Lowest complexity (8 FRs), no dependencies in either direction. Multi-tool prompt support enhances existing AI prompts retroactively – no feature needs it as a prerequisite.

---

## Risk factors

| Risk | Spec | Mitigation |
|------|------|------------|
| Native modules in packaged Electron (better-sqlite3, Sharp, onnxruntime) | 004, 005 | Test packaged builds early (pattern proven by 021 LiteParse) |
| OAuth + Google Picker complexity | 020 | Well-scoped: `drive.file` only, single account |
| 004 is large (50 FRs + 11 NFRs) and blocks four downstream specs | 004 | Consider staged delivery: DB+indexing first, then UI |
| Graph pipeline is 5 specs deep | 004–008 | Each milestone is independently shippable |
