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

## Milestone 1: Foundation (FTS5 + Keyword Search)

**Goal:** Ship working keyword search with complete UI components and MCP server for Claude Code.

**Duration:** 3-4 weeks

### Overview

M1 delivers:
- **Related Sidebar**: Auto-updating research assistant
- **Global Search**: Project-wide keyword search (replaces grep)
- **Settings Panel**: Configure indexing and search
- **Status Indicator**: Show indexing progress
- **MCP Server**: Expose graph engine to Claude Code (Terminal)
- **Event-Driven Integration**: Subscribe to FileWatcherService events

### Tasks

#### 1.1 Database Setup

**Files to create:**
- `src/main/services/GraphDatabaseService.ts`
- `src/main/db/schema.sql`

**Steps:**

1. Initialize SQLite database:
   ```typescript
   import Database from 'better-sqlite3';

   export class GraphDatabaseService {
     private db: Database.Database;

     constructor(projectPath: string) {
       const dbPath = path.join(projectPath, '.erfana', 'graph.db');
       this.db = new Database(dbPath);
       this.db.pragma('journal_mode = WAL');
       this.runMigrations();
     }

     private runMigrations(): void {
       const schema = fs.readFileSync('./src/main/db/schema.sql', 'utf-8');
       this.db.exec(schema);
     }
   }
   ```

2. Create schema (from data-model.md):
   - `files` table
   - `sections` table
   - `fts_sections` virtual table
   - FTS sync triggers

**Validation:** Run `sqlite3 graph.db ".schema"` → verify tables exist.

#### 1.2 Text Preprocessing

**File:** `src/main/services/TextPreprocessor.ts`

**Implementation:**
- Strip markdown syntax (headings, emphasis, links, code)
- Normalize whitespace
- Compute SHA-256 hash (for deduplication)

**Test:**
```typescript
const text = TextPreprocessor.normalize('## Heading

This is **bold**.');
assert.equal(text, 'Heading

This is bold.');
```

#### 1.3 File Indexing Pipeline

**File:** `src/main/services/IndexingService.ts`

**Steps:**

1. Parse markdown file → extract sections (by headings)
2. Normalize text per section
3. Insert into `files` table
4. Insert sections into `sections` table (FTS triggers auto-sync)

**Code (sketch):**

```typescript
export class IndexingService {
  constructor(private db: GraphDatabaseService) {}

  indexFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Check if file changed
    const existing = this.db.getFileByPath(filePath);
    if (existing && existing.hash === hash) {
      console.log(`Skipping ${filePath} (unchanged)`);
      return;
    }

    // Parse sections
    const sections = this.parseSections(content);

    // Upsert file
    const fileId = this.db.upsertFile({
      path: filePath,
      hash,
      meta_json: JSON.stringify({ /* frontmatter */ }),
      updated_at: Date.now()
    });

    // Delete old sections
    this.db.deleteSectionsByFileId(fileId);

    // Insert new sections
    for (const section of sections) {
      this.db.insertSection({
        file_id: fileId,
        heading: section.heading,
        level: section.level,
        text: TextPreprocessor.normalize(section.text),
        text_hash: TextPreprocessor.hash(section.text),
        updated_at: Date.now()
      });
    }

    console.log(`Indexed ${filePath}: ${sections.length} sections`);
  }

  private parseSections(markdown: string): Section[] {
    // TODO: Implement markdown → sections parser
    // Use remark or marked for AST parsing
  }
}
```

**Test:** Index `docs/README.md` → verify sections in DB.

#### 1.4 BM25 Search API

**File:** `src/main/services/SearchService.ts`

**Implementation:**

```typescript
export class SearchService {
  constructor(private db: GraphDatabaseService) {}

  search(query: string, k: number = 10): SearchResult[] {
    const results = this.db.db.prepare(`
      SELECT
        s.id AS section_id,
        s.text,
        s.heading,
        f.path,
        bm25(fts, 3.0, 1.0) AS score
      FROM fts_sections fts
      JOIN sections s ON s.id = fts.section_id
      JOIN files f ON f.id = s.file_id
      WHERE fts_sections MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `).all(query, k);

    return results.map(r => ({
      ...r,
      score: Math.abs(r.score) // BM25 returns negative
    }));
  }
}
```

