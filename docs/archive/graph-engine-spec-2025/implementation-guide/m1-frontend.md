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

