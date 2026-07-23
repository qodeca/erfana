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
- Table accepts vectors of the model-profile dimension (default 256)
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

**Given:** Application starts and the model was previously downloaded (005-FR-036).

**When:** Embedding worker pool initializes.

**Then:**
- Worker thread spawns successfully
- The active model profile (default EmbeddingGemma-300m) loads without errors via the transformers.js pipeline
- Tokenizer initializes
- Worker reports ready status
- Alternative: if the model has not been downloaded, the worker reports BM25-only readiness without error

**Traces to:** 005-FR-007, 005-FR-008, 005-FR-009

---

### 005-AC-005: Embedding generation produces correct dimensions

**Description:** Generated embeddings have correct dimensions and normalization.

**Given:** Worker is ready.

**When:** Text "Hello world" is embedded.

**Then:**
- Token embeddings are mean-pooled (attention-mask weighted), L2-normalized, MRL-truncated to the profile dimension (default 256), and re-normalized – in that order
- Output is a float array of the model-profile dimension
- Vector is L2-normalized (magnitude approximately 1.0)
- embedder_id is recorded as "embeddinggemma-300m:1.0:d256"

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

## On-demand model delivery

### 005-AC-032: Model available after on-demand download

**Description:** Semantic search works only after the one-time verified download; BM25 works regardless.

**Given:** Fresh install, semantic search never enabled.

**When:** The user searches, then enables semantic search.

**Then:**
- Before enablement: BM25 search works, no model artifact on disk, no network requests
- On enablement: the pinned artifact downloads from Hugging Face with progress indication; SHA-256 is verified (a tampered artifact is rejected and semantic search stays disabled with a retry path)
- After completed download: worker becomes ready; model and tokenizer load from the local model store
- On subsequent runs: no further network requests

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

### 005-AC-015: RRF fuses ranked lists correctly

**Description:** Reciprocal rank fusion combines the two ranked lists by rank, not score.

**Given:** BM25 ranking [A, B, C] and vector ranking [B, A, D]; k = 60, weights = 1.0.

**When:** RRF fusion is applied.

**Then:**
- score(A) = 1/61 + 1/62, score(B) = 1/62 + 1/61, score(C) = 1/63, score(D) = 1/63
- A and B tie ahead of C and D; ties broken by section ID (005-FR-027)
- No score normalization is performed in rrf mode
- In linear mode, a result set where max == min normalizes all scores to 1.0 (no division by zero)

**Traces to:** 005-FR-024, 005-FR-026

---

### 005-AC-016: Vector distances converted to similarity

**Description:** Cosine distances are converted to similarity scores.

**Given:** Cosine distances [0.0, 0.5, 1.0, 2.0].

**When:** Conversion (`similarity = 1 - cosine_distance`) is applied.

**Then:**
- Similarities are [1.0, 0.5, 0.0, -1.0]
- For [0, 1] display and linear fusion, negative similarities clamp to 0 → [1.0, 0.5, 0.0, 0.0]
- Distance 0 produces similarity 1.0
- Higher distance produces lower similarity

**Traces to:** 005-FR-025

---

### 005-AC-017: Fusion method switch is deterministic

**Description:** Switching fusion methods changes results deterministically; linear mode uses the weight formula.

**Given:** A fixed corpus and query; method = rrf.

**When:** Method is switched to linear (BM25 normalized = 0.8, vector similarity = 0.6, alpha = 0.4, beta = 0.6).

**Then:**
- Linear combined score = 0.4 * 0.8 + 0.6 * 0.6 = 0.68
- Repeating the same query under the same method reproduces the same ordering
- Switching back to rrf restores the rrf ordering

**Traces to:** 005-FR-026

---

### 005-AC-018: Invalid fusion parameters rejected

**Description:** Per-mode parameter validation catches invalid values.

**Given:** Attempt to set linear alpha = 0.7, beta = 0.5 (and separately rrf k = 0).

**When:** Settings are saved.

**Then:**
- Linear mode: error "Weights must sum to 1.0"; previous valid weights retained
- Rrf mode: error for k < 1; previous valid k retained

