# Overview

> 📐 **Design context**: historical design exploration lives at [`docs/future/graph-engine/`](../../../docs/future/graph-engine/) — temporal data model, timeline UI wireframes, time-travel queries. This spec is the authoritative requirement source.

## Summary

Spec #007 implements temporal query capabilities and timeline visualization for the Graph Engine, enabling time-travel queries to reconstruct historical knowledge graph states and track documentation evolution over time.

This feature adds temporal semantics to graph edges (valid_from, valid_to, tx_time), provides as-of query APIs for point-in-time state reconstruction, implements a Timeline UI with date slider navigation, and exposes temporal data through the MCP `erfana_graph_timeline` tool.

## Purpose

Documentation evolves constantly. Statements that were true in January may be outdated by October. Without temporal awareness, the knowledge graph only represents the current state, losing valuable historical context.

Temporal queries solve three key problems:

1. **Historical reconstruction**: Answer "What did the graph look like on date X?" for debugging, auditing, or understanding past project states
2. **Change tracking**: See exactly when relationships were added or invalidated, creating a complete audit trail
3. **Contradiction detection**: Identify conflicting statements over time (e.g., "uses sqlite-vss" in January vs "uses sqlite-vec" in October)

## Scope

### In scope

- Temporal fields on edge records (valid_from, valid_to, tx_time)
- Edge lifecycle management (create with valid_from, close with valid_to, never delete)
- As-of query API for historical graph state reconstruction
- Timeline API for retrieving change events by entity or file
- Contradiction detection for conflicting statements over time
- Timeline UI with date slider, event list, and as-of toggle
- Timeline export to markdown
- MCP tool `erfana_graph_timeline` for Claude Code integration

### Out of scope

- Temporal fields on entities (entities are version-agnostic identifiers)
- Temporal fields on the FTS/vector search indexes (search always queries current state)
- Branch/fork support (single linear timeline only)
- Collaborative conflict resolution (single-user desktop app)

## Success criteria

1. Any historical graph state can be reconstructed via as-of queries with 100% accuracy
2. Timeline UI shows all edge changes for a selected entity or file
3. Temporal queries complete in <200ms for graphs with up to 10,000 edges
4. Contradiction detection flags conflicting statements with same src_entity and edge type
5. MCP tool enables Claude Code to query timelines and historical state

## Dependencies

- **Spec #006** (Knowledge graph & entities): Provides entities and edges tables that this spec extends with temporal fields
