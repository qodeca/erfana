## Milestone 1: Foundation (FTS5 + Keyword Search)

**Goal:** Ship working keyword search with complete UI components and MCP server for Claude Code.

**Duration:** 3-4 weeks

### Overview

M1 delivers:
- **Related Sidebar**: Auto-updating research assistant
- **Global Search**: Project-wide keyword search (replaces grep)
- **Settings Panel**: Configure indexing and search
- **Status Indicator**: Show indexing progress
- **MCP Server**: Expose graph engine to Claude Code (Terminal)
- **Event-Driven Integration**: Subscribe to FileWatcherService events

### Tasks

#### 1.1 Database Setup

**Files to create:**
- `src/main/services/GraphDatabaseService.ts`
- `src/main/db/schema.sql`

**Steps:**

1. Initialize SQLite database:
   ```typescript
   import Database from 'better-sqlite3';

   export class GraphDatabaseService {
     private db: Database.Database;

     constructor(projectPath: string) {
       const dbPath = path.join(projectPath, '.erfana', 'graph.db');
       this.db = new Database(dbPath);
       this.db.pragma('journal_mode = WAL');
       this.runMigrations();
     }

     private runMigrations(): void {
       const schema = fs.readFileSync('./src/main/db/schema.sql', 'utf-8');
       this.db.exec(schema);
     }
   }
   ```

2. Create schema (from data-model.md):
   - `files` table
   - `sections` table
   - `fts_sections` virtual table
   - FTS sync triggers

**Validation:** Run `sqlite3 graph.db ".schema"` → verify tables exist.

#### 1.2 Text Preprocessing

**File:** `src/main/services/TextPreprocessor.ts`

**Implementation:**
- Strip markdown syntax (headings, emphasis, links, code)
- Normalize whitespace
- Compute SHA-256 hash (for deduplication)

**Test:**
```typescript
const text = TextPreprocessor.normalize('## Heading

This is **bold**.');
assert.equal(text, 'Heading

This is bold.');
```

#### 1.3 File Indexing Pipeline

**File:** `src/main/services/IndexingService.ts`

**Steps:**

1. Parse markdown file → extract sections (by headings)
2. Normalize text per section
3. Insert into `files` table
4. Insert sections into `sections` table (FTS triggers auto-sync)

**Code (sketch):**

```typescript
export class IndexingService {
  constructor(private db: GraphDatabaseService) {}

  indexFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Check if file changed
    const existing = this.db.getFileByPath(filePath);
    if (existing && existing.hash === hash) {
      console.log(`Skipping ${filePath} (unchanged)`);
      return;
    }

    // Parse sections
    const sections = this.parseSections(content);

    // Upsert file
    const fileId = this.db.upsertFile({
      path: filePath,
      hash,
      meta_json: JSON.stringify({ /* frontmatter */ }),
      updated_at: Date.now()
    });

    // Delete old sections
    this.db.deleteSectionsByFileId(fileId);

    // Insert new sections
    for (const section of sections) {
      this.db.insertSection({
        file_id: fileId,
        heading: section.heading,
        level: section.level,
        text: TextPreprocessor.normalize(section.text),
        text_hash: TextPreprocessor.hash(section.text),
        updated_at: Date.now()
      });
    }

    console.log(`Indexed ${filePath}: ${sections.length} sections`);
  }

  private parseSections(markdown: string): Section[] {
    // TODO: Implement markdown → sections parser
    // Use remark or marked for AST parsing
  }
}
```

**Test:** Index `docs/README.md` → verify sections in DB.

#### 1.4 BM25 Search API

**File:** `src/main/services/SearchService.ts`

**Implementation:**

```typescript
export class SearchService {
  constructor(private db: GraphDatabaseService) {}

  search(query: string, k: number = 10): SearchResult[] {
    const results = this.db.db.prepare(`
      SELECT
        s.id AS section_id,
        s.text,
        s.heading,
        f.path,
        bm25(fts, 3.0, 1.0) AS score
      FROM fts_sections fts
      JOIN sections s ON s.id = fts.section_id
      JOIN files f ON f.id = s.file_id
      WHERE fts_sections MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `).all(query, k);

    return results.map(r => ({
      ...r,
      score: Math.abs(r.score) // BM25 returns negative
    }));
  }
}
```

**Test:**
```bash
npm run dev
# In renderer console:
const results = await window.api.graph.search({ q: 'vector search', k: 10 });
console.log(results);
```

#### 1.5 IPC Handlers

**File:** `src/main/ipc/graph-handlers.ts`

```typescript
import { ipcMain } from 'electron';

export function registerGraphHandlers(
  indexingService: IndexingService,
  searchService: SearchService
) {
  ipcMain.handle('graph:indexFile', async (event, filePath: string) => {
    indexingService.indexFile(filePath);
    return { success: true };
  });

  ipcMain.handle('graph:search', async (event, params: { q: string; k?: number }) => {
    const results = searchService.search(params.q, params.k || 10);
    return { results };
  });
}
```

**Preload:** `src/preload/index.ts`

```typescript
contextBridge.exposeInMainWorld('api', {
  graph: {
    indexFile: (path: string) => ipcRenderer.invoke('graph:indexFile', path),
    search: (params: { q: string; k?: number }) => ipcRenderer.invoke('graph:search', params)
  }
});
```

