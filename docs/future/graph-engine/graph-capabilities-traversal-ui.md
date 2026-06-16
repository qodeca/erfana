# Graph capabilities – traversal and UI

> This is part 2 of the graph capabilities documentation, split for readability.
>
> **Other parts:**
> - [Graph capabilities – entities and linking](./graph-capabilities-entities.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Graph traversal

### graphology integration

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

### Centrality metrics

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

### Neighborhood queries

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

## Timeline queries

### Change timeline for entity

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

### Contradiction detection

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

## Knowledge panel UI

### Component structure

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

### Timeline slider (M4)

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

## See also

- [Graph capabilities – entities and linking](./graph-capabilities-entities.md) – entity extraction, linking, deduplication, temporal relationships, backlinks
- [Architecture](./architecture-overview.md) – Graph store integration with graphology
- [Data Model](./data-model.md) – Entities, edges, mentions schema
- [Hybrid Search](./hybrid-search-fundamentals.md) – Graph-aware boosts
- [Implementation Guide](./implementation-guide.md) – M3/M4 milestones