**Test:**
```bash
npm run dev
# In renderer console:
const results = await window.api.graph.search({ q: 'vector search', k: 10 });
console.log(results);
```

#### 1.5 IPC Handlers

**File:** `src/main/ipc/graph-handlers.ts`

```typescript
import { ipcMain } from 'electron';

export function registerGraphHandlers(
  indexingService: IndexingService,
  searchService: SearchService
) {
  ipcMain.handle('graph:indexFile', async (event, filePath: string) => {
    indexingService.indexFile(filePath);
    return { success: true };
  });

  ipcMain.handle('graph:search', async (event, params: { q: string; k?: number }) => {
    const results = searchService.search(params.q, params.k || 10);
    return { results };
  });
}
```

**Preload:** `src/preload/index.ts`

```typescript
contextBridge.exposeInMainWorld('api', {
  graph: {
    indexFile: (path: string) => ipcRenderer.invoke('graph:indexFile', path),
    search: (params: { q: string; k?: number }) => ipcRenderer.invoke('graph:search', params)
  }
});
```

#### 1.6 Related Sidebar UI

**File:** `src/renderer/src/components/Panels/RelatedSidebar.tsx`

**Implementation:**

```tsx
export function RelatedSidebar() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRelated = async (query: string) => {
    setLoading(true);
    try {
      const data = await window.api.graph.search({ q: query, k: 10 });
      setResults(data.results);
    } finally {
      setLoading(false);
    }
  };

  // Trigger search when editor selection changes
  useEffect(() => {
    const selectedText = /* get from Monaco editor */;
    if (selectedText.length > 10) {
      fetchRelated(selectedText);
    }
  }, [/* dependencies */]);

  return (
    <div className="related-sidebar">
      <h3>Related</h3>
      {loading && <div>Loading...</div>}
      {results.map(r => (
        <div key={r.section_id} className="result">
          <a href={`file://${r.path}#${r.section_id}`}>
            {r.heading || r.path}
          </a>
          <p>{r.text.slice(0, 150)}...</p>
          <span className="score">Score: {r.score.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
```

#### 1.7 Global Search UI

**File:** `src/renderer/src/components/Panels/GlobalSearch.tsx`

**Implementation:**

```tsx
export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      const data = await window.api.graph.search({ q: query, k: 50 });
      setResults(data.results);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="global-search">
      <input
        type="text"
        placeholder="Search project (e.g., 'SQLite performance')..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
      />
      <button onClick={handleSearch}>Search</button>

      {loading && <div>Searching...</div>}
      {results.map(r => (
        <div key={r.section_id} className="result">
          <div className="result-header">
            <span className="path">{r.path}</span>
            <span className="score">Score: {r.score.toFixed(2)}</span>
          </div>
          <h4>{r.heading}</h4>
          <p>{r.text.slice(0, 200)}...</p>
          <button onClick={() => openFile(r.path, r.section_id)}>
            Open
          </button>
        </div>
      ))}
    </div>
  );
}
```

**Features:**
- Natural language queries (e.g., "how to optimize search")
- Filters: folder, file type, date range (M2+)
- "Why this result?" breakdown (M2+)

#### 1.8 Settings Panel UI

**File:** `src/renderer/src/components/GraphSettings/SettingsPanel.tsx`

**Implementation:**

```tsx
export function GraphSettingsPanel() {
  const [indexing, setIndexing] = useState(false);

  const handleReindex = async () => {
    setIndexing(true);
    try {
      await window.api.graph.reindexAll();
    } finally {
      setIndexing(false);
    }
  };

  return (
    <div className="graph-settings">
      <h3>Graph Engine Settings</h3>

      <section>
        <h4>Indexing</h4>
        <button onClick={handleReindex} disabled={indexing}>
          {indexing ? 'Reindexing...' : 'Reindex All Files'}
        </button>
        <p className="help-text">
          Re-scan and index all markdown files in the project.
        </p>
      </section>

      {/* M2: Add hybrid weights sliders */}
      {/* M3: Add entity extraction toggle */}
    </div>
  );
}
```

#### 1.9 Status Indicator UI

**File:** `src/renderer/src/components/StatusBar/GraphStatus.tsx`

**Implementation:**

```tsx
export function GraphStatusIndicator() {
  const [status, setStatus] = useState<IndexingStatus | null>(null);

  useEffect(() => {
    // Subscribe to indexing progress events
    window.api.graph.onIndexingProgress((progress) => {
      setStatus(progress);
    });
  }, []);

  if (!status) return null;

  return (
    <div className="graph-status">
      {status.indexing ? (
        <>
          <div className="spinner" />
          <span>Indexing: {status.current}/{status.total}</span>
        </>
      ) : (
        <>
          <span className="status-dot green" />
          <span>Graph Ready</span>
        </>
      )}
    </div>
  );
}
```

**Events to handle:**
- `graph:indexing:started` → Show spinner
- `graph:indexing:progress` → Update count
- `graph:indexing:complete` → Show green dot

#### 1.10 Event-Driven Integration

**File:** `src/main/services/GraphEngineService.ts`

**Implementation:**

```typescript
export class GraphEngineService {
  constructor(
    private db: GraphDatabaseService,
    private indexingService: IndexingService,
    private eventBus: EventEmitter
  ) {
    // Subscribe to FileWatcherService events
    this.eventBus.on('file:saved', this.handleFileSaved.bind(this));
    this.eventBus.on('file:created', this.handleFileCreated.bind(this));
    this.eventBus.on('file:deleted', this.handleFileDeleted.bind(this));
    this.eventBus.on('project:changed', this.handleProjectChanged.bind(this));
  }

