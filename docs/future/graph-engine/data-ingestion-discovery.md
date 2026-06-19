# Data ingestion – discovery and indexing

> This is part 1 of the data ingestion documentation, split for readability.
>
> **Other parts:**
> - [Data ingestion – updates and performance](./data-ingestion-updates.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document explains how the Erfana Graph Engine automatically discovers, processes, and indexes markdown files from your project.

---

## Overview

### Automatic indexing philosophy

**Design principle:** Zero-configuration knowledge graph that "just works."

**User experience:**
1. User opens project in Erfana
2. Graph engine automatically detects all `.md` files
3. Indexing starts in background (non-blocking)
4. User can continue working while indexing completes
5. Related Sidebar/Search become available once indexed

**No manual steps required.**

---

## Project initialization

### Trigger: `project:changed` event

When user opens a project (File → Open Project), Erfana's main process emits `project:changed` event.

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

### Initial indexing flow

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

## File discovery

### Recursive file scan

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

### Prioritization strategy

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

## Event-driven indexing

### FileWatcherService integration

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

## See also

- [Data ingestion – updates and performance](./data-ingestion-updates.md) – incremental updates, progress reporting, error handling, performance
- [Architecture](./architecture-overview.md) – Event-driven integration with FileWatcherService
- [User Guide](./user-guide-features.md) – User-facing features and workflows
- [Implementation Guide](./implementation-guide.md) – M1 indexing pipeline tasks
- [Performance](./performance.md) – Indexing benchmarks and optimization
