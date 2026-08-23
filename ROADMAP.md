# Implementation roadmap

*Roadmap for active drafts. Shipped specs (021 LiteParse v0.9.0, 022 git-status offloading v0.9.0, 009 media import v0.8.0) are removed once archived; see `specs/registry.json` for lifecycle.*

> **Scope**: this file tracks spec-numbered feature work only. Bug-fix and performance streams are **not** listed here and are not untracked – they live in the GitHub issues, and the large-project performance cluster is planned in [`docs/large-project-performance-plan.md`](docs/large-project-performance-plan.md). The authoritative list of active specs is `specs/registry.json`.

## Dependency map

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

## Graph engine chain (on the `graph` branch)

> **The graph chain (004–008) is already underway on the `graph` branch, not here.** Before starting any of 004–008, branch off `graph` (`git checkout -b feature/<name> graph`) and read its `specs/` and design set first; starting from `develop` means re-implementing work that already exists. See the Branching model section in `CLAUDE.md`.

**What the R1 contract freeze already landed on `graph`**, and what `develop` therefore deliberately does not carry: the schemas, the STRICT DDL, the `IGraph*` interfaces, the `GRAPH_*` / `MCP_*` error codes and the `specs/designs/sd-021-*` design set. The refreshed spec requirements for 004–008 live there too.

> **Chain status (verified 2026-08-07 against `gh issue list --repo qodeca/erfana --state all`):** the release-1 umbrella is [#17](https://github.com/qodeca/erfana/issues/17) "Graph engine R1: project search (spec 004)", still open. The analysis and architecture issues [#19](https://github.com/qodeca/erfana/issues/19), [#20](https://github.com/qodeca/erfana/issues/20) and [#21](https://github.com/qodeca/erfana/issues/21) are all **closed** – the contract freeze they describe has landed on `graph`. The implementation chain [#22](https://github.com/qodeca/erfana/issues/22)–[#32](https://github.com/qodeca/erfana/issues/32) (DB layer, preprocessing, indexing, search API, the three UI surfaces, MCP server, testing) is open and is where graph work now happens.

The sequential-ordering table for 004–008, its rationale and its risk register were removed on 2026-08-23: they described a pre-freeze plan that the `graph` branch has superseded. Order now comes from the #22–#32 chain. The hard and soft dependencies above still hold and are the part worth consulting from `develop`.
