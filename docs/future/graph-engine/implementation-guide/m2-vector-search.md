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

**Implementation:** See [embedding-pipeline-overview.md](./embedding-pipeline-overview.md) for full code.

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

**Implementation:** See [embedding-pipeline-overview.md](./embedding-pipeline-overview.md).

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

**Implementation:** See [hybrid-search-fundamentals.md](./hybrid-search-fundamentals.md) for score fusion logic.

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

