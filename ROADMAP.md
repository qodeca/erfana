# Implementation roadmap

## Dependency map

```
GRAPH ENGINE (sequential chain):       INDEPENDENT:
004 Foundation                          013 CLI prompts
 ↓ required                             020 Google Drive
005 Vector search                       021 LiteParse import
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
- 013 enhances 020 and 021 (multi-tool AI prompts for Drive content and import templates)

---

## Sequential implementation order

| # | Spec | Tier | FRs | Rationale |
|---|------|------|-----|-----------|
| 1 | **021** LiteParse document import | T3 | 27 | Independent, pre-spike validated. Dialog patterns inform 020 |
| 2 | **004** Graph engine foundation | T4 | 50 | Foundational – unlocks entire graph pipeline. Largest single spec, best tackled with full focus |
| 3 | **005** Vector search & hybrid retrieval | T3 | 38 | First graph dependency – needs 004's database + sections table |
| 4 | **006** Knowledge graph & entities | T3 | 27 | Needs 004; benefits from 005's vector similarity for semantic entity matching |
| 5 | **020** Google Drive link integration | T4 | 50 | Independent but complex (OAuth, Picker, 4 services). Placed here as a break between graph milestones |
| 6 | **007** Temporal queries & timeline | T3 | 23 | Needs 006's edges table to extend with temporal fields |
| 7 | **008** Graph engine polish | T3 | 30 | Needs 004+005 (required) + 006 (Mermaid viz) + 007 (temporal health). Gets all optional enhancements |
| 8 | **013** Multi-CLI tool prompts | T3 | 13 | Lowest complexity, no dependencies. Enhances AI prompts across all features retroactively |

---

## Rationale for ordering decisions

**021 first**: Independent with a completed pre-spike. Delivers user value early while dialog patterns (DocumentImportDialog, progress streaming, dependency detection) inform 020's similar patterns later.

**004 → 005 → 006**: Strict dependency chain. 006 placed after 005 (not just 004) so it can use vector similarity for semantic entity matching – the optional dependency is worth respecting.

**020 between 006 and 007**: A context switch from graph work. 020 is independent, so it can slot anywhere, but placing it here provides a mental break from the graph pipeline and lets the graph architecture settle before the final two specs.

**007 → 008**: 007 extends 006's edges table. 008 is the "polish" spec – it leverages everything: database (004), embeddings (005), entities (006), and temporal data (007).

**013 last**: Lowest complexity (13 FRs), no dependencies in either direction. Multi-tool prompt support enhances existing AI prompts retroactively – no feature needs it as a prerequisite.

---

## Risk factors

| Risk | Spec | Mitigation |
|------|------|------------|
| LiteParse v1.4.0 maturity (released 2026-03-19) | 021 | Version pinned; pre-spike validated |
| Native modules in packaged Electron (better-sqlite3, Sharp, onnxruntime) | 004, 005, 021 | Test packaged builds early |
| OAuth + Google Picker complexity | 020 | Well-scoped: `drive.file` only, single account |
| 004 is the largest single spec (50 FRs + 11 NFRs) | 004 | Consider staged delivery: DB+indexing first, then UI |
| Graph pipeline is 5 specs deep | 004–008 | Each milestone is independently shippable |
