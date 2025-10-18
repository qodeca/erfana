# Graph Engine Architecture

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

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

```mermaid
graph TD
    subgraph RendererProcess["RENDERER PROCESS (React)"]
        direction LR

        subgraph UIComponents[" "]
            RelatedSidebar["Related Sidebar<br/>• Top-k results<br/>• Citations<br/>• Auto-update"]
            KnowledgePanel["Knowledge Panel<br/>• Entities<br/>• Backlinks<br/>• Mentions"]
            GlobalSearch["Global Search<br/>• Filters<br/>• Time slider<br/>• Replace grep"]
        end

        subgraph UIControls[" "]
            SettingsPanel["Settings Panel<br/>• Hybrid weights<br/>• Re-index<br/>• Quantization"]
            StatusIndicator["Status Indicator<br/>• Indexing progress (%)<br/>• MCP server status (🟢/🔴)<br/>• Click for details"]
        end

        ZustandStore["useGraphSettingsStore (Zustand)<br/>• Hybrid weights (α, β, γ, δ)<br/>• Chunk size, overlap<br/>• Active embedder ID"]
    end

    IPC["IPC (contextBridge)<br/>window.api.graph.*"]

    RendererProcess --> IPC

    subgraph MainProcess["MAIN PROCESS (Node.js)"]
        direction TB

        subgraph ServicesIntegration["ERFANA Services Integration"]
            FileWatcherService["FileWatcherService<br/>(Event Emitter)<br/>• file:saved<br/>• file:created<br/>• file:deleted<br/>• project:changed"]
            GraphEngineServiceSub["GraphEngineService<br/>(Subscriber)<br/>• Listens to events<br/>• Queues indexing<br/>• Debounces changes<br/>• Emits progress"]

            FileWatcherService -->|Events| GraphEngineServiceSub

            MCPServerService["MCPServerService<br/>(stdio transport)<br/>• erfana_graph_search<br/>• erfana_graph_related<br/>• erfana_graph_entities/etc."]
            GraphEngineServiceData["GraphEngineService<br/>(Data Provider)<br/>• search()<br/>• getRelated()<br/>• getEntities()<br/>• getBacklinks()<br/>• getTimeline()"]

            GraphEngineServiceData -->|Queries| MCPServerService
        end

        ClaudeCodeTerminal["Claude Code<br/>(Terminal)"]
        MCPServerService -.->|Exposes Tools| ClaudeCodeTerminal
        GraphEngineServiceSub -.->|Provides Data| ClaudeCodeTerminal

        subgraph GraphEngineCore["GraphEngineService (Core)"]
            CoreOrchestrator["• Orchestrates all graph operations<br/>• Manages debouncing and queueing<br/>• Exposes IPC API surface<br/>• Subscribes to FileWatcherService events<br/>• Provides data to MCPServerService"]
        end

        subgraph DataLayer[" "]
            SQLiteDB["SQLite Database<br/>• FTS5<br/>• sqlite-vec<br/>• Edges<br/>• Entities<br/>• Mentions"]
            EmbedderWorker["EmbedderWorker<br/>(worker_thread)<br/>• ONNX Runtime<br/>• Tokenizer<br/>• Batching<br/>• Normalize<br/>[Limit: 2-4 concurrent]"]
            GraphStore["GraphStore<br/>(graphology)<br/>• PageRank<br/>• Betweenness<br/>• On-demand"]
        end

        GraphEngineCore --> SQLiteDB
        GraphEngineCore --> EmbedderWorker
        GraphEngineCore --> GraphStore
    end

    IPC --> MainProcess

    classDef rendererClass fill:#bbdefb,stroke:#0d47a1,stroke-width:3px,color:#000
    classDef mainClass fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#000
    classDef serviceClass fill:#e1bee7,stroke:#4a148c,stroke-width:3px,color:#000
    classDef dataClass fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px,color:#000
    classDef externalClass fill:#fff59d,stroke:#f57f17,stroke-width:3px,stroke-dasharray: 5 5,color:#000

    class RendererProcess,UIComponents,UIControls rendererClass
    class MainProcess,ServicesIntegration,GraphEngineCore mainClass
    class FileWatcherService,GraphEngineServiceSub,MCPServerService,GraphEngineServiceData serviceClass
    class SQLiteDB,EmbedderWorker,GraphStore dataClass
    class ClaudeCodeTerminal externalClass
```

