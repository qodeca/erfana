# Requirements

## Functional requirements

### sqlite-vec integration

#### 005-FR-001: Extension loading

**Title:** Load sqlite-vec extension into better-sqlite3

**Description:** The system shall load the sqlite-vec extension into the existing better-sqlite3 database connection established by Spec #004. Extension loading must occur after database initialization and before any vector operations.

**Priority:** High

**Traces to:** Spec #004 (database infrastructure)

---

#### 005-FR-002: Virtual table creation

**Title:** Create vector virtual table for embeddings

**Description:** The system shall create a virtual table `vss_sections` using sqlite-vec's virtual table syntax. The table shall store vectors of the model-profile dimension (default 256, MRL-truncated from EmbeddingGemma-300m's native 768) with section ID foreign key reference. The dimension shall be read from the model profile, never hardcoded.

**Priority:** High

**Traces to:** 005-FR-001

---

#### 005-FR-003: Version verification

**Title:** Verify sqlite-vec extension version

**Description:** The system shall pin sqlite-vec to an exact version (no caret) in package.json – sqlite-vec is pre-v1 with announced breaking changes to SQL API and storage format – and verify the loaded version matches the pin at startup. Version mismatch shall produce an error, not a warning.

**Priority:** Medium

**Traces to:** 005-FR-001

---

### Embeddings table schema

#### 005-FR-004: Embeddings table schema

**Title:** Create embeddings table with metadata

**Description:** The system shall create an `embeddings` table storing: section_id (FK to sections), chunk_index (integer), embedding (BLOB via sqlite-vec), embedder_id (string identifying model version), and created_at timestamp.

**Priority:** High

**Traces to:** 005-FR-002

---

#### 005-FR-005: Embedder ID tracking

**Title:** Track embedding model version

**Description:** The system shall store an embedder_id with each embedding to track which model version generated it. Format: `{model_name}:{version}:d{dimension}` (e.g., `embeddinggemma-300m:1.0:d256`). When the model changes, stale embeddings shall be re-computed via the 005-FR-039 detection mechanism.

**Priority:** Medium

**Traces to:** 005-FR-004

---

#### 005-FR-006: Foreign key constraints

**Title:** Enforce referential integrity

**Description:** The embeddings table shall have foreign key constraint to sections table with CASCADE DELETE. Deleting a section shall automatically delete associated embeddings.

**Priority:** High

**Traces to:** 005-FR-004, Spec #004 (sections table)

---

### ONNX embedding worker

#### 005-FR-007: Worker initialization

**Title:** Initialize embedding worker thread

**Description:** The system shall create a dedicated worker thread using Node.js worker_threads for embedding inference. The worker shall host a transformers.js v4 feature-extraction pipeline (which uses onnxruntime-node under the hood) and initialize the inference session on startup.

**Priority:** High

**Traces to:** Spec #004 (main process infrastructure)

---

#### 005-FR-008: Model loading

**Title:** Load embedding model

**Description:** The system shall load the EmbeddingGemma-300m ONNX model (quantized variant from `onnx-community/embeddinggemma-300m-ONNX`; record the actual artifact size when pinning) from bundled assets. Native output is 768 dimensions; the system shall apply Matryoshka (MRL) truncation to the configured dimension (default 256). Model path and dimension shall come from a single model-profile config. A low-resource fallback profile (all-MiniLM-L6-v2, 384-dim, ~23 MB) may be offered where bundle size matters. Model path shall be configurable for development/testing.

**Priority:** High

**Traces to:** 005-FR-007

---

#### 005-FR-009: Tokenization

**Title:** Tokenize text via the pipeline

**Description:** Text tokenization shall be provided by the transformers.js pipeline using the bundled tokenizer matching the active model profile (no separate @huggingface/tokenizers dependency). Tokenizer shall be loaded once and reused across batches.

**Priority:** High

**Traces to:** 005-FR-008

---

#### 005-FR-010: Batch processing

**Title:** Process embeddings in batches

**Description:** The system shall process embeddings in batches of 32-128 chunks to optimize throughput. Batch size shall be configurable and auto-tuned based on available memory.

**Priority:** Medium

**Traces to:** 005-FR-007, 005-FR-009

---

#### 005-FR-011: L2 normalization

**Title:** Pooling and normalization

**Description:** The pipeline shall produce sentence embeddings via attention-mask-weighted mean pooling of token embeddings followed by L2 normalization (transformers.js options `pooling: 'mean', normalize: true`), then apply MRL truncation to the profile dimension and re-normalize. Raw un-pooled token output shall never be stored. Pooling and normalization occur in the worker thread after inference.

**Priority:** High

**Traces to:** 005-FR-007

---

