# Data Ingestion & Indexing

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document explains how the Erfana Graph Engine automatically discovers, processes, and indexes markdown files from your project.

---

## Table of Contents

1. [Overview](#overview)
2. [Project Initialization](#project-initialization)
3. [File Discovery](#file-discovery)
4. [Event-Driven Indexing](#event-driven-indexing)
5. [Incremental Updates](#incremental-updates)
6. [Progress Reporting](#progress-reporting)
7. [Error Handling](#error-handling)
8. [Performance Considerations](#performance-considerations)

---

## Overview

### Automatic Indexing Philosophy

**Design principle:** Zero-configuration knowledge graph that "just works."

**User experience:**
1. User opens project in ERFANA
2. Graph engine automatically detects all `.md` files
3. Indexing starts in background (non-blocking)
4. User can continue working while indexing completes
5. Related Sidebar/Search become available once indexed

**No manual steps required.**

---

## Project Initialization

### Trigger: `project:changed` Event

When user opens a project (File → Open Project), ERFANA's main process emits `project:changed` event.

**Event payload:**
```typescript
{
  oldPath: string | null,  // Previous project path (null if first open)
  newPath: string          // New project path
}
```

**GraphEngineService subscribes to this event:**

```typescript
// File: src/main/services/GraphEngineService.ts

export class GraphEngineService {
  constructor(
    private eventBus: EventEmitter,
    private fileService: FileService
  ) {
    // Subscribe to project changes
    this.eventBus.on('project:changed', this.handleProjectChange.bind(this));
  }

  private async handleProjectChange(event: ProjectChangeEvent): Promise<void> {
    console.log(`[GraphEngine] Project changed: ${event.newPath}`);

    // 1. Close previous database (if any)
    if (this.db) {
      this.db.close();
    }

    // 2. Open/create database for new project
    const dbPath = path.join(event.newPath, '.erfana', 'graph.db');
    this.db = new GraphDatabaseService(dbPath);

    // 3. Start initial indexing
    await this.initialIndex(event.newPath);
  }
}
```

### Initial Indexing Flow

```
1. User opens project
   │
   ▼
2. GraphEngineService receives 'project:changed' event
   │
   ▼
3. Create/open SQLite database (.erfana/graph.db)
   │
   ▼
4. Discover all .md files (recursive scan)
   │
   ├─▶ Skip: node_modules/, .git/, .erfana/
   └─▶ Include: *.md, *.markdown
   │
   ▼
5. Queue files for indexing (prioritize open files first)
   │
   ▼
6. Process batches (10 files/batch)
   │
   ├─▶ Parse markdown → sections
   ├─▶ Normalize text
   ├─▶ Insert into database (FTS5 + sections)
   ├─▶ Tokenize + chunk
   ├─▶ Embed (worker pool)
   ├─▶ Store embeddings + vectors
   └─▶ Extract entities (M3+)
   │
   ▼
7. Report progress (emit 'graph:indexing:progress' event)
   │
   ▼
8. Indexing complete → emit 'graph:indexing:complete' event
```

---

## File Discovery

### Recursive File Scan

**Implementation:**

```typescript
async discoverFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];

  const walkDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip excluded directories
      if (entry.isDirectory()) {
        if (this.shouldSkipDirectory(entry.name)) {
          continue;
        }
        walkDir(fullPath);
      }

      // Include markdown files
      if (entry.isFile() && this.isMarkdownFile(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  walkDir(projectPath);
  return files;
}

private shouldSkipDirectory(dirName: string): boolean {
  const excluded = [
    'node_modules',
    '.git',
    '.erfana',
    'dist',
    'out',
    'build',
    '.vscode',
    '.idea'
  ];
  return excluded.includes(dirName);
}

private isMarkdownFile(filename: string): boolean {
  return /\.(md|markdown)$/i.test(filename);
}
```

### Prioritization Strategy

**Problem:** User may start working before indexing finishes.

**Solution:** Prioritize currently open files.

```typescript
async initialIndex(projectPath: string): Promise<void> {
  // 1. Discover all files
  const allFiles = await this.discoverFiles(projectPath);

  // 2. Get currently open files from editor
  const openFiles = this.getOpenFilesFromEditor();

  // 3. Prioritize: open files first, then rest
  const prioritized = [
    ...openFiles.filter(f => allFiles.includes(f)),
    ...allFiles.filter(f => !openFiles.includes(f))
  ];

  // 4. Index in priority order
  await this.indexFiles(prioritized);
}
```

---

## Event-Driven Indexing

### FileWatcherService Integration

**Architecture:** Graph engine subscribes to file change events from `FileWatcherService` (event-driven, not polling).

**Events:**

| Event | Trigger | Action |
|-------|---------|--------|
| `file:saved` | User saves file in editor | Re-index file |
| `file:created` | New file created | Index file |
| `file:deleted` | File deleted | Remove from index |
| `file:renamed` | File renamed | Update path, re-index |

**Implementation:**

```typescript
// File: src/main/services/FileWatcherService.ts

export class FileWatcherService {
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.setupWatcher();
  }

  private setupWatcher(): void {
    // Chokidar-based file watcher (existing)
    this.watcher = chokidar.watch(this.projectPath, {
      ignored: /(node_modules|\.git)/,
      persistent: true
    });

    this.watcher.on('change', (path) => {
      this.eventBus.emit('file:saved', { path });
    });

    this.watcher.on('add', (path) => {
      this.eventBus.emit('file:created', { path });
    });

    this.watcher.on('unlink', (path) => {
      this.eventBus.emit('file:deleted', { path });
    });
  }
}
```

**GraphEngineService subscription:**

```typescript
// File: src/main/services/GraphEngineService.ts

constructor(eventBus: EventEmitter) {
  // Subscribe to file events
  eventBus.on('file:saved', this.handleFileSaved.bind(this));
  eventBus.on('file:created', this.handleFileCreated.bind(this));
  eventBus.on('file:deleted', this.handleFileDeleted.bind(this));
}

private async handleFileSaved(event: { path: string }): Promise<void> {
  if (!this.isMarkdownFile(event.path)) return;

  console.log(`[GraphEngine] Re-indexing: ${event.path}`);
  await this.indexFile(event.path);

  // Notify UI to refresh Related Sidebar
  this.eventBus.emit('graph:file:indexed', { path: event.path });
}
```

---

## Incremental Updates

### Problem: Avoid Re-Embedding Unchanged Content

**Scenario:** User saves file with minor edit (fix typo). Should we re-embed entire file?

**Answer:** No! Use content hashing to skip unchanged sections.

### Content-Based Deduplication

**Strategy:**

1. Parse file → sections
2. Normalize each section text → compute SHA-256 hash
3. Compare hash with `sections.text_hash` in database
4. Only re-embed if hash changed

**Implementation:**

```typescript
async indexFile(filePath: string): Promise<void> {
  // 1. Read file
  const content = fs.readFileSync(filePath, 'utf-8');

  // 2. Parse into sections
  const newSections = this.parseMarkdown(content);

  // 3. Get existing sections from DB
  const fileId = this.db.getFileIdByPath(filePath);
  const existingSections = fileId ? this.db.getSectionsByFileId(fileId) : [];

  // 4. Diff: identify changed sections
  const toEmbed: Section[] = [];

  for (const newSection of newSections) {
    const normalized = TextPreprocessor.normalize(newSection.text);
    const newHash = TextPreprocessor.hash(normalized);

    const existing = existingSections.find(
      s => s.start_byte === newSection.startByte && s.end_byte === newSection.endByte
    );

    if (!existing || existing.text_hash !== newHash) {
      // Section changed or is new
      toEmbed.push({ ...newSection, textHash: newHash });
    } else {
      // Section unchanged, skip
      console.log(`[GraphEngine] Skipping unchanged section: ${newSection.heading}`);
    }
  }

  // 5. Embed only changed sections
  if (toEmbed.length > 0) {
    await this.embedSections(toEmbed);
  }

  console.log(`[GraphEngine] Indexed ${filePath}: ${toEmbed.length}/${newSections.length} sections updated`);
}
```

**Performance Impact:**

| Scenario | Sections Changed | Time (Before Dedupe) | Time (After Dedupe) | Speedup |
|----------|------------------|----------------------|---------------------|---------|
| Fix typo | 1/10 | 1200ms | 150ms | 8x |
| Add paragraph | 2/10 | 1200ms | 300ms | 4x |
| Rewrite file | 10/10 | 1200ms | 1200ms | 1x |

**Result:** 80-90% of file saves → 10x faster indexing.

---

## Progress Reporting

### UI Feedback Requirements

Users need to know:
1. Is indexing in progress?
2. How much is left?
3. Did it finish successfully?

### Progress Events

**Emitted by GraphEngineService:**

```typescript
// Start
this.eventBus.emit('graph:indexing:started', {
  totalFiles: allFiles.length
});

// Progress
this.eventBus.emit('graph:indexing:progress', {
  current: i,
  total: allFiles.length,
  currentFile: filePath
});

// Complete
this.eventBus.emit('graph:indexing:complete', {
  filesIndexed: allFiles.length,
  duration: Date.now() - startTime
});

// Error
this.eventBus.emit('graph:indexing:error', {
  file: filePath,
  error: err.message
});
```

### Status Indicator Component

**File:** `src/renderer/src/components/StatusBar/GraphStatusIndicator.tsx`

```tsx
export function GraphStatusIndicator() {
  const [status, setStatus] = useState<'idle' | 'indexing' | 'error'>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const unsubscribe = [
      window.api.graph.onIndexingStarted(() => setStatus('indexing')),
      window.api.graph.onIndexingProgress((data) => {
        setProgress({ current: data.current, total: data.total });
      }),
      window.api.graph.onIndexingComplete(() => setStatus('idle')),
      window.api.graph.onIndexingError(() => setStatus('error'))
    ];

    return () => unsubscribe.forEach(fn => fn());
  }, []);

  const getIndicatorColor = () => {
    switch (status) {
      case 'idle': return 'green';
      case 'indexing': return 'yellow';
      case 'error': return 'red';
    }
  };

  const getTooltip = () => {
    if (status === 'indexing') {
      return `Indexing: ${progress.current}/${progress.total} files`;
    }
    if (status === 'error') {
      return 'Indexing error (click for details)';
    }
    return 'Graph engine ready';
  };

  return (
    <div className="graph-status" title={getTooltip()}>
      <span className={`indicator-dot ${getIndicatorColor()}`} />
      {status === 'indexing' && (
        <span className="progress-text">
          {Math.round((progress.current / progress.total) * 100)}%
        </span>
      )}
    </div>
  );
}
```

---

## Error Handling

### Common Indexing Errors

#### 1. Parse Error (Malformed Markdown)

**Cause:** Invalid markdown syntax breaks parser.

**Handling:**

```typescript
try {
  const sections = this.parseMarkdown(content);
} catch (err) {
  console.error(`[GraphEngine] Parse error: ${filePath}`, err);
  this.eventBus.emit('graph:indexing:error', {
    file: filePath,
    error: `Parse error: ${err.message}`
  });
  // Skip this file, continue with others
  return;
}
```

#### 2. Worker Crash (ONNX Runtime)

**Cause:** onnxruntime-node crashes with >4 workers.

**Handling:**

```typescript
// In EmbedderWorkerPool
private handleWorkerExit(worker: Worker, code: number): void {
  if (code !== 0) {
    console.error(`[WorkerPool] Worker crashed (code ${code})`);

    // Restart worker
    this.spawnWorker();

    // Retry failed batch
    const failedBatches = this.pendingRequests.get(worker.threadId);
    for (const batch of failedBatches) {
      this.queue.unshift(batch); // Retry at front of queue
    }
  }
}
```

#### 3. Database Lock (SQLite BUSY)

**Cause:** Concurrent writes without proper transaction management.

**Handling:**

```typescript
async indexFile(filePath: string): Promise<void> {
  let retries = 3;

  while (retries > 0) {
    try {
      const tx = this.db.transaction(() => {
        // ... insert operations ...
      });
      tx(); // Execute transaction
      break; // Success
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && retries > 1) {
        console.warn(`[GraphEngine] DB locked, retrying... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries))); // Exponential backoff
        retries--;
      } else {
        throw err; // Give up
      }
    }
  }
}
```

### Error Recovery Strategy

**Principle:** Never crash the app. Log errors, skip problematic files, continue indexing.

**User notification:**
- Status indicator turns red
- Tooltip shows "Indexing error (click for details)"
- Clicking opens log viewer with error details

---

## Performance Considerations

### Batch Processing

**Problem:** Indexing 10K files one-by-one is slow (sequential I/O).

**Solution:** Process in batches.

```typescript
async indexFiles(files: string[]): Promise<void> {
  const BATCH_SIZE = 10;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    await Promise.all(batch.map(file => this.indexFile(file)));

    // Report progress after each batch
    this.eventBus.emit('graph:indexing:progress', {
      current: Math.min(i + BATCH_SIZE, files.length),
      total: files.length
    });
  }
}
```

**Performance:**
- Sequential: 10K files @ 100ms/file = 16.7 minutes
- Batch (10 parallel): 10K files @ 10ms/file = 1.7 minutes (10x faster)

### Debouncing File Saves

**Problem:** User rapidly saves file (Cmd+S, Cmd+S, Cmd+S) → triggers 3 index operations.

**Solution:** Debounce (300ms window).

```typescript
// File: src/main/services/GraphEngineService.ts