### Component Responsibilities

#### Integration with ERFANA Services

The Graph Engine integrates seamlessly with existing ERFANA services through an event-driven architecture:

**FileWatcherService → GraphEngineService**
- GraphEngineService subscribes to FileWatcherService events on initialization
- Events listened to:
  - `file:saved` - Re-index modified file (incremental update)
  - `file:created` - Index new file
  - `file:deleted` - Remove from index
  - `project:changed` - Trigger full project indexing

**GraphEngineService → MCPServerService**
- MCPServerService exposes GraphEngineService data via MCP protocol
- Runs on stdio transport for Claude Code consumption
- 5 MCP tools provided (search, related, entities, backlinks, timeline)
- Rate limiting: 100/min for search, 50/min for entities, 20/min for timeline

**Event Flow Example:**
```typescript
// On app startup
const eventBus = new EventEmitter();
const fileWatcherService = new FileWatcherService(eventBus);
const graphEngineService = new GraphEngineService(eventBus);
const mcpServerService = new MCPServerService(graphEngineService);

// User opens project
eventBus.emit('project:changed', { newPath: '/path/to/project' });
// → GraphEngine discovers all .md files and queues indexing

// User saves file
eventBus.emit('file:saved', { path: '/path/to/file.md' });
// → GraphEngine re-indexes only changed sections (via text_hash)

// Claude Code queries from Terminal
await mcpClient.callTool('erfana_graph_search', { query: 'architecture' });
// → MCPServer calls graphEngine.search() → returns results
```

#### GraphEngineService (Orchestrator)
- **Request Handling**: Processes IPC requests from renderer
- **Event Subscription**: Listens to FileWatcherService events for auto-indexing
- **Debouncing**: Coalesces rapid file saves (e.g., 300ms window)
- **Queue Management**: Serializes indexing operations to prevent contention
- **Error Handling**: Catches errors, logs, returns structured error responses
- **State Coordination**: Tracks indexing progress, worker availability
- **MCP Data Provider**: Exposes search/graph APIs to MCPServerService

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

#### MCPServerService (Claude Code Integration)
- **Protocol**: Model Context Protocol (MCP) over stdio transport
- **Lifecycle**: Started on app launch, stopped on app quit
- **Tools Exposed**:
  - `erfana_graph_search` - Hybrid search (BM25 + vector)
  - `erfana_graph_related` - Find related sections
  - `erfana_graph_entities` - List entities with filters
  - `erfana_graph_backlinks` - Get entity backlinks
  - `erfana_graph_timeline` - Temporal queries
- **Rate Limiting**: Token bucket algorithm per tool
- **Security**: Read-only access, no file system writes

#### UI Components (Renderer Process)

**Related Sidebar**
- **Purpose**: Research assistant showing top-10 related sections
- **Trigger**: Auto-updates on file change or text selection
- **Display**: Citation with score, file path, snippet
- **Actions**: Click to open, copy citation, insert link

**Global Search**
- **Purpose**: Project-wide hybrid search (replaces/augments grep)
- **Input**: Natural language query
- **Filters**: Folder, file type, date range
- **Display**: Results with BM25 score, cosine similarity, combined score
- **Actions**: Click to navigate, "Why this result?" breakdown

**Knowledge Panel** (M3+)
- **Purpose**: Entity mentions and backlinks (Obsidian-like)
- **Display**: Entities in current section, where else mentioned
- **Actions**: Click entity to see backlinks, navigate to mentions

**Settings Panel**
- **Purpose**: Configure hybrid search weights and indexing
- **Controls**: α/β/γ/δ sliders, re-index button, quantization toggle
- **Display**: Current embedder model, corpus size, index status

**Status Indicator**
- **Purpose**: Show indexing progress and MCP server status
- **Display**: Progress bar (e.g., "Indexing: 450/1000 files"), MCP status (🟢/🔴)
- **Location**: Bottom-right status bar
- **Actions**: Click to open indexing details

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

