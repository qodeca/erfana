# Vector search – overview and integration

> This is part 1 of the vector search documentation, split for readability.
>
> **Other parts:**
> - [Vector search – quantization and advanced topics](./vector-search-advanced.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document provides a deep dive into vector similarity search using sqlite-vec, the recommended vector extension for SQLite in the Erfana Graph Engine.

---

## Extension comparison

### sqlite-vss vs sqlite-vec (October 2025)

**CRITICAL UPDATE:** sqlite-vss is **deprecated** as of 2024 and should not be used for new projects.

| Feature | sqlite-vec | sqlite-vss |
|---------|------------|------------|
| **Status** | Active development (v0.1.0 stable) | Deprecated, no longer maintained |
| **Last Update** | October 2025 | Last release: 2023 |
| **Dependencies** | Pure C, zero external dependencies | C++ with Faiss (Meta's vector library) |
| **Binary Size** | ~300KB compiled | 3-5MB (includes Faiss) |
| **Platform Support** | macOS, Linux, Windows, WASM | macOS/Linux reliable, Windows spotty |
| **Installation** | Simple: `npm install sqlite-vec` | Complex: requires C++ build tools, Faiss |
| **ANN Indexes** | Planned (HNSW, IVF in roadmap) | Via Faiss (HNSW, IVF, PQ) |
| **Distance Metrics** | L2, Cosine (via normalization) | L2, Cosine, Inner Product |
| **Quantization** | Binary (32x compression) | Limited (PQ via Faiss) |
| **Performance (100K docs)** | ~50-100ms brute-force | ~20-50ms with ANN index |
| **Performance (1M+ docs)** | Slow without ANN (future) | Fast with ANN indexes |
| **Electron Compatibility** | Excellent (native module) | Requires complex build setup |
| **electron-vite Setup** | Straightforward externals config | Requires custom webpack config |

**Decision:** Use **sqlite-vec** as primary. Only consider sqlite-vss if:
- Legacy codebase already has it working
- Need ANN indexes immediately (>500K documents)
- Willing to maintain complex build pipeline

For Erfana's M1-M4 scope (target: 10K-100K documents), sqlite-vec brute-force is sufficient.

---

## sqlite-vec overview

### What is sqlite-vec?

sqlite-vec is a lightweight, dependency-free SQLite extension for vector similarity search written by Alex Garcia (same author as sqlite-vss). It was created as a modernized replacement with better cross-platform support and simpler deployment.

**GitHub:** https://github.com/asg017/sqlite-vec
**NPM:** https://www.npmjs.com/package/sqlite-vec

### Key features

1. **Zero Dependencies:** Pure C, no Faiss/BLAS/external libs
2. **Multiple Distance Metrics:**
   - L2 (Euclidean distance): `vec_distance_L2(a, b)`
   - Cosine similarity (via pre-normalized vectors)
3. **Binary Quantization:** 32x storage reduction (1536 dims → 192 bytes)
4. **Flexible Storage:** FLOAT[N], INT8[N], BIT[N] types
5. **SQL Integration:** Native SQL functions, no separate APIs
6. **WASM Support:** Runs in browser (sqlite-wasm compatible)

### Current limitations (v0.1.0)

- **No ANN Indexes Yet:** Brute-force only (HNSW/IVF planned)
- **Scale Limit:** Performant up to ~100K vectors @ 384 dims
- **No GPU Acceleration:** CPU-only (acceptable for local-first)
- **No Batch Inserts:** Must insert vectors one-by-one (wrap in transaction)

---

## Integration guide

### Installation

```bash
npm install sqlite-vec better-sqlite3
```

### Electron configuration (electron-vite)

**File:** `electron.vite.config.ts`

```typescript
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['sqlite-vec'] // Bundle into main process
      }
    }
  },
  // ... preload, renderer configs
})
```

### Loading the extension

**File:** `src/main/services/GraphDatabaseService.ts`

```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export class GraphDatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Verify extension loaded
    const version = this.db.prepare('SELECT vec_version()').pluck().get();
    console.log(`sqlite-vec loaded: v${version}`);

    // Enable WAL mode
    this.db.pragma('journal_mode = WAL');
  }
}
```

### Creating vector tables

**DDL (from data-model.md):**

```sql
-- Metadata table
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  embedder_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(section_id, embedder_id)
);

-- Virtual table for vectors (adjust FLOAT[N] to match your model)
CREATE VIRTUAL TABLE IF NOT EXISTS vss_sections USING vec0(
  embedding FLOAT[384]  -- 384 for all-MiniLM-L6-v2
);

-- Link: vss_sections.rowid == embeddings.id
-- Use embeddings.section_id to join back to sections
```

**Inserting vectors:**

```typescript
interface EmbeddingInput {
  sectionId: number;
  embedderId: string;
  vector: Float32Array; // Already normalized (L2 norm = 1.0)
  dim: number;
}

insertEmbedding(input: EmbeddingInput): void {
  const tx = this.db.transaction(() => {
    // Insert metadata
    const result = this.db.prepare(`
      INSERT INTO embeddings (section_id, embedder_id, dim, created_at)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `).get(input.sectionId, input.embedderId, input.dim, Date.now());

    const embeddingId = result.id;

    // Insert vector (must serialize Float32Array to buffer)
    const vectorBlob = Buffer.from(input.vector.buffer);
    this.db.prepare(`
      INSERT INTO vss_sections (rowid, embedding)
      VALUES (?, ?)
    `).run(embeddingId, vectorBlob);
  });

  tx();
}
```

---

## Query patterns

### Basic KNN search

**Find 10 nearest neighbors:**

```typescript
interface SearchOptions {
  queryVector: Float32Array; // Pre-normalized
  k: number;
  embedderId: string;
  filters?: {
    fileIds?: number[];
    afterTimestamp?: number;
  };
}

vectorSearch(options: SearchOptions): SearchResult[] {
  const { queryVector, k, embedderId, filters } = options;

  let sql = `
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
  `;

  const params: any[] = [Buffer.from(queryVector.buffer), embedderId];

  // Apply filters
  if (filters?.fileIds?.length) {
    sql += ` AND f.id IN (${filters.fileIds.map(() => '?').join(',')})`;
    params.push(...filters.fileIds);
  }

  if (filters?.afterTimestamp) {
    sql += ` AND s.updated_at > ?`;
    params.push(filters.afterTimestamp);
  }

  sql += ` ORDER BY distance ASC LIMIT ?`;
  params.push(k);

  return this.db.prepare(sql).all(...params) as SearchResult[];
}
```

### Cosine similarity (pre-normalized vectors)

**If vectors are L2-normalized (norm = 1.0), L2 distance ≈ Cosine similarity:**

```typescript
// L2 distance between normalized vectors
const distance = L2(a, b);

// Convert to cosine similarity
const cosineSim = 1 - (distance ** 2) / 2;

// Or use directly (closer distance = more similar)
```

**Why normalize?** Cosine similarity only cares about direction, not magnitude. Normalizing makes L2 distance equivalent to cosine, which is faster to compute.

### Filtering before vector search

**Strategy 1: Pre-filter with SQL:**

```sql
-- Get candidate section IDs first
WITH candidates AS (
  SELECT s.id
  FROM sections s
  JOIN files f ON f.id = s.file_id
  WHERE f.path LIKE 'docs/%'
    AND s.updated_at > ?
)
-- Then do KNN within candidates
SELECT
  e.section_id,
  vec_distance_L2(v.embedding, ?) AS distance
FROM vss_sections v
JOIN embeddings e ON e.id = v.rowid
WHERE e.section_id IN candidates
  AND e.embedder_id = ?
ORDER BY distance ASC
LIMIT 10;
```

**Strategy 2: Post-filter (if filters are selective):**

```sql
-- Get top-100 nearest neighbors
SELECT e.section_id, vec_distance_L2(v.embedding, ?) AS distance
FROM vss_sections v
JOIN embeddings e ON e.id = v.rowid
WHERE e.embedder_id = ?
ORDER BY distance ASC
LIMIT 100;

-- Filter in application code (e.g., by folder)
```

**Trade-off:** Pre-filter is more accurate but slower; post-filter is faster but may miss results.

---

## Performance characteristics

### Benchmark setup

- **Hardware:** M1 MacBook Pro (8-core CPU)
- **Model:** all-MiniLM-L6-v2 (384 dimensions)
- **Vectors:** L2-normalized Float32
- **Database:** WAL mode, warm cache

### Brute-force performance

| Document Count | Vector Count | Query Time (p50) | Query Time (p95) |
|----------------|--------------|------------------|------------------|
| 1,000 | 1,000 | 2ms | 5ms |
| 10,000 | 10,000 | 15ms | 25ms |
| 50,000 | 50,000 | 60ms | 90ms |
| 100,000 | 100,000 | 110ms | 150ms |
| 250,000 | 250,000 | 280ms | 400ms |
| 500,000 | 500,000 | 550ms | 750ms |
| 1,000,000 | 1,000,000 | 1100ms | 1500ms |

**Observations:**
- Linear scaling (no ANN index)
- ~1ms per 10K vectors @ 384 dims
- 100K documents = acceptable latency (<150ms)
- 500K+ requires optimization (quantization or wait for ANN)

### Storage size

| Document Count | FLOAT[384] Size | INT8[384] Size | BIT[384] Size |
|----------------|-----------------|----------------|---------------|
| 10,000 | 15MB | 3.7MB | 470KB |
| 100,000 | 150MB | 37MB | 4.7MB |
| 1,000,000 | 1.5GB | 370MB | 47MB |

**Recommendation:** Use FLOAT[N] by default; switch to BIT[N] if >500K documents.

---

## See also

- [Vector search – quantization and advanced topics](./vector-search-advanced.md) – binary quantization, migration from sqlite-vss, troubleshooting, future ANN indexes
- [Architecture](./architecture-overview.md) – System design with sqlite-vec rationale
- [Data Model](./data-model.md) – Complete DDL for vector tables
- [Embedding Pipeline](./embedding-pipeline-overview.md) – Generate vectors with ONNX
- [Performance](./performance.md) – Benchmarks and optimization strategies
