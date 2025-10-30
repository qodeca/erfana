# Graph Capabilities

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document covers the graph layer of the Erfana Graph Engine: entity extraction, temporal relationships, graph traversal, and knowledge graph features.

---

## Table of Contents

1. [Graph Overview](#graph-overview)
2. [Entity Extraction](#entity-extraction)
3. [Entity Linking & Deduplication](#entity-linking--deduplication)
4. [Temporal Relationships](#temporal-relationships)
5. [Backlinks & Impact Analysis](#backlinks--impact-analysis)
6. [Graph Traversal](#graph-traversal)
7. [Timeline Queries](#timeline-queries)
8. [Knowledge Panel UI](#knowledge-panel-ui)

---

## Graph Overview

### What is a Knowledge Graph?

A knowledge graph represents entities (concepts, people, technologies) and their relationships as nodes and edges.

**Example:**
```
(Entity: ERFANA) --[uses]--> (Entity: SQLite)
(Entity: SQLite) --[supports]--> (Entity: FTS5)
(Entity: FTS5) --[implements]--> (Entity: BM25)
```

### Why Add Graphs to Hybrid Search?

1. **Contextual Relevance:** Boost results related to user's current context
2. **Backlinks:** "Where else is this mentioned?"
3. **Impact Analysis:** "What would break if I change this?"
4. **Change Timeline:** "How has this concept evolved?"

### Erfana's Graph Model

**Tables (from data-model.md):**
- **entities**: Named concepts (name, type, canonical_id)
- **edges**: Relationships between entities (src, dst, type, temporal fields)
- **mentions**: Links between sections and entities (provenance)

---

## Entity Extraction

### Extraction Methods

#### Method 1: Rule-Based (M3 Default)

Extract entities using regex patterns (fast, no LLM needed).

**Patterns:**
- **Wikilinks:** `[[Entity Name]]`
- **Hashtags:** `#tag`
- **@-mentions:** `@username`
- **Technical terms:** SQL keywords, function names (configurable list)

**Code:**

```typescript
export class RuleBasedExtractor {
  /**
   * Extract entities from normalized text
   */
  extractEntities(text: string): Entity[] {
    const entities: Entity[] = [];

    // Wikilinks: [[Entity Name]]
    const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = wikilinkRegex.exec(text)) !== null) {
      entities.push({
        name: match[1].trim(),
        type: 'wikilink',
        startChar: match.index,
        endChar: match.index + match[0].length
      });
    }

    // Hashtags: #tag
    const hashtagRegex = /#([a-zA-Z0-9_-]+)/g;
    while ((match = hashtagRegex.exec(text)) !== null) {
      entities.push({
        name: match[1],
        type: 'tag',
        startChar: match.index,
        endChar: match.index + match[0].length
      });
    }

    // @-mentions: @username
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    while ((match = mentionRegex.exec(text)) !== null) {
      entities.push({
        name: match[1],
        type: 'person',
        startChar: match.index,
        endChar: match.index + match[0].length
      });
    }

    // Technical terms (from predefined list)
    const technicalTerms = ['SQLite', 'React', 'Electron', 'FTS5', 'ONNX'];
    for (const term of technicalTerms) {
      const regex = new RegExp(`\b${term}\b`, 'gi');
      while ((match = regex.exec(text)) !== null) {
        entities.push({
          name: term,
          type: 'technology',
          startChar: match.index,
          endChar: match.index + match[0].length
        });
      }
    }

    return entities;
  }
}
```

**Pros:** Fast, deterministic, no API costs
**Cons:** Limited recall (misses unlabeled entities)

#### Method 2: LLM-Based (M4 Optional)

Use GPT-4/Claude to extract structured entities.

**Prompt:**

```
Extract entities from the following text. Return JSON array with schema:
{
  "entities": [
    {"name": "SQLite", "type": "database"},
    {"name": "React", "type": "library"},
    ...
  ],
  "relationships": [
    {"from": "ERFANA", "to": "SQLite", "type": "uses"},
    ...
  ]
}

Text:
"""
{section_text}
"""
```

**Code (sketch):**

```typescript
async extractEntitiesLLM(text: string): Promise<ExtractedData> {
  const response = await this.llmClient.createChatCompletion({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: ENTITY_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' }
  });

  const data = JSON.parse(response.choices[0].message.content);
  return data;
}
```

**Pros:** High recall, discovers implicit entities
**Cons:** Slow (~1-2s per section), API costs, requires internet

**Recommendation:** Start with rule-based (M3), add LLM option later (M4+).

---

## Entity Linking & Deduplication

### Problem: Aliases

Different names for the same entity:
- "React" vs "ReactJS" vs "React.js"
- "SQLite" vs "sqlite" (case-insensitive)

### Solution: Canonical Entities

**Schema (from data-model.md):**

```sql
CREATE TABLE entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  canonical_id INTEGER REFERENCES entities(id),  -- Points to canonical entity
  alias_score REAL,                               -- Confidence (0-1)
  UNIQUE(name, type)
);
```

**Approach:**

1. Insert "React" as canonical entity (canonical_id = NULL)
2. Insert "ReactJS" with canonical_id → React entity, alias_score = 0.95

**Query canonical entities:**

```sql
-- Get all entities (resolved to canonical)
SELECT
  COALESCE(canonical.name, e.name) AS resolved_name,
  e.type
FROM entities e
LEFT JOIN entities canonical ON e.canonical_id = canonical.id;
```

### Deduplication Strategy

**Option 1: Manual Curation**

User manually links aliases in UI:
```
"ReactJS" → canonical: "React"
```

**Option 2: String Similarity**

Auto-link if Levenshtein distance < threshold:

```typescript
import { levenshtein } from 'fastest-levenshtein';

function findPotentialAliases(newEntity: string, existingEntities: string[]): string[] {
  const candidates = [];

  for (const existing of existingEntities) {
    const dist = levenshtein(newEntity.toLowerCase(), existing.toLowerCase());
    const maxLen = Math.max(newEntity.length, existing.length);
    const similarity = 1 - (dist / maxLen);

    if (similarity > 0.85) { // 85% similar
      candidates.push({ existing, similarity });
    }
  }

  return candidates;
}
```

**Option 3: Embedding Similarity**

Embed entity names, link if cosine > 0.9:

```typescript
async findSemanticAliases(newEntity: string, existingEntities: Entity[]): Promise<Entity[]> {
  const newVec = await this.embedText(newEntity);

  const candidates = [];
  for (const existing of existingEntities) {
    const existingVec = await this.embedText(existing.name);
    const similarity = cosineSimilarity(newVec, existingVec);

    if (similarity > 0.9) {
      candidates.push({ entity: existing, similarity });
    }
  }

  return candidates;
}
```

**Recommendation:** Start with manual curation (M3), add string similarity later (M4).

---

## Temporal Relationships

### Why Temporal Graphs?

Knowledge changes over time:
- "Project uses React 17" → "Project uses React 18" (upgrade)
- "SQLite supports vectors via sqlite-vss" → "SQLite supports vectors via sqlite-vec" (migration)

### Bitemporal Model

**Schema (from data-model.md):**

```sql
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  src_id INTEGER NOT NULL REFERENCES entities(id),
  dst_id INTEGER NOT NULL REFERENCES entities(id),
  type TEXT NOT NULL,
  valid_from INTEGER NOT NULL,  -- When fact became true
  valid_to INTEGER,              -- When fact stopped being true (NULL = still true)
  tx_time INTEGER NOT NULL,      -- When we learned about this fact
  confidence REAL,
  UNIQUE(src_id, dst_id, type, valid_from, tx_time)
);
```

**Example:**

```sql
-- January 2024: Project starts using sqlite-vss
INSERT INTO edges (src_id, dst_id, type, valid_from, tx_time)
VALUES (
  (SELECT id FROM entities WHERE name = 'ERFANA'),
  (SELECT id FROM entities WHERE name = 'sqlite-vss'),
  'uses',
  1704067200000,  -- 2024-01-01
  1704067200000
);

-- October 2024: Migrate to sqlite-vec
-- 1. Close old edge
UPDATE edges
SET valid_to = 1728000000000  -- 2024-10-01
WHERE src_id = (SELECT id FROM entities WHERE name = 'ERFANA')
  AND dst_id = (SELECT id FROM entities WHERE name = 'sqlite-vss')
  AND type = 'uses'
  AND valid_to IS NULL;

-- 2. Insert new edge
INSERT INTO edges (src_id, dst_id, type, valid_from, tx_time)
VALUES (
  (SELECT id FROM entities WHERE name = 'ERFANA'),
  (SELECT id FROM entities WHERE name = 'sqlite-vec'),
  'uses',
  1728000000000,  -- 2024-10-01
  1728000000000
);
```

### Querying Temporal Edges

**As-Of Query:** "What was true on date X?"

```sql
SELECT src.name AS from_entity, edge.type, dst.name AS to_entity
FROM edges edge
JOIN entities src ON src.id = edge.src_id
JOIN entities dst ON dst.id = edge.dst_id
WHERE edge.valid_from <= :asof_timestamp
  AND (edge.valid_to IS NULL OR edge.valid_to > :asof_timestamp);
```

**Example:**

```typescript
// "What vector extension did ERFANA use in March 2024?"
const march2024 = new Date('2024-03-01').getTime();

const edges = db.prepare(`
  SELECT dst.name AS extension
  FROM edges edge
  JOIN entities src ON src.id = edge.src_id
  JOIN entities dst ON dst.id = edge.dst_id
  WHERE src.name = 'ERFANA'
    AND edge.type = 'uses'
    AND edge.valid_from <= ?
    AND (edge.valid_to IS NULL OR edge.valid_to > ?)
`).all(march2024, march2024);

console.log(edges); // [{ extension: 'sqlite-vss' }]
```

---

## Backlinks & Impact Analysis

### Backlinks: "Where is this mentioned?"

**Query:**

```sql
-- Find all sections that mention entity "React"
SELECT
  f.path,
  s.heading,
  s.text,
  s.updated_at
FROM mentions m
JOIN entities e ON e.id = m.entity_id
JOIN sections s ON s.id = m.section_id
JOIN files f ON f.id = s.file_id
WHERE e.name = 'React'
ORDER BY s.updated_at DESC;
```

**Code:**

```typescript
interface BacklinkOptions {
  entityName: string;
  limit?: number;
}

getBacklinks(options: BacklinkOptions): Backlink[] {
  const { entityName, limit = 50 } = options;

  return this.db.prepare(`
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
```

### Impact Analysis: "What depends on this?"

**Query:**

```sql
-- Find entities that depend on "SQLite"
WITH RECURSIVE dependents(id, name, depth) AS (
  -- Base case: Direct dependents
  SELECT e.id, e.name, 1
  FROM edges edge
  JOIN entities e ON e.id = edge.src_id
  WHERE edge.dst_id = (SELECT id FROM entities WHERE name = 'SQLite')
    AND edge.valid_to IS NULL

  UNION ALL

  -- Recursive case: Transitive dependents
  SELECT e.id, e.name, d.depth + 1
  FROM edges edge
  JOIN entities e ON e.id = edge.src_id
  JOIN dependents d ON d.id = edge.dst_id
  WHERE edge.valid_to IS NULL
    AND d.depth < 3  -- Limit recursion depth
)
SELECT DISTINCT name, depth
FROM dependents
ORDER BY depth, name;
```

**Use Case:**

> User: "I'm thinking of replacing SQLite with DuckDB. What would break?"
>
> Impact Analysis: Shows all entities (components, features) that depend on SQLite.

---

## Graph Traversal

### graphology Integration

**Load graph from SQLite:**

```typescript
import { Graph } from 'graphology';

export class GraphStore {
  private graph: Graph;

  loadGraph(): void {
    this.graph = new Graph();

    // Load entities (nodes)
    const entities = this.db.prepare(`
      SELECT id, name, type
      FROM entities
    `).all();

    entities.forEach(e => {
      this.graph.addNode(e.id, { name: e.name, type: e.type });
    });

    // Load current edges (valid_to IS NULL)
    const edges = this.db.prepare(`
      SELECT src_id, dst_id, type
      FROM edges
      WHERE valid_to IS NULL
    `).all();

    edges.forEach(e => {
      if (!this.graph.hasEdge(e.src_id, e.dst_id)) {
        this.graph.addEdge(e.src_id, e.dst_id, { type: e.type });
      }
    });

    console.log(`Graph loaded: ${this.graph.order} nodes, ${this.graph.size} edges`);
  }
}
```

### Centrality Metrics

**PageRank:** Identify important entities.

```typescript
import pagerank from 'graphology-metrics/centrality/pagerank';

const scores = pagerank(this.graph);

// Top 10 most important entities
const ranked = Object.entries(scores)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log('Top entities:', ranked.map(([id, score]) => ({
  name: this.graph.getNodeAttribute(id, 'name'),
  score
})));
```

**Betweenness:** Find bridge entities (connect different clusters).

```typescript
import betweenness from 'graphology-metrics/centrality/betweenness';

const scores = betweenness(this.graph);
```

### Neighborhood Queries

**N-hop neighbors:**

```typescript
import { neighbors } from 'graphology-operators';

function getNeighborhood(graph: Graph, entityId: number, hops: number): Set<number> {
  let frontier = new Set([entityId]);
  let visited = new Set<number>();

  for (let i = 0; i < hops; i++) {
    const nextFrontier = new Set<number>();

    for (const node of frontier) {
      if (visited.has(node)) continue;
      visited.add(node);

      // Get direct neighbors
      graph.forEachNeighbor(node, (neighbor) => {
        nextFrontier.add(neighbor);
      });
    }

    frontier = nextFrontier;
  }

  return visited;
}
```

**Use Case:** "Show me all entities within 2 hops of 'SQLite'" → Returns: FTS5, BM25, ERFANA, hybrid search, etc.

---

## Timeline Queries

### Change Timeline for Entity

**Query:**

```sql
-- Get change history for "ERFANA" entity
SELECT
  edge.type,
  dst.name AS target,
  edge.valid_from,
  edge.valid_to,
  edge.tx_time
FROM edges edge
JOIN entities src ON src.id = edge.src_id
JOIN entities dst ON dst.id = edge.dst_id
WHERE src.name = 'ERFANA'
ORDER BY edge.valid_from DESC;
```

**Result:**

```
type   | target        | valid_from   | valid_to     | tx_time
-------|---------------|--------------|--------------|-------------
uses   | sqlite-vec    | 2024-10-01   | NULL         | 2024-10-01
uses   | sqlite-vss    | 2024-01-01   | 2024-10-01   | 2024-01-01
uses   | React         | 2023-06-01   | NULL         | 2023-06-01
```

**Interpretation:**
- ERFANA used sqlite-vss from Jan-Oct 2024, then switched to sqlite-vec
- Still uses React (no valid_to)

### Contradiction Detection

**Problem:** Multiple active edges of same type.

**Query:**

```sql
-- Find contradictions: Entity has multiple "uses" edges with valid_to IS NULL
SELECT
  src.name,
  edge.type,
  GROUP_CONCAT(dst.name, ', ') AS conflicting_targets
FROM edges edge
JOIN entities src ON src.id = edge.src_id
JOIN entities dst ON dst.id = edge.dst_id
WHERE edge.valid_to IS NULL
GROUP BY src.id, edge.type
HAVING COUNT(*) > 1;
```

**Use Case:** Alert user if knowledge base has conflicting facts.

---

## Knowledge Panel UI

### Component Structure

**File:** `src/renderer/src/components/Panels/GraphPanel.tsx`

```tsx
export function GraphPanel() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  useEffect(() => {
    const loadEntities = async () => {
      const sectionId = /* current active section */;
      const data = await window.api.graph.entities.forSection(sectionId);
      setEntities(data);
    };

    loadEntities();
  }, [/* dependencies */]);

  const handleEntityClick = async (entity: Entity) => {
    const links = await window.api.graph.backlinks(entity.name);
    setBacklinks(links);
  };

  return (
    <div className="graph-panel">
      <section>
        <h3>Entities in Current Section</h3>
        {entities.map(e => (
          <button key={e.id} onClick={() => handleEntityClick(e)}>
            {e.name} <span className="type-badge">{e.type}</span>
          </button>
        ))}
      </section>

      {backlinks.length > 0 && (
        <section>
          <h3>Backlinks</h3>
          {backlinks.map(b => (
            <div key={b.section_id} className="backlink">
              <a href={`file://${b.path}#${b.section_id}`}>
                {b.heading || b.path}
              </a>
              <p>{b.text.slice(0, 100)}...</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
```

### Timeline Slider (M4)

**Component:** `TimelineSlider.tsx`

```tsx
export function TimelineSlider() {
  const [asOfDate, setAsOfDate] = useState<number>(Date.now());

  const handleSliderChange = (timestamp: number) => {
    setAsOfDate(timestamp);

    // Re-run queries with as-of filter
    window.api.graph.search({ q: currentQuery, asOf: timestamp });
  };

  return (
    <div className="timeline-slider">
      <label>View knowledge as of:</label>
      <input
        type="range"
        min={projectStartDate}
        max={Date.now()}
        value={asOfDate}
        onChange={(e) => handleSliderChange(parseInt(e.target.value))}
      />
      <span>{new Date(asOfDate).toLocaleDateString()}</span>
    </div>
  );
}
```

---

**Related:**
- [Architecture](./architecture.md) - Graph store integration with graphology
- [Data Model](./data-model.md) - Entities, edges, mentions schema
- [Hybrid Search](./hybrid-search.md) - Graph-aware boosts
- [Implementation Guide](./implementation-guide.md) - M3/M4 milestones
