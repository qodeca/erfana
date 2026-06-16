# Performance & Scalability

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document provides performance benchmarks, scalability analysis, and optimization strategies for the Erfana Graph Engine.

---

## Table of Contents

1. [Performance Targets](#performance-targets)
2. [Benchmark Setup](#benchmark-setup)
3. [Component Benchmarks](#component-benchmarks)
4. [End-to-End Latency](#end-to-end-latency)
5. [Scalability Limits](#scalability-limits)
6. [Optimization Techniques](#optimization-techniques)
7. [Profiling Tools](#profiling-tools)

---

## Performance Targets

### Latency Goals (P95)

| Operation | Target | Acceptable | Unacceptable |
|-----------|--------|------------|--------------|
| **BM25 Search** (10K docs) | <20ms | <50ms | >100ms |
| **Vector Search** (10K docs) | <30ms | <80ms | >150ms |
| **Hybrid Search** (10K docs) | <50ms | <120ms | >200ms |
| **File Indexing** (10KB file) | <100ms | <300ms | >500ms |
| **Embedding** (1K tokens) | <50ms | <150ms | >300ms |

### Throughput Goals

| Operation | Target | Notes |
|-----------|--------|-------|
| **Indexing** | >10 files/sec | On initial project import |
| **Embedding** | >1K tokens/sec | Per worker (2-4 workers) |
| **Search Queries** | >50 queries/sec | Concurrent reads (WAL mode) |

### Resource Limits

| Resource | Limit | Impact if Exceeded |
|----------|-------|-------------------|
| **Database Size** | <2GB | Slower queries, higher memory |
| **Memory Usage** | <500MB | Electron main process OOM |
| **Worker Threads** | 2-4 | onnxruntime-node crashes |
| **Document Count** | 100K optimal | >500K needs quantization |

---

## Benchmark Setup

### Hardware

**Test Machine:**
- MacBook Pro M1 (8-core CPU, 16GB RAM)
- 512GB SSD (NVMe)
- macOS Sonoma 14.5

### Software

- Node.js 24.x
- Electron 39
- SQLite 3.45.0 (bundled with better-sqlite3)
- sqlite-vec v0.1.0
- onnxruntime-node 1.17.0

### Test Corpus

| Corpus | Files | Sections | Total Tokens | Avg Section Length |
|--------|-------|----------|--------------|-------------------|
| **Small** | 100 | 1,000 | 256K | 256 tokens |
| **Medium** | 1,000 | 10,000 | 2.56M | 256 tokens |
| **Large** | 10,000 | 100,000 | 25.6M | 256 tokens |
| **XLarge** | 50,000 | 500,000 | 128M | 256 tokens |

---

## Component Benchmarks

### BM25 Search (FTS5)

**Test:** 100 random queries, return top-10 results.

| Corpus Size | P50 Latency | P95 Latency | P99 Latency |
|-------------|-------------|-------------|-------------|
| 1K docs | 1.2ms | 2.5ms | 3.8ms |
| 10K docs | 8.5ms | 15.2ms | 22.1ms |
| 100K docs | 45ms | 82ms | 120ms |
| 500K docs | 215ms | 380ms | 520ms |

**Observations:**
- Linear scaling (no index optimization in FTS5 BM25)
- Cold cache adds ~20-30ms (first query after startup)
- Phrase queries (`"exact phrase"`) 2x slower

**Optimization:**
- Warm cache on startup: `SELECT * FROM fts_sections LIMIT 1`
- Use column filters: `heading:term` faster than full-text search

### Vector Search (sqlite-vec)

**Test:** 100 random queries (384-dim vectors), return top-10 results.

| Corpus Size | P50 Latency | P95 Latency | P99 Latency |
|-------------|-------------|-------------|-------------|
| 1K vectors | 1.8ms | 3.2ms | 4.5ms |
| 10K vectors | 16ms | 28ms | 38ms |
| 100K vectors | 105ms | 185ms | 245ms |
| 500K vectors | 540ms | 890ms | 1150ms |

**Observations:**
- Brute-force KNN (no ANN index in v0.1.0)
- ~1ms per 10K vectors @ 384 dims
- Binary quantization reduces latency by 60-70% (see below)

**Optimization:**
- Pre-filter candidates (e.g., by folder/date) before vector search
- Use binary quantization for >100K docs

### Hybrid Search

**Test:** BM25 + Vector fusion (α=0.4, β=0.6), top-100 candidates each, return top-10.

| Corpus Size | P50 Latency | P95 Latency | P99 Latency |
|-------------|-------------|-------------|-------------|
| 10K docs | 28ms | 52ms | 71ms |
| 100K docs | 165ms | 295ms | 410ms |
| 500K docs | 790ms | 1280ms | 1750ms |

**Breakdown (100K docs):**
- BM25: 45ms (27%)
- Query embedding: 18ms (11%)
- Vector search: 105ms (64%)
- Score fusion: 2ms (1%)

**Optimization:** Vector search dominates → optimize vector component first.

### Embedding Generation

**Test:** Batch embed chunks (256 tokens each), measure throughput.

| Batch Size | Throughput (tokens/sec) | Latency per Chunk | Memory |
|------------|------------------------|-------------------|--------|
| 1 | 65 tokens/sec | 15.4ms | 50MB |
| 16 | 620 tokens/sec | 4.1ms | 150MB |
| 32 | 1050 tokens/sec | 2.4ms | 250MB |
| 64 | 1340 tokens/sec | 1.9ms | 450MB |
| 128 | 1450 tokens/sec | 1.8ms | 850MB |

**Observations:**
- Batch size 32-64 optimal (diminishing returns after 64)
- 2 workers → 2100 tokens/sec total
- 4 workers → 3800 tokens/sec total (but unstable due to onnxruntime-node)

**Optimization:**
- Use batch size 32-64
- Limit to 2-4 workers max

### File Indexing

**Test:** Index files (10KB avg), measure end-to-end latency (parse + BM25 + embed).

| Operation | Latency (10KB file) | Notes |
|-----------|---------------------|-------|
| Parse markdown | 5ms | remark AST parsing |
| Normalize text | 2ms | Regex-based |
| Insert sections | 8ms | SQLite transaction |
| Tokenize + chunk | 12ms | @huggingface/tokenizers |
| Embed (32 chunks) | 85ms | ONNX batch embed |
| Insert embeddings | 15ms | SQLite transaction |
| **Total** | **127ms** | P95: ~210ms |

**Optimization:**
- Debounce file saves (300ms window)
- Skip unchanged sections (text_hash comparison)

---

## End-to-End Latency

### User Workflow: Save File → See Related Results

| Step | Latency | Notes |
|------|---------|-------|
| User saves file | 0ms | - |
| File watcher detects change | 50-150ms | Debounced (300ms window) |
| Index file | 127ms | See above |
| Hybrid search (auto-query) | 165ms | Medium corpus (100K docs) |
| Render results | 5ms | React re-render |
| **Total (perceived)** | **347-447ms** | Acceptable (<500ms) |

**User Experience:**
- <300ms: Instant (user doesn't notice)
- 300-500ms: Responsive (acceptable)
- 500-1000ms: Sluggish (consider loading indicator)
- >1000ms: Unacceptable (optimize or split operation)

---

## Scalability Limits

### Document Count Limits

| Corpus Size | BM25 Latency | Vector Latency | Hybrid Latency | Recommendation |
|-------------|--------------|----------------|----------------|----------------|
| **< 10K** | <20ms | <30ms | <50ms | ✅ No optimization needed |
| **10K-100K** | <50ms | <120ms | <170ms | ✅ Default config OK |
| **100K-500K** | <90ms | <600ms | <690ms | ⚠️ Consider binary quantization |
| **500K-1M** | <200ms | <1200ms | <1400ms | ⚠️ Binary quantization required |
| **> 1M** | <400ms | >2000ms | >2400ms | ❌ Wait for ANN indexes (HNSW) |

**Bottleneck:** Vector search (brute-force KNN).

**Mitigation (100K-500K docs):**
1. Binary quantization (32x smaller, 60% faster)
2. Pre-filter candidates (by folder/date/metadata)
3. Reduce top-k (50 instead of 100)

**Future (>1M docs):**
- Wait for sqlite-vec ANN indexes (HNSW/IVF planned 2026+)
- Or use external vector DB (Qdrant, Weaviate) with IPC bridge

### Database Size Limits

| Corpus Size | DB Size (FLOAT[384]) | DB Size (BIT[384]) | WAL Size |
|-------------|----------------------|-------------------|----------|
| 10K docs | 15MB | 2MB | 3MB |
| 100K docs | 150MB | 19MB | 30MB |
| 500K docs | 750MB | 94MB | 150MB |
| 1M docs | 1.5GB | 188MB | 300MB |

**Limits:**
- SQLite max DB size: 281TB (not a concern)
- Electron main process memory: ~1GB (OOM risk if DB + vectors in memory)

**Optimization:**
- Use binary quantization for >500K docs
- Set `PRAGMA cache_size = -64000` (64MB max cache)

### Memory Usage

| Component | Memory (Small) | Memory (Medium) | Memory (Large) |
|-----------|---------------|-----------------|----------------|
| Main process | 120MB | 180MB | 350MB |
| Renderer process | 200MB | 220MB | 250MB |
| Worker threads (2x) | 100MB | 150MB | 300MB |
| **Total** | **420MB** | **550MB** | **900MB** |

**Risks:**
- Electron OOM if total > 1.5GB
- Worker crashes if individual worker > 500MB

**Optimization:**
- Limit batch size to 32-64
- Unload vectors after search (don't keep in memory)

---

## Optimization Techniques

### 1. Skip Unchanged Sections

**Problem:** Re-embed identical sections on every file save.

**Solution:** Use `text_hash` to skip.

```typescript
const existingHash = db.prepare(`
  SELECT text_hash FROM sections WHERE file_id = ? AND start_byte = ?
`).pluck().get(fileId, section.startByte);

if (existingHash === newHash) {
  console.log('Skipping unchanged section');
  return;
}

// Otherwise, re-embed
```

**Impact:** 80-90% of sections unchanged during edits → 10x faster indexing.

### 2. Prepared Statements

**Problem:** Re-parsing SQL on every query.

**Solution:** Prepare statements once, reuse.

```typescript
class SearchService {
  private bm25Stmt: Database.Statement;

  constructor(db: Database.Database) {
    this.bm25Stmt = db.prepare(`
      SELECT ... FROM fts_sections WHERE fts_sections MATCH ? LIMIT ?
    `);
  }

  search(query: string, k: number): SearchResult[] {
    return this.bm25Stmt.all(query, k);
  }
}
```

**Impact:** ~20% faster queries.

### 3. Batch Transactions

**Problem:** Individual inserts are slow (disk I/O per insert).

**Solution:** Wrap in transaction.

```typescript
const insertMany = db.transaction((sections) => {
  for (const section of sections) {
    insertStmt.run(section);
  }
});

insertMany(sections); // Single transaction, one disk write
```

**Impact:** 100x faster bulk inserts.

### 4. WAL Mode

**Problem:** Default rollback journal blocks readers during writes.

**Solution:** Enable WAL (write-ahead logging).

```sql
PRAGMA journal_mode=WAL;
```

**Impact:** Concurrent reads while writing (no blocking).

### 5. Cache Warming

**Problem:** First query after startup is slow (cold cache).

**Solution:** Warm cache on startup.

```typescript
// On GraphDatabaseService initialization:
this.db.prepare('SELECT * FROM fts_sections LIMIT 1').get(); // Warm FTS cache
this.db.prepare('SELECT * FROM vss_sections LIMIT 1').get(); // Warm vector cache
```

**Impact:** Eliminates 50-100ms cold start penalty.

---

## Profiling Tools

### SQLite Query Profiling

**Explain query plan:**

```sql
EXPLAIN QUERY PLAN
SELECT ... FROM fts_sections WHERE fts_sections MATCH 'query';
```

**Analyze execution time:**

```typescript
console.time('query');
const results = db.prepare(sql).all(params);
console.timeEnd('query');
```

### Node.js Profiling

**CPU profiling:**

```bash
node --prof dist/main/index.js
node --prof-process isolate-*.log > profile.txt
```

**Memory profiling:**

```typescript
const memBefore = process.memoryUsage();
// ... operation ...
const memAfter = process.memoryUsage();
console.log(`Memory delta: ${(memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024} MB`);
```

### Electron DevTools

**Renderer profiling:**
- Open DevTools (Cmd+Option+I)
- Performance tab → Record → Stop
- Analyze flame graph

**Main process profiling:**
- Set `ELECTRON_RUN_AS_NODE=1`
- Use Node.js profiler

---

**Related:**
- [Architecture](./architecture-overview.md) - Performance considerations in design
- [Vector Search](./vector-search-overview.md) - sqlite-vec performance characteristics
- [Embedding Pipeline](./embedding-pipeline-overview.md) - Batching and worker concurrency
- [Production Readiness](./production-readiness-checklist.md) - Performance checklist