  private async handleFileSaved(event: { path: string }): Promise<void> {
    if (!this.isMarkdownFile(event.path)) return;

    console.log(`[GraphEngine] Re-indexing: ${event.path}`);
    await this.indexingService.indexFile(event.path);
    this.eventBus.emit('graph:file:indexed', { path: event.path });
  }

  private async handleFileCreated(event: { path: string }): Promise<void> {
    if (!this.isMarkdownFile(event.path)) return;

    console.log(`[GraphEngine] Indexing new file: ${event.path}`);
    await this.indexingService.indexFile(event.path);
  }

  private async handleFileDeleted(event: { path: string }): Promise<void> {
    console.log(`[GraphEngine] Removing from index: ${event.path}`);
    await this.db.deleteFileByPath(event.path);
  }

  private async handleProjectChanged(event: { newPath: string | null }): Promise<void> {
    if (!event.newPath) return;

    console.log(`[GraphEngine] Indexing project: ${event.newPath}`);
    await this.discoverAndIndexAllFiles(event.newPath);
  }

  private async discoverAndIndexAllFiles(projectPath: string): Promise<void> {
    // Discover all .md files
    const files = await this.discoverMarkdownFiles(projectPath);

    this.eventBus.emit('graph:indexing:started', { total: files.length });

    // Index in batches
    for (let i = 0; i < files.length; i += 10) {
      const batch = files.slice(i, i + 10);
      await Promise.all(batch.map(f => this.indexingService.indexFile(f)));

      this.eventBus.emit('graph:indexing:progress', {
        current: Math.min(i + 10, files.length),
        total: files.length
      });
    }

    this.eventBus.emit('graph:indexing:complete', {
      indexed: files.length,
      skipped: 0
    });
  }

  private isMarkdownFile(path: string): boolean {
    return path.endsWith('.md');
  }
}
```

#### 1.11 MCP Server Integration

**File:** `src/main/services/MCPServerService.ts`

**Implementation:**

```typescript
import { MCPServer } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

export class MCPServerService {
  private server: MCPServer;

  constructor(private graphEngine: GraphEngineService) {
    this.server = new MCPServer({
      name: 'erfana-graph-engine',
      version: '1.0.0'
    });

    this.registerTools();
  }

  private registerTools(): void {
    // Tool 1: Hybrid search
    this.server.addTool({
      name: 'erfana_graph_search',
      description: 'Hybrid BM25 + vector search across project documentation',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          k: { type: 'number', description: 'Number of results', default: 10 }
        },
        required: ['query']
      }
    }, async (params) => {
      const results = await this.graphEngine.search({
        q: params.query,
        k: params.k || 10
      });
      return { results };
    });

    // Additional tools in M2+
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('[MCP] Graph Engine MCP server started on stdio');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
```

**Start MCP Server on app launch:**

```typescript
// In main process initialization
const eventBus = new EventEmitter();
const graphEngine = new GraphEngineService(db, indexingService, eventBus);
const mcpServer = new MCPServerService(graphEngine);