### Complete Event-Driven Architecture

**Overview:** The Graph Engine integrates with ERFANA through an event-driven architecture where services communicate via an EventEmitter bus.

```mermaid
graph LR
    subgraph UserActions["User Actions"]
        OpenProject["Open Project"]
        SaveFile["Save File"]
        CreateFile["Create File"]
        DeleteFile["Delete File"]
        ClaudeCodeAction["Claude Code<br/>(Terminal)"]
    end

    subgraph ServiceEvents["Service Events<br/>(EventEmitter)"]
        ProjectChanged["project:changed"]
        FileSaved["file:saved<br/>(300ms debounce)"]
        FileCreated["file:created"]
        FileDeleted["file:deleted"]
        MCPToolCall["MCP Tool Call<br/>(stdio)"]
    end

    subgraph GraphEngine["Graph Engine Operations"]
        DiscoverFiles["Discover .md files<br/>Queue full index<br/>Emit: graph:indexing:started"]
        ReindexChanged["Re-index changed<br/>sections only<br/>Emit: graph:file:indexed"]
        IndexNewFile["Index new file"]
        RemoveFromIndex["Remove from index"]
        QueryGraphDB["Query graph DB<br/>Return results"]
    end

    OpenProject --> ProjectChanged --> DiscoverFiles
    SaveFile --> FileSaved --> ReindexChanged
    CreateFile --> FileCreated --> IndexNewFile
    DeleteFile --> FileDeleted --> RemoveFromIndex
    ClaudeCodeAction --> MCPToolCall --> QueryGraphDB

    classDef userClass fill:#bbdefb,stroke:#0d47a1,stroke-width:3px,color:#000
    classDef eventClass fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#000
    classDef engineClass fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px,color:#000

    class UserActions,OpenProject,SaveFile,CreateFile,DeleteFile,ClaudeCodeAction userClass
    class ServiceEvents,ProjectChanged,FileSaved,FileCreated,FileDeleted,MCPToolCall eventClass
    class GraphEngine,DiscoverFiles,ReindexChanged,IndexNewFile,RemoveFromIndex,QueryGraphDB engineClass
```

### Project Initialization Flow

```mermaid
graph TD
    Step1["1. User opens project<br/>(File → Open Project)"]
    Step2["2. EventEmitter emits<br/>'project:changed'"]
    Step3["3. GraphEngineService<br/>receives event"]

    Step4a["4a. Discover .md files<br/>• Exclude: node_modules/, .git/, dist/<br/>• Priority: Currently open files first"]
    Step4b["4b. Create/migrate SQLite DB<br/>• Path: {projectPath}/.erfana/graph.db<br/>• Schema version check"]
    Step4c["4c. Queue indexing jobs<br/>• Batches of 10 files<br/>• Emit: graph:indexing:started"]

    Step4d["4d. Process batches in parallel"]

    BatchOps["For each batch:<br/>• Parse markdown → sections<br/>• Compute text_hash<br/>• Check if changed<br/>• If changed: embed + store<br/>• Emit: graph:indexing:progress"]

    Complete["When done:<br/>• Emit: graph:indexing:complete<br/>• Start MCP server<br/>(if Claude Code running)"]

    Step1 --> Step2
    Step2 --> Step3
    Step3 --> Step4a
    Step3 --> Step4b
    Step3 --> Step4c
    Step4a --> Step4d
    Step4b --> Step4d
    Step4c --> Step4d
    Step4d --> BatchOps
    BatchOps --> Complete

    classDef userAction fill:#bbdefb,stroke:#0d47a1,stroke-width:3px,color:#000
    classDef eventAction fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#000
    classDef serviceAction fill:#e1bee7,stroke:#4a148c,stroke-width:3px,color:#000
    classDef processAction fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px,color:#000

    class Step1 userAction
    class Step2 eventAction
    class Step3,Step4a,Step4b,Step4c serviceAction
    class Step4d,BatchOps,Complete processAction
```

### Indexing Flow (File Save)

