# Data Model & Schema

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document provides the complete SQLite schema, design rationale, and usage patterns for the Erfana Graph Engine database.

---

## Table of Contents

1. [Schema Overview](#schema-overview)
2. [Complete DDL](#complete-ddl)
3. [Table Details](#table-details)
4. [Temporal Patterns](#temporal-patterns)
5. [Indexing Strategy](#indexing-strategy)
6. [Query Examples](#query-examples)

---

## Schema Overview

The database consists of 8 core tables plus 2 virtual tables:

### Content Tables
- **files**: Markdown files in the project
- **sections**: Chunked content from files (headings + paragraphs)
- **fts_sections**: FTS5 virtual table for keyword search

### Vector & Embedding Tables
- **embeddings**: Metadata for vector embeddings
- **vss_sections**: sqlite-vec virtual table for vector similarity

### Graph Tables
- **entities**: Named concepts/topics extracted from content
- **edges**: Relationships between entities (temporal)
- **mentions**: Links between sections and entities

### Metadata Tables
- **episodes**: Ingestion events (file saves, terminal logs)
- **meta**: Global key-value config (embedder ID, settings)

---

## Complete DDL

```sql
-- Set WAL mode (run once at DB initialization)
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;  -- Faster than FULL, safe with WAL
PRAGMA temp_store=MEMORY;   -- Temp tables in RAM

-- ================================================================
-- CONTENT TABLES
-- ================================================================

-- Files: Markdown documents in the project
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,           -- Relative path from project root
  hash TEXT NOT NULL,                   -- SHA-256 of file content (for change detection)
  meta_json TEXT,                       -- JSON: {title, frontmatter, tags, ...}
  updated_at INTEGER NOT NULL           -- Unix epoch (ms)
);
CREATE INDEX IF NOT EXISTS files_path_idx ON files(path);
CREATE INDEX IF NOT EXISTS files_updated_at_idx ON files(updated_at);

-- Sections: Chunked content from files (256-384 tokens per chunk)
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  heading TEXT,                         -- Nearest H1-H6 heading (if any)
  level INTEGER,                        -- Heading level (1-6, NULL for content)
  start_byte INTEGER,                   -- Byte offset in file (for source mapping)
  end_byte INTEGER,
  text TEXT NOT NULL,                   -- Normalized text (markdown stripped)
  text_hash TEXT NOT NULL,              -- SHA-256 of text (skip re-embed if unchanged)
  token_count INTEGER NOT NULL,         -- Exact token count (from tokenizer)
  updated_at INTEGER NOT NULL,          -- Unix epoch (ms)
  UNIQUE(file_id, start_byte, end_byte)
);
CREATE INDEX IF NOT EXISTS sections_file_id_idx ON sections(file_id);
CREATE INDEX IF NOT EXISTS sections_text_hash_idx ON sections(text_hash);

-- FTS5: Full-text search with BM25 ranking
CREATE VIRTUAL TABLE IF NOT EXISTS fts_sections USING fts5(
  text,                                 -- Normalized text content
  heading,                              -- Heading text (weighted higher in searches)
  section_id UNINDEXED,                 -- Link back to sections.id (not searchable)
  content='sections',                   -- External content table
  content_rowid='id'                    -- Map fts rowid to sections.id
);

-- Triggers: Sync fts_sections with sections table
CREATE TRIGGER IF NOT EXISTS sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO fts_sections(rowid, text, heading, section_id)
  VALUES (new.id, new.text, new.heading, new.id);
END;

CREATE TRIGGER IF NOT EXISTS sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO fts_sections(fts_sections, rowid, text, heading)
  VALUES ('delete', old.id, old.text, old.heading);
END;

CREATE TRIGGER IF NOT EXISTS sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO fts_sections(fts_sections, rowid, text, heading)
  VALUES ('delete', old.id, old.text, old.heading);
  INSERT INTO fts_sections(rowid, text, heading, section_id)
  VALUES (new.id, new.text, new.heading, new.id);
END;

-- ================================================================
-- VECTOR & EMBEDDING TABLES
-- ================================================================

-- Embeddings: Metadata for vector embeddings
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  embedder_id TEXT NOT NULL,            -- e.g., 'all-MiniLM-L6-v2:v1.0'
  dim INTEGER NOT NULL,                 -- Vector dimensionality (384, 768, 1536...)
  created_at INTEGER NOT NULL,          -- Unix epoch (ms)
  UNIQUE(section_id, embedder_id)       -- One embedding per section per model
);
CREATE INDEX IF NOT EXISTS embeddings_section_id_idx ON embeddings(section_id);
CREATE INDEX IF NOT EXISTS embeddings_embedder_id_idx ON embeddings(embedder_id);

-- Vector store (sqlite-vec)
-- NOTE: Adjust embedding(N) to match your model's dimension
CREATE VIRTUAL TABLE IF NOT EXISTS vss_sections USING vec0(
  embedding FLOAT[384]                  -- 384 for all-MiniLM-L6-v2
);
-- Link: vss_sections.rowid == embeddings.id (use embeddings.section_id to join back)

-- ================================================================
-- GRAPH TABLES
-- ================================================================

-- Entities: Named concepts/topics extracted from content
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                   -- e.g., 'React', 'SQLite', 'John Doe'
  type TEXT NOT NULL,                   -- e.g., 'library', 'database', 'person'
  canonical_id INTEGER REFERENCES entities(id),  -- For aliases: 'React' -> 'React.js'
  alias_score REAL,                     -- Confidence that this is an alias (0-1)
  created_at INTEGER NOT NULL,          -- Unix epoch (ms)
  UNIQUE(name, type)                    -- No duplicate entities
);
CREATE INDEX IF NOT EXISTS entities_name_idx ON entities(name);
CREATE INDEX IF NOT EXISTS entities_type_idx ON entities(type);
CREATE INDEX IF NOT EXISTS entities_canonical_id_idx ON entities(canonical_id);

-- Edges: Temporal relationships between entities
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  src_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- e.g., 'uses', 'references', 'depends-on'
  valid_from INTEGER NOT NULL,          -- Start of validity (Unix epoch ms)
  valid_to INTEGER,                     -- End of validity (NULL = still valid)
  tx_time INTEGER NOT NULL,             -- Transaction time (when edge was created)
  confidence REAL,                      -- Extraction confidence (0-1)
  UNIQUE(src_id, dst_id, type, valid_from, tx_time)
);
CREATE INDEX IF NOT EXISTS edges_src_idx ON edges(src_id);
CREATE INDEX IF NOT EXISTS edges_dst_idx ON edges(dst_id);
CREATE INDEX IF NOT EXISTS edges_type_idx ON edges(type);
CREATE INDEX IF NOT EXISTS edges_valid_from_idx ON edges(valid_from);
CREATE INDEX IF NOT EXISTS edges_valid_to_idx ON edges(valid_to);

-- Mentions: Links between sections and entities
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  start_char INTEGER,                   -- Character offset in section.text
  end_char INTEGER,
  created_at INTEGER NOT NULL,          -- Unix epoch (ms)
  UNIQUE(section_id, entity_id, start_char, end_char)
);
CREATE INDEX IF NOT EXISTS mentions_section_id_idx ON mentions(section_id);
CREATE INDEX IF NOT EXISTS mentions_entity_id_idx ON mentions(entity_id);

-- ================================================================
-- METADATA TABLES
-- ================================================================

-- Episodes: Ingestion events (for debugging and provenance)
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                   -- 'file_save' | 'terminal' | 'json' | ...
  content_hash TEXT,                    -- Hash of content that triggered episode
  created_at INTEGER NOT NULL           -- Unix epoch (ms)
);
CREATE INDEX IF NOT EXISTS episodes_kind_idx ON episodes(kind);
CREATE INDEX IF NOT EXISTS episodes_created_at_idx ON episodes(created_at);

-- Meta: Global key-value configuration
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                   -- JSON or plain string
);

-- Default meta values
INSERT OR IGNORE INTO meta(key, value) VALUES
  ('schema_version', '1'),
  ('embedder_id', 'all-MiniLM-L6-v2:v1.0'),
  ('hybrid_weights', '{"alpha":0.4,"beta":0.6,"gamma":0.0,"delta":0.0}'),
  ('chunk_tokens', '256'),
  ('chunk_overlap', '25');
```

---

## Table Details

### files
**Purpose:** Track markdown files in the project.

**Key Fields:**
- `path`: Relative path from project root (e.g., `docs/architecture.md`)
- `hash`: SHA-256 of file content; reindex if changed
- `meta_json`: JSON blob for title, frontmatter (YAML), tags
- `updated_at`: Last modification time (Unix epoch ms)

**Cascade Behavior:** DELETE file → cascade to sections → cascade to embeddings/mentions

### sections
**Purpose:** Store chunked, normalized content for search/embedding.

**Key Fields:**
- `text`: Normalized markdown (stripped syntax, preserved meaning)
- `text_hash`: SHA-256 of `text`; skip re-embed if unchanged
- `token_count`: Exact count from tokenizer (e.g., 256-384)
- `heading` + `level`: Nearest H1-H6 for context
- `start_byte` + `end_byte`: Source mapping for jump-to-line

**Constraints:** `UNIQUE(file_id, start_byte, end_byte)` prevents duplicate chunks

### fts_sections
**Purpose:** Fast BM25 keyword search.

**How It Works:**
- Virtual table backed by sections (external content)
- Triggers keep it in sync (insert/update/delete)
- Use `ORDER BY rank` for best performance (faster than `ORDER BY bm25(...)`)

**Weighted Columns:**
```sql
-- Weight heading 3x higher than text
SELECT ... FROM fts_sections
WHERE fts_sections MATCH :query
ORDER BY bm25(fts_sections, 3.0, 1.0) LIMIT 10;
```

### embeddings
**Purpose:** Store vector embedding metadata (vectors live in `vss_sections`).

**Key Fields:**
- `embedder_id`: Model identifier (e.g., `all-MiniLM-L6-v2:v1.0`)
- `dim`: Vector dimension (384, 768, 1536, etc.)
- `created_at`: When embedding was generated

**Link to vectors:** `vss_sections.rowid` == `embeddings.id`

### vss_sections
**Purpose:** Store and search vector embeddings (sqlite-vec).

**How It Works:**
- Virtual table with FLOAT[N] column
- Brute-force KNN search (no ANN yet in v0.1.0)
- Insert normalized vectors (L2 norm = 1.0)

**Example Query:**
```sql
-- Find 10 nearest neighbors
SELECT e.section_id, vec_distance_L2(v.embedding, :query_vec) AS distance
FROM vss_sections v
JOIN embeddings e ON e.id = v.rowid
WHERE e.embedder_id = :active_embedder
ORDER BY distance ASC
LIMIT 10;
```

### entities
**Purpose:** Store named concepts extracted from content.

**Key Fields:**
- `name`: Entity name (e.g., `React`, `SQLite`)
- `type`: Entity type (e.g., `library`, `database`, `person`)
- `canonical_id`: For aliases (e.g., `React` is canonical for `ReactJS`)

**Extraction Methods:**
- **LLM-based:** GPT-4/Claude extract structured entities
- **Rule-based:** Regex for [[wikilinks]], #tags, @mentions

### edges
**Purpose:** Store temporal relationships between entities.

**Temporal Fields:**
- `valid_from`: When relationship started being true
- `valid_to`: When relationship stopped (NULL = still true)
- `tx_time`: When we learned about the relationship

**Example:** "Project uses React" → `(project_entity, react_entity, 'uses', 2024-01-01, NULL, 2024-01-01)`

**Invalidation Pattern:**
```sql
-- Close old edge
UPDATE edges SET valid_to = :now WHERE id = :old_edge_id;
-- Insert new edge
INSERT INTO edges (src_id, dst_id, type, valid_from, tx_time)
VALUES (:src, :dst, :type, :now, :now);
```

### mentions
**Purpose:** Link sections to entities (provenance).

**Use Case:** "Which sections mention React?" → backlinks

---

## Temporal Patterns

### Valid Time (valid_from, valid_to)
**Represents:** When a fact was true in the real world.

**Query Pattern (As-Of):**
```sql
-- "What entities were related on 2024-06-01?"
SELECT * FROM edges
WHERE valid_from <= 1717200000000  -- 2024-06-01 in Unix ms
  AND (valid_to IS NULL OR valid_to > 1717200000000);
```

### Transaction Time (tx_time)
**Represents:** When we learned about a fact.

**Use Case:** Audit trail, debugging extractions

### Bitemporal Pattern
Combine `valid_from/to` + `tx_time` for full history:
- "What did we think was true on date X?"
- "When did we learn that fact Y changed?"

---

## Indexing Strategy

### Files
- `path` (UNIQUE) - Fast file lookup
- `updated_at` - Range queries (e.g., "files changed in last 7 days")

### Sections
- `file_id` - Join files ↔ sections
- `text_hash` - Dedupe embeddings

### Embeddings
- `section_id` - Join sections ↔ embeddings
- `embedder_id` - Filter by active model

### Edges
- `src_id`, `dst_id` - Graph traversal
- `type` - Filter by relationship type
- `valid_from`, `valid_to` - Temporal queries

### Mentions
- `section_id`, `entity_id` - Bidirectional lookups

---

## Query Examples

### 1. Find sections that mention multiple entities
```sql
SELECT s.id, s.heading, COUNT(DISTINCT m.entity_id) AS entity_count
FROM sections s
JOIN mentions m ON m.section_id = s.id
WHERE m.entity_id IN (SELECT id FROM entities WHERE name IN ('React', 'SQLite'))
GROUP BY s.id
HAVING entity_count = 2;
```

### 2. Backlinks for an entity
```sql
-- "Which sections reference 'React'?"
SELECT f.path, s.heading, s.text
FROM mentions m
JOIN entities e ON e.id = m.entity_id
JOIN sections s ON s.id = m.section_id
JOIN files f ON f.id = s.file_id
WHERE e.name = 'React'
ORDER BY s.updated_at DESC;
```

### 3. Temporal query: "What did the graph look like 3 months ago?"
```sql
SELECT src.name AS from_entity, edge.type, dst.name AS to_entity
FROM edges edge
JOIN entities src ON src.id = edge.src_id
JOIN entities dst ON dst.id = edge.dst_id
WHERE edge.valid_from <= :three_months_ago
  AND (edge.valid_to IS NULL OR edge.valid_to > :three_months_ago);
```

### 4. Hybrid search (sketch)
```sql
-- Step 1: BM25 candidates
WITH bm25_results AS (
  SELECT s.id AS section_id, bm25(fts, 3.0, 1.0) AS bm25_score
  FROM fts_sections fts
  JOIN sections s ON s.id = fts.rowid
  WHERE fts_sections MATCH :query
  ORDER BY bm25_score
  LIMIT 50
),
-- Step 2: Vector candidates
vector_results AS (
  SELECT e.section_id, vec_distance_L2(v.embedding, :query_vec) AS vec_dist
  FROM vss_sections v
  JOIN embeddings e ON e.id = v.rowid
  WHERE e.embedder_id = :active_embedder
  ORDER BY vec_dist
  LIMIT 50
)
-- Step 3: Combine (application-side normalization + weighting)
SELECT DISTINCT b.section_id FROM bm25_results b
UNION
SELECT DISTINCT v.section_id FROM vector_results v;
-- (Then normalize scores and apply α*bm25 + β*cosine in app code)
```

---

**Related:**
- [Architecture](./architecture-overview.md)
- [Vector Search](./vector-search-overview.md)
- [Graph Capabilities](./graph-capabilities-entities.md)