private indexDebounceTimers = new Map<string, NodeJS.Timeout>();

private handleFileSaved(event: { path: string }): void {
  // Clear existing timer
  const existingTimer = this.indexDebounceTimers.get(event.path);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new timer (300ms)
  const timer = setTimeout(async () => {
    await this.indexFile(event.path);
    this.indexDebounceTimers.delete(event.path);
  }, 300);

  this.indexDebounceTimers.set(event.path, timer);
}
```

**Result:** 3 rapid saves → 1 index operation (67% reduction).

### Memory Management

**Problem:** Loading 10K files into memory at once → OOM.

**Solution:** Stream processing (load → index → discard → next file).

```typescript
async indexFiles(files: string[]): Promise<void> {
  for (const file of files) {
    // Load file content
    const content = fs.readFileSync(file, 'utf-8');

    // Index (insert into DB, embed)
    await this.indexFile(file);

    // Content is garbage-collected automatically
    // (no references held after indexFile returns)
  }
}
```

---

## Summary

**Data ingestion flow:**

1. **Project open** → `project:changed` event → initialize database
2. **File discovery** → recursive scan → prioritize open files
3. **Initial indexing** → batch process (10 files/batch)
4. **File changes** → event-driven (`file:saved`) → incremental update
5. **Deduplication** → content hashing → skip unchanged sections
6. **Progress** → emit events → UI status indicator
7. **Errors** → log, skip, continue (don't crash app)

**Performance:**
- Batch processing: 10x faster than sequential
- Content hashing: 8x faster for minor edits (skip unchanged sections)
- Debouncing: 67% reduction in redundant indexing
- Prioritization: User can start working immediately (open files indexed first)

**User experience:**
- Zero configuration (automatic)
- Non-blocking (background indexing)
- Transparent (status indicator + progress %)
- Resilient (error recovery, never crashes)

---

**Related:**
- [Architecture](./architecture.md) - Event-driven integration with FileWatcherService
- [User Guide](./user-guide.md) - User-facing features and workflows
- [Implementation Guide](./implementation-guide.md) - M1 indexing pipeline tasks
- [Performance](./performance.md) - Indexing benchmarks and optimization