```mermaid
graph TD
    Step1["1. User saves file in editor"]
    Step2["2. FileWatcherService detects change<br/>(debounced 300ms)"]
    Step3["3. FileWatcherService emits<br/>'file:saved' event"]
    Step4["4. GraphEngineService.handleFileSaved(event)"]

    Step5a["5a. Parse markdown → sections<br/>• H1-H6 headings<br/>• Compute text_hash (SHA-256)"]
    Step5b["5b. Diff against DB<br/>• SELECT text_hash WHERE file_id = ?<br/>• Find changed sections"]
    Step5c["5c. Tokenize + chunk<br/>• Changed sections only<br/>• 256-384 tokens, 10-15% overlap<br/>• Store in sections table"]
    Step5d["5d. FTS5 sync<br/>(automatic via triggers)"]

    Step5e["5e. Send chunks to<br/>EmbedderWorker"]
    Worker["Worker Operations:<br/>• Batch embed (32-128 chunks)<br/>• L2 normalize vectors<br/>• Return embeddings"]

    Step5f["5f. INSERT OR REPLACE<br/>• embeddings table<br/>• vss_sections (vector index)"]
    Step5g["5g. [Optional M3+]<br/>Extract entities/mentions/edges<br/>• LLM-based extraction OR<br/>• Rule-based ([[wikilinks]], #tags)"]
    Step5h["5h. Emit 'graph:file:indexed'<br/>→ Renderer updates Related Sidebar"]

    Step1 --> Step2
    Step2 --> Step3
    Step3 --> Step4
    Step4 --> Step5a
    Step4 --> Step5b
    Step4 --> Step5c
    Step4 --> Step5d
    Step5c --> Step5e
    Step5e --> Worker
    Worker --> Step5f
    Step5f --> Step5g
    Step5g --> Step5h

    classDef userAction fill:#bbdefb,stroke:#0d47a1,stroke-width:3px,color:#000
    classDef serviceAction fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#000
    classDef processingAction fill:#e1bee7,stroke:#4a148c,stroke-width:3px,color:#000
    classDef workerAction fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px,color:#000

    class Step1 userAction
    class Step2,Step3 serviceAction
    class Step4,Step5a,Step5b,Step5c,Step5d,Step5f,Step5g,Step5h processingAction
    class Step5e,Worker workerAction
```

### Search Flow (Hybrid Retrieval)

```mermaid
graph TD
    Step1["1. User enters query<br/>in Global Search"]
    Step2["2. window.api.graph.search()<br/>{ q, k, filters, asOf }"]
    Step3["3. GraphEngineService.search()"]

    Step4a["4a. BM25 keyword search (FTS5)<br/>SELECT ... FROM fts_sections<br/>WHERE fts_sections MATCH :q<br/>Returns: [(section_id, bm25_score), ...]"]
    Step4b["4b. Embed query (EmbedderWorker)<br/>Returns: query_vector (float32[])"]
    Step4c["4c. Vector similarity search<br/>(sqlite-vec)<br/>SELECT ... FROM vss_sections<br/>WHERE vss_search(...)<br/>Returns: [(section_id, cosine_distance), ...]"]
    Step4d["4d. [Optional] Graph boost<br/>For each candidate:<br/>• Shared entities with query<br/>• Distance to focused entity<br/>• Centrality (if graphology loaded)"]

    Step5["5. Combine + normalize scores<br/>score = α×bm25 + β×cosine + γ×graph_boost + δ×recency<br/>Sort by score DESC, apply filters, return top-k"]

    Step6["6. Renderer displays<br/>results in UI"]

    Step1 --> Step2
    Step2 --> Step3
    Step3 --> Step4a
    Step3 --> Step4b
    Step3 --> Step4c
    Step3 --> Step4d
    Step4a --> Step5
    Step4b --> Step5
    Step4c --> Step5
    Step4d --> Step5
    Step5 --> Step6

    classDef userAction fill:#bbdefb,stroke:#0d47a1,stroke-width:3px,color:#000
    classDef ipcAction fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#000
    classDef searchAction fill:#e1bee7,stroke:#4a148c,stroke-width:3px,color:#000
    classDef combineAction fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px,color:#000
    classDef renderAction fill:#bbdefb,stroke:#0d47a1,stroke-width:3px,color:#000

    class Step1 userAction
    class Step2 ipcAction
    class Step3,Step4a,Step4b,Step4c,Step4d searchAction
    class Step5 combineAction
    class Step6 renderAction
```

