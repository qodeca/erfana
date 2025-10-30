# Implementation Guide

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document provides a step-by-step implementation roadmap for the Erfana Graph Engine, organized into 5 milestones (M1-M5).

---

## Table of Contents

1. [Implementation Philosophy](#implementation-philosophy)
2. [Milestone 1: Foundation (FTS5 + Keyword Search)](#milestone-1-foundation-fts5--keyword-search)
3. [Milestone 2: Vector Search (Hybrid Retrieval)](#milestone-2-vector-search-hybrid-retrieval)
4. [Milestone 3: Graph Capabilities (Entities & Relations)](#milestone-3-graph-capabilities-entities--relations)
5. [Milestone 4: Temporal Features (Time-Aware Queries)](#milestone-4-temporal-features-time-aware-queries)
6. [Milestone 5: Advanced Features (Polish & Maintenance)](#milestone-5-advanced-features-polish--maintenance)
7. [Code Structure](#code-structure)
8. [Testing Strategy](#testing-strategy)
9. [Migration Path](#migration-path)

---

## Implementation Philosophy

### Incremental Approach

Build features incrementally, shipping working functionality at each milestone:
- **M1:** Keyword search (FTS5 only) → Ship usable "Related Sidebar"
- **M2:** Add vector search → Improve relevance
- **M3:** Add graph layer → Enable backlinks
- **M4:** Add temporal queries → Enable time-travel
- **M5:** Polish and optimize

### Avoid Big-Bang Integration

**Anti-pattern:** Build all 3 systems (FTS5, vectors, graph) in parallel, integrate at end → high risk of blockers.

**Better:** Validate each layer before adding next.

### Defer Optimizations

**M1-M3:** Focus on correctness, not performance.
**M4+:** Profile and optimize hot paths.

---


## Document Index

This implementation guide has been split into milestone-focused documents for better readability and Claude Code token efficiency.

1. **[m1-backend.md](./m1-backend.md)** - M1 Backend (Database, Search, IPC) (215 lines)
2. **[m1-frontend.md](./m1-frontend.md)** - M1 Frontend (UI Components, MCP) (367 lines)
3. **[m2-vector-search.md](./m2-vector-search.md)** - M2 Vector Search (195 lines)
4. **[m3-graph.md](./m3-graph.md)** - M3 Graph Capabilities (178 lines)
5. **[m4-temporal.md](./m4-temporal.md)** - M4 Temporal Features (119 lines)
6. **[m5-advanced.md](./m5-advanced.md)** - M5 Advanced Features (243 lines)

Each milestone document is self-contained with full context for implementation.