### Worker pool management

#### 005-FR-012: Pool creation

**Title:** Create worker pool for parallel embedding

**Description:** The system shall create a pool of embedding workers to parallelize embedding generation. Pool size shall be configurable with default of 2 workers.

**Priority:** High

**Traces to:** 005-FR-007

---

#### 005-FR-013: Concurrency limits

**Title:** Enforce worker concurrency limits

**Description:** The system shall limit maximum concurrent workers to 4 due to onnxruntime-node stability constraints. Attempting to create more workers shall log a warning and cap at 4.

**Priority:** High

**Traces to:** 005-FR-012

---

#### 005-FR-014: Crash recovery

**Title:** Recover from worker crashes

**Description:** The system shall detect worker crashes via error events and automatically spawn replacement workers. Crash recovery shall complete within 5 seconds. Repeated crashes (>3 in 60s) shall trigger graceful degradation to single-worker mode.

**Priority:** High

**Traces to:** 005-FR-012

---

#### 005-FR-015: Batch queue management

**Title:** Queue and distribute batches to workers

**Description:** The system shall maintain a queue of pending batches and distribute them to available workers using round-robin scheduling. Queue depth shall be monitored for backpressure.

**Priority:** Medium

**Traces to:** 005-FR-012, 005-FR-010

---

### Chunking and tokenization

#### 005-FR-016: Token counting

**Title:** Count tokens per text segment

**Description:** The system shall count tokens using the loaded tokenizer to determine chunk boundaries. Token count shall be cached per segment to avoid redundant tokenization.

**Priority:** Medium

**Traces to:** 005-FR-009

---

#### 005-FR-017: Chunk splitting

**Title:** Split text into embedding chunks

**Description:** The system shall split text into chunks of 256-512 tokens. Chunk size shall be configurable with default of 300 tokens. Note: EmbeddingGemma's 2048-token context means chunk size is bounded by retrieval granularity, not the model window.

**Priority:** High

**Traces to:** 005-FR-016

---

#### 005-FR-018: Overlap handling

**Title:** Implement chunk overlap

**Description:** The system shall overlap consecutive chunks by 10-15% (default 12%) to preserve context at boundaries. Overlap percentage shall be configurable.

**Priority:** Medium

**Traces to:** 005-FR-017

---

#### 005-FR-019: Sentence boundary respect

**Title:** Respect sentence boundaries

**Description:** The system shall attempt to break chunks at sentence boundaries when possible. If a sentence exceeds max chunk size, it shall be split at the token limit.

**Priority:** Low

**Traces to:** 005-FR-017

---

### Text preprocessing

#### 005-FR-035: Text preprocessing

**Title:** Preprocess markdown before embedding

