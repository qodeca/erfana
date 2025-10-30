# Production Readiness

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document provides a pre-deployment checklist and validation guide for the Erfana Graph Engine before releasing to production.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Known Limitations](#known-limitations)
3. [Mitigation Strategies](#mitigation-strategies)
4. [Monitoring & Observability](#monitoring--observability)
5. [User Communication](#user-communication)
6. [Rollback Plan](#rollback-plan)

---

## Pre-Deployment Checklist

### 1. Database & Schema

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

### 2. Vector Search (sqlite-vec)

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

### 3. Embedding Pipeline

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

### 4. Hybrid Search

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

### 5. Graph Features (M3+)

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

### 8. Error Handling

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

### 9. Data Integrity

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

## Known Limitations

### 1. onnxruntime-node Worker Stability

**Issue:** Worker threads crash randomly with >4 concurrent workers (GitHub issue #18790).

**Impact:** Indexing slower than ideal; potential user-facing errors.

**Mitigation:**
- Limit to 2-4 workers (see [embedding-pipeline.md](./embedding-pipeline.md))
- Auto-restart crashed workers
- Retry failed batches (idempotent operations)

**Alternative:** Consider `transformers.js` (wraps onnxruntime, better stability) in M5+.

### 2. No ANN Indexes (sqlite-vec v0.1.0)

**Issue:** Brute-force KNN → slow for >500K documents.

**Impact:** Hybrid search latency > 1s for large corpora.

**Mitigation:**
- Binary quantization (60-70% faster, 32x smaller)
- Pre-filter candidates (by folder/date/metadata)
- Document scale limits in user docs

**Future:** HNSW/IVF indexes planned in sqlite-vec v0.2+ (2026).

### 3. Scale Limit: 100K Documents Optimal

**Issue:** Performance degrades beyond 500K documents without quantization.

**Impact:** Large projects (e.g., entire Wikipedia mirror) unusable.

**Mitigation:**
- Document recommended corpus size (10K-100K optimal)
- Provide binary quantization option in settings
- Allow folder-level index exclusions (e.g., skip `node_modules/`)

### 4. Single Embedder per Project

**Issue:** Mixing embedding models → poor search results (incompatible vector spaces).

**Impact:** Must re-embed entire project if switching models.

**Mitigation:**
- Store `embedder_id` in `meta` table
- Warn user before model switch (with estimated re-embed time)
- Background re-embedding with progress UI

### 5. No Real-Time Collaboration

**Issue:** Graph engine designed for single-user, local-first.

**Impact:** Multi-user scenarios (e.g., team wiki) unsupported.

**Mitigation:**
- Document as single-user feature
- Consider CRDTs or operational transforms in future versions

---

## Mitigation Strategies

### Worker Crash Recovery

**File:** `EmbedderWorkerPool.ts`

```typescript
private handleWorkerExit(worker: Worker, code: number): void {
  if (code !== 0) {
    console.error(`[WorkerPool] Worker crashed (code ${code}), restarting...`);

    // Remove from pool
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);

    // Spawn new worker
    this.spawnWorker().then(() => {
      console.log('[WorkerPool] Worker restarted successfully');
    });

    // Retry pending requests
    const failedRequests = Array.from(this.pendingRequests.values())
      .filter(req => req.workerId === /* crashed worker id */);

    for (const req of failedRequests) {
      this.queue.unshift(req); // Retry at front of queue
    }
  }
}
```

### Binary Quantization Auto-Enable

**Logic:** Auto-enable for >100K documents.

```typescript
async initialize(): Promise<void> {
  const docCount = this.db.prepare('SELECT COUNT(*) FROM sections').pluck().get();

  if (docCount > 100000) {
    console.warn(`Large corpus detected (${docCount} docs), enabling binary quantization`);
    this.useBinaryQuantization = true;
  }
}
```

### Health Check Endpoint

**File:** `HealthCheckService.ts`

```typescript
export class HealthCheckService {
  checkHealth(): HealthReport {
    return {
      database: this.checkDatabase(),
      workers: this.checkWorkers(),
      vectorSearch: this.checkVectorSearch(),
      timestamp: Date.now()
    };
  }

  private checkDatabase(): ComponentHealth {
    try {
      const integrity = this.db.prepare('PRAGMA integrity_check').pluck().get();
      const size = fs.statSync(this.dbPath).size;

      return {
        status: integrity === 'ok' ? 'healthy' : 'unhealthy',
        message: `DB size: ${(size / (1024 ** 2)).toFixed(2)} MB`,
        details: { integrity, size }
      };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  private checkWorkers(): ComponentHealth {
    const alive = this.workerPool.workers.filter(w => !w.killed).length;
    const expected = this.workerPool.workerCount;

    return {
      status: alive === expected ? 'healthy' : 'degraded',
      message: `${alive}/${expected} workers alive`,
      details: { alive, expected }
    };
  }
}
```

**Expose via IPC:**

```typescript
ipcMain.handle('graph:health', async () => {
  return healthCheckService.checkHealth();
});
```

**UI:** Show in settings panel or dev tools.

---

## Monitoring & Observability

### Logging

**File:** `LoggingService.ts`

```typescript
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class LoggingService {
  private logFile: string;
  private minLevel: LogLevel = LogLevel.INFO;

  log(level: LogLevel, message: string, context?: any): void {
    if (level < this.minLevel) return;

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${LogLevel[level]}] ${message}`;

    // Console
    console.log(logEntry, context || '');

    // File
    fs.appendFileSync(this.logFile, logEntry + '
');
  }
}
```

**Usage:**

```typescript
logger.log(LogLevel.INFO, 'Indexing file', { path: filePath, sections: count });
logger.log(LogLevel.ERROR, 'Worker crashed', { workerId, error: err.message });
```

### Metrics Collection

**Key Metrics:**

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| `graph.search.latency_ms` | Histogram | P95 > 500ms |
| `graph.index.errors` | Counter | > 10/hour |
| `graph.worker.crashes` | Counter | > 5/hour |
| `graph.db.size_mb` | Gauge | > 2000MB |
| `graph.memory.heap_mb` | Gauge | > 1000MB |

**Implementation:**

```typescript
class MetricsService {
  private metrics = new Map<string, number[]>();

  recordLatency(operation: string, latency: number): void {
    const key = `${operation}.latency_ms`;
    if (!this.metrics.has(key)) this.metrics.set(key, []);
    this.metrics.get(key)!.push(latency);
  }

  getP95(operation: string): number {
    const latencies = this.metrics.get(`${operation}.latency_ms`) || [];
    if (latencies.length === 0) return 0;

    latencies.sort((a, b) => a - b);
    const idx = Math.floor(latencies.length * 0.95);
    return latencies[idx];
  }
}
```

### User Feedback Collection

**Feature:** "Report Issue" button in UI.

**Data to collect:**
- Error message + stack trace
- Health check report
- Last 100 log lines
- System info (OS, Electron version, memory)

**Privacy:** Strip sensitive data (file paths, content) before upload.

---

## User Communication

### Documentation to Provide

1. **System Requirements:**
   - Node.js 18+
   - 8GB RAM (16GB recommended for large projects)
   - 2GB free disk space

2. **Recommended Project Size:**
   - Optimal: 10K-100K documents
   - Acceptable: 100K-500K (enable binary quantization)
   - Not recommended: >500K (wait for ANN indexes)

3. **Known Issues:**
   - Worker threads may crash occasionally (auto-recovery enabled)
   - First indexing is slow (subsequent saves are fast due to deduplication)
   - Switching embedding models requires full re-index

4. **Troubleshooting Guide:**
   - "Search is slow" → Check corpus size, enable quantization
   - "Indexing stuck" → Check logs for worker crashes
   - "Out of memory" → Reduce batch size in settings

### Release Notes Template

```markdown
## Graph Engine v1.0.0 (M2)

### New Features
- Hybrid search (BM25 + vector similarity)
- Configurable weights (α, β)
- Settings UI for weight tuning

### Known Limitations
- Optimal for 10K-100K documents
- Worker threads may crash occasionally (auto-recovery enabled)
- No ANN indexes (planned for v1.1)

### Breaking Changes
- Database schema updated (auto-migration on first launch)

### Upgrade Path
1. Backup project (`.erfana/` folder)
2. Open project in new version
3. Wait for automatic re-indexing (may take 5-10 minutes)
```

---

## Rollback Plan

### Scenario: Critical Bug in Production

**Steps:**

1. **Identify regression** (user reports, crash logs)
2. **Revert to previous release** (GitHub releases page)
3. **Restore database backup** (if schema changed)
4. **Communicate with users** (release notes, email)

### Database Backup Strategy

**Auto-backup on schema changes:**

```typescript
private runMigrations(): void {
  const currentVersion = this.getSchemaVersion();
  const targetVersion = LATEST_SCHEMA_VERSION;

  if (currentVersion !== targetVersion) {
    console.log(`Schema migration: v${currentVersion} → v${targetVersion}`);

    // Backup before migration
    const backupPath = `${this.dbPath}.backup-v${currentVersion}`;
    fs.copyFileSync(this.dbPath, backupPath);
    console.log(`Backup created: ${backupPath}`);

    // Run migrations
    this.applyMigrations(currentVersion, targetVersion);
  }
}
```

**User-triggered backup:**

```typescript
ipcMain.handle('graph:backup', async (event, backupPath: string) => {
  fs.copyFileSync(dbPath, backupPath);
  return { success: true, path: backupPath };
});
```

---

**Related:**
- [Architecture](./architecture.md) - System design decisions
- [Performance](./performance.md) - Benchmarks and optimization
- [Packaging](./packaging.md) - Native module configuration
- [Implementation Guide](./implementation-guide.md) - Milestone checklist
