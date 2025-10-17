# Erfana Graph Engine (SQLite‑Based)

This document specifies the local‑first, embedded implementation of the Erfana Graph Engine using SQLite with FTS5 for BM25 keyword search and a vector search extension (sqlite‑vss or sqlite‑vec) for semantic retrieval, plus lightweight graph capabilities. It covers goals, architecture, schema, pipelines, APIs, UX, performance, packaging, and a delivery roadmap.

## Goals

- Local‑first: fully offline, private, and fast; zero external services by default.
- Hybrid retrieval: BM25 (FTS5) + vector similarity (VSS) with graph‑aware boosts.
- Temporal awareness: “as‑of” queries and change timelines for entities and relations.
- Simple ops: embedded SQLite, portable models (ONNX), optional cloud providers.

## High‑Level Architecture

- Storage: SQLite database with WAL mode; FTS5 for full‑text; VSS for vectors.
- Embedding: `onnxruntime-node` for local embeddings; exact tokenizer via Hugging Face tokenizers. Optional fallback to remote embeddings (OpenAI, etc.).
- Graph: edges persisted in SQLite; neighborhood and centrality computed on demand with `graphology` when needed.
- Ingestion: debounced, incremental pipeline triggered on file save; batched tokenization/embeddings; idempotent upserts based on content hashes.
- IPC: main process service exposes `api.graph.*` methods to the renderer via preload.

## Dependencies (runtime)

- Node/Electron
- SQLite (bundled) + `better-sqlite3`
- SQLite FTS5 (built‑in)
- SQLite vector search: `sqlite-vss` (preferred) or `sqlite-vec` (fallback)
- `onnxruntime-node` (CPU) for embeddings
- `@huggingface/tokenizers` or `transformers.js` tokenizer assets
- Optional: OpenAI/Anthropic/Gemini SDKs (cloud fallback)
- Optional: `graphology` for in‑memory graph analytics

## File Layout (proposed)

- Main
  - `src/main/services/GraphEngineService.ts`
  - `src/main/db/sqlite.ts`
  - `src/main/embedding/EmbedderWorker.ts`
  - `src/main/graph/graphStore.ts`
- Preload
  - `src/preload/index.ts` (add `api.graph.*`)
- Renderer
  - `src/renderer/src/components/Sidebars/RelatedSidebar.tsx`
  - `src/renderer/src/components/Panels/GraphPanel.tsx`
  - `src/renderer/src/stores/useGraphSettingsStore.ts`

## Data Model & DDL

Notes
- All timestamps are ISO strings (UTC) or Unix epoch (ms). Use UTC consistently.
- `embedder_id` uniquely identifies the embedding fleet (model, tokenizer, dim, pooling, version).
- `valid_from`, `valid_to` power temporal queries. `tx_time` tracks write time.

Schema

