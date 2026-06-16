# Production readiness – checklist and limitations

> This is part 1 of the production readiness documentation, split for readability.
>
> **Other parts:**
> - [Production readiness – monitoring and deployment](./production-readiness-operations.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document provides a pre-deployment checklist and validation guide for the Erfana Graph Engine before releasing to production.

---

## Pre-deployment checklist

### 1. Database & schema

- [ ] Schema version tracked in `meta` table
- [ ] Migrations tested (upgrade + downgrade)
- [ ] WAL mode enabled (`PRAGMA journal_mode=WAL`)
- [ ] Integrity check passes (`PRAGMA integrity_check`)
- [ ] Index coverage verified (all foreign keys indexed)
- [ ] Database size < 2GB (or quantization enabled)

**Verification:**

```typescript
const checks = {
  walMode: db.prepare('PRAGMA journal_mode').pluck().get() === 'wal',
  integrity: db.prepare('PRAGMA integrity_check').pluck().get() === 'ok',
  size: fs.statSync('graph.db').size / (1024 ** 3) // GB
};
console.log(checks);
```

### 2. Vector search (sqlite-vec)

- [ ] sqlite-vec v0.1.0+ loaded successfully
- [ ] Extension version verified (`SELECT vec_version()`)
- [ ] Sample vector search returns results
- [ ] Distance metric correct (L2 for normalized vectors)
- [ ] Embeddings table linked to vss_sections (rowid == embeddings.id)

**Verification:**

```typescript
const version = db.prepare('SELECT vec_version()').pluck().get();
assert(version.startsWith('v0.1'), 'sqlite-vec v0.1.0+ required');

const testVec = new Float32Array(384).fill(0.1);
const results = db.prepare(`
  SELECT COUNT(*) FROM vss_sections
  WHERE vec_distance_L2(embedding, ?) < 1.0
`).pluck().get(Buffer.from(testVec.buffer));

assert(results > 0, 'Vector search returned no results');
```

### 3. Embedding pipeline

- [ ] ONNX model loaded (`all-MiniLM-L6-v2.onnx`)
- [ ] Tokenizer loaded
- [ ] Worker pool initialized (2-4 workers)
- [ ] Sample embedding generated (384 dims, L2 norm ≈ 1.0)
- [ ] Worker crash recovery tested

**Verification:**

```typescript
const workerPool = new EmbedderWorkerPool(/* config */);
await workerPool.initialize();

const embeddings = await workerPool.embed(['test text']);
assert(embeddings[0].length === 384, 'Wrong embedding dimension');

const norm = Math.sqrt(embeddings[0].reduce((sum, v) => sum + v * v, 0));
assert(Math.abs(norm - 1.0) < 0.01, 'Vector not normalized');
```

### 4. Hybrid search

- [ ] BM25 search returns results
- [ ] Vector search returns results
- [ ] Score fusion working (α + β + γ + δ = 1.0)
- [ ] Default weights set (α=0.4, β=0.6)
- [ ] Settings UI saves/loads weights correctly

**Verification:**

```typescript
const results = await searchService.hybridSearch('test query', 10);
assert(results.length > 0, 'Hybrid search returned no results');

const weights = JSON.parse(db.prepare(`
  SELECT value FROM meta WHERE key = 'hybrid_weights'
`).pluck().get());
assert(weights.alpha + weights.beta + weights.gamma + weights.delta === 1.0);
```

### 5. Graph features (M3+)

- [ ] Entity extraction working (rule-based or LLM)
- [ ] Entities and mentions stored correctly
- [ ] Backlinks API returns results
- [ ] Temporal edges (valid_from, valid_to) enforced
- [ ] As-of queries return correct historical data

**Verification:**

```typescript
const entities = db.prepare('SELECT COUNT(*) FROM entities').pluck().get();
assert(entities > 0, 'No entities extracted');

const backlinks = graphService.getBacklinks('SQLite', 10);
assert(backlinks.length > 0, 'No backlinks found');
```

### 6. Performance

- [ ] Hybrid search < 200ms @ 100K docs (P95)
- [ ] File indexing < 500ms per file (P95)
- [ ] Memory usage < 1GB (total Electron)
- [ ] Worker threads stable (no crashes during 1-hour test)
- [ ] Cold start time < 5s

**Verification:**

Run performance benchmarks (see [performance.md](./performance.md)).

### 7. Packaging

- [ ] Native modules rebuilt for Electron (`electron-rebuild`)
- [ ] better-sqlite3 works in production build
- [ ] sqlite-vec works in production build
- [ ] onnxruntime-node works in production build
- [ ] ONNX models copied to output directory
- [ ] App bundle < 500MB (or acceptable size)

**Verification:**

```bash
npm run build:mac
open dist/erfana-darwin-arm64.dmg
# Test in production app: File → Open Project → Index files → Search
```

### 8. Error handling

- [ ] Worker crashes handled gracefully (restart + retry)
- [ ] SQLite lock timeouts retried (exponential backoff)
- [ ] File indexing errors logged (don't crash app)
- [ ] User-facing errors are actionable

**Verification:**

```typescript
// Simulate worker crash
const worker = workerPool.workers[0];
worker.terminate(); // Force crash

// Verify recovery
await new Promise(resolve => setTimeout(resolve, 1000));
const results = await workerPool.embed(['test']);
assert(results.length > 0, 'Worker pool did not recover');
```

### 9. Data integrity

- [ ] No orphaned embeddings (section deleted but embedding remains)
- [ ] No duplicate entities (UNIQUE constraint enforced)
- [ ] Temporal edges consistent (no overlapping valid periods)

**Verification:**

```sql
-- Orphaned embeddings
SELECT COUNT(*) FROM embeddings e
WHERE NOT EXISTS (SELECT 1 FROM sections s WHERE s.id = e.section_id);
-- Should return: 0

-- Duplicate entities
SELECT name, type, COUNT(*) FROM entities GROUP BY name, type HAVING COUNT(*) > 1;
-- Should return: empty set

-- Overlapping edges
SELECT src_id, dst_id, type, COUNT(*) FROM edges
WHERE valid_to IS NULL
GROUP BY src_id, dst_id, type HAVING COUNT(*) > 1;
-- Should return: empty set
```

---

## Known limitations

### 1. onnxruntime-node worker stability

**Issue:** Worker threads crash randomly with >4 concurrent workers (GitHub issue #18790).

**Impact:** Indexing slower than ideal; potential user-facing errors.

**Mitigation:**
- Limit to 2-4 workers (see [embedding-pipeline-onnx-workers.md](./embedding-pipeline-onnx-workers.md))
- Auto-restart crashed workers
- Retry failed batches (idempotent operations)

**Alternative:** Consider `transformers.js` (wraps onnxruntime, better stability) in M5+.

### 2. No ANN indexes (sqlite-vec v0.1.0)

**Issue:** Brute-force KNN → slow for >500K documents.

**Impact:** Hybrid search latency > 1s for large corpora.

**Mitigation:**
- Binary quantization (60-70% faster, 32x smaller)
- Pre-filter candidates (by folder/date/metadata)
- Document scale limits in user docs

**Future:** HNSW/IVF indexes planned in sqlite-vec v0.2+ (2026).

### 3. Scale limit: 100K documents optimal

**Issue:** Performance degrades beyond 500K documents without quantization.

**Impact:** Large projects (e.g., entire Wikipedia mirror) unusable.

**Mitigation:**
- Document recommended corpus size (10K-100K optimal)
- Provide binary quantization option in settings
- Allow folder-level index exclusions (e.g., skip `node_modules/`)

### 4. Single embedder per project

**Issue:** Mixing embedding models → poor search results (incompatible vector spaces).

**Impact:** Must re-embed entire project if switching models.

**Mitigation:**
- Store `embedder_id` in `meta` table
- Warn user before model switch (with estimated re-embed time)
- Background re-embedding with progress UI

### 5. No real-time collaboration

**Issue:** Graph engine designed for single-user, local-first.

**Impact:** Multi-user scenarios (e.g., team wiki) unsupported.

**Mitigation:**
- Document as single-user feature
- Consider CRDTs or operational transforms in future versions

---

## See also

- [Production readiness – monitoring and deployment](./production-readiness-operations.md) – mitigation strategies, monitoring, user communication, rollback plan
- [Architecture](./architecture-overview.md) – System design decisions
- [Performance](./performance.md) – Benchmarks and optimization
- [Packaging](./packaging.md) – Native module configuration
- [Implementation Guide](./implementation-guide.md) – Milestone checklist
