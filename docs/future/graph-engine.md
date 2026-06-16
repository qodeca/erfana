# Erfana Graph Engine (SQLite-Based)

> 📐 **This is design exploration, not the live spec.** The canonical what-we're-building lives in specs [#004 Graph foundation](../../specs/spec-t4-004-graph-foundation/), [#005 Vector search](../../specs/spec-t3-005-vector-search/), [#006 Knowledge graph](../../specs/spec-t3-006-knowledge-graph/), [#007 Temporal queries](../../specs/spec-t3-007-temporal-queries/), [#008 Graph polish](../../specs/spec-t3-008-graph-polish/). This folder contains design notes, wireframes, and implementation exploration that informed those specs. **Supersession policy**: when a spec closes, the corresponding sections here are archived.
>
> **Do not start implementation from this folder.** Read the specs' `requirements/02-requirements.md` for acceptance-bearing requirements.

**Status:** Design exploration (October 2025). Requirements authoritative in specs #004–#008.
**Research Validated:** ✅ Extensively validated against 2025 production practices

This document provides an overview of the Erfana Graph Engine—a local-first, embedded knowledge graph and hybrid search system built on SQLite. The system combines BM25 keyword search (FTS5), vector similarity (sqlite-vec), and lightweight graph capabilities to power semantic retrieval, backlinks, and temporal queries within the ERFANA markdown IDE.

---

## Why Use the Graph Engine?

The Erfana Graph Engine solves common documentation challenges:

### 🔍 **Better Search Than Grep**
- **Problem**: Grep only finds exact keyword matches, missing semantically similar content
- **Solution**: Hybrid search combines keyword matching (BM25) with semantic similarity (vectors)
- **Result**: Find "optimize database performance" even when you search for "make queries faster"

### 🧠 **Research Assistant While You Write**
- **Problem**: Forgetting what you've written elsewhere, duplicating content
- **Solution**: Related Sidebar auto-shows top-10 similar sections as you edit
- **Result**: Discover related content without manual searching, avoid duplication

### 🔗 **Obsidian-Like Navigation**
- **Problem**: Hard to track where concepts are mentioned across your project
- **Solution**: Knowledge Panel shows entity mentions and backlinks (e.g., "Where else did I mention SQLite?")
- **Result**: Navigate your knowledge graph like Obsidian, understand impact of changes

### ⏰ **Time-Travel for Documentation**
- **Problem**: Can't remember what the architecture looked like 3 months ago
- **Solution**: Temporal queries track how entities and relationships changed over time
- **Result**: Audit trail for decisions, detect contradictions (e.g., "still using sqlite-vss?" vs "migrated to sqlite-vec")

### 🤖 **Claude Code Integration**
- **Problem**: Claude Code doesn't understand your project structure and documentation
- **Solution**: MCP server exposes graph engine to Claude Code (running in Terminal)
- **Result**: Claude Code queries your docs automatically, gives better suggestions

---

## Quick Start

### For Users (Want to use the graph engine)
1. **Read**: [User Guide](./graph-engine/user-guide-features.md) - Learn workflows and features
2. **Wait for M1**: Graph engine will auto-index `.md` files on project open
3. **Try Features**:
   - Edit file → See Related Sidebar update
   - Global Search → Query "SQLite performance"
   - Settings → Adjust hybrid weights (α, β)
   - Terminal → Use Claude Code with `erfana_graph_search` tool

### For Developers (Want to implement the graph engine)
1. **Read**: [Architecture](./graph-engine/architecture-overview.md) - Understand system design
2. **Read**: [Data Ingestion](./graph-engine/data-ingestion-discovery.md) - Learn how files are indexed
3. **Follow**: [Implementation Guide](./graph-engine/implementation-guide.md) - Step-by-step M1-M5 milestones
4. **Test**: [Production Readiness](./graph-engine/production-readiness-checklist.md) - Pre-deployment checklist

### For Claude Code (Want to understand integration)
1. **Read**: [MCP Server](./graph-engine/mcp-server-tools.md) - Complete integration guide
2. **Tools Available**:
   - `erfana_graph_search` - Hybrid search across docs
   - `erfana_graph_related` - Find related sections
   - `erfana_graph_entities` - List entities with filters
   - `erfana_graph_backlinks` - Get entity backlinks
   - `erfana_graph_timeline` - Temporal queries

