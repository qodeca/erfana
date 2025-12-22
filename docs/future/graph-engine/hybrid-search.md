# Hybrid Search & Ranking

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document covers hybrid search architecture, combining BM25 keyword search (FTS5), vector similarity (sqlite-vec), and graph-aware boosts into a unified ranking system.

---

## Table of Contents

1. [Hybrid Search Overview](#hybrid-search-overview)
2. [BM25 Keyword Search](#bm25-keyword-search)
3. [Vector Semantic Search](#vector-semantic-search)
4. [Score Fusion Strategies](#score-fusion-strategies)
5. [Graph-Aware Boosts](#graph-aware-boosts)
6. [Recency Bias](#recency-bias)
7. [Weight Tuning](#weight-tuning)
8. [Implementation Guide](#implementation-guide)
9. [Query Examples](#query-examples)

---

## Hybrid Search Overview

### Why Hybrid?

No single retrieval method is perfect:

| Method | Strengths | Weaknesses |
|--------|-----------|------------|
| **BM25** | Exact keyword matching, proper nouns, acronyms | Misses synonyms, paraphrases |
| **Vector** | Semantic similarity, handles paraphrases | Weak on exact terms, proper nouns |
| **Graph** | Contextual relevance, entity relationships | Requires entity extraction (overhead) |

**Hybrid search** combines all three to maximize recall and precision.

### Industry Standard Weights (October 2025)

Research shows typical production systems use:
- **α (BM25):** 0.3 - 0.5 (40% weight)
- **β (Vector):** 0.5 - 0.7 (60% weight)
- **γ (Graph):** 0.0 - 0.2 (0-20% boost, optional)
- **δ (Recency):** 0.0 - 0.1 (0-10% boost, optional)

**Erfana Default:** α=0.4, β=0.6, γ=0.0, δ=0.0

### Ranking Formula

```
final_score = α * norm_bm25 + β * norm_cosine + γ * graph_boost + δ * recency_boost

Where:
- norm_bm25: Normalized BM25 score (0-1)
- norm_cosine: Cosine similarity (0-1)
- graph_boost: Entity overlap score (0-1)
- recency_boost: Time decay factor (0-1)
```

---

## BM25 Keyword Search

### What is BM25?

**BM25 (Best Match 25)** is a probabilistic ranking function for keyword search, improved over TF-IDF.

**Formula:**

```
BM25(q, d) = Σ IDF(qi) * (f(qi, d) * (k1 + 1)) / (f(qi, d) + k1 * (1 - b + b * |d| / avgdl))

Where:
- q: Query terms
- d: Document
- f(qi, d): Term frequency of qi in d
- IDF(qi): Inverse document frequency of qi
- k1: Term saturation parameter (default: 1.2)
- b: Length normalization (default: 0.75)
- |d|: Document length
- avgdl: Average document length
```

**Intuition:**
- **IDF:** Rare terms score higher (e.g., "SQLite" > "the")
- **TF saturation (k1):** Diminishing returns after ~5 occurrences
- **Length norm (b):** Penalize long documents (avoid stuffing)

### SQLite FTS5 Implementation

SQLite FTS5 has BM25 **hardcoded** with k1=1.2, b=0.75 (optimal for most corpora).

**Create FTS5 table (from data-model.md):**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS fts_sections USING fts5(
  text,                 -- Main content (weight: 1.0)
  heading,              -- Section heading (weight: 3.0)
  section_id UNINDEXED, -- Link back to sections.id
  content='sections',   -- External content table
  content_rowid='id'    -- Map rowid to sections.id
);
```

**Query with weighted columns:**

```typescript
interface BM25Options {
  query: string;
  headingWeight?: number; // Default: 3.0
  k: number;
}

bm25Search(options: BM25Options): BM25Result[] {
  const { query, headingWeight = 3.0, k } = options;

  // Use bm25() function with column weights
  const results = this.db.prepare(`
    SELECT
      fts.section_id,
      s.text,
      s.heading,
      f.path,
      bm25(fts, ${headingWeight}, 1.0) AS bm25_score
    FROM fts_sections fts
    JOIN sections s ON s.id = fts.section_id
    JOIN files f ON f.id = s.file_id
    WHERE fts_sections MATCH ?
    ORDER BY bm25_score ASC  -- Lower is better (negative scores)
    LIMIT ?
  `).all(query, k);

  // Convert negative scores to positive (BM25 returns negative values)
  return results.map(r => ({
    ...r,
    bm25_score: Math.abs(r.bm25_score)
  }));
}
```

### Query Syntax

FTS5 supports advanced query operators:

| Syntax | Example | Meaning |
|--------|---------|---------|
| **AND** (implicit) | `sqlite vector` | Both terms must appear |
| **OR** | `sqlite OR postgres` | Either term |
| **NOT** | `sqlite NOT vss` | Exclude documents with "vss" |
| **Phrase** | `"vector search"` | Exact phrase |
| **Prefix** | `embed*` | Matches embed, embedding, embeddings |
| **NEAR** | `NEAR(sqlite vector, 5)` | Terms within 5 tokens |
| **Column** | `heading:architecture` | Search only in heading column |

**Example:**

```sql
-- Find sections with "sqlite" in heading and "vector" nearby
WHERE fts_sections MATCH 'heading:sqlite NEAR(vector search, 10)'
```

### BM25 Score Normalization

**Problem:** BM25 scores are unbounded (range: 0 to ~100+).

**Solution:** Normalize to [0, 1] for fusion.

**Method 1: Min-Max Scaling**

```typescript
function normalizeBM25(scores: number[]): number[] {
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min || 1; // Avoid division by zero

  return scores.map(s => (s - min) / range);
}
```

**Method 2: Sigmoid (better for outliers)**

```typescript
function normalizeBM25Sigmoid(scores: number[], k: number = 10): number[] {
  // Sigmoid: 1 / (1 + exp(-x / k))
  return scores.map(s => 1 / (1 + Math.exp(-s / k)));
}
```

**Recommendation:** Use min-max for speed; use sigmoid if BM25 scores have extreme outliers.

---

## Vector Semantic Search

### Cosine Similarity

**Formula:**

```
cosine(a, b) = dot(a, b) / (||a|| * ||b||)

If vectors are L2-normalized (||a|| = ||b|| = 1):
cosine(a, b) = dot(a, b)
```

**Range:** -1 (opposite) to +1 (identical)

### sqlite-vec Distance Metrics

sqlite-vec provides L2 distance (Euclidean):

```sql
SELECT vec_distance_L2(v.embedding, :query_vec) AS distance
FROM vss_sections v
ORDER BY distance ASC;
```

**Convert L2 to Cosine (normalized vectors):**

```typescript
// If vectors are normalized:
const l2_dist = vecDistanceL2(a, b);
const cosine_sim = 1 - (l2_dist ** 2) / 2;
```

**Or use directly:** Closer L2 distance = more similar (already in [0, ∞) range).

### Vector Search Implementation

```typescript
interface VectorSearchOptions {
  queryVector: Float32Array; // Pre-normalized
  embedderId: string;
  k: number;
}

vectorSearch(options: VectorSearchOptions): VectorResult[] {
  const { queryVector, embedderId, k } = options;

  const results = this.db.prepare(`
    SELECT
      e.section_id,
      s.text,
      s.heading,
      f.path,
      vec_distance_L2(v.embedding, ?) AS distance
    FROM vss_sections v
    JOIN embeddings e ON e.id = v.rowid
    JOIN sections s ON s.id = e.section_id
    JOIN files f ON f.id = s.file_id
    WHERE e.embedder_id = ?
    ORDER BY distance ASC
    LIMIT ?
  `).all(Buffer.from(queryVector.buffer), embedderId, k);

  // Convert distance to similarity (0 = identical, higher = less similar)
  return results.map(r => ({
    ...r,
    similarity: 1 / (1 + r.distance) // Normalize to [0, 1]
  }));
}
```

---

## Score Fusion Strategies

### Strategy 1: Normalized Score Fusion (Recommended)

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

### Strategy 2: Reciprocal Rank Fusion (RRF)

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

## Graph-Aware Boosts

### Entity Overlap Score

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

### Centrality Boost (Advanced)

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

## Recency Bias

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

## Weight Tuning

### Settings Storage

Store hybrid weights in `meta` table (from data-model.md):

```sql
INSERT OR REPLACE INTO meta(key, value) VALUES
  ('hybrid_weights', '{"alpha":0.4,"beta":0.6,"gamma":0.0,"delta":0.0}');
```

### UI: Weight Slider Component

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

### A/B Testing (Advanced)

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

## Implementation Guide

### Step 1: BM25-Only Search (M1)

```typescript
export class SearchService {
  bm25Search(query: string, k: number): SearchResult[] {
    return this.db.prepare(`
      SELECT s.id, s.text, s.heading, f.path,
             bm25(fts, 3.0, 1.0) AS score
      FROM fts_sections fts
      JOIN sections s ON s.id = fts.section_id
      JOIN files f ON f.id = s.file_id
      WHERE fts_sections MATCH ?
      ORDER BY score ASC
      LIMIT ?
    `).all(query, k);
  }
}
```

### Step 2: Add Vector Search (M2)

```typescript
async hybridSearch(query: string, k: number): Promise<SearchResult[]> {
  // BM25
  const bm25Results = this.bm25Search(query, 100);

  // Vector
  const queryVec = await this.embedQuery(query);
  const vecResults = this.vectorSearch(queryVec, 100);

  // Normalize + fuse
  return this.fuseResults(bm25Results, vecResults, {
    alpha: 0.4,
    beta: 0.6,
    k
  });
}
```

### Step 3: Add Graph Boost (M3)

```typescript
async hybridSearchWithGraph(
  query: string,
  contextEntityIds: number[],
  k: number
): Promise<SearchResult[]> {
  let candidates = await this.hybridSearch(query, 100);

  // Apply graph boost
  candidates = this.applyGraphBoost({
    candidateSections: candidates,
    contextEntityIds,
    k: 100
  });

  // Re-rank with γ
  candidates.forEach(c => {
    c.final_score = 0.4 * c.bm25 + 0.6 * c.vector + 0.1 * c.graph_boost;
  });

  candidates.sort((a, b) => b.final_score - a.final_score);
  return candidates.slice(0, k);
}
```

---

## Query Examples

### Example 1: Keyword-Dominant Query

**Query:** "SQLite FTS5 BM25 parameters"

**Expected:** BM25 should dominate (exact technical terms).

**Weights:** α=0.7, β=0.3

### Example 2: Semantic Query

**Query:** "How do I make search faster?"

**Expected:** Vector should dominate (paraphrase of "optimize search performance").

**Weights:** α=0.3, β=0.7

### Example 3: Contextual Query (Graph Boost)

**Context:** User editing `docs/vector-search.md` (mentions: sqlite-vec, quantization)

**Query:** "compression techniques"

**Expected:** Boost results mentioning sqlite-vec/quantization.

**Weights:** α=0.3, β=0.5, γ=0.2

### Example 4: Recent Changes

**Query:** "what changed recently?"

**Expected:** Recency boost dominates.

**Weights:** α=0.2, β=0.2, γ=0.0, δ=0.6

---

**Related:**
- [Architecture](./architecture.md) - Hybrid search in system design
- [BM25 Implementation](./data-model.md) - FTS5 DDL and triggers
- [Vector Search](./vector-search.md) - sqlite-vec querying
- [Graph Capabilities](./graph-capabilities.md) - Entity extraction and graph boosts
- [Performance](./performance.md) - Hybrid search benchmarks
