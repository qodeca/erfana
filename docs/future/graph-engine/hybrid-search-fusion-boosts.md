# Hybrid search – fusion and boosts

> This is part 2 of the hybrid search documentation, split for readability.
>
> **Other parts:**
> - [Hybrid search – fundamentals](./hybrid-search-fundamentals.md)
> - [Hybrid search – implementation and examples](./hybrid-search-implementation.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Score fusion strategies

### Strategy 1: Normalized score fusion (recommended)

**Steps:**

1. Run BM25 and vector searches independently (top-k=50-100 each)
2. Normalize scores to [0, 1]
3. Combine: `final_score = α * bm25 + β * vector`
4. Sort by final_score DESC, return top-k

**Code:**

```typescript
interface HybridSearchOptions {
  query: string;
  k: number;
  alpha: number; // BM25 weight
  beta: number;  // Vector weight
}

async hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
  const { query, k, alpha, beta } = options;

  // Step 1: BM25 search (top-100)
  const bm25Results = this.bm25Search({ query, k: 100 });

  // Step 2: Embed query
  const queryVector = await this.embedQuery(query);

  // Step 3: Vector search (top-100)
  const vectorResults = this.vectorSearch({
    queryVector,
    embedderId: this.activeEmbedderId,
    k: 100
  });

  // Step 4: Normalize BM25 scores
  const bm25Scores = bm25Results.map(r => r.bm25_score);
  const normBM25 = this.normalizeBM25(bm25Scores);

  // Step 5: Normalize vector scores (already in [0, 1] via similarity)
  const vectorScores = vectorResults.map(r => r.similarity);

  // Step 6: Create unified candidate set
  const candidateMap = new Map<number, SearchResult>();

  bm25Results.forEach((r, i) => {
    candidateMap.set(r.section_id, {
      section_id: r.section_id,
      text: r.text,
      heading: r.heading,
      path: r.path,
      bm25_score: normBM25[i],
      vector_score: 0
    });
  });

  vectorResults.forEach(r => {
    if (candidateMap.has(r.section_id)) {
      candidateMap.get(r.section_id)!.vector_score = r.similarity;
    } else {
      candidateMap.set(r.section_id, {
        section_id: r.section_id,
        text: r.text,
        heading: r.heading,
        path: r.path,
        bm25_score: 0,
        vector_score: r.similarity
      });
    }
  });

  // Step 7: Compute final scores
  const candidates = Array.from(candidateMap.values()).map(c => ({
    ...c,
    final_score: alpha * c.bm25_score + beta * c.vector_score
  }));

  // Step 8: Sort and return top-k
  candidates.sort((a, b) => b.final_score - a.final_score);
  return candidates.slice(0, k);
}
```

### Strategy 2: Reciprocal rank fusion (RRF)

**Formula:**

```
RRF(d) = Σ 1 / (k + rank_i(d))

Where:
- rank_i(d): Rank of document d in result set i
- k: Constant (default: 60)
```

**Advantages:**
- No score normalization needed
- Robust to score scale differences

**Disadvantages:**
- Ignores absolute scores (only uses ranks)
- Harder to tune per-query

**Code:**

```typescript
function reciprocalRankFusion(
  bm25Results: BM25Result[],
  vectorResults: VectorResult[],
  k: number = 60
): SearchResult[] {
  const rrfScores = new Map<number, number>();

  // Add BM25 ranks
  bm25Results.forEach((r, rank) => {
    const score = 1 / (k + rank + 1);
    rrfScores.set(r.section_id, (rrfScores.get(r.section_id) || 0) + score);
  });

  // Add vector ranks
  vectorResults.forEach((r, rank) => {
    const score = 1 / (k + rank + 1);
    rrfScores.set(r.section_id, (rrfScores.get(r.section_id) || 0) + score);
  });

  // Sort by RRF score
  const results = Array.from(rrfScores.entries())
    .map(([section_id, rrf_score]) => ({ section_id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);

  return results.slice(0, k);
}
```

**Recommendation:** Use **normalized score fusion** for Erfana (easier to explain to users in "Why this result?" UI).

---

## Graph-aware boosts

### Entity overlap score

Boost sections that mention entities related to the query context.

**Use Case:** User is editing `docs/architecture.md` (mentions: "SQLite", "React", "Electron"). Query: "How do I persist settings?"

→ Boost results that also mention SQLite/Electron (likely relevant to architecture context).

**Implementation:**

```typescript
interface GraphBoostOptions {
  candidateSections: SearchResult[];
  contextEntityIds: number[]; // Entities in current file/section
  k: number;
}

applyGraphBoost(options: GraphBoostOptions): SearchResult[] {
  const { candidateSections, contextEntityIds, k } = options;

  // Get entity mentions for each candidate
  candidateSections.forEach(candidate => {
    const mentions = this.db.prepare(`
      SELECT entity_id
      FROM mentions
      WHERE section_id = ?
    `).all(candidate.section_id);

    const candidateEntities = new Set(mentions.map(m => m.entity_id));

    // Count overlapping entities
    let overlap = 0;
    for (const entityId of contextEntityIds) {
      if (candidateEntities.has(entityId)) {
        overlap++;
      }
    }

    // Normalize by context entity count
    candidate.graph_boost = contextEntityIds.length > 0
      ? overlap / contextEntityIds.length
      : 0;
  });

  return candidateSections;
}
```

**Add to final score:**

```typescript
final_score = alpha * bm25 + beta * vector + gamma * graph_boost
```

### Centrality boost (advanced)

Boost sections that mention high-centrality entities (important concepts).

**Steps:**

1. Load entity graph (graphology)
2. Compute PageRank
3. For each candidate, sum centrality of mentioned entities

**Code (sketch):**

```typescript
import { Graph } from 'graphology';
import pagerank from 'graphology-metrics/centrality/pagerank';

class GraphStore {
  private graph: Graph;
  private centrality: Map<string, number>;

  loadGraph(): void {
    this.graph = new Graph();

    // Load entities
    const entities = this.db.prepare('SELECT id, name FROM entities').all();
    entities.forEach(e => this.graph.addNode(e.id, { name: e.name }));

    // Load edges
    const edges = this.db.prepare(`
      SELECT src_id, dst_id
      FROM edges
      WHERE valid_to IS NULL  -- Only current edges
    `).all();
    edges.forEach(e => this.graph.addEdge(e.src_id, e.dst_id));

    // Compute PageRank
    this.centrality = pagerank(this.graph);
  }

  getCentralityScore(entityIds: number[]): number {
    let score = 0;
    for (const id of entityIds) {
      score += this.centrality.get(id.toString()) || 0;
    }
    return score / (entityIds.length || 1); // Average
  }
}
```

**When to use:** M3+ (requires entity extraction).

---

## Recency bias

Boost recently updated sections (assume newer = more relevant).

**Formula:**

```
recency_boost = exp(-λ * days_ago)

Where:
- λ: Decay rate (e.g., 0.01 = slow, 0.1 = fast)
- days_ago: Days since section.updated_at
```

**Code:**

```typescript
function computeRecencyBoost(updatedAt: number, lambda: number = 0.01): number {
  const now = Date.now();
  const ageMs = now - updatedAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  return Math.exp(-lambda * ageDays);
}
```

**Add to final score:**

```typescript
final_score = alpha * bm25 + beta * vector + gamma * graph + delta * recency
```

**Trade-off:** May suppress old-but-relevant results. Use sparingly (δ ≤ 0.1).

---

## Weight tuning

### Settings storage

Store hybrid weights in `meta` table (from data-model.md):

```sql
INSERT OR REPLACE INTO meta(key, value) VALUES
  ('hybrid_weights', '{"alpha":0.4,"beta":0.6,"gamma":0.0,"delta":0.0}');
```

### UI: Weight slider component

**File:** `src/renderer/src/components/GraphSettings/WeightTuner.tsx`

```tsx
export function WeightTuner() {
  const [weights, setWeights] = useState({ alpha: 0.4, beta: 0.6, gamma: 0.0, delta: 0.0 });

  const handleChange = (key: string, value: number) => {
    const newWeights = { ...weights, [key]: value };

    // Normalize alpha + beta + gamma + delta = 1.0
    const sum = newWeights.alpha + newWeights.beta + newWeights.gamma + newWeights.delta;
    if (sum > 0) {
      Object.keys(newWeights).forEach(k => {
        newWeights[k] /= sum;
      });
    }

    setWeights(newWeights);
    window.api.graph.settings.set({ weights: newWeights });
  };

  return (
    <div>
      <label>BM25 (α): {weights.alpha.toFixed(2)}</label>
      <input type="range" min="0" max="1" step="0.01"
        value={weights.alpha}
        onChange={(e) => handleChange('alpha', parseFloat(e.target.value))}
      />

      <label>Vector (β): {weights.beta.toFixed(2)}</label>
      <input type="range" min="0" max="1" step="0.01"
        value={weights.beta}
        onChange={(e) => handleChange('beta', parseFloat(e.target.value))}
      />

      {/* ... gamma, delta sliders ... */}
    </div>
  );
}
```

### A/B testing (advanced)

Log queries + clicks to evaluate weight tuning:

```sql
CREATE TABLE IF NOT EXISTS query_logs (
  id INTEGER PRIMARY KEY,
  query TEXT,
  weights_json TEXT,
  clicked_section_id INTEGER,
  rank INTEGER,  -- Position in results
  created_at INTEGER
);
```

**Metrics:**
- **MRR (Mean Reciprocal Rank):** 1 / rank_of_first_click
- **NDCG (Normalized DCG):** Weighted relevance at each position
- **Click-Through Rate:** % of queries with clicks in top-10

---

## See also

- [Hybrid search – fundamentals](./hybrid-search-fundamentals.md) – BM25, vector search, overview
- [Hybrid search – implementation and examples](./hybrid-search-implementation.md) – step-by-step implementation guide, query examples
- [Architecture](./architecture-overview.md) – Hybrid search in system design
- [Vector Search](./vector-search-overview.md) – sqlite-vec querying
- [Graph Capabilities](./graph-capabilities-entities.md) – Entity extraction and graph boosts
- [Performance](./performance.md) – Hybrid search benchmarks