---

## Quick Navigation

### Getting Started (NEW)

1. **[User Guide](./graph-engine/user-guide-features.md)** 👤 FOR USERS
   - What the graph engine does and why it's valuable
   - User workflows with examples
   - UI components (Related Sidebar, Global Search, Knowledge Panel)
   - Claude Code integration from user perspective

2. **[Data Ingestion](./graph-engine/data-ingestion-discovery.md)** 📥 HOW FILES ARE INDEXED
   - Project initialization flow (auto-index on open)
   - Event-driven architecture (FileWatcherService integration)
   - Incremental updates and content deduplication
   - Progress reporting and error handling

3. **[MCP Server](./graph-engine/mcp-server-tools.md)** 🤖 CLAUDE CODE INTEGRATION
   - MCP architecture and protocol
   - 5 MCP tools exposed to Claude Code
   - Server implementation and client usage
   - Security and rate limiting

### Core Documentation

4. **[Architecture](./graph-engine/architecture-overview.md)** ⭐ START HERE
   - System design and component interactions
   - ERFANA services integration (event-driven)
   - MCP layer and Claude Code flow
   - Technology stack justification (October 2025)

5. **[Data Model & Schema](./graph-engine/data-model.md)**
   - Complete SQLite DDL with annotations
   - Temporal graph patterns (`valid_from`, `valid_to`, `tx_time`)
   - Entity-relationship design

6. **[Vector Search (sqlite-vec)](./graph-engine/vector-search-overview.md)** 🔄 UPDATED
   - Why sqlite-vec over sqlite-vss (deprecation status)
   - Performance characteristics and scale limits
   - Binary quantization strategy

7. **[Embedding Pipeline](./graph-engine/embedding-pipeline-overview.md)**
   - ONNX Runtime integration with Electron
   - Worker thread strategy and stability concerns
   - Chunking and tokenization best practices

8. **[Hybrid Search & Ranking](./graph-engine/hybrid-search-fundamentals.md)**
   - BM25 + vector similarity fusion
   - Configurable weight tuning
   - Graph-aware boosts

9. **[Graph Capabilities](./graph-engine/graph-capabilities-entities.md)**
   - Entity extraction and linking
   - Temporal queries and change timelines
   - Graphology integration patterns

### Implementation & Operations

10. **[Implementation Guide](./graph-engine/implementation-guide.md)** 📝 PRACTICAL
    - Step-by-step milestones (M1-M5)
    - M1 includes: UI components + event-driven integration + MCP server
    - Code structure and IPC patterns
    - Testing strategies

11. **[Performance & Scalability](./graph-engine/performance.md)** 📊 BENCHMARKS
    - Real-world performance targets
    - Scale limits (100K optimal, 500K+ with quantization)
    - Optimization techniques

12. **[Packaging & Deployment](./graph-engine/packaging.md)** 🔧 ELECTRON
    - Native module configuration (better-sqlite3, onnxruntime-node)
    - Electron-vite setup
    - Platform-specific builds

13. **[Production Readiness](./graph-engine/production-readiness-checklist.md)** ✅ CHECKLIST
    - Pre-deployment validation
    - Known limitations and workarounds
    - Monitoring and observability

---

## Goals

The Erfana Graph Engine is designed to provide:

