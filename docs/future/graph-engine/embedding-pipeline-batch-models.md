# Embedding pipeline – batch processing and models

> This is part 3 of the embedding pipeline documentation, split for readability.
>
> **Other parts:**
> - [Embedding pipeline – overview and preprocessing](./embedding-pipeline-overview.md)
> - [Embedding pipeline – ONNX and workers](./embedding-pipeline-onnx-workers.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Batch processing

### Why batching?

- **Throughput:** Process 32-128 chunks in one ONNX call (~50ms) vs 32-128 calls (~1.5s)
- **GPU Efficiency:** (if available) GPUs prefer larger batches

### Optimal batch size

| Model | Batch Size | Throughput (chunks/sec) | Memory |
|-------|-----------|-------------------------|--------|
| all-MiniLM-L6-v2 | 1 | 65 | 50MB |
| all-MiniLM-L6-v2 | 16 | 600 | 150MB |
| all-MiniLM-L6-v2 | 32 | 900 | 250MB |
| all-MiniLM-L6-v2 | 64 | 1100 | 450MB |
| all-MiniLM-L6-v2 | 128 | 1200 | 850MB |

**Recommendation:** Batch size 32-64 (diminishing returns beyond 64).

### Batching implementation

**File:** `src/main/services/EmbeddingService.ts`

```typescript
export class EmbeddingService {
  constructor(
    private workerPool: EmbedderWorkerPool,
    private db: Database.Database,
    private batchSize: number = 32
  ) {}

  /**
   * Embed all chunks for a file (batched)
   */
  async embedFile(fileId: number, chunks: Chunk[]): Promise<void> {
    // Process in batches
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map(c => c.text);

      // Embed batch (parallel across workers)
      const embeddings = await this.workerPool.embed(texts);

      // Normalize + store
      const normalized = embeddings.map(e => this.normalize(e));

      this.storeBatch(fileId, batch, normalized);
    }
  }

  private storeBatch(
    fileId: number,
    chunks: Chunk[],
    embeddings: Float32Array[]
  ): void {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        // Insert section
        const sectionResult = this.db.prepare(`
          INSERT INTO sections (file_id, text, text_hash, token_count, updated_at)
          VALUES (?, ?, ?, ?, ?)
          RETURNING id
        `).get(
          fileId,
          chunks[i].text,
          crypto.createHash('sha256').update(chunks[i].text).digest('hex'),
          chunks[i].tokenCount,
          Date.now()
        );

        const sectionId = sectionResult.id;

        // Insert embedding metadata
        const embeddingResult = this.db.prepare(`
          INSERT INTO embeddings (section_id, embedder_id, dim, created_at)
          VALUES (?, ?, ?, ?)
          RETURNING id
        `).get(sectionId, 'all-MiniLM-L6-v2:v1.0', 384, Date.now());

        // Insert vector
        const vectorBlob = Buffer.from(embeddings[i].buffer);
        this.db.prepare(`
          INSERT INTO vss_sections (rowid, embedding)
          VALUES (?, ?)
        `).run(embeddingResult.id, vectorBlob);
      }
    });

    tx();
  }
}
```

---

## Vector normalization

### Why normalize?

**L2 distance ≈ Cosine similarity** for normalized vectors:

```
cosine(a, b) = dot(a, b) / (||a|| * ||b||)

If ||a|| = ||b|| = 1 (normalized), then:
cosine(a, b) = dot(a, b)

L2(a, b)² = ||a - b||² = ||a||² + ||b||² - 2*dot(a, b)
                        = 1 + 1 - 2*dot(a, b)  (if normalized)
                        = 2 - 2*cosine(a, b)

Therefore: cosine(a, b) = 1 - L2(a, b)² / 2
```

**Benefit:** L2 distance is faster to compute than cosine (no division).

### Implementation

```typescript
function normalize(vector: Float32Array): Float32Array {
  // Compute L2 norm
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  // Divide by norm (avoid division by zero)
  if (norm < 1e-12) {
    console.warn('Zero vector detected, skipping normalization');
    return vector;
  }

  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }

  return normalized;
}
```

**Validation:**

```typescript
const normalized = normalize(rawEmbedding);

// Check norm = 1.0 (within floating-point precision)
let norm = 0;
for (let i = 0; i < normalized.length; i++) {
  norm += normalized[i] * normalized[i];
}
norm = Math.sqrt(norm);

console.assert(Math.abs(norm - 1.0) < 1e-6, 'Vector not normalized');
```

---

## Error handling & recovery

### Worker crashes

**Symptom:** Worker exits unexpectedly (code 134 = SIGABRT on Linux).

**Cause:** onnxruntime-node bug with multiple concurrent sessions.

**Recovery:**

```typescript
private handleWorkerExit(worker: Worker, code: number): void {
  if (code !== 0) {
    console.error(`Worker crashed with code ${code}`);

    // Remove from pool
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);

    // Restart worker
    this.spawnWorker();

    // Retry pending requests (idempotent)
    this.retryPendingRequests();
  }
}

private retryPendingRequests(): void {
  const requests = Array.from(this.pendingRequests.values());
  this.pendingRequests.clear();

  for (const req of requests) {
    this.queue.unshift(req); // Retry at front of queue
  }
}
```

### Model load failures

**Symptom:** `Error: Cannot find module 'model.onnx'`

**Cause:** Model file not packaged in Electron app bundle.

**Fix (electron-vite):**

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['onnxruntime-node'],
        // Copy models to output
        plugins: [
          {
            name: 'copy-models',
            writeBundle() {
              fs.cpSync('resources/models', 'out/main/models', { recursive: true });
            }
          }
        ]
      }
    }
  }
});
```

---

## Model selection

### Comparison table (October 2025)

| Model | Dims | Params | Size | Speed (1K tokens) | Quality (MTEB) |
|-------|------|--------|------|-------------------|----------------|
| **all-MiniLM-L6-v2** | 384 | 22M | 80MB | 14.7ms | 56.3 |
| bge-micro-v2 | 384 | 17M | 62MB | 12.1ms | 58.7 |
| all-MiniLM-L12-v2 | 384 | 33M | 120MB | 22.4ms | 59.8 |
| bge-small-en-v1.5 | 384 | 33M | 130MB | 23.1ms | 62.1 |
| all-mpnet-base-v2 | 768 | 110M | 420MB | 47.2ms | 63.3 |
| bge-base-en-v1.5 | 768 | 109M | 440MB | 48.6ms | 63.6 |

**Recommendation:** **all-MiniLM-L6-v2** for default (good balance of speed/quality).

### When to use alternatives

- **bge-micro-v2:** If speed is critical (2ms faster, +2.4 quality)
- **all-mpnet-base-v2:** If quality is critical (768 dims, 3x slower)
- **Multilingual:** Use `paraphrase-multilingual-MiniLM-L12-v2` or `bge-m3`

---

## See also

- [Embedding pipeline – overview and preprocessing](./embedding-pipeline-overview.md) – pipeline overview, text preprocessing, tokenization, chunking
- [Embedding pipeline – ONNX and workers](./embedding-pipeline-onnx-workers.md) – ONNX Runtime integration, worker thread architecture
- [Architecture](./architecture-overview.md) – Worker thread design rationale
- [Vector Search](./vector-search-overview.md) – Storage and querying embeddings
- [Data Model](./data-model.md) – Schema for embeddings and vss_sections
- [Performance](./performance.md) – Benchmarks and optimization