**Traces to:** 005-FR-028

---

## Settings UI

### 005-AC-019: Fusion controls follow the selected method

**Description:** The Settings overlay shows method-appropriate controls; linear sliders stay linked.

**Given:** Settings overlay is open, method = rrf.

**When:** Method is switched to linear and the alpha slider is dragged to 0.7.

**Then:**
- Rrf controls (k, per-ranker weights) are replaced by linked alpha/beta sliders
- Beta automatically updates to 0.3; sum remains 1.0

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

**Given:** Method = linear with alpha = 0.7, beta = 0.3 is saved.

**When:** App restarts.

**Then:**
- Settings load with method = linear, alpha = 0.7, beta = 0.3
- Searches use these fusion settings

**Traces to:** 005-FR-031

---

### 005-AC-022: Reset to defaults works

**Description:** Reset button restores default fusion settings.

**Given:** Method = linear with custom weights alpha = 0.8, beta = 0.2.

**When:** "Reset to defaults" is clicked.

**Then:**
- Method becomes rrf with k = 60 and per-ranker weights = 1.0
- Preview updates with default settings

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

### 005-AC-024: Advisory rate limiting applied

**Description:** Excessive MCP queries are slowed by backpressure, not rejected.

**Given:** MCP client has made 100 requests in the last minute (default limit).

**When:** Request 101 is made.

**Then:**
- The request is queued and delayed (backpressure), not rejected
- No error is returned; the request eventually completes
- The limit is configurable (shared with Spec #004 FR-042)

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

**Given:** The active profile's model file is missing.

**When:** Worker attempts to initialize.

**Then:**
- Clear error logged: "Failed to load embedding model"
- Graceful degradation to BM25-only mode
- User notified via status indicator

**Traces to:** 005-NFR-005

---

### 005-AC-033: Stale embeddings detected and re-queued

**Description:** Embeddings from a previous model profile are detected and re-embedded.

**Given:** Database contains embeddings with embedder_id "all-MiniLM-L6-v2:1.0:d384" and the active profile is "embeddinggemma-300m:1.0:d256".

**When:** Application starts.

**Then:**
- Stale embeddings are detected via embedder_id mismatch
- Affected sections are queued for re-embedding through the 005-FR-038 content-hash pipeline
- Search excludes stale embeddings until re-embedding completes

**Traces to:** 005-FR-039

---

### 005-AC-034: Index rebuild on sqlite-vec version drift

**Description:** An incompatible sqlite-vec upgrade triggers rebuild from stored embeddings.

**Given:** Stored `vss_sections` index was created by a sqlite-vec version incompatible with the currently pinned one.

**When:** Application starts and the version check (005-FR-003) detects the drift.

**Then:**
- `vss_sections` is rebuilt from the float32 embeddings in the `embeddings` table
- No embedding re-inference occurs
- Progress is surfaced to the user during the rebuild

**Traces to:** 005-FR-040

---

## Acceptance criteria summary

| Category | Count | IDs |
|----------|-------|-----|
| sqlite-vec integration | 3 | 005-AC-001 through 005-AC-003 |
| ONNX embedding worker | 3 | 005-AC-004 through 005-AC-006 |
| Worker pool management | 3 | 005-AC-007 through 005-AC-009 |
| Chunking | 2 | 005-AC-010 through 005-AC-011 |
| Text preprocessing | 1 | 005-AC-031 |
| On-demand model delivery | 1 | 005-AC-032 |
| Vector search | 3 | 005-AC-012 through 005-AC-014 |
| Hybrid search fusion | 4 | 005-AC-015 through 005-AC-018 |
| Settings UI | 4 | 005-AC-019 through 005-AC-022 |
| MCP integration | 2 | 005-AC-023 through 005-AC-024 |
| Performance criteria | 4 | 005-AC-025 through 005-AC-028 |
| Error handling | 2 | 005-AC-029 through 005-AC-030 |
| Model migration | 1 | 005-AC-033 |
| Index maintenance | 1 | 005-AC-034 |
| **Total** | **34** | |
