# Acceptance criteria

## sqlite-vec integration

### 005-AC-001: Extension loads successfully

**Description:** sqlite-vec extension loads into better-sqlite3 without errors.

**Given:** Application starts with Spec #004 database initialized.

**When:** Vector search module initializes.

**Then:**
- sqlite-vec extension is loaded
- Version is logged at INFO level
- `vec_version()` function returns valid version string

**Traces to:** 005-FR-001, 005-FR-003

---

### 005-AC-002: Vector table created

**Description:** vss_sections virtual table is created and operational.

**Given:** sqlite-vec extension is loaded.

**When:** Schema initialization runs.

**Then:**
- `vss_sections` virtual table exists
- Table accepts 384-dimensional vectors
- Table can be queried without errors

**Traces to:** 005-FR-002

---

### 005-AC-003: Embeddings table with constraints

**Description:** Embeddings table has proper schema and constraints.

**Given:** Database is initialized.

**When:** Embeddings table is created.

**Then:**
- Table has columns: section_id, chunk_index, embedding, embedder_id, created_at
- Foreign key to sections table exists
- Deleting a section cascades to delete its embeddings

**Traces to:** 005-FR-004, 005-FR-006

---

## ONNX embedding worker

### 005-AC-004: Worker starts and loads model

**Description:** Embedding worker initializes and loads model successfully.

**Given:** Application starts.

**When:** Embedding worker pool initializes.

**Then:**
- Worker thread spawns successfully
- all-MiniLM-L6-v2 model loads without errors
- Tokenizer initializes
- Worker reports ready status

**Traces to:** 005-FR-007, 005-FR-008, 005-FR-009

---

### 005-AC-005: Embedding generation produces correct dimensions

**Description:** Generated embeddings have correct dimensions and normalization.

**Given:** Worker is ready.

**When:** Text "Hello world" is embedded.

**Then:**
- Output is 384-dimensional float array
- Vector is L2-normalized (magnitude approximately 1.0)
- embedder_id is recorded as "all-MiniLM-L6-v2:1.0.0"

**Traces to:** 005-FR-011, 005-FR-005

---

### 005-AC-006: Batch processing works correctly

**Description:** Multiple texts are processed in efficient batches.

**Given:** Worker pool with 2 workers.

**When:** 100 text chunks are submitted for embedding.

**Then:**
- Chunks are batched (32-128 per batch)
- All 100 embeddings are generated
- Total time is less than processing serially

**Traces to:** 005-FR-010, 005-FR-012

---

## Worker pool management

### 005-AC-007: Concurrent workers limited

**Description:** Worker pool respects concurrency limits.

**Given:** Configuration requests 6 workers.

**When:** Worker pool initializes.

**Then:**
- Only 4 workers are created
- Warning is logged about capping at 4
- All 4 workers function correctly

**Traces to:** 005-FR-013

---

### 005-AC-008: Crash recovery works

**Description:** Crashed workers are automatically replaced.

**Given:** Worker pool with 2 active workers.

**When:** One worker crashes (simulate with process.exit in worker).

**Then:**
- Crash is detected within 1 second
- Replacement worker spawns
- Recovery completes within 5 seconds
- Pending batches are re-queued

**Traces to:** 005-FR-014, 005-NFR-004

---

### 005-AC-009: Repeated crashes trigger degradation

**Description:** Multiple crashes trigger single-worker fallback.

**Given:** Worker pool with 2 workers.

**When:** Workers crash 4 times within 60 seconds.

**Then:**
- After 3rd crash, pool switches to single-worker mode
- Warning is logged about degraded mode
- Embedding continues with reduced throughput

**Traces to:** 005-FR-014, 005-NFR-005

---

## Chunking

### 005-AC-010: Text chunked correctly

**Description:** Long text is split into appropriate chunks.

**Given:** Text with 1000 tokens.

**When:** Text is chunked with default settings (300 tokens, 12% overlap).

**Then:**
- Approximately 4 chunks are created
- Each chunk is 264-336 tokens (300 +/- 12%)
- Consecutive chunks have ~36 token overlap

**Traces to:** 005-FR-017, 005-FR-018

---

### 005-AC-011: Sentence boundaries respected

**Description:** Chunks break at sentences when possible.

**Given:** Text with clear sentence boundaries.

**When:** Text is chunked.

**Then:**
- Chunks end at sentence boundaries (periods, question marks)
- No sentence is split unless it exceeds chunk size

**Traces to:** 005-FR-019

