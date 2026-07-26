# Notes

## Constraints

### Electron process model

The graph engine must operate within Electron's process constraints:
- **Main process:** Database access, file I/O, MCP server
- **Renderer process:** UI components, search invocation via IPC
- **No shared memory:** All data transfer via IPC channels

Heavy computation (indexing) should use worker threads or be chunked to avoid blocking the main process.

### SQLite in Electron

- Must use `better-sqlite3` **>= 13** (synchronous API, N-API build) rather than `sqlite3` (callback-based)
- v13+ is the N-API line: decoupled from V8 ABI, so a single N-API prebuild should serve Electron 39. Electron 39 win-x64 prebuild coverage is now empirically verified (SD-019 packaged/signed CI run, 2026-07-24 – loads the flat `win32-x64.node` prebuild); mac-arm64 packaged/notarized coverage remains to be confirmed at pin time (context: better-sqlite3 issues #1416, #1384). See [`docs/graph/native-dependencies.md`](../../../docs/graph/native-dependencies.md)
- `node:sqlite` (bundled with Node 22 in Electron 39) rejected for M1: compiled with `SQLITE_OMIT_LOAD_EXTENSION` and without FTS5, still experimental before Node 26 – cannot satisfy 004-FR-001/017/018. Revisit only if it gains FTS5
- Database file must be in writable location (`.erfana/` directory)

> **Native-dependency spike (#19 / SD-019):** the prebuild-coverage, FTS5, worker-concurrency, and MCP-SDK questions in this section and under Dependencies are empirically de-risked in the spike findings note — see [`docs/graph/native-dependencies.md`](../../../docs/graph/native-dependencies.md) (consumed by #23 DB layer / #30 MCP server).

### FTS5 limitations

- FTS5 provides BM25 ranking but no semantic/vector search
- Custom tokenizers require C extension (not available in M1)
- Porter stemmer is built-in; porter stemming is English-only – language-specific stemming and multilingual support deferred (see General deferrals)

### Alternatives considered (2026-07)

FTS5 + BM25 re-affirmed for M1 at this scale (≤10k sections, <50ms p95):
- **Tantivy** rejected – would add a second native-module/ABI surface alongside better-sqlite3
- **DuckDB FTS** rejected – analytics-oriented, not a fit for incremental per-project indexing
- **Orama / minisearch** rejected – in-memory engines, no persisted per-project index

### MCP transport

- MCP defines two standard transports: stdio and Streamable HTTP (HTTP+SSE was replaced by Streamable HTTP in protocol rev 2025-03-26; WebSocket was never a standard transport)
- stdio selected: local single-client server, no network exposure – choice re-affirmed 2026-07 against protocol revs through 2026-07-28
- Single MCP server instance per Erfana process
- Client connection management handled by MCP SDK

### Contract stability (beta period)

- MCP tool names and schemas (`erfana_graph_*` – all of them, including the Spec #005/#006/#007 tools) and the on-disk database schema are **beta until frozen**
- Tool descriptions state "beta – contract may change" until the freeze
- The database is a derived cache of the markdown sources: delete + reindex is always a valid recovery, so schema churn during beta needs no migration guarantees
- Freeze criterion: ~one month of stable dogfood use and two consecutive releases without contract/schema churn (decision 2026-07-23)

## Assumptions

### File system

- Project directory is readable and writable
- `.erfana/` directory can be created if not exists
- File names are valid UTF-8
- Files fit in available memory for preprocessing

### Content

- All indexable files are markdown (`.md` extension)
- Markdown follows CommonMark specification
- File encoding is UTF-8
- Headings use ATX style (`#` prefix, not underline)

### Environment

- SQLite FTS5 extension is available in better-sqlite3
- File watcher events are delivered reliably (with polling fallback)
- Main process has sufficient memory for SQLite operations

### Usage patterns

- Typical project has < 10,000 sections
- Typical section is < 10,000 words
- Search queries are < 100 characters
- Users expect sub-second response for search

## Dependencies

### Runtime dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| better-sqlite3 | ^13.x | SQLite database with FTS5 (N-API line; required for Electron 39 – v12 and older fail to compile against Electron 39's V8, which removed Context::GetIsolate) |
| @modelcontextprotocol/sdk | ^1.x (SD-019 pins `1.29.0`) | MCP server implementation via the v1 SDK `registerTool` API (protocol rev 2025-11-25). SD-019 **rejected `@modelcontextprotocol/server@2.x` (beta-only)** and pinned v1; the v1→v2 SDK split (`@modelcontextprotocol/server` + `/client`) is a deferred #30 migration once v2 stabilizes, and #30 also moves the SDK from `devDependencies` to `dependencies` when a real transport ships – see [`native-dependencies.md`](../../../docs/graph/native-dependencies.md) §1/§8 |

### Internal dependencies

| Service | Purpose |
|---------|---------|
| FileWatcherService | Source of file change events |
| ProjectManagementContext | Current project path |
| LoggingService | Structured logging |

### Build dependencies

- `better-sqlite3` >= 13 uses N-API prebuilt binaries in the common case; Python and C++ toolchain retained for source-build fallback
- The build ships `asar: false`, so the `.node` binary loads from the unpacked `resources/app/node_modules/better-sqlite3/prebuilds/` tree – no `asarUnpack` is used; the win-x64 packaged smoke confirmed this load path (SD-019)
- electron-rebuild / source-build remains the documented fallback if a prebuild does not cover the target Electron/platform. win-x64 prebuild coverage is verified (SD-019, 2026-07-24); mac-arm64 remains to be confirmed at pin time

## Out of Scope (Deferred)

### M2: Vector embeddings

- sqlite-vec extension for vector storage
- Embedding generation via local model or API
- Semantic similarity search
- Hybrid ranking (BM25 + vector)

### M3: Hybrid search

- Score fusion algorithms
- Reciprocal rank fusion
- Query expansion
- Relevance feedback

### M4: Entity extraction

- Named entity recognition
- Entity linking
- Relationship extraction
- Entity-based filtering

### M5: Knowledge graph

- Graph database schema
- Relationship types
- Graph traversal queries
- Visualization

### General deferrals

- Cross-project search federation
- Real-time collaborative indexing
- Custom tokenizers and stemmers
- Multilingual support
- Search history and analytics
- Synonym expansion
- Fuzzy matching

## Open Questions

### Performance tuning

1. **Batch size:** Should batch size be configurable or auto-tuned based on system resources?
2. **Debounce timing:** Is 300ms optimal, or should it adapt to typing speed?
3. **FTS5 parameters:** Should BM25 k1 and b parameters be exposed for tuning?

### UI/UX

1. **Related sidebar scope:** Should it show related content from current file, or exclude current file entirely?
2. **Global search persistence:** Should search panel state persist across sessions?
3. **Keyboard shortcuts:** Is Cmd+Shift+F the right shortcut, or does it conflict with existing functionality?

### MCP integration

1. **Multiple tools:** Should M1 include only search, or also index status and reindex commands?
2. **Rate limiting:** Is 100 queries/minute appropriate, or should it be configurable?
3. **Result format:** Should MCP results include full content or just snippets?

### Architecture

1. **Worker threads:** Should indexing use worker threads, or is chunked main-thread processing sufficient?
2. **Database location:** Should database be in `.erfana/` or a user-configurable location?
3. **Cache layer:** Is an in-memory cache needed for frequent searches, or is SQLite fast enough?

## Technical Notes

### FTS5 table schema (proposed)

```sql
CREATE VIRTUAL TABLE sections_fts USING fts5(
  heading,
  content,
  file_path UNINDEXED,
  section_id UNINDEXED,
  content_hash UNINDEXED,
  -- porter stemming is English-only; unicode61 with remove_diacritics 2 normalizes accented text
  tokenize = 'porter unicode61 remove_diacritics 2'
);
```

### Search query structure (proposed)

```sql
SELECT
  file_path,
  heading,
  snippet(sections_fts, 1, '<mark>', '</mark>', '...', 30) as snippet,
  bm25(sections_fts, 3.0, 1.0) as score
FROM sections_fts
WHERE sections_fts MATCH ?
ORDER BY score
LIMIT ?;
```

### Event subscription pattern

```typescript
// GraphEngineService subscribes to FileWatcherService events
fileWatcherService.on('file:saved', (path) => this.queueUpdate(path));
fileWatcherService.on('file:created', (path) => this.queueUpdate(path));
fileWatcherService.on('file:deleted', (path) => this.removeFromIndex(path));
projectManagement.on('project:changed', (event) => this.switchDatabase(event));
```

### MCP tool definition (proposed)

```typescript
// v1 SDK (@modelcontextprotocol/sdk, SD-019 pin) – registerTool replaces raw tool JSON; v2 (@modelcontextprotocol/server) is a deferred #30 migration
server.registerTool('erfana_graph_search', {
  title: 'Search project content',
  description: 'Search project content using BM25 keyword ranking (beta – contract may change)',
  inputSchema: {
    query: z.string().describe('Search query'),
    k: z.number().default(10).describe('Number of results'),
    filters: z.object({
      folder: z.string().optional(),
      file_type: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional()
    }).optional()
  }
}, async (args) => { /* returns structured results */ })
```
