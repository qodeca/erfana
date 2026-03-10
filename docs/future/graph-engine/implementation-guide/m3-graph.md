## Milestone 3: Graph Capabilities (Entities & Relations)

**Goal:** Extract entities, build graph, enable backlinks and impact analysis.

**Duration:** 3-4 weeks

### Tasks

#### 3.1 Add Graph Tables

**Update schema:**
- `entities` table
- `edges` table
- `mentions` table

#### 3.2 Rule-Based Entity Extraction

**File:** `src/main/services/EntityExtractor.ts`

**Implementation:** See [graph-capabilities-entities.md](./graph-capabilities-entities.md).

**Patterns:**
- `[[wikilinks]]`
- `#tags`
- `@mentions`
- Technical terms (SQLite, React, etc.)

#### 3.3 Entity Storage

**File:** `src/main/services/EntityService.ts`

```typescript
export class EntityService {
  upsertEntity(name: string, type: string): number {
    const result = this.db.db.prepare(`
      INSERT INTO entities (name, type, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name, type) DO UPDATE SET name=name
      RETURNING id
    `).get(name, type, Date.now());

    return result.id;
  }

  linkMention(sectionId: number, entityId: number, startChar: number, endChar: number): void {
    this.db.db.prepare(`
      INSERT OR IGNORE INTO mentions (section_id, entity_id, start_char, end_char, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sectionId, entityId, startChar, endChar, Date.now());
  }
}
```

#### 3.4 Update Indexing Pipeline

**Update:** `IndexingService.ts`

```typescript
indexFile(filePath: string): void {
  // ... existing BM25 + vector indexing ...

  // Extract entities
  for (const section of sections) {
    const entities = this.entityExtractor.extractEntities(section.text);

    for (const entity of entities) {
      const entityId = this.entityService.upsertEntity(entity.name, entity.type);
      this.entityService.linkMention(section.id, entityId, entity.startChar, entity.endChar);
    }
  }
}
```

#### 3.5 Backlinks API

**File:** `src/main/services/GraphService.ts`

```typescript
export class GraphService {
  getBacklinks(entityName: string, limit: number = 50): Backlink[] {
    return this.db.db.prepare(`
      SELECT
        f.path,
        s.id AS section_id,
        s.heading,
        s.text,
        s.updated_at
      FROM mentions m
      JOIN entities e ON e.id = m.entity_id
      JOIN sections s ON s.id = m.section_id
      JOIN files f ON f.id = s.file_id
      WHERE e.name = ?
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(entityName, limit);
  }
}
```

#### 3.6 Knowledge Panel UI

**File:** `src/renderer/src/components/Panels/GraphPanel.tsx`

**Features:**
- List entities in current section
- Click entity → show backlinks
- "Impact analysis" button (shows dependents)

#### 3.7 MCP Server Updates

**Update:** `src/main/services/MCPServerService.ts`

**Add 2 new MCP tools:**

```typescript
// Tool 3: List entities
this.server.addTool({
  name: 'erfana_graph_entities',
  description: 'List entities (with optional filters)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Filter by name' },
      type: { type: 'string', description: 'Filter by type (e.g., technology, person)' },
      limit: { type: 'number', description: 'Max results', default: 50 }
    }
  }
}, async (params) => {
  const results = await this.graphEngine.getEntities({
    query: params.query,
    type: params.type,
    limit: params.limit || 50
  });
  return { results };
});

// Tool 4: Get backlinks
this.server.addTool({
  name: 'erfana_graph_backlinks',
  description: 'Get backlinks for an entity',
  inputSchema: {
    type: 'object',
    properties: {
      entityName: { type: 'string', description: 'Entity name (e.g., "SQLite")' },
      limit: { type: 'number', description: 'Max results', default: 50 }
    },
    required: ['entityName']
  }
}, async (params) => {
  const results = await this.graphEngine.getBacklinks({
    entityName: params.entityName,
    limit: params.limit || 50
  });
  return { results };
});
```

### M3 Completion Checklist

**Core Functionality:**
- [ ] Entity extraction working (wikilinks, tags, mentions)
- [ ] Entities and mentions stored in DB
- [ ] Backlinks API returns correct results

**UI Components:**
- [ ] Knowledge Panel shows entities
- [ ] Click entity → backlinks populate

**MCP Server:**
- [ ] `erfana_graph_entities` tool accessible from Claude Code
- [ ] `erfana_graph_backlinks` tool accessible from Claude Code

**Manual Tests:**
- [ ] Add `[[SQLite]]` → see backlinks in Knowledge Panel
- [ ] Claude Code: `erfana_graph_entities({ type: 'technology' })` → get entities
- [ ] Claude Code: `erfana_graph_backlinks({ entityName: 'SQLite' })` → get backlinks

---

