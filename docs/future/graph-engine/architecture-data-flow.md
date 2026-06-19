# Graph engine architecture – data flow and design decisions

> This is part 2 of the architecture documentation, split for readability.
>
> **Other parts:**
> - [Architecture – overview and components](./architecture-overview.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Data flow

### Complete event-driven architecture

**Overview:** The Graph Engine integrates with Erfana through an event-driven architecture where services communicate via an EventEmitter bus.

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
```

### Project initialization flow

```mermaid
graph TD
    Step1["1. User opens project<br/>(File → Open Project)"]
    Step2["2. EventEmitter emits<br/>'project:changed'"]
    Step3["3. GraphEngineService<br/>receives event"]

    Step4a["4a. Discover .md files<br/>• Exclude: node_modules/, .git/, dist/<br/>• Priority: Currently open files first"]
    Step4b["4b. Create/migrate SQLite DB<br/>• Path: projectPath/.erfana/graph.db<br/>• Schema version check"]
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
```

### Indexing flow (file save)

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
```

### Search flow (hybrid retrieval)

```mermaid
graph TD
    Step1["1. User enters query<br/>in Global Search"]
    Step2["2. window.api.graph.search()<br/>{ q, k, filters, asOf }"]
    Step3["3. GraphEngineService.search()"]

    Step4a["4a. BM25 keyword search (FTS5)<br/>SELECT ... FROM fts_sections<br/>WHERE fts_sections MATCH :q<br/>Returns: [(section_id, bm25_score), ...]"]
    Step4b["4b. Embed query (EmbedderWorker)<br/>Returns: query_vector (float32[])"]
    Step4c["4c. Vector similarity search<br/>(sqlite-vec)<br/>SELECT ... FROM vss_sections<br/>WHERE vss_search(...)<br/>Returns: [(section_id, cosine_distance), ...]"]
    Step4d["4d. [Optional] Graph boost<br/>For each candidate:<br/>• Shared entities with query<br/>• Distance to focused entity<br/>• Centrality (if graphology loaded)"]

    Step5["5. Combine + normalize scores<br/>score = a*bm25 + b*cosine + g*graph_boost + d*recency<br/>Sort by score DESC, apply filters, return top-k"]

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
```

### MCP server integration flow (Claude Code)

```mermaid
graph TD
    Step1["1. Claude Code starts<br/>in Terminal panel"]
    Step2["2. Erfana launches<br/>MCPServerService<br/>(stdio transport)"]
    Step3["3. MCPServerService registers 5 tools:<br/>• erfana_graph_search<br/>• erfana_graph_related<br/>• erfana_graph_entities<br/>• erfana_graph_backlinks<br/>• erfana_graph_timeline"]
    Step4["4. Claude Code queries:<br/>'Show me docs about SQLite'"]
    Step5["5. MCP client calls<br/>erfana_graph_search()<br/>{ query: 'SQLite', k: 10 }"]
    Step6["6. MCPServerService.handleToolCall()"]

    Step7a["7a. Check rate limit<br/>(100 queries/min for search)"]
    Step7b["7b. Call graphEngineService.search()<br/>{ q: 'SQLite', k: 10 }<br/>(Same hybrid search as UI)"]
    Step7c["7c. Format results as MCP response"]
    Step7d["7d. Return to Claude Code via stdio"]

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
```

**Security & isolation:**
- MCP server runs in main process (trusted zone)
- Read-only access to graph database
- No file system writes allowed
- Rate limiting prevents abuse
- Separate from renderer process (untrusted zone)

---

## Key design decisions

### 1. Synchronous SQLite (better-sqlite3)
**Why:** Simpler code flow; no promise hell for DB ops.
**Trade-off:** Main thread blocking (mitigated by worker threads for embeddings).

### 2. Debounced indexing
**Why:** Avoid re-indexing on every keystroke.
**Strategy:** 300ms debounce + queue coalescing (one job per file).

### 3. Content-based hashing (text_hash)
**Why:** Skip re-embedding unchanged sections.
**How:** Hash normalized text after stripping markdown syntax.

### 4. Temporal graph (valid_from, valid_to, tx_time)
**Why:** Track how knowledge changes over time.
**Use Case:** "What did the code architecture look like 3 months ago?"

### 5. On-demand graph loading (graphology)
**Why:** Don't load full graph into memory for every query.
**How:** Build subgraph on-demand for specific entities.

### 6. Configurable hybrid weights
**Why:** Different query types benefit from different weightings.
**How:** Store α, β, γ, δ in settings; allow per-query override.

### 7. Single embedder per project
**Why:** Mixing vector spaces causes poor results.
**Migration:** Re-embed all on model switch (background job with progress).

### 8. Event-driven integration with Erfana
**Why:** Loose coupling; GraphEngine doesn't need to know about FileWatcherService internals.
**How:** GraphEngine subscribes to EventEmitter events (`file:saved`, `project:changed`, etc.).
**Benefits:**
- Easy to add new event sources (e.g., git commits, external file changes)
- Graph engine can be disabled/enabled without code changes
- Clean separation of concerns

### 9. MCP server for Claude Code integration
**Why:** Standardized protocol for AI assistant tooling; future-proof for other MCP clients.
**How:** MCPServerService exposes GraphEngineService via stdio transport.
**Benefits:**
- Claude Code gets project knowledge automatically
- Same search API used by both UI and MCP (consistency)
- Rate limiting prevents resource exhaustion
- Read-only access ensures safety

---

## Security considerations

### 1. No renderer Node.js access
- Renderer can't directly call `require()` or `process`
- All file system access goes through IPC

### 2. Content redaction
- Apply regex patterns before indexing (e.g., remove API keys, secrets)
- Configurable per-project

### 3. SQL injection prevention
- Use prepared statements for all queries
- Never concatenate user input into SQL strings

### 4. Optional cloud services
- Embeddings/LLMs are opt-in, not default
- API keys scoped per-project (stored in electron-store)

### 5. Content isolation
- Each project has its own SQLite database
- No cross-project data leakage

---

## Performance considerations

### Read performance
- **FTS5**: ~1-10ms for keyword search (typical corpus)
- **sqlite-vec**: ~50-100ms for 100K vectors @ 384 dims (brute-force)
- **Hybrid Search**: ~100-200ms total (parallelizable)

### Write performance
- **Prepared Statements**: ~0.1ms per row insert
- **WAL Mode**: Concurrent reads while writing
- **Batch Transactions**: Wrap 1000s of inserts in single transaction

### Embedding performance
- **all-MiniLM-L6-v2**: ~15ms per 1K tokens (single thread)
- **Batching**: 32-128 chunks → ~0.5-2s per batch
- **Concurrency**: 2-4 workers → ~1-4 batches/sec

---

## Failure modes & recovery

### Worker crash (onnxruntime-node)
**Symptom:** Worker thread exits unexpectedly
**Recovery:** Auto-restart worker, retry batch (idempotent ops)
**Prevention:** Limit concurrent workers to 2-4

### SQLite lock timeout
**Symptom:** `SQLITE_BUSY` error
**Recovery:** Retry with exponential backoff (max 3 attempts)
**Prevention:** Use WAL mode, keep transactions short

### Corrupt database
**Symptom:** `SQLITE_CORRUPT` error
**Recovery:** Backup DB, run `PRAGMA integrity_check`, rebuild if needed
**Prevention:** Regular integrity checks on startup

---

## Next steps

- **[User Guide](./user-guide-features.md)**: Learn what the graph engine does and how to use it
- **[Data Ingestion](./data-ingestion-discovery.md)**: How files are discovered and indexed
- **[MCP Server](./mcp-server-tools.md)**: Claude Code integration details
- **[Data Model](./data-model.md)**: Review SQLite schema details
- **[Vector Search](./vector-search-overview.md)**: Deep dive on sqlite-vec
- **[Embedding Pipeline](./embedding-pipeline-overview.md)**: ONNX integration details

---

## See also

- [Architecture – overview and components](./architecture-overview.md) – system overview, component architecture, technology stack, process model
- [Main Overview](../graph-engine.md)
- [Performance & Scalability](./performance.md)
- [Production Readiness](./production-readiness-checklist.md)
- [Implementation Guide](./implementation-guide.md)
