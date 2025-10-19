## Milestone 4: Temporal Features (Time-Aware Queries)

**Goal:** Enable "as-of" queries and change timelines.

**Duration:** 2-3 weeks

### Tasks

#### 4.1 Add Temporal Fields

**Already in schema:**
- `edges.valid_from`
- `edges.valid_to`
- `edges.tx_time`

#### 4.2 Edge Management

**File:** `src/main/services/EdgeService.ts`

```typescript
export class EdgeService {
  createEdge(srcId: number, dstId: number, type: string, validFrom: number): void {
    this.db.db.prepare(`
      INSERT INTO edges (src_id, dst_id, type, valid_from, tx_time)
      VALUES (?, ?, ?, ?, ?)
    `).run(srcId, dstId, type, validFrom, Date.now());
  }

  closeEdge(edgeId: number, validTo: number): void {
    this.db.db.prepare(`
      UPDATE edges SET valid_to = ? WHERE id = ?
    `).run(validTo, edgeId);
  }
}
```

#### 4.3 As-Of Query API

**Update:** `GraphService.ts`

```typescript
getEdgesAsOf(asOf: number): Edge[] {
  return this.db.db.prepare(`
    SELECT
      src.name AS from_entity,
      edge.type,
      dst.name AS to_entity
    FROM edges edge
    JOIN entities src ON src.id = edge.src_id
    JOIN entities dst ON dst.id = edge.dst_id
    WHERE edge.valid_from <= ?
      AND (edge.valid_to IS NULL OR edge.valid_to > ?)
  `).all(asOf, asOf);
}
```

#### 4.4 Timeline UI

**File:** `src/renderer/src/components/Timeline/TimelineSlider.tsx`

**Features:**
- Date slider (project start → today)
- Show change events (edges added/closed)
- Re-run search with `asOf` filter

#### 4.5 MCP Server Updates

**Update:** `src/main/services/MCPServerService.ts`

**Add final MCP tool:**

```typescript
// Tool 5: Timeline queries
this.server.addTool({
  name: 'erfana_graph_timeline',
  description: 'Get temporal timeline for entity or file',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: { type: 'number', description: 'Entity ID (optional)' },
      fileId: { type: 'number', description: 'File ID (optional)' },
      asOf: { type: 'number', description: 'Unix timestamp for "as-of" query (optional)' }
    }
  }
}, async (params) => {
  const results = await this.graphEngine.getTimeline({
    entityId: params.entityId,
    fileId: params.fileId,
    asOf: params.asOf
  });
  return { results };
});
```

**All 5 MCP Tools Now Available:**
1. `erfana_graph_search` - Hybrid search (M1)
2. `erfana_graph_related` - Related sections (M2)
3. `erfana_graph_entities` - List entities (M3)
4. `erfana_graph_backlinks` - Entity backlinks (M3)
5. `erfana_graph_timeline` - Temporal queries (M4)

### M4 Completion Checklist

**Core Functionality:**
- [ ] Edges have valid_from/valid_to/tx_time
- [ ] As-of queries work

**UI Components:**
- [ ] Timeline slider functional

**MCP Server:**
- [ ] `erfana_graph_timeline` tool accessible from Claude Code
- [ ] All 5 MCP tools tested and working

**Manual Tests:**
- [ ] Create edge → close edge → query past date → see old edge
- [ ] Claude Code: `erfana_graph_timeline({ entityId: 5, asOf: Date.parse('2024-03-01') })` → get timeline

---