- **Local-First Operation**: Fully offline, private, fast; zero external services by default
- **Hybrid Retrieval**: BM25 (FTS5) + vector similarity with graph-aware boosts
- **Temporal Awareness**: "As-of" queries and change timelines for entities and relations
- **Simple Operations**: Embedded SQLite, portable ONNX models, optional cloud providers
- **Production-Ready**: Validated against October 2025 state-of-the-art practices

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (React)                  │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │   Related    │  │  Knowledge   │  │  Global Search  │   │
│  │   Sidebar    │  │    Panel     │  │  + Time Slider  │   │
│  └──────────────┘  └─────────────┘  └─────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC (window.api.graph.*)
┌────────────────────────┴────────────────────────────────────┐
│                    Main Process (Node.js)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          GraphEngineService (Orchestrator)            │  │
│  └───────┬──────────────────┬──────────────────┬────────┘  │
│          │                  │                  │            │
│  ┌───────▼────┐   ┌─────────▼────────┐  ┌─────▼──────┐   │
│  │ SQLite DB  │   │ EmbedderWorker   │  │ GraphStore │   │
│  │ (WAL mode) │   │ (worker_threads) │  │ (graphology)│   │
│  │            │   │                  │  │            │   │
│  │ • FTS5     │   │ • onnxruntime-   │  │ • Centrality│   │
│  │ • sqlite-  │   │   node (ONNX)    │  │ • Neighborhood│
│  │   vec      │   │ • Batch embed    │  │ • On-demand│   │
│  └────────────┘   └──────────────────┘  └────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Key Components:**
- **SQLite Database**: FTS5 for BM25, sqlite-vec for vector search, standard tables for graph
- **Embedding Worker**: Worker threads with onnxruntime-node for local embeddings
- **Graph Store**: In-memory graphology for centrality/neighborhood computed on-demand
- **IPC Layer**: Secure contextBridge API (`api.graph.*`) for renderer ↔ main communication

---

## Technology Stack (October 2025)

### Core Dependencies
- **SQLite** (bundled) + **better-sqlite3** (native module)
- **SQLite FTS5** (built-in) - BM25 ranking with weighted columns
- **sqlite-vec v0.1.0+** (primary vector extension) 🔄 UPDATED
- **onnxruntime-node** (CPU) - Local embedding generation
- **@huggingface/tokenizers** or **transformers.js** - Tokenization
- **graphology** - In-memory graph analytics

### Optional Dependencies
- OpenAI/Anthropic/Gemini SDKs (cloud embedding fallback)
- sqlite-vss (legacy fallback if already compiled)

### Validated Embedding Models
- **all-MiniLM-L6-v2** (384 dims, 22M params) - Default, fast
- **bge-micro-v2** (384 dims) - Alternative, slightly more accurate
- **BGE-M3** (multi-lingual, if needed)

---

## Key Research Findings (October 2025)

### ✅ Validated Assumptions
1. **SQLite FTS5 BM25**: Production-ready, hardcoded k1=1.2, b=0.75 optimal
2. **Hybrid Search**: Industry-standard pattern (40% BM25 / 60% vector typical)
3. **Chunking Strategy**: 256-384 tokens with 10-15% overlap matches 2025 best practices
4. **Graphology**: Appropriate for on-demand centrality/neighborhood analysis

### ⚠️ Critical Updates Required
1. **sqlite-vec over sqlite-vss**: sqlite-vss deprecated; sqlite-vec is actively maintained
2. **onnxruntime-node Worker Stability**: Known crash issues with multiple workers; limit concurrency
3. **Scale Limits**: Document realistic performance (100K optimal, >500K requires ANN)
4. **better-sqlite3 Packaging**: Requires careful electron-vite configuration

See **[Production Readiness](./graph-engine/production-readiness-operations.md)** for detailed mitigation strategies.

---

## Roadmap & Milestones

### M1: Foundation (FTS5 + Keyword Search)
- SQLite schema and migrations
- FTS5 keyword search with BM25 ranking
- Index-on-save pipeline
- Related Sidebar (keyword-only)

### M2: Vector Search (Hybrid Retrieval)
- sqlite-vec integration
- ONNX embedding worker
- Hybrid search with configurable weights
- Settings UI for weight tuning

### M3: Graph Capabilities (Entities & Relations)
- Entity extraction (LLM or rules)
- Mentions and edges tables
- Backlinks and impact analysis
- Knowledge Panel UI

### M4: Temporal Features (Time-Aware Queries)
- `valid_from`, `valid_to`, `tx_time` fields
- As-of queries (temporal predicates)
- Contradiction detection
- Timeline UI with time slider

### M5: Advanced Features (Polish & Maintenance)
- Mermaid graph insertion/refresh
- Reindex/reembed UX with progress
- Binary quantization for large datasets
- Monitoring and health checks