app.on('ready', async () => {
  await mcpServer.start();
});

app.on('quit', async () => {
  await mcpServer.stop();
});
```

### M1 Completion Checklist

**Core Functionality:**
- [ ] SQLite database initialized with schema
- [ ] Text preprocessing pipeline working
- [ ] File indexing pipeline working (on save)
- [ ] BM25 search returns relevant results

**UI Components:**
- [ ] Related Sidebar displays top-10 results (auto-updates)
- [ ] Global Search UI with project-wide search
- [ ] Settings Panel with reindex button
- [ ] Status Indicator shows indexing progress

**Integration:**
- [ ] Event-driven integration: GraphEngine subscribes to FileWatcherService events
- [ ] `file:saved` → re-index file
- [ ] `project:changed` → discover and index all .md files
- [ ] MCP Server started on app launch
- [ ] `erfana_graph_search` tool accessible from Claude Code

**Manual Tests:**
- [ ] Edit file → save → see Related Sidebar update
- [ ] Global Search: query "SQLite" → see results
- [ ] Open project → see status indicator show indexing progress
- [ ] Claude Code in Terminal: use `erfana_graph_search` tool → get results

---

## Milestone 2: Vector Search (Hybrid Retrieval)

**Goal:** Add semantic search, combine with BM25 using configurable weights.

**Duration:** 3-4 weeks

### Tasks

#### 2.1 Install Dependencies

```bash
npm install sqlite-vec onnxruntime-node @huggingface/tokenizers
```

#### 2.2 Download Embedding Model

```bash
mkdir -p resources/models
cd resources/models

# Download ONNX model
wget https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx \
  -O all-MiniLM-L6-v2.onnx

# Download tokenizer
wget https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json \
  -O all-MiniLM-L6-v2-tokenizer.json
```

#### 2.3 Load sqlite-vec Extension

**Update:** `GraphDatabaseService.ts`

```typescript
import * as sqliteVec from 'sqlite-vec';

constructor(projectPath: string) {
  // ... existing code ...

  sqliteVec.load(this.db);
  console.log(`sqlite-vec loaded: v${this.db.prepare('SELECT vec_version()').pluck().get()}`);
}
```

**Add to schema:**
- `embeddings` table
- `vss_sections` virtual table

#### 2.4 Embedding Worker

**File:** `src/main/workers/embedder.worker.ts`

**Implementation:** See [embedding-pipeline.md](./embedding-pipeline.md) for full code.

**Test:**

```typescript
const worker = new Worker('./embedder.worker.js');
worker.postMessage({ type: 'initialize', config: { /* ... */ } });
worker.on('message', (msg) => {
  if (msg.type === 'ready') {
    worker.postMessage({ type: 'embed', texts: ['test text'] });
  } else if (msg.type === 'result') {
    console.log('Embedding:', msg.embeddings[0]);
  }
});
```

#### 2.5 Worker Pool

**File:** `src/main/services/EmbedderWorkerPool.ts`

**Implementation:** See [embedding-pipeline.md](./embedding-pipeline.md).

**Key:** Limit to 2-4 workers (onnxruntime-node stability).

#### 2.6 Embedding Service

**File:** `src/main/services/EmbeddingService.ts`

**Steps:**

1. Tokenize text
2. Chunk into 256-384 token segments
3. Batch chunks (32-128 per batch)
4. Send to worker pool
5. Normalize vectors
6. Store in `embeddings` + `vss_sections`

**Test:** Index file → verify embeddings in DB.

#### 2.7 Vector Search

**Update:** `SearchService.ts`

```typescript
async vectorSearch(queryVector: Float32Array, k: number): Promise<VectorResult[]> {
  const results = this.db.db.prepare(`
    SELECT
      e.section_id,
      s.text,
      s.heading,
      f.path,
      vec_distance_L2(v.embedding, ?) AS distance
    FROM vss_sections v
    JOIN embeddings e ON e.id = v.rowid
    JOIN sections s ON s.id = e.section_id
    JOIN files f ON f.id = s.file_id
    WHERE e.embedder_id = ?
    ORDER BY distance ASC
    LIMIT ?
  `).all(Buffer.from(queryVector.buffer), 'all-MiniLM-L6-v2:v1.0', k);

  return results;
}
```

#### 2.8 Hybrid Search

**Implementation:** See [hybrid-search.md](./hybrid-search.md) for score fusion logic.

**Key:**
- Normalize BM25 scores to [0, 1]
- Normalize vector distances to [0, 1]
- Combine: `final_score = α * bm25 + β * vector`
- Default weights: α=0.4, β=0.6

#### 2.9 Settings UI

**File:** `src/renderer/src/components/GraphSettings/WeightTuner.tsx`

**Features:**
- Sliders for α, β
- Real-time preview (show top-10 with current weights)
- Reset to defaults button

#### 2.10 MCP Server Updates

**Update:** `src/main/services/MCPServerService.ts`

**Add new MCP tool:**

```typescript
// Tool 2: Find related sections
this.server.addTool({
  name: 'erfana_graph_related',
  description: 'Find sections related to a specific section',
  inputSchema: {
    type: 'object',
    properties: {
      sectionId: { type: 'number', description: 'Section ID' },
      k: { type: 'number', description: 'Number of results', default: 10 }
    },
    required: ['sectionId']
  }
}, async (params) => {
  const results = await this.graphEngine.getRelated({
    sectionId: params.sectionId,
    k: params.k || 10
  });
  return { results };
});
```

**Status Indicator Update:**

Add MCP server status to status indicator:

```tsx
<div className="mcp-status">
  {mcpServerRunning ? (
    <>
      <span className="status-dot green" />
      <span>MCP Server</span>
    </>
  ) : (
    <>
      <span className="status-dot red" />
      <span>MCP Offline</span>
    </>
  )}
