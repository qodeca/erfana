# Hybrid search – implementation and examples

> This is part 3 of the hybrid search documentation, split for readability.
>
> **Other parts:**
> - [Hybrid search – fundamentals](./hybrid-search-fundamentals.md)
> - [Hybrid search – fusion and boosts](./hybrid-search-fusion-boosts.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## Implementation guide

### Step 1: BM25-only search (M1)

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

### Step 2: Add vector search (M2)

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

### Step 3: Add graph boost (M3)

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

## Query examples

### Example 1: Keyword-dominant query

**Query:** "SQLite FTS5 BM25 parameters"

**Expected:** BM25 should dominate (exact technical terms).

**Weights:** α=0.7, β=0.3

### Example 2: Semantic query

**Query:** "How do I make search faster?"

**Expected:** Vector should dominate (paraphrase of "optimize search performance").

**Weights:** α=0.3, β=0.7

### Example 3: Contextual query (graph boost)

**Context:** User editing `docs/vector-search.md` (mentions: sqlite-vec, quantization)

**Query:** "compression techniques"

**Expected:** Boost results mentioning sqlite-vec/quantization.

**Weights:** α=0.3, β=0.5, γ=0.2

### Example 4: Recent changes

**Query:** "what changed recently?"

**Expected:** Recency boost dominates.

**Weights:** α=0.2, β=0.2, γ=0.0, δ=0.6

---

## See also

- [Hybrid search – fundamentals](./hybrid-search-fundamentals.md) – BM25, vector search, overview
- [Hybrid search – fusion and boosts](./hybrid-search-fusion-boosts.md) – score fusion strategies, graph-aware boosts, recency bias, weight tuning
- [Architecture](./architecture-overview.md) – Hybrid search in system design
- [BM25 implementation](./data-model.md) – FTS5 DDL and triggers
- [Vector Search](./vector-search-overview.md) – sqlite-vec querying
- [Graph Capabilities](./graph-capabilities-entities.md) – Entity extraction and graph boosts
- [Performance](./performance.md) – Hybrid search benchmarks