**Description:** The system shall preprocess markdown text before embedding generation to remove:
- YAML frontmatter
- Code blocks (preserve inline code as plain text)
- HTML tags
- Image syntax (preserve alt text)
- Link syntax (preserve link text)
- Emphasis markers (**bold**, *italic*)
- Heading markers (#)
- List markers (-, *, 1.)
- Blockquote markers (>)

The system shall normalize whitespace (max 2 consecutive newlines, collapse multiple spaces).

**Priority:** High

**Traces to:** 005-FR-007 (worker processes preprocessed text), embedding quality

---

### Vector similarity search

#### 005-FR-020: Query embedding generation

**Title:** Generate embedding for search query

**Description:** The system shall generate an embedding of the model-profile dimension for the search query using the same model, pooling, normalization, and truncation as document embeddings.

**Priority:** High

**Traces to:** 005-FR-007, 005-FR-011

---

#### 005-FR-021: L2 distance search

**Title:** Search by cosine distance

**Description:** The system shall use sqlite-vec's cosine distance (`distance_metric=cosine` on the virtual table) to find nearest neighbors. Note: L2 distance on normalized vectors is rank-equivalent to cosine, but the system standardizes on cosine.

**Priority:** High

**Traces to:** 005-FR-002, 005-FR-020

---

#### 005-FR-022: Top-K retrieval

**Title:** Retrieve top-K results

**Description:** The system shall support retrieving the top K nearest vectors with configurable K (default 20). Results shall include section ID, chunk index, and distance score.

**Priority:** High

**Traces to:** 005-FR-021

---

#### 005-FR-023: Result aggregation

**Title:** Aggregate chunk results to sections

**Description:** The system shall aggregate chunk-level results to section level by taking the minimum distance (closest match) across all chunks belonging to a section.

**Priority:** Medium

**Traces to:** 005-FR-022

---

### Hybrid search fusion

#### 005-FR-024: Reciprocal rank fusion (default)

**Title:** Fuse result lists with RRF

**Description:** The system shall fuse BM25 and vector result lists with reciprocal rank fusion: `score(d) = Σ_r w_r / (k + rank_r(d))` over the rankers that returned d, with k = 60 (configurable, ≥ 1) and per-ranker weights w_r default 1.0. RRF operates on ranks, requiring no score normalization. Zero results from both rankers shall produce an empty fused set.

**Priority:** High

**Traces to:** Spec #004 (BM25 search), 005-FR-021

---

#### 005-FR-025: Vector distance normalization

**Title:** Convert distance to similarity

**Description:** The system shall convert cosine distances to similarity scores. Formula: `similarity = 1 - cosine_distance`. Cosine distance is in [0, 2], so similarity is in [-1, 1]; for the linear-fusion mode and any [0, 1] display score, negative similarities shall be clamped to 0. Closer vectors produce higher similarity.

**Priority:** High

**Traces to:** 005-FR-021

---

#### 005-FR-026: Fusion method selection

**Title:** Select fusion method

**Description:** The system shall support fusion methods `rrf` (default) and `linear`. Linear mode combines min-max-normalized BM25 scores with clamped vector similarity as `final_score = alpha * bm25_normalized + beta * vector_similarity` (defaults alpha=0.4, beta=0.6), retained for experimentation. In linear mode, when max == min within a result set, all scores in that set normalize to 1.0.

**Priority:** High

**Traces to:** 005-FR-024, 005-FR-025

---

#### 005-FR-027: Result ordering

**Title:** Order results by combined score

**Description:** The system shall order final results by descending combined score. Ties shall be broken by section ID for deterministic ordering.

**Priority:** Medium

**Traces to:** 005-FR-026

---

#### 005-FR-028: Weight constraints

**Title:** Validate fusion parameter constraints

**Description:** The system shall enforce per-mode constraints: rrf mode – k ≥ 1 and per-ranker weights ≥ 0; linear mode – alpha + beta = 1.0 and both weights in [0, 1]. Invalid parameters shall be rejected with descriptive error.

**Priority:** Medium

**Traces to:** 005-FR-026

---

### Settings UI

#### 005-FR-029: Fusion tuning controls

**Title:** Provide fusion tuning controls

**Description:** The system shall provide a fusion-method selector (rrf | linear) in the Settings overlay with method-appropriate controls: rrf mode – k and per-ranker weights; linear mode – linked alpha/beta sliders (adjusting one updates the other to maintain sum = 1).

**Priority:** Medium

**Traces to:** 005-FR-026

---

#### 005-FR-030: Live preview

**Title:** Preview search results with current weights

**Description:** The system shall show a live preview of search results with current fusion settings. Preview shall update debounced (300ms) as settings change.

**Priority:** Low

**Traces to:** 005-FR-029

---

#### 005-FR-031: Settings persistence

**Title:** Persist weight settings

**Description:** The system shall persist fusion settings (method, k, weights) to global settings (GlobalSettingsService). Settings shall be loaded on app start and applied to all searches.

**Priority:** Medium

**Traces to:** 005-FR-029

---

#### 005-FR-032: Reset to defaults

**Title:** Reset fusion settings to defaults

**Description:** The system shall provide a "Reset to defaults" button to restore fusion settings to method=rrf, k=60, per-ranker weights=1.0 (linear-mode defaults remain alpha=0.4, beta=0.6).

**Priority:** Low

**Traces to:** 005-FR-029

---

### MCP integration

#### 005-FR-033: erfana_graph_related tool

**Title:** Implement erfana_graph_related MCP tool

**Description:** The system shall expose an MCP tool `erfana_graph_related` that finds sections related to a given section ID using vector similarity. Input: section_id, limit (default 10). Output: list of related sections with similarity scores.

**Priority:** High

**Traces to:** 005-FR-021, Spec #004 (MCP server)

---

#### 005-FR-034: Rate limiting

**Title:** MCP rate limiting (advisory)

**Description:** The system shall apply the shared advisory MCP rate limit (Spec #004 FR-042: configurable, default 100 queries/minute, backpressure queue-and-delay, never hard rejection) to `erfana_graph_related` queries.

**Priority:** Medium

**Traces to:** 005-FR-033, Spec #004 FR-042

---

### Model bundling

#### 005-FR-036: Model bundling

**Title:** Bundle embedding model with application

**Description:** The system shall bundle the EmbeddingGemma-300m quantized ONNX model and tokenizer files in the application resources folder at `resources/models/` (record the actual artifact size when pinning; it is substantially larger than MiniLM's ~23 MB – trade-off accepted 2026-07-23). The application shall not require network access to download models at runtime.

**Priority:** High

**Traces to:** Offline operation, deployment simplicity

---

### Scalability options

#### 005-FR-037: Binary quantization support (optional)

**Title:** Support binary quantization for large datasets

**Description:** The system shall support optional binary quantization of model-profile-dimension vectors for large datasets, using the two-stage oversample-and-rescore design specified in Spec #008 (FR-020); float32 vectors are retained for rescoring, so the ~32x reduction applies to the binary index footprint, not total storage. Recommendation threshold aligned with Spec #008 FR-028 (100,000 documents).

**Priority:** Low (Could)

**Traces to:** Scalability for large documentation projects, Spec #008

---

### Performance optimization

#### 005-FR-038: Content hash deduplication

**Title:** Skip re-embedding unchanged content

**Description:** The system shall compute SHA-256 hash of normalized/preprocessed text and skip re-embedding if the hash matches an existing embedding record. This optimization avoids redundant embedding computation for unchanged content.

**Priority:** Medium

**Traces to:** Performance optimization, resource efficiency

---

#### 005-FR-039: Stale-embedding detection

**Title:** Detect and re-embed stale embeddings on model change

**Description:** On startup and after any model-profile change, the system shall scan for embeddings whose embedder_id differs from the active profile and queue affected sections for re-embedding, reusing the 005-FR-038 content-hash pipeline. Search shall exclude stale embeddings.

**Priority:** Medium

**Traces to:** 005-FR-005, 005-FR-038

---

#### 005-FR-040: Vector index rebuild on version drift

**Title:** Rebuild vector index after incompatible sqlite-vec upgrade

**Description:** When a sqlite-vec upgrade is incompatible with the stored index format, the system shall rebuild `vss_sections` from the float32 embeddings retained in the `embeddings` table (no re-inference needed), with progress surfaced to the user (minimal progress indication in M2; upgraded to the Spec #008 reindex-progress UX once that ships – soft dependency, not blocking).

**Priority:** Medium

**Traces to:** 005-FR-003, 005-FR-004

---

## Non-functional requirements

### Performance

#### 005-NFR-001: Embedding throughput

**Title:** Embedding generation throughput

**Description:** The system shall generate embeddings at >100 chunks per second with 2-worker pool on modern hardware (M1/M2 Mac or equivalent).

**Acceptance:** Benchmark test processes 1000 chunks in <10 seconds.

---

#### 005-NFR-002: Search latency

**Title:** Vector search latency

**Description:** The system shall return vector search results within 100ms for databases up to 100,000 document sections.

**Acceptance:** P95 latency <100ms with 100K sections and 500K embeddings.

---

#### 005-NFR-003: Hybrid search latency

**Title:** Combined hybrid search latency

**Description:** The system shall return hybrid search results (BM25 + vector) within 150ms total, including both searches and fusion.

**Acceptance:** P95 latency <150ms with 100K sections.

---

### Reliability

#### 005-NFR-004: Worker crash recovery

**Title:** Worker crash recovery time

**Description:** The system shall recover from worker crashes within 5 seconds, automatically respawning workers and resuming queue processing.

**Acceptance:** Injected worker crash recovers and resumes within 5s.

---

#### 005-NFR-005: Graceful degradation

**Title:** Graceful degradation on embedding failure

**Description:** The system shall fall back to BM25-only search if vector search is unavailable (worker pool exhausted, model load failure). User shall see warning toast.

**Acceptance:** Forced embedding failure results in BM25 results with warning.

---

### Resource management

#### 005-NFR-006: Memory limits

**Title:** Embedding cache memory limits

**Description:** The system shall limit in-memory embedding cache to 100MB. LRU eviction shall occur when limit is reached.

**Acceptance:** Cache does not exceed 100MB under load.

---

#### 005-NFR-007: Worker concurrency stability

**Title:** Worker pool stability limit

**Description:** The system shall not exceed 4 concurrent ONNX workers due to onnxruntime-node stability constraints documented in their issue tracker. Re-verify the 4-worker cap against the current onnxruntime-node issue tracker at implementation time; adjust if resolved upstream.

**Acceptance:** Configuration attempting >4 workers is capped at 4.

---

### Usability

#### 005-NFR-008: Weight UI responsiveness

**Title:** Settings UI responsiveness

**Description:** Weight slider adjustments shall update the preview within 300ms debounce. UI shall remain responsive during preview computation.

**Acceptance:** Slider dragging feels smooth, preview updates after settling.

---

## Requirement summary

| Category | Count | IDs |
|----------|-------|-----|
| Functional Requirements | 40 | 005-FR-001 through 005-FR-040 |
| Non-Functional Requirements | 8 | 005-NFR-001 through 005-NFR-008 |
| **Total** | **48** |
