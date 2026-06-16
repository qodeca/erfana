# Production readiness – monitoring and deployment

> This is part 2 of the production readiness documentation, split for readability.
>
> **Other parts:**
> - [Production readiness – checklist and limitations](./production-readiness-checklist.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Mitigation strategies

### Worker crash recovery

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

### Binary quantization auto-enable

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

### Health check endpoint

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

## Monitoring & observability

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
    fs.appendFileSync(this.logFile, logEntry + '\n');
  }
}
```

**Usage:**

```typescript
logger.log(LogLevel.INFO, 'Indexing file', { path: filePath, sections: count });
logger.log(LogLevel.ERROR, 'Worker crashed', { workerId, error: err.message });
```

### Metrics collection

**Key metrics:**

| Metric | Type | Alert threshold |
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

### User feedback collection

**Feature:** "Report Issue" button in UI.

**Data to collect:**
- Error message + stack trace
- Health check report
- Last 100 log lines
- System info (OS, Electron version, memory)

**Privacy:** Strip sensitive data (file paths, content) before upload.

---

## User communication

### Documentation to provide

1. **System requirements:**
   - Node.js 24+
   - 8GB RAM (16GB recommended for large projects)
   - 2GB free disk space

2. **Recommended project size:**
   - Optimal: 10K-100K documents
   - Acceptable: 100K-500K (enable binary quantization)
   - Not recommended: >500K (wait for ANN indexes)

3. **Known issues:**
   - Worker threads may crash occasionally (auto-recovery enabled)
   - First indexing is slow (subsequent saves are fast due to deduplication)
   - Switching embedding models requires full re-index

4. **Troubleshooting guide:**
   - "Search is slow" → Check corpus size, enable quantization
   - "Indexing stuck" → Check logs for worker crashes
   - "Out of memory" → Reduce batch size in settings

### Release notes template

```markdown
## Graph Engine v1.0.0 (M2)

### New features
- Hybrid search (BM25 + vector similarity)
- Configurable weights (α, β)
- Settings UI for weight tuning

### Known limitations
- Optimal for 10K-100K documents
- Worker threads may crash occasionally (auto-recovery enabled)
- No ANN indexes (planned for v1.1)

### Breaking changes
- Database schema updated (auto-migration on first launch)

### Upgrade path
1. Backup project (`.erfana/` folder)
2. Open project in new version
3. Wait for automatic re-indexing (may take 5-10 minutes)
```

---

## Rollback plan

### Scenario: Critical bug in production

**Steps:**

1. **Identify regression** (user reports, crash logs)
2. **Revert to previous release** (GitHub releases page)
3. **Restore database backup** (if schema changed)
4. **Communicate with users** (release notes, email)

### Database backup strategy

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

## See also

- [Production readiness – checklist and limitations](./production-readiness-checklist.md) – pre-deployment checklist, known limitations
- [Architecture](./architecture-overview.md) – System design decisions
- [Performance](./performance.md) – Benchmarks and optimization
- [Packaging](./packaging.md) – Native module configuration
- [Implementation Guide](./implementation-guide.md) – Milestone checklist
