# Graph Engine Architecture

**Last Updated:** October 2025
**Status:** Design Specification

This document details the system architecture, component interactions, and key design decisions for the Erfana Graph Engine.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
3. [Technology Stack Justification](#technology-stack-justification)
4. [Process Model (Electron)](#process-model-electron)
5. [Data Flow](#data-flow)
6. [Key Design Decisions](#key-design-decisions)
7. [Security Considerations](#security-considerations)

---

## System Overview

The Erfana Graph Engine is a **local-first, embedded knowledge graph** that combines three retrieval paradigms:

1. **Keyword Search (BM25)**: SQLite FTS5 for fast, precise keyword matching
2. **Semantic Search (Vector)**: sqlite-vec for meaning-based similarity
3. **Graph Traversal**: Lightweight entity-relationship graph with temporal awareness

### Design Philosophy

- **Local-First**: Zero dependencies on external services; fully functional offline
- **Embedded**: Single-process deployment; no separate database server
- **Hybrid**: Combine multiple retrieval strategies for better results
- **Incremental**: Index documents as they're saved; no batch processing required
- **Privacy**: All data stays on device; optional cloud features are explicit opt-in

---

## Component Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                      RENDERER PROCESS (React)                       │
│                                                                      │
│  ┌───────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │  Related Sidebar  │  │  Knowledge Panel │  │  Global Search  │ │
│  │  - Top-k results  │  │  - Entities      │  │  - Filters      │ │
│  │  - Citations      │  │  - Mentions      │  │  - Time slider  │ │
│  └───────────────────┘  └──────────────────┘  └─────────────────┘ │
│                                                                      │
│  useGraphSettingsStore (Zustand)                                    │
│  - Hybrid weights (α, β, γ, δ)                                      │
│  - Chunk size, overlap                                              │
│  - Active embedder ID                                               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               │ IPC (contextBridge)
                               │ window.api.graph.*
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                      MAIN PROCESS (Node.js)                          │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               GraphEngineService                             │   │
│  │  - Orchestrates all graph operations                         │   │
│  │  - Manages debouncing and queueing                           │   │
│  │  - Exposes IPC API surface                                   │   │
│  └───┬──────────────────┬──────────────────┬──────────────────┘   │
│      │                  │                  │                        │
│  ┌───▼──────┐   ┌───────▼────────┐   ┌────▼──────┐                │
│  │ SQLite   │   │ EmbedderWorker │   │ GraphStore│                │
│  │ Database │   │ (worker_thread)│   │(graphology)│                │
│  │          │   │                │   │           │                │
│  │ • FTS5   │   │ • ONNX Runtime │   │ • Page-  │                │
│  │ • sqlite-│   │ • Tokenizer    │   │   Rank   │                │
│  │   vec    │   │ • Batching     │   │ • Betwe- │                │
│  │ • Edges  │   │ • Normalize    │   │   enness │                │
│  │ • Entities│   │                │   │ • On-    │                │
│  │ • Mentions│   │ [Limit: 2-4    │   │   demand │                │
│  │          │   │  concurrent]   │   │          │                │
│  └──────────┘   └────────────────┘   └───────────┘                │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### GraphEngineService (Orchestrator)
- **Request Handling**: Processes IPC requests from renderer
- **Debouncing**: Coalesces rapid file saves (e.g., 300ms window)
- **Queue Management**: Serializes indexing operations to prevent contention
- **Error Handling**: Catches errors, logs, returns structured error responses
- **State Coordination**: Tracks indexing progress, worker availability

#### SQLite Database
- **Schema Management**: DDL migrations, version tracking
- **FTS5**: Keyword search with BM25 ranking
- **sqlite-vec**: Vector similarity search (brute-force initially)
- **Graph Tables**: Entities, edges, mentions, temporal fields
- **WAL Mode**: Write-ahead logging for concurrency

#### EmbedderWorker (worker_threads)
- **Model Loading**: Load ONNX model + tokenizer on initialization
- **Tokenization**: Count tokens, split into chunks (256-384 tokens)
- **Batching**: Process 32-128 chunks per batch (configurable)
- **Embedding**: Generate normalized float32 vectors (L2 norm)
- **Isolation**: Runs off main thread; communicates via postMessage

**⚠️ Critical Limitation:** onnxruntime-node has known stability issues with multiple concurrent workers. **Limit to 2-4 workers max** to avoid random crashes.

#### GraphStore (graphology)
- **In-Memory Graph**: Build from SQLite edges on-demand
- **Centrality Metrics**: PageRank, betweenness, closeness
- **Neighborhood Queries**: Find N-hop neighbors for an entity
- **Lazy Loading**: Only load subgraphs when needed (not full graph)

---

## Technology Stack Justification

### Why SQLite?
- **Embedded**: No separate server; packaged with app
- **Proven**: 30+ years of production use; battle-tested
- **Features**: FTS5, JSON, CTEs, window functions, triggers
- **WAL Mode**: Concurrent reads; single writer

### Why FTS5 over FTS4?
- Better ranking (BM25 built-in)
- Improved tokenization
- More flexible column weighting
- Actively maintained

### Why sqlite-vec over sqlite-vss? (UPDATED October 2025)
**sqlite-vss is deprecated** as of 2024. sqlite-vec is the active replacement:

| Feature | sqlite-vec | sqlite-vss (deprecated) |
|---------|-----------|------------------------|
| **Status** | ✅ Active (v0.1.0 stable) | ⚠️ No longer developed |
| **Dependencies** | Pure C, zero deps | C++ (Faiss) |
| **Binary Size** | ~300KB | 3-5MB |
| **Platform Support** | All (macOS/Linux/Windows/WASM) | macOS/Linux only (reliable) |
| **ANN Indexes** | Planned (HNSW/IVF) | ✅ Via Faiss |
| **Performance (100K docs)** | <100ms (brute-force) | ~50ms (indexed) |
| **Quantization** | ✅ Binary (32x compression) | Limited |

**Decision:** Use sqlite-vec as primary; sqlite-vss only if legacy builds exist.

### Why onnxruntime-node over transformers.js?
- **Performance**: Native C++ execution vs WebAssembly
- **Maturity**: Stable API, widely used
- **Flexibility**: Swap models without code changes

**⚠️ Known Issue:** Worker thread crashes with high concurrency. Mitigation: limit workers, add recovery logic.

**Alternative Considered:** transformers.js (wraps onnxruntime-node, better stability). May revisit if crashes persist.

### Why graphology?
- **Lightweight**: Similar to networkx (Python) / igraph (R)
- **Comprehensive**: PageRank, betweenness, closeness, etc.
- **TypeScript**: First-class TS support
- **Sigma.js Integration**: If we add visualization later

---

## Process Model (Electron)

### Main Process (Node.js)
- GraphEngineService runs here (access to native modules)
- SQLite database (better-sqlite3 is synchronous, main-thread safe)
- Worker threads for embedding (onnxruntime-node)
- File system access

### Preload Script (Secure Bridge)
- Exposes `window.api.graph.*` via contextBridge
- **No direct Node.js access** in renderer (security)
- Type-safe IPC channels

### Renderer Process (Chromium/React)
- UI components (Related Sidebar, Knowledge Panel)
- Zustand stores for settings/state
- Calls `window.api.graph.*` for all operations

### Security Boundary
```
Renderer (untrusted) <--> Preload (bridge) <--> Main (trusted)
```

---

## Data Flow

### Indexing Flow (File Save)

```
1. User saves file in editor
   │
   ▼
2. FileWatcherService detects change (debounced 300ms)
   │
   ▼
3. GraphEngineService.indexFile(path)
   │
   ├─▶ 4a. Parse markdown → sections (H1-H6)
   │       Compute text_hash per section
   │
   ├─▶ 4b. Diff against DB (select changed sections)
   │
   ├─▶ 4c. Tokenize + chunk (256-384 tokens, 10-15% overlap)
   │       Store in sections table
   │
   ├─▶ 4d. FTS5 sync via triggers (automatic)
   │
   ├─▶ 4e. Send chunks to EmbedderWorker
   │       │
   │       ▼
   │       Worker: Batch embed (32-128 chunks)
   │       Worker: L2 normalize vectors
   │       Worker: Return embeddings
   │
   ├─▶ 4f. Insert into embeddings table
   │       Insert into vss_sections (vector index)
   │
   └─▶ 4g. [Optional M3+] Extract entities/mentions/edges
           - LLM-based extraction OR
           - Rule-based patterns (e.g., [[wikilinks]], #tags)
```

### Search Flow (Hybrid Retrieval)

```
1. User enters query in Global Search
   │
   ▼
2. window.api.graph.search({ q, k, filters, asOf })
   │
   ▼
3. GraphEngineService.search()
   │
   ├─▶ 4a. BM25 keyword search (FTS5)
   │       SELECT ... FROM fts_sections WHERE fts_sections MATCH :q
   │       Returns: [(section_id, bm25_score), ...]
   │
   ├─▶ 4b. Embed query (EmbedderWorker)
   │       Returns: query_vector (float32[])
   │
   ├─▶ 4c. Vector similarity search (sqlite-vec)
   │       SELECT ... FROM vss_sections WHERE vss_search(...)
   │       Returns: [(section_id, cosine_distance), ...]
   │
   ├─▶ 4d. [Optional] Graph boost
   │       For each candidate, compute:
   │       - Shared entities with query context
   │       - Distance to focused entity (if any)
   │       - Centrality (if graphology loaded)
   │
   └─▶ 5. Combine + normalize scores
           score = α*bm25 + β*cosine + γ*graph_boost + δ*recency
           Sort by score DESC, apply filters, return top-k
   │
   ▼
6. Renderer displays results in UI
```

---

## Key Design Decisions

### 1. Synchronous SQLite (better-sqlite3)
**Why:** Simpler code flow; no promise hell for DB ops.
**Trade-off:** Main thread blocking (mitigated by worker threads for embeddings).

### 2. Debounced Indexing
**Why:** Avoid re-indexing on every keystroke.
**Strategy:** 300ms debounce + queue coalescing (one job per file).

### 3. Content-Based Hashing (text_hash)
**Why:** Skip re-embedding unchanged sections.
**How:** Hash normalized text after stripping markdown syntax.

### 4. Temporal Graph (valid_from, valid_to, tx_time)
**Why:** Track how knowledge changes over time.
**Use Case:** "What did the code architecture look like 3 months ago?"

### 5. On-Demand Graph Loading (graphology)
**Why:** Don't load full graph into memory for every query.
**How:** Build subgraph on-demand for specific entities.

### 6. Configurable Hybrid Weights
**Why:** Different query types benefit from different weightings.
**How:** Store α, β, γ, δ in settings; allow per-query override.

### 7. Single Embedder per Project
**Why:** Mixing vector spaces causes poor results.
**Migration:** Re-embed all on model switch (background job with progress).

---

## Security Considerations

### 1. No Renderer Node.js Access
- Renderer can't directly call `require()` or `process`
- All file system access goes through IPC

### 2. Content Redaction
- Apply regex patterns before indexing (e.g., remove API keys, secrets)
- Configurable per-project

### 3. SQL Injection Prevention
- Use prepared statements for all queries
- Never concatenate user input into SQL strings

### 4. Optional Cloud Services
- Embeddings/LLMs are opt-in, not default
- API keys scoped per-project (stored in electron-store)

### 5. Content Isolation
- Each project has its own SQLite database
- No cross-project data leakage

---

## Performance Considerations

### Read Performance
- **FTS5**: ~1-10ms for keyword search (typical corpus)
- **sqlite-vec**: ~50-100ms for 100K vectors @ 384 dims (brute-force)
- **Hybrid Search**: ~100-200ms total (parallelizable)

### Write Performance
- **Prepared Statements**: ~0.1ms per row insert
- **WAL Mode**: Concurrent reads while writing
- **Batch Transactions**: Wrap 1000s of inserts in single transaction

### Embedding Performance
- **all-MiniLM-L6-v2**: ~15ms per 1K tokens (single thread)
- **Batching**: 32-128 chunks → ~0.5-2s per batch
- **Concurrency**: 2-4 workers → ~1-4 batches/sec

---

## Failure Modes & Recovery

### Worker Crash (onnxruntime-node)
**Symptom:** Worker thread exits unexpectedly
**Recovery:** Auto-restart worker, retry batch (idempotent ops)
**Prevention:** Limit concurrent workers to 2-4

### SQLite Lock Timeout
**Symptom:** `SQLITE_BUSY` error
**Recovery:** Retry with exponential backoff (max 3 attempts)
**Prevention:** Use WAL mode, keep transactions short

### Corrupt Database
**Symptom:** `SQLITE_CORRUPT` error
**Recovery:** Backup DB, run `PRAGMA integrity_check`, rebuild if needed
**Prevention:** Regular integrity checks on startup

---

## Next Steps

- **[Data Model](./data-model.md)**: Review SQLite schema details
- **[Vector Search](./vector-search.md)**: Deep dive on sqlite-vec
- **[Embedding Pipeline](./embedding-pipeline.md)**: ONNX integration details

---

**Related:**
- [Main Overview](../graph-engine.md)
- [Performance & Scalability](./performance.md)
- [Production Readiness](./production-readiness.md)
