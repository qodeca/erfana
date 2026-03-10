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

**If corpus > 500K docs:** Implement binary quantization (see [vector-search-advanced.md](./vector-search-advanced.md)).

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
- [User Guide](./user-guide-features.md) - Learn what the graph engine does and how to use it
- [Data Ingestion](./data-ingestion-discovery.md) - How files are discovered and indexed
- [MCP Server](./mcp-server-tools.md) - Claude Code integration details
- [Architecture](./architecture-overview.md) - System design overview
- [Data Model](./data-model.md) - Schema reference
- [Packaging](./packaging.md) - Electron build configuration
- [Production Readiness](./production-readiness-checklist.md) - Pre-deployment checklist