### MCP Server Integration Flow (Claude Code)

```mermaid
graph TD
    Step1["1. Claude Code starts<br/>in Terminal panel"]
    Step2["2. ERFANA launches<br/>MCPServerService<br/>(stdio transport)"]
    Step3["3. MCPServerService registers 5 tools:<br/>• erfana_graph_search<br/>• erfana_graph_related<br/>• erfana_graph_entities<br/>• erfana_graph_backlinks<br/>• erfana_graph_timeline"]
    Step4["4. Claude Code queries:<br/>'Show me docs about SQLite'"]
    Step5["5. MCP client calls<br/>erfana_graph_search()<br/>{ query: 'SQLite', k: 10 }"]
    Step6["6. MCPServerService.handleToolCall()"]

    Step7a["7a. Check rate limit<br/>(100 queries/min for search)"]
    Step7b["7b. Call graphEngineService.search()<br/>{ q: 'SQLite', k: 10 }<br/>(Same hybrid search as UI)"]
    Step7c["7c. Format results as MCP response<br/>{ results: [<br/>  { title, file, snippet, score, ... },<br/>  ...<br/>] }"]
    Step7d["7d. Return to Claude Code via stdio<br/>→ Claude uses results to inform response"]

    Step1 --> Step2
    Step2 --> Step3
    Step3 --> Step4
    Step4 --> Step5
    Step5 --> Step6
    Step6 --> Step7a
    Step6 --> Step7b
    Step6 --> Step7c
    Step7a --> Step7d
    Step7b --> Step7d
    Step7c --> Step7d

    classDef externalAction fill:#fff59d,stroke:#f57f17,stroke-width:3px,color:#000
    classDef serviceAction fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#000
    classDef mcpAction fill:#e1bee7,stroke:#4a148c,stroke-width:3px,color:#000
    classDef processingAction fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px,color:#000

    class Step1,Step4 externalAction
    class Step2,Step3 serviceAction
    class Step5,Step6 mcpAction
    class Step7a,Step7b,Step7c,Step7d processingAction
```

**Security & Isolation:**
- MCP server runs in main process (trusted zone)
- Read-only access to graph database
- No file system writes allowed
- Rate limiting prevents abuse
- Separate from renderer process (untrusted zone)

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

### 8. Event-Driven Integration with ERFANA
**Why:** Loose coupling; GraphEngine doesn't need to know about FileWatcherService internals.
**How:** GraphEngine subscribes to EventEmitter events (`file:saved`, `project:changed`, etc.).
**Benefits:**
- Easy to add new event sources (e.g., git commits, external file changes)
- Graph engine can be disabled/enabled without code changes
- Clean separation of concerns

### 9. MCP Server for Claude Code Integration
**Why:** Standardized protocol for AI assistant tooling; future-proof for other MCP clients.
**How:** MCPServerService exposes GraphEngineService via stdio transport.
**Benefits:**
- Claude Code gets project knowledge automatically
- Same search API used by both UI and MCP (consistency)
- Rate limiting prevents resource exhaustion
- Read-only access ensures safety

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

- **[User Guide](./user-guide.md)**: Learn what the graph engine does and how to use it
- **[Data Ingestion](./data-ingestion.md)**: How files are discovered and indexed
- **[MCP Server](./mcp-server.md)**: Claude Code integration details
- **[Data Model](./data-model.md)**: Review SQLite schema details
- **[Vector Search](./vector-search.md)**: Deep dive on sqlite-vec
- **[Embedding Pipeline](./embedding-pipeline.md)**: ONNX integration details

---

**Related:**
- [Main Overview](../graph-engine.md)
- [Performance & Scalability](./performance.md)
- [Production Readiness](./production-readiness.md)
- [Implementation Guide](./implementation-guide.md)
