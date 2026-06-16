# Overview

> 📐 **Design context**: historical design exploration lives at [`docs/future/graph-engine/`](../../../docs/future/graph-engine/) — data model, wireframes, ONNX worker pipelines, performance notes. This spec is the authoritative requirement source; the design folder is read-only reference.

## Summary

This specification defines the Graph Engine Foundation for Erfana, delivering SQLite-based text indexing with FTS5 full-text search, BM25 keyword ranking, event-driven integration with the file watcher system, four UI components for content discovery, and an MCP server for Claude Code integration. This represents Milestone 1 (M1) of the graph engine roadmap, establishing the core infrastructure upon which vector search and knowledge graph features will be built.

## Purpose

Erfana is a markdown-focused IDE that manages substantial documentation projects. Users need intelligent content discovery to navigate large knowledge bases efficiently. The graph engine enables:

1. **Related content discovery** - Automatically surface semantically related sections while editing
2. **Project-wide search** - Find relevant content across all markdown files with ranked results
3. **AI assistant integration** - Allow Claude Code to query project knowledge via MCP tools
4. **Corpus analytics** - Provide visibility into indexed content and indexing status

The foundation layer (M1) delivers keyword-based search that provides immediate value while establishing the architecture for vector embeddings (M2), hybrid search (M3), entity extraction (M4), and knowledge graph (M5).

## Scope

### In Scope (Milestone 1)

**Database Layer:**
- SQLite database with FTS5 extension for full-text search
- WAL mode for concurrent read/write performance
- Schema versioning and migration system
- Integrity checks and corruption recovery

**Preprocessing Pipeline:**
- Markdown syntax normalization (strip formatting, preserve text)
- Whitespace normalization and text deduplication
- SHA-256 content hashing for change detection
- Section extraction by heading structure

**Indexing Pipeline:**
- Recursive markdown file discovery (respecting .gitignore)
- Incremental updates via content hash comparison
- Batch processing with progress events
- Event-driven triggers from FileWatcherService

**Search API:**
- BM25 keyword search with weighted ranking
- Column weights: heading (3x), text (1x)
- Filters by folder, file type, date range
- Top-K results with pagination

**UI Components:**
- Related Sidebar: Top-10 related sections, auto-update on selection
- Global Search: Project-wide search with filters and result breakdown
- Settings Panel: Manual reindex, corpus stats, excluded folders
- Status Indicator: Indexing progress with status dot

**MCP Integration:**
- MCPServerService on stdio transport
- `erfana_graph_search` tool with query, k, filters parameters
- Rate limiting (100 queries/minute)
- Lifecycle management (auto-start/stop with app)

### Out of Scope (Deferred to Later Milestones)

- **M2:** Vector embeddings and semantic similarity search
- **M3:** Hybrid search (keyword + vector fusion)
- **M4:** Entity extraction and named entity recognition
- **M5:** Knowledge graph construction and traversal
- Real-time collaborative indexing
- Cross-project search federation
- Custom tokenizers or language-specific analyzers

## Success Criteria

1. **Search latency:** < 50ms for typical queries on corpus up to 10,000 sections
2. **Indexing throughput:** > 100 files/second for initial indexing
3. **Incremental update latency:** < 500ms from file save to index update
4. **Related content relevance:** Top-3 results rated relevant by users > 80% of time
5. **MCP response time:** < 100ms for tool invocations
6. **Zero data loss:** Database corruption handled with recovery, no silent data loss
7. **UI responsiveness:** All UI updates complete within single animation frame (16ms)

## Stakeholders

| Stakeholder | Interest |
|-------------|----------|
| End Users | Content discovery, project navigation, search functionality |
| Developers | Clean API design, extensibility for future milestones |
| Claude Code | MCP tool access for project knowledge queries |
| Operations | Observability, logging, error recovery |