```sql
PRAGMA journal_mode=WAL; -- set once at initialization

-- Files and sections
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  hash TEXT NOT NULL,
  meta_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  heading TEXT,
  level INTEGER,
  start_byte INTEGER,
  end_byte INTEGER,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(file_id, start_byte, end_byte)
);

-- Full text mirror (BM25)
CREATE VIRTUAL TABLE IF NOT EXISTS fts_sections USING fts5(
  text, heading, section_id UNINDEXED,
  content='sections', content_rowid='id'
);
-- Content synchronization triggers
CREATE TRIGGER IF NOT EXISTS sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO fts_sections(rowid, text, heading, section_id)
  VALUES (new.id, new.text, new.heading, new.id);
END;
CREATE TRIGGER IF NOT EXISTS sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO fts_sections(fts_sections, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
END;
CREATE TRIGGER IF NOT EXISTS sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO fts_sections(fts_sections, rowid, text, heading) VALUES ('delete', old.id, old.text, old.heading);
  INSERT INTO fts_sections(rowid, text, heading, section_id) VALUES (new.id, new.text, new.heading, new.id);
END;

-- Embeddings and vector table (sqlite-vss)
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  embedder_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(section_id, embedder_id)
);

-- Vector store (one per embedder fleet or use embedder_id column if extension supports it)
-- Example for sqlite-vss (single fleet):
CREATE VIRTUAL TABLE IF NOT EXISTS vss_sections USING vss0(
  embedding(384) -- adjust to model dim
);
-- Link table index: store rowid == embeddings.id, and use that to map back to section_id

-- Entities and edges (graph)
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  canonical_id INTEGER REFERENCES entities(id),
  alias_score REAL,
  created_at INTEGER NOT NULL,
  UNIQUE(name, type)
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  src_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER, -- NULL means open-ended
  tx_time INTEGER NOT NULL,
  confidence REAL,
  UNIQUE(src_id, dst_id, type, valid_from, tx_time)
);
CREATE INDEX IF NOT EXISTS edges_src_idx ON edges(src_id);
CREATE INDEX IF NOT EXISTS edges_dst_idx ON edges(dst_id);
CREATE INDEX IF NOT EXISTS edges_type_idx ON edges(type);
CREATE INDEX IF NOT EXISTS edges_valid_from_idx ON edges(valid_from);

-- Mentions (link sections to entities)
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  start_char INTEGER,
  end_char INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(section_id, entity_id, start_char, end_char)
);

-- Episodes (ingest events: file save, terminal, etc.)
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, -- 'file_save' | 'terminal' | 'json' | ...
  content_hash TEXT,
  created_at INTEGER NOT NULL
);

-- Global metadata
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Notes on vectors
- For `sqlite-vss`, insert normalized `FLOAT32` vectors via BLOB; `vss0` expects a separate table with rowids mapping to an owner table (here `embeddings`).
- Maintain `embedder_id` in `embeddings`; if you switch model fleets, either create a separate `vss` table per fleet or rebuild the single fleet table and keep old rows until swap.

## Tokenization & Chunking

- Use the exact tokenizer for the embedding model to count tokens and split content.
- Strategy
  - Parse Markdown into sections (H1–H6). Within each section, split into paragraphs/sentences.
  - Target ~256–384 tokens per chunk (configurable). Use small overlap (20–40 tokens) to preserve context across chunks.
  - Treat code blocks separately (track language). Optionally route to a code‑tuned model in the future.
  - Normalize text for embeddings: strip most Markdown syntax, normalize whitespace; keep casing unless the model expects lowercase.
- Cache
  - Hash normalized chunk text (`text_hash`). Skip re‑embedding when unchanged.
  - Persist `token_count` per section/chunk to avoid re‑tokenization on minor metadata updates.

## Embedding Pipeline

On file save (debounced):
1. Parse file into sections (with byte offsets) and compute `text_hash` per section.
2. Diff against DB; select changed/new sections.
3. Tokenize and chunk to token budget; compute `token_count`.
4. Batch embed chunks via `onnxruntime-node` worker thread(s); L2 normalize vectors.
5. Upsert rows:
   - `sections` (text, hashes, offsets)
   - `fts_sections` via triggers
   - `embeddings` (and the vector into `vss_sections` mapping `embeddings.id → vss rowid`)
6. Extract entities/mentions/edges (LLM or rules); upsert entities, mentions, edges with temporal fields.

Batching & concurrency
- Use prepared statements and wrap each logical step in a transaction.
- Batch embedding (e.g., 32–128 per call) based on CPU.
- Control concurrency with a semaphore; queue file events; coalesce rapid saves.

## Retrieval & Ranking

- BM25 keyword: `fts_sections` using FTS5.
- Vector similarity: cosine similarity via `vss_sections`.
- Hybrid score: `score = α * bm25 + β * cosine + γ * graph_boost + δ * recency` (weights configurable).
- Graph boost: for each candidate, compute lightweight neighborhood signals (e.g., number of shared entities with the query context; distance to focused entity) by querying `edges`/`mentions`. Optionally compute small in‑memory centrality on the current working set via `graphology`.
- Filters: by folder, file type, tag/entity type, date ranges; “as‑of” filter applies temporal predicates to edges.

## Temporal Queries

- As‑of: for a given timestamp T, consider edges where `valid_from <= T AND (valid_to IS NULL OR valid_to > T)`.
- Change timelines: for an entity or edge type, list periods via successive `valid_from/valid_to` ranges; visualize diffs.
- Invalidation: when extracting new conflicting edges, close previous edges by setting `valid_to = tx_time` and insert the new edge with `valid_from = tx_time`.

## IPC API Surface (Preload/Main)

Renderer calls `window.api.graph.*` (add to `src/preload/index.ts`). Main handles requests in `GraphEngineService`.

- `graph.indexFile(path: string): Promise<{ indexed: number }>`
- `graph.search(params: { q: string; k?: number; filters?: any; asOf?: number; }): Promise<{ results: Array<{ sectionId, filePath, heading, snippet, score }> }>`
- `graph.related(params: { sectionId: number; k?: number; }): Promise<{ results: Array<{ sectionId, filePath, heading, snippet, score }> }>`
- `graph.entities.find(params: { q?: string; type?: string; limit?: number }): Promise<Entity[]>`
- `graph.entities.forSection(sectionId: number): Promise<Entity[]>`
- `graph.timeline(params: { entityId?: number; fileId?: number }): Promise<TimelineItem[]>`
- `graph.settings.set(params: { embedderId?: string; weights?: any; thresholds?: any }): Promise<void>`
- `graph.reembedAll(params?: { concurrency?: number }): Promise<{ queued: number }>`
- `graph.reindexAll(): Promise<{ queued: number }>`

Error model: reject with `{ code, message, details? }`; never crash renderer.

## Renderer UX

- Related Sidebar (`RelatedSidebar.tsx`)
  - Shows top‑k related sections/snippets for the active editor selection or file.
  - Actions: open, copy citation, insert link/snippet.
- Knowledge Panel (`GraphPanel.tsx`)
  - Entities, relations, mentions for the current section; backlinks; “impact” view.
- Global Search
  - Hybrid search with filters and “Why this result?” (BM25, cosine, boosts breakdown).
- Time Slider
  - As‑of UI to pivot queries and graph overlays to a past time.
- Insert/Refresh Mermaid
  - Generate local neighborhood diagrams for a selected entity or file context.

## Settings & Metadata

- Active embedder
  - `meta(embedder_id)` stores `{ model, tokenizer, dim, pooling, version }`.
  - Changing embedder prompts re‑embed workflow (see migration).
- Weights & thresholds
  - Hybrid weights, min confidence, dedupe thresholds, chunk token budget, overlap.
- Inclusion filters
  - Respect `.gitignore` + custom ignore rules; per‑folder opt‑in/out.
- Redaction
  - Apply regex/pattern redaction before indexing/embedding to avoid secrets leakage.

## Performance & Reliability

- SQLite pragmas
  - `PRAGMA journal_mode=WAL;`
  - `PRAGMA synchronous=NORMAL;` (configurable)
  - `PRAGMA temp_store=MEMORY;`
- Use prepared statements, batch inserts, and transactions.
- Cache token counts and chunk boundaries; skip unchanged sections.
- Background workers (embedding) via `worker_threads`; configurable concurrency.
- Health checks: on startup, verify FTS/VSS availability; auto‑fallbacks.

## Packaging & Native Modules

- `better-sqlite3` and `onnxruntime-node` are native; ensure they are rebuilt for Electron in postinstall (`electron-builder install-app-deps`).
- Ship platform builds of the vector extension:
  - Preferred: `sqlite-vss` (macOS, Windows, Linux); load in `sqlite.ts` with `db.loadExtension(path)`.
  - Fallbacks: `sqlite-vec`, or JS cosine search for very small corpora.
- Model assets
  - Bundle ONNX model and tokenizer files or download on first run into an app cache dir.

## Security & Privacy

- Default local‑only operation; no telemetry.
- Redact secrets before indexing/embedding.
- Opt‑in for cloud embeddings and LLMs; use per‑project API key scoping.

## Testing Strategy

- Unit
  - Tokenization, chunking, hashing, dedupe logic; embedding normalization; SQL helpers.
- Integration
  - Index small workspaces; verify FTS and VSS agreement and hybrid ranking stability.
  - Temporal edge updates (invalidation/closing) and as‑of queries.
- Performance
  - Batch embedding throughput; DB write/read latency; search latency with increasing corpus sizes.

## Migration & Re‑Embedding

- Maintain `embedder_id` per vector; store current active `embedder_id` in `meta`.
- When switching embedder:
  - Queue background re‑embedding by batches.
  - During migration, filter searches to active `embedder_id` but allow dual‑fleet testing in a hidden mode.
  - Provide progress UI and safe rollback.

## Roadmap & Milestones

- M1: DB schema, FTS5 search, index‑on‑save, Related Sidebar (keyword‑only)
- M2: Vector search (VSS), hybrid ranking, embedder worker, settings UI
- M3: Entity/mentions/edges extraction, backlinks, impact analysis
- M4: Temporal fields, as‑of queries, contradiction surfacing, timeline UI
- M5: Mermaid graph insertion/refresh; reindex/reembed UX and maintenance tooling

## Open Questions & Options

- Multilingual support: choose multilingual model (e.g., `bge-m3`) vs. English‑first; consider per‑project setting.
- Code embeddings: add an optional code‑focused model for code blocks.
- Reranking: add a light cross‑encoder reranker (cloud or local) for top‑N.
- Adaptive chunking: adjust chunk sizes based on section structure, not just tokens.

## Implementation Notes (Main Process)

- Database init in `src/main/db/sqlite.ts`:
  - Open DB, set WAL, load vector extension, run DDL migrations, prep statements.
- Service `src/main/services/GraphEngineService.ts`:
  - Queue saves; run indexing pipeline; expose search/related/entities/timeline APIs.
- Embedding worker `src/main/embedding/EmbedderWorker.ts`:
  - Load ONNX session and tokenizer; batch inference; return normalized vectors.
- Graph store `src/main/graph/graphStore.ts`:
  - Helpers for entity/edge upsert, invalidation, and small neighborhood retrieval.

## Minimal Example Queries

- Hybrid search (sketch):
```sql
-- 1) Keyword candidates
SELECT s.id AS section_id, s.file_id, f.path, s.heading,
       bm25(fts) AS bm25
FROM fts_sections fts
JOIN sections s ON s.id = fts.rowid
JOIN files f ON f.id = s.file_id
WHERE fts_sections MATCH :q
ORDER BY bm25 LIMIT :k_keyword;

-- 2) Vector candidates (sqlite-vss)
SELECT e.section_id, v.distance AS cosine
FROM vss_sections v
JOIN embeddings e ON e.id = v.rowid
WHERE vss_search(embedding, :query_vec) -- extension API
LIMIT :k_vector;
```
Combine in app code, normalize scores, apply boosts/filters, and return ranked results.

---

This document is the source of truth for the Erfana Graph Engine (SQLite) implementation. Update it as design evolves and as we make concrete choices about models, extensions, and defaults.