</div>
```

### M2 Completion Checklist

- [ ] sqlite-vec loaded successfully
- [ ] Embedding worker pool operational (2-4 workers)
- [ ] Files re-indexed with embeddings
- [ ] Vector search returns relevant results
- [ ] Hybrid search combines BM25 + vector
- [ ] Settings UI allows weight tuning
- [ ] Manual test: Query "how to optimize search" → sees semantic results

---

## Milestone 3: Graph Capabilities (Entities & Relations)

**Goal:** Extract entities, build graph, enable backlinks and impact analysis.

**Duration:** 3-4 weeks

### Tasks

#### 3.1 Add Graph Tables

**Update schema:**
- `entities` table
- `edges` table
- `mentions` table

#### 3.2 Rule-Based Entity Extraction

**File:** `src/main/services/EntityExtractor.ts`

**Implementation:** See [graph-capabilities.md](./graph-capabilities.md).

**Patterns:**
- `[[wikilinks]]`
- `#tags`
- `@mentions`
- Technical terms (SQLite, React, etc.)

#### 3.3 Entity Storage

**File:** `src/main/services/EntityService.ts`

```typescript
export class EntityService {
  upsertEntity(name: string, type: string): number {
    const result = this.db.db.prepare(`
      INSERT INTO entities (name, type, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name, type) DO UPDATE SET name=name
      RETURNING id
    `).get(name, type, Date.now());

    return result.id;
  }

  linkMention(sectionId: number, entityId: number, startChar: number, endChar: number): void {
    this.db.db.prepare(`
      INSERT OR IGNORE INTO mentions (section_id, entity_id, start_char, end_char, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sectionId, entityId, startChar, endChar, Date.now());
  }
}
```

#### 3.4 Update Indexing Pipeline

**Update:** `IndexingService.ts`

```typescript
indexFile(filePath: string): void {
  // ... existing BM25 + vector indexing ...

  // Extract entities
  for (const section of sections) {
    const entities = this.entityExtractor.extractEntities(section.text);

    for (const entity of entities) {
      const entityId = this.entityService.upsertEntity(entity.name, entity.type);
      this.entityService.linkMention(section.id, entityId, entity.startChar, entity.endChar);
    }
  }
}
```

#### 3.5 Backlinks API

**File:** `src/main/services/GraphService.ts`

```typescript
export class GraphService {
  getBacklinks(entityName: string, limit: number = 50): Backlink[] {
    return this.db.db.prepare(`
      SELECT
        f.path,
        s.id AS section_id,
        s.heading,
        s.text,
        s.updated_at
      FROM mentions m
      JOIN entities e ON e.id = m.entity_id
      JOIN sections s ON s.id = m.section_id
      JOIN files f ON f.id = s.file_id
      WHERE e.name = ?
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(entityName, limit);
  }
}
```

#### 3.6 Knowledge Panel UI

**File:** `src/renderer/src/components/Panels/GraphPanel.tsx`

**Features:**
- List entities in current section
- Click entity → show backlinks
- "Impact analysis" button (shows dependents)

#### 3.7 MCP Server Updates

**Update:** `src/main/services/MCPServerService.ts`

**Add 2 new MCP tools:**

```typescript
// Tool 3: List entities
this.server.addTool({
  name: 'erfana_graph_entities',
  description: 'List entities (with optional filters)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Filter by name' },
      type: { type: 'string', description: 'Filter by type (e.g., technology, person)' },
      limit: { type: 'number', description: 'Max results', default: 50 }
    }
  }
}, async (params) => {
  const results = await this.graphEngine.getEntities({
    query: params.query,
    type: params.type,
    limit: params.limit || 50
  });
  return { results };
});

// Tool 4: Get backlinks
this.server.addTool({
  name: 'erfana_graph_backlinks',
  description: 'Get backlinks for an entity',
  inputSchema: {
    type: 'object',
    properties: {
      entityName: { type: 'string', description: 'Entity name (e.g., "SQLite")' },
      limit: { type: 'number', description: 'Max results', default: 50 }
    },
    required: ['entityName']
  }
}, async (params) => {
  const results = await this.graphEngine.getBacklinks({
    entityName: params.entityName,
    limit: params.limit || 50
  });
  return { results };
});
```

### M3 Completion Checklist

**Core Functionality:**
- [ ] Entity extraction working (wikilinks, tags, mentions)
- [ ] Entities and mentions stored in DB
- [ ] Backlinks API returns correct results

**UI Components:**
- [ ] Knowledge Panel shows entities
- [ ] Click entity → backlinks populate

**MCP Server:**
- [ ] `erfana_graph_entities` tool accessible from Claude Code
- [ ] `erfana_graph_backlinks` tool accessible from Claude Code

**Manual Tests:**
- [ ] Add `[[SQLite]]` → see backlinks in Knowledge Panel
- [ ] Claude Code: `erfana_graph_entities({ type: 'technology' })` → get entities
- [ ] Claude Code: `erfana_graph_backlinks({ entityName: 'SQLite' })` → get backlinks

---

## Milestone 4: Temporal Features (Time-Aware Queries)

**Goal:** Enable "as-of" queries and change timelines.

**Duration:** 2-3 weeks

### Tasks

#### 4.1 Add Temporal Fields

**Already in schema:**
- `edges.valid_from`
- `edges.valid_to`
- `edges.tx_time`

#### 4.2 Edge Management

**File:** `src/main/services/EdgeService.ts`

```typescript
export class EdgeService {
  createEdge(srcId: number, dstId: number, type: string, validFrom: number): void {
    this.db.db.prepare(`
      INSERT INTO edges (src_id, dst_id, type, valid_from, tx_time)
      VALUES (?, ?, ?, ?, ?)
    `).run(srcId, dstId, type, validFrom, Date.now());
  }

  closeEdge(edgeId: number, validTo: number): void {
    this.db.db.prepare(`
      UPDATE edges SET valid_to = ? WHERE id = ?
    `).run(validTo, edgeId);
  }
}
```

#### 4.3 As-Of Query API

**Update:** `GraphService.ts`

```typescript
getEdgesAsOf(asOf: number): Edge[] {
  return this.db.db.prepare(`
    SELECT
      src.name AS from_entity,
      edge.type,
      dst.name AS to_entity
    FROM edges edge
    JOIN entities src ON src.id = edge.src_id
    JOIN entities dst ON dst.id = edge.dst_id
    WHERE edge.valid_from <= ?
      AND (edge.valid_to IS NULL OR edge.valid_to > ?)
  `).all(asOf, asOf);
}
```

#### 4.4 Timeline UI

**File:** `src/renderer/src/components/Timeline/TimelineSlider.tsx`

**Features:**
- Date slider (project start → today)
- Show change events (edges added/closed)
- Re-run search with `asOf` filter

#### 4.5 MCP Server Updates

**Update:** `src/main/services/MCPServerService.ts`

**Add final MCP tool:**

```typescript
// Tool 5: Timeline queries
this.server.addTool({
  name: 'erfana_graph_timeline',
  description: 'Get temporal timeline for entity or file',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: { type: 'number', description: 'Entity ID (optional)' },
      fileId: { type: 'number', description: 'File ID (optional)' },
      asOf: { type: 'number', description: 'Unix timestamp for "as-of" query (optional)' }
    }
  }
}, async (params) => {
  const results = await this.graphEngine.getTimeline({
    entityId: params.entityId,
    fileId: params.fileId,
    asOf: params.asOf
  });
  return { results };
});
```

**All 5 MCP Tools Now Available:**
1. `erfana_graph_search` - Hybrid search (M1)
2. `erfana_graph_related` - Related sections (M2)
3. `erfana_graph_entities` - List entities (M3)
4. `erfana_graph_backlinks` - Entity backlinks (M3)
5. `erfana_graph_timeline` - Temporal queries (M4)

### M4 Completion Checklist

**Core Functionality:**
- [ ] Edges have valid_from/valid_to/tx_time
- [ ] As-of queries work

**UI Components:**
- [ ] Timeline slider functional

**MCP Server:**
- [ ] `erfana_graph_timeline` tool accessible from Claude Code
- [ ] All 5 MCP tools tested and working

**Manual Tests:**
- [ ] Create edge → close edge → query past date → see old edge
- [ ] Claude Code: `erfana_graph_timeline({ entityId: 5, asOf: Date.parse('2024-03-01') })` → get timeline

---

## Milestone 5: Advanced Features (Polish & Maintenance)

**Goal:** Production-ready polish and maintenance features.

**Duration:** 2-3 weeks

### Tasks

#### 5.1 Mermaid Graph Visualization

**Feature:** Generate Mermaid diagram for entity neighborhood.

**Code:**

```typescript
generateMermaidGraph(entityName: string, hops: number = 2): string {
  const neighbors = this.getNeighborhood(entityName, hops);

  let mermaid = 'graph TD
';
  for (const edge of neighbors) {
    mermaid += `  ${edge.src}[${edge.srcName}] -->|${edge.type}| ${edge.dst}[${edge.dstName}]
`;
  }

  return mermaid;
}
```

**Insert into editor:**

```tsx
const insertGraph = () => {
  const mermaid = await window.api.graph.generateMermaid('SQLite', 2);
  monaco.editor.executeEdits('insert-graph', [{
    range: currentSelection,
    text: `\`\`\`mermaid
${mermaid}
\`\`\``
  }]);
};
```

#### 5.2 Reindex/Reembed UX

**Feature:** Background job with progress UI.

**File:** `src/main/services/ReindexService.ts`

```typescript
export class ReindexService {
  async reindexAll(onProgress: (progress: number) => void): Promise<void> {
    const files = this.db.getAllFiles();

    for (let i = 0; i < files.length; i++) {
      await this.indexingService.indexFile(files[i].path);
      onProgress((i + 1) / files.length);
    }
  }
}
```

**UI:** Progress bar in settings panel.

#### 5.3 Binary Quantization (Optional)

**If corpus > 500K docs:** Implement binary quantization (see [vector-search.md](./vector-search.md)).

#### 5.4 Monitoring & Health Checks

**File:** `src/main/services/HealthCheckService.ts`

```typescript
export class HealthCheckService {
  checkHealth(): HealthStatus {
    return {
      db: this.checkDatabase(),
      workers: this.checkWorkers(),
      diskSpace: this.checkDiskSpace()
    };
  }