---

## IPC API Surface

Renderer calls `window.api.graph.*` methods (exposed via preload):

```typescript
// Indexing
graph.indexFile(path: string): Promise<{ indexed: number }>
graph.reindexAll(): Promise<{ queued: number }>

// Search & Retrieval
graph.search(params: {
  q: string;
  k?: number;
  filters?: any;
  asOf?: number;
}): Promise<{ results: SearchResult[] }>

graph.related(params: {
  sectionId: number;
  k?: number;
}): Promise<{ results: SearchResult[] }>

// Entities & Graph
graph.entities.find(params: {
  q?: string;
  type?: string;
  limit?: number;
}): Promise<Entity[]>

graph.entities.forSection(sectionId: number): Promise<Entity[]>
graph.timeline(params: {
  entityId?: number;
  fileId?: number;
}): Promise<TimelineItem[]>

// Settings & Maintenance
graph.settings.set(params: {
  embedderId?: string;
  weights?: any;
  thresholds?: any;
}): Promise<void>

graph.reembedAll(params?: {
  concurrency?: number;
}): Promise<{ queued: number }>
```

Error model: Reject with `{ code, message, details? }`; never crash renderer.

---

## Renderer UX Components

### Related Sidebar (`RelatedSidebar.tsx`)
- Shows top-k related sections/snippets for active editor selection or file
- Actions: open, copy citation, insert link/snippet

### Knowledge Panel (`GraphPanel.tsx`)
- Entities, relations, mentions for current section
- Backlinks and "impact" view (who references this?)

### Global Search
- Hybrid search with filters (folder, file type, date range)
- "Why this result?" breakdown (BM25 score, cosine similarity, boosts)

### Time Slider
- As-of UI to pivot queries and graph overlays to a past timestamp

### Mermaid Integration
- Generate local neighborhood diagrams for selected entity or file context

---

## Security & Privacy

- **Default Local-Only**: No telemetry, no external services
- **Redaction**: Apply regex/pattern redaction before indexing to avoid secrets
- **Opt-In Cloud**: Optional OpenAI/Anthropic/Gemini for embeddings (per-project API key)
- **Content Isolation**: Each project has its own SQLite database

---

## Testing Strategy

### Unit Tests
- Tokenization, chunking, hashing, dedupe logic
- Embedding normalization
- SQL helpers and prepared statements

### Integration Tests
- Index small workspaces (10-100 documents)
- Verify FTS and vector search agreement
- Hybrid ranking stability
- Temporal edge updates (invalidation/closing)
- As-of queries with multiple timepoints

### Performance Tests
- Batch embedding throughput (32-128 chunks/batch)
- DB write/read latency (prepared statements, WAL)
- Search latency at 10K, 100K, 500K documents
- Worker thread concurrency limits

---

## Migration & Re-Embedding

When switching embedding models:
1. Store new `embedder_id` in `meta` table
2. Queue background re-embedding by batches
3. Filter searches to active `embedder_id` during migration
4. Provide progress UI and safe rollback option
5. Keep old embeddings until migration completes

---

## Open Questions & Options

- **Multilingual Support**: Choose multilingual model (e.g., `bge-m3`) vs. English-first
- **Code Embeddings**: Add optional code-focused model for code blocks
- **Reranking**: Add light cross-encoder reranker (cloud or local) for top-N refinement
- **Adaptive Chunking**: Adjust chunk sizes based on section structure, not just tokens
- **ANN Indexes**: When sqlite-vec adds HNSW/IVF, plan migration from brute-force

---

## Next Steps for Implementation

1. **Read [Architecture](./graph-engine/architecture-overview.md)** to understand system design
2. **Review [Data Model](./graph-engine/data-model.md)** for schema details
3. **Follow [Implementation Guide](./graph-engine/implementation-guide.md)** for M1-M5 milestones
4. **Check [Production Readiness](./graph-engine/production-readiness-checklist.md)** before deployment

---

**Last Updated:** October 2025
**Research Validated:** Extensive online research across 8 key technical areas
**Status:** Ready for M1 implementation with documented mitigations for known issues
