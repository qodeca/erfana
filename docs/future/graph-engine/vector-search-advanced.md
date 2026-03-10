# Vector search – quantization and advanced topics

> This is part 2 of the vector search documentation, split for readability.
>
> **Other parts:**
> - [Vector search – overview and integration](./vector-search-overview.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Binary quantization

### What is binary quantization?

Convert float32 vectors → 1-bit per dimension:
- **Storage:** 384 dims x 32 bits → 384 bits (48 bytes)
- **Compression:** 32x smaller (1536 bytes → 48 bytes)
- **Accuracy:** ~95% recall @ k=10 (validated on BEIR benchmarks)

### How it works

```typescript
function quantizeToBinary(vector: Float32Array): Uint8Array {
  const bits = new Uint8Array(Math.ceil(vector.length / 8));

  for (let i = 0; i < vector.length; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;

    // Set bit if dimension > 0
    if (vector[i] > 0) {
      bits[byteIdx] |= (1 << bitIdx);
    }
  }

  return bits;
}
```

### sqlite-vec binary vectors

**Create binary vector table:**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vss_sections_binary USING vec0(
  embedding BIT[384]  -- 48 bytes per vector
);
```

**Insert binary vectors:**

```typescript
insertBinaryEmbedding(sectionId: number, vector: Float32Array): void {
  const binary = quantizeToBinary(vector);

  const tx = this.db.transaction(() => {
    const result = this.db.prepare(`
      INSERT INTO embeddings (section_id, embedder_id, dim, created_at)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `).get(sectionId, 'all-MiniLM-L6-v2:v1.0-binary', 384, Date.now());

    this.db.prepare(`
      INSERT INTO vss_sections_binary (rowid, embedding)
      VALUES (?, ?)
    `).run(result.id, binary);
  });

  tx();
}
```

**Query binary vectors (Hamming distance):**

```sql
SELECT
  e.section_id,
  vec_distance_hamming(v.embedding, ?) AS hamming_dist
FROM vss_sections_binary v
JOIN embeddings e ON e.id = v.rowid
WHERE e.embedder_id LIKE '%-binary'
ORDER BY hamming_dist ASC
LIMIT 10;
```

### When to use binary quantization

**Use if:**
- Document count > 500K
- Storage constraints (mobile, edge devices)
- Query latency > 500ms with float vectors

**Don't use if:**
- Document count < 100K (negligible benefit)
- Need highest accuracy (binary loses ~5% recall)
- Have fast SSD and plenty of RAM

### Hybrid approach (re-ranking)

**Best of both worlds:**

1. **Stage 1:** Binary search (retrieve top-100 candidates, ~fast)
2. **Stage 2:** Full-precision re-rank (score top-100 with float vectors)

```typescript
hybridVectorSearch(queryVector: Float32Array, k: number): SearchResult[] {
  // Step 1: Binary search for candidates
  const binaryQuery = quantizeToBinary(queryVector);
  const candidates = this.db.prepare(`
    SELECT e.section_id, e.id AS embedding_id
    FROM vss_sections_binary v
    JOIN embeddings e ON e.id = v.rowid
    WHERE e.embedder_id LIKE '%-binary'
    ORDER BY vec_distance_hamming(v.embedding, ?) ASC
    LIMIT 100
  `).all(binaryQuery);

  // Step 2: Re-rank with full precision
  const candidateIds = candidates.map(c => c.embedding_id);
  const results = this.db.prepare(`
    SELECT
      e.section_id,
      s.text,
      vec_distance_L2(v.embedding, ?) AS distance
    FROM vss_sections v
    JOIN embeddings e ON e.id = v.rowid
    JOIN sections s ON s.id = e.section_id
    WHERE e.id IN (${candidateIds.map(() => '?').join(',')})
    ORDER BY distance ASC
    LIMIT ?
  `).all(Buffer.from(queryVector.buffer), ...candidateIds, k);

  return results;
}
```

**Performance:** 100K docs → ~30ms (binary) + 2ms (re-rank) = 32ms total (vs 110ms brute-force).

---

## Migration from sqlite-vss

If you have an existing sqlite-vss deployment and need to migrate:

### Step 1: Dump existing vectors

```typescript
// Export vectors from sqlite-vss
const vectors = oldDb.prepare(`
  SELECT
    vss.rowid,
    vss.embedding,
    meta.section_id,
    meta.embedder_id
  FROM vss_sections vss
  JOIN embeddings meta ON meta.id = vss.rowid
`).all();

// Write to JSON for migration
fs.writeFileSync('vectors-export.json', JSON.stringify(vectors));
```

### Step 2: Create new sqlite-vec database

```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const newDb = new Database('erfana-new.db');
sqliteVec.load(newDb);

// Run DDL from data-model.md
newDb.exec(/* CREATE TABLE statements */);
```

### Step 3: Import vectors

```typescript
const vectors = JSON.parse(fs.readFileSync('vectors-export.json', 'utf-8'));

const insertTx = newDb.transaction(() => {
  for (const vec of vectors) {
    // Insert metadata
    const result = newDb.prepare(`
      INSERT INTO embeddings (section_id, embedder_id, dim, created_at)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `).get(vec.section_id, vec.embedder_id, 384, Date.now());

    // Insert vector
    newDb.prepare(`
      INSERT INTO vss_sections (rowid, embedding)
      VALUES (?, ?)
    `).run(result.id, vec.embedding);
  }
});

insertTx();
```

### Step 4: Validate

```typescript
// Count vectors in both databases
const oldCount = oldDb.prepare('SELECT COUNT(*) FROM vss_sections').pluck().get();
const newCount = newDb.prepare('SELECT COUNT(*) FROM vss_sections').pluck().get();

console.log(`Migration complete: ${oldCount} -> ${newCount} vectors`);

// Spot-check random query
const testVector = /* get a known vector */;
const oldResults = /* query old db */;
const newResults = /* query new db */;

// Compare top-10 results (should be ~95% overlap)
```

---

## Troubleshooting

### Error: "no such module: vec0"

**Cause:** sqlite-vec extension not loaded.

**Fix:**

```typescript
import * as sqliteVec from 'sqlite-vec';
sqliteVec.load(db); // Call BEFORE creating virtual tables
```

### Error: "wrong number of columns"

**Cause:** Mismatch between vector dimension and table definition.

**Example:**
```sql
CREATE VIRTUAL TABLE vss USING vec0(embedding FLOAT[384]); -- Expects 384 dims
-- But inserting 768-dim vector results in error
```

**Fix:** Match table definition to model output:
- all-MiniLM-L6-v2: 384
- bge-base-en: 768
- text-embedding-3-small (OpenAI): 1536

### Slow queries (>1s)

**Diagnosis:**

```typescript
const explain = db.prepare(`
  EXPLAIN QUERY PLAN
  SELECT vec_distance_L2(embedding, ?) FROM vss_sections
  ORDER BY distance LIMIT 10
`).all(queryVector);

console.log(explain);
```

**Possible causes:**
1. **Too many vectors:** >500K requires quantization or ANN (future)
2. **Cold cache:** First query after startup is slow (warm up with dummy query)
3. **Slow storage:** SSD recommended (HDD adds 50-100ms)

**Mitigation:**
- Limit corpus size (filter by date/folder)
- Use binary quantization
- Pre-warm cache on startup

### Memory usage spikes

**Cause:** SQLite loads entire vector table into memory during search.

**Calculation:** 100K vectors x 384 dims x 4 bytes = 150MB

**Fix:**
- Monitor with `process.memoryUsage()` in Electron main process
- Set `PRAGMA cache_size = -64000` (64MB cache limit)
- Use binary quantization (32x smaller)

---

## Future: ANN indexes

sqlite-vec roadmap (estimated 2026+):

### HNSW (Hierarchical navigable small worlds)

- **Speed:** Sub-10ms for 1M+ vectors
- **Accuracy:** >95% recall @ k=10
- **Build Time:** Minutes for 1M vectors
- **Memory:** 2-4x vector size

### IVF (Inverted file index)

- **Speed:** 10-50ms for 1M+ vectors
- **Accuracy:** >90% recall @ k=10
- **Build Time:** Faster than HNSW
- **Memory:** 1.5-2x vector size

**When available**, update DDL:

```sql
CREATE VIRTUAL TABLE vss_sections USING vec0(
  embedding FLOAT[384],
  +index hnsw(m=16, ef_construction=200)  -- HNSW index
);
```

Until then, stick with brute-force + binary quantization for >500K documents.

---

## See also

- [Vector search – overview and integration](./vector-search-overview.md) – extension comparison, integration guide, query patterns, performance
- [Architecture](./architecture-overview.md) – System design with sqlite-vec rationale
- [Data Model](./data-model.md) – Complete DDL for vector tables
- [Embedding Pipeline](./embedding-pipeline-overview.md) – Generate vectors with ONNX
- [Performance](./performance.md) – Benchmarks and optimization strategies