  private checkDatabase(): { ok: boolean; size: number } {
    const result = this.db.db.prepare(`
      SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()
    `).get();

    return { ok: true, size: result.size };
  }
}
```

### M5 Completion Checklist

- [ ] Mermaid graph generation works
- [ ] Reindex UX with progress bar
- [ ] Health check API operational
- [ ] Documentation updated
- [ ] Performance profiled and optimized

---

## Code Structure

```
src/main/
├── services/
│   ├── GraphDatabaseService.ts      # SQLite wrapper
│   ├── GraphEngineService.ts        # Main orchestrator + event subscriber
│   ├── IndexingService.ts           # File → sections pipeline
│   ├── TextPreprocessor.ts          # Markdown → normalized text
│   ├── SearchService.ts             # BM25 + vector + hybrid
│   ├── EmbeddingService.ts          # Chunking + batching
│   ├── EmbedderWorkerPool.ts        # Worker pool manager
│   ├── EntityExtractor.ts           # Rule-based entity extraction
│   ├── EntityService.ts             # Entity CRUD
│   ├── EdgeService.ts               # Edge CRUD (temporal)
│   ├── GraphService.ts              # Backlinks, impact, as-of queries
│   └── MCPServerService.ts          # MCP server for Claude Code (M1+)
├── workers/
│   └── embedder.worker.ts           # ONNX embedding worker
├── db/
│   └── schema.sql                   # DDL (data-model.md)
└── ipc/
    └── graph-handlers.ts            # IPC handlers