---

## Text preprocessing

### 005-AC-031: Markdown preprocessing removes syntax

**Description:** Markdown syntax is stripped before embedding.

**Given:** Markdown text with frontmatter, headings, links, emphasis, and code blocks.

**When:** Text is preprocessed for embedding.

**Then:**
- YAML frontmatter is removed
- Heading markers (#) are removed
- Link syntax removed, link text preserved
- Emphasis markers removed, text preserved
- Code block markers removed, code content preserved as text
- Whitespace is normalized

**Traces to:** 005-FR-035

---

## Model bundling

### 005-AC-032: Model loads from bundled resources

**Description:** Embedding model loads from application resources without network.

**Given:** Application installed with bundled models.

**When:** Embedding worker initializes.

**Then:**
- Model loads from resources/models/all-MiniLM-L6-v2.onnx
- Tokenizer loads from resources/models/all-MiniLM-L6-v2-tokenizer.json
- No network requests are made
- Worker becomes ready within 5 seconds

**Traces to:** 005-FR-036

---

## Vector search

### 005-AC-012: Query embedding matches documents

**Description:** Semantically similar queries find relevant documents.

**Given:** Documents about "user login" and "payment processing" are indexed.

**When:** Query "authentication flow" is searched.

**Then:**
- "user login" document has higher similarity than "payment processing"
- Results are ordered by decreasing similarity

**Traces to:** 005-FR-020, 005-FR-021, 005-FR-022

---

### 005-AC-013: Top-K retrieval respects limit

**Description:** Result count respects K parameter.

**Given:** Database with 100 indexed documents.

**When:** Search with K=5.

**Then:**
- Exactly 5 results are returned
- Results are the 5 nearest neighbors

**Traces to:** 005-FR-022

---

### 005-AC-014: Chunk results aggregated to sections

**Description:** Multiple chunks per section are aggregated correctly.

**Given:** Section with 4 chunks, one very similar to query.

**When:** Vector search runs.

**Then:**
- Section appears once in results
- Score is based on best matching chunk (minimum distance)

**Traces to:** 005-FR-023

---

## Hybrid search fusion

### 005-AC-015: BM25 scores normalized correctly

**Description:** BM25 scores are normalized to [0, 1] range.

**Given:** BM25 search returns scores [10, 5, 2, 1].

**When:** Normalization is applied.

**Then:**
- Normalized scores are [1.0, 0.44, 0.11, 0.0]
- Highest original score maps to 1.0
- Lowest original score maps to 0.0

**Traces to:** 005-FR-024

---

### 005-AC-016: Vector distances converted to similarity

**Description:** L2 distances are converted to similarity scores.

**Given:** L2 distances [0.0, 0.5, 1.0, 2.0].

**When:** Conversion is applied.

**Then:**
- Similarities are [1.0, 0.67, 0.5, 0.33]
- Distance 0 produces similarity 1.0
- Higher distance produces lower similarity

**Traces to:** 005-FR-025

---

### 005-AC-017: Fusion weights applied correctly

**Description:** Combined score uses correct weight formula.

**Given:** BM25 normalized = 0.8, vector similarity = 0.6, alpha = 0.4, beta = 0.6.

**When:** Fusion is applied.

**Then:**
- Combined score = 0.4 * 0.8 + 0.6 * 0.6 = 0.68

**Traces to:** 005-FR-026

---

### 005-AC-018: Invalid weights rejected

**Description:** Weight validation catches invalid values.

**Given:** Attempt to set alpha = 0.7, beta = 0.5.

**When:** Settings are saved.

**Then:**
- Error is shown: "Weights must sum to 1.0"
- Previous valid weights are retained

**Traces to:** 005-FR-028

---

## Settings UI

### 005-AC-019: Weight sliders linked

**Description:** Adjusting one slider updates the other.

**Given:** Settings overlay is open, alpha = 0.4, beta = 0.6.

**When:** Alpha slider is dragged to 0.7.

**Then:**
- Beta automatically updates to 0.3
- Sum remains 1.0

**Traces to:** 005-FR-029

---

### 005-AC-020: Preview updates with weights

**Description:** Search preview reflects weight changes.

**Given:** Settings overlay with preview showing 5 results.

**When:** Alpha is changed from 0.4 to 0.8.

**Then:**
- Preview updates after 300ms debounce
- Result order may change based on new weights
- Loading indicator shows during computation

**Traces to:** 005-FR-030

---

### 005-AC-021: Settings persist across restart

**Description:** Custom weights are retained after app restart.

**Given:** Alpha = 0.7, beta = 0.3 are saved.

**When:** App restarts.

**Then:**
- Settings load with alpha = 0.7, beta = 0.3
- Searches use these weights

**Traces to:** 005-FR-031

---

### 005-AC-022: Reset to defaults works

**Description:** Reset button restores default weights.

**Given:** Custom weights alpha = 0.8, beta = 0.2.

**When:** "Reset to defaults" is clicked.

**Then:**
- Alpha becomes 0.4, beta becomes 0.6
- Preview updates with default weights

**Traces to:** 005-FR-032

---

## MCP integration

### 005-AC-023: erfana_graph_related returns related sections

**Description:** MCP tool finds semantically related sections.

**Given:** Section ID 42 exists with embedding.

**When:** `erfana_graph_related(section_id=42, limit=5)` is called.

**Then:**
- Returns up to 5 related sections
- Results include section_id and similarity_score
- Results are ordered by decreasing similarity
- Source section (42) is excluded from results

**Traces to:** 005-FR-033

---

### 005-AC-024: Rate limiting enforced

**Description:** Excessive MCP queries are rate limited.

**Given:** MCP client making rapid requests.

**When:** 101 requests are made in one minute.

**Then:**
- First 100 requests succeed
- 101st request returns rate limit error
- Error includes retry-after value

**Traces to:** 005-FR-034

---

## Performance criteria

### 005-AC-025: Embedding throughput meets target

**Description:** Embedding generation achieves target throughput.

**Given:** 2-worker pool on M1/M2 Mac.

**When:** 1000 chunks are processed.

**Then:**
- Total time < 10 seconds
- Throughput > 100 chunks/second

**Traces to:** 005-NFR-001

---

### 005-AC-026: Vector search latency meets target

**Description:** Vector search is fast at scale.

**Given:** Database with 100K sections and 500K embeddings.

**When:** 100 vector searches are performed.

**Then:**
- P95 latency < 100ms

**Traces to:** 005-NFR-002

---

### 005-AC-027: Hybrid search latency meets target

**Description:** Combined search is fast at scale.

**Given:** Database with 100K sections.

**When:** 100 hybrid searches are performed.

**Then:**
- P95 latency < 150ms (includes BM25 + vector + fusion)

**Traces to:** 005-NFR-003

---

### 005-AC-028: Memory limits respected

**Description:** Embedding cache stays within limits.

**Given:** Large document set requiring >100MB of embeddings.

**When:** All documents are processed and cached.

**Then:**
- Cache size does not exceed 100MB
- LRU eviction occurs
- Evicted embeddings can be re-fetched from database

**Traces to:** 005-NFR-006

---

## Error handling

### 005-AC-029: Graceful degradation on vector failure

**Description:** Search continues when vector search fails.

**Given:** Vector search is unavailable (workers crashed).

**When:** User performs a search.

**Then:**
- BM25 results are returned
- Toast warning: "Semantic search unavailable, showing keyword results only"
- No error thrown to user

**Traces to:** 005-NFR-005

---

### 005-AC-030: Model load failure handled

**Description:** Missing model file is handled gracefully.

**Given:** all-MiniLM-L6-v2 model file is missing.

**When:** Worker attempts to initialize.

**Then:**
- Clear error logged: "Failed to load embedding model"
- Graceful degradation to BM25-only mode
- User notified via status indicator

**Traces to:** 005-NFR-005

---

## Acceptance criteria summary

| Category | Count | IDs |
|----------|-------|-----|
| sqlite-vec integration | 3 | 005-AC-001 through 005-AC-003 |
| ONNX embedding worker | 3 | 005-AC-004 through 005-AC-006 |
| Worker pool management | 3 | 005-AC-007 through 005-AC-009 |
| Chunking | 2 | 005-AC-010 through 005-AC-011 |
| Text preprocessing | 1 | 005-AC-031 |
| Model bundling | 1 | 005-AC-032 |
| Vector search | 3 | 005-AC-012 through 005-AC-014 |
| Hybrid search fusion | 4 | 005-AC-015 through 005-AC-018 |
| Settings UI | 4 | 005-AC-019 through 005-AC-022 |
| MCP integration | 2 | 005-AC-023 through 005-AC-024 |
| Performance criteria | 4 | 005-AC-025 through 005-AC-028 |
| Error handling | 2 | 005-AC-029 through 005-AC-030 |
| **Total** | **32** | |
