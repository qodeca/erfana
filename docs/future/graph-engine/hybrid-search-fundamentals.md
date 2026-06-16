# Hybrid search – fundamentals

> This is part 1 of the hybrid search documentation, split for readability.
>
> **Other parts:**
> - [Hybrid search – fusion and boosts](./hybrid-search-fusion-boosts.md)
> - [Hybrid search – implementation and examples](./hybrid-search-implementation.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document covers hybrid search architecture, combining BM25 keyword search (FTS5), vector similarity (sqlite-vec), and graph-aware boosts into a unified ranking system.

---

## Hybrid search overview

### Why hybrid?

No single retrieval method is perfect:

| Method | Strengths | Weaknesses |
|--------|-----------|------------|
| **BM25** | Exact keyword matching, proper nouns, acronyms | Misses synonyms, paraphrases |
| **Vector** | Semantic similarity, handles paraphrases | Weak on exact terms, proper nouns |
| **Graph** | Contextual relevance, entity relationships | Requires entity extraction (overhead) |

**Hybrid search** combines all three to maximize recall and precision.

### Industry standard weights (October 2025)

Research shows typical production systems use:
- **α (BM25):** 0.3 - 0.5 (40% weight)
- **β (Vector):** 0.5 - 0.7 (60% weight)
- **γ (Graph):** 0.0 - 0.2 (0-20% boost, optional)
- **δ (Recency):** 0.0 - 0.1 (0-10% boost, optional)

**Erfana Default:** α=0.4, β=0.6, γ=0.0, δ=0.0

### Ranking formula

```
final_score = α * norm_bm25 + β * norm_cosine + γ * graph_boost + δ * recency_boost

Where:
- norm_bm25: Normalized BM25 score (0-1)
- norm_cosine: Cosine similarity (0-1)
- graph_boost: Entity overlap score (0-1)
- recency_boost: Time decay factor (0-1)
```

---

## BM25 keyword search

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

### SQLite FTS5 implementation

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

### Query syntax

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

### BM25 score normalization

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

## Vector semantic search

### Cosine similarity

**Formula:**

```
cosine(a, b) = dot(a, b) / (||a|| * ||b||)

If vectors are L2-normalized (||a|| = ||b|| = 1):
cosine(a, b) = dot(a, b)
```

**Range:** -1 (opposite) to +1 (identical)

### sqlite-vec distance metrics

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

### Vector search implementation

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

## See also

- [Hybrid search – fusion and boosts](./hybrid-search-fusion-boosts.md) – score fusion strategies, graph-aware boosts, recency bias, weight tuning
- [Hybrid search – implementation and examples](./hybrid-search-implementation.md) – step-by-step implementation guide, query examples
- [Architecture](./architecture-overview.md) – Hybrid search in system design
- [BM25 implementation](./data-model.md) – FTS5 DDL and triggers
- [Vector Search](./vector-search-overview.md) – sqlite-vec querying
- [Graph Capabilities](./graph-capabilities-entities.md) – Entity extraction and graph boosts
- [Performance](./performance.md) – Hybrid search benchmarks