src/renderer/src/
├── components/
│   ├── Panels/
│   │   ├── RelatedSidebar.tsx       # Research assistant (M1)
│   │   ├── GlobalSearch.tsx         # Project-wide search (M1)
│   │   └── GraphPanel.tsx           # Entity backlinks (M3)
│   ├── GraphSettings/
│   │   ├── SettingsPanel.tsx        # Reindex button (M1)
│   │   └── WeightTuner.tsx          # Hybrid weights (M2)
│   ├── StatusBar/
│   │   └── GraphStatus.tsx          # Indexing progress (M1)
│   └── Timeline/
│       └── TimelineSlider.tsx       # Temporal queries (M4)
└── stores/
    └── useGraphStore.ts             # Zustand store for settings
```

**Key Integration Points:**
- `GraphEngineService` subscribes to FileWatcherService events via EventEmitter
- `MCPServerService` exposes GraphEngineService data to Claude Code (stdio transport)
- All UI components call `window.api.graph.*` IPC methods
- Status indicator listens to `graph:indexing:*` events for real-time updates

---

## Testing Strategy

### Unit Tests (Vitest)

**Test files:**
- `TextPreprocessor.test.ts`
- `EntityExtractor.test.ts`
- `VectorNormalization.test.ts`

**Example:**

```typescript
describe('TextPreprocessor', () => {
  it('should strip markdown syntax', () => {
    const input = '## Heading

This is **bold**.';
    const output = TextPreprocessor.normalize(input);
    expect(output).toBe('Heading

This is bold.');
  });
});
```

### Integration Tests

**Test files:**
- `IndexingPipeline.test.ts`
- `HybridSearch.test.ts`

**Example:**

```typescript
describe('Indexing Pipeline', () => {
  it('should index file and return search results', async () => {
    const indexingService = new IndexingService(db);
    indexingService.indexFile('test/fixtures/sample.md');

    const searchService = new SearchService(db);
    const results = searchService.search('test query', 10);

    expect(results.length).toBeGreaterThan(0);
  });
});
```

### E2E Tests (Manual for M1-M3, Playwright for M4+)

**Scenarios:**
1. Open project → edit file → save → see Related Sidebar update
2. Search in global search → verify hybrid ranking
3. Click entity in Knowledge Panel → see backlinks
4. Move timeline slider → verify as-of query results

---

## Migration Path

### From M1 to M2 (Adding Embeddings)

**Steps:**

1. Run schema migration (add `embeddings`, `vss_sections`)
2. Reindex all files (background job with progress)
3. Verify: `SELECT COUNT(*) FROM embeddings` matches `SELECT COUNT(*) FROM sections`

### From M2 to M3 (Adding Entities)

**Steps:**

1. Run schema migration (add `entities`, `edges`, `mentions`)
2. Reindex all files (extract entities)
3. Verify: `SELECT COUNT(*) FROM entities` > 0

### Switching Embedding Models

**Steps:**

1. Update `meta` table: `UPDATE meta SET value = 'new-model-id' WHERE key = 'embedder_id'`
2. Delete old embeddings: `DELETE FROM embeddings WHERE embedder_id != 'new-model-id'`
3. Reembed all sections (background job)

---

**Related:**
- [User Guide](./user-guide.md) - Learn what the graph engine does and how to use it
- [Data Ingestion](./data-ingestion.md) - How files are discovered and indexed
- [MCP Server](./mcp-server.md) - Claude Code integration details
- [Architecture](./architecture.md) - System design overview
- [Data Model](./data-model.md) - Schema reference
- [Packaging](./packaging.md) - Electron build configuration
- [Production Readiness](./production-readiness.md) - Pre-deployment checklist
